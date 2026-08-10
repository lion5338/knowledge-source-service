import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

import { getServiceConfig } from "../config.js";
import { withClient as defaultWithClient } from "../db/pool.js";
import { HttpError } from "../http/errors.js";
import { resolveKnowledgeAccess as defaultResolveKnowledgeAccess } from "../knowledge-access/knowledge-access-resolver.js";
import { findTenantEntitlements as defaultFindTenantEntitlements } from "../knowledge-access/tenant-entitlements.js";
import { listCollections as defaultListCollections } from "../source-collections/source-collections.js";
import { readArtifactJson as defaultReadArtifactJson } from "../storage/artifacts.js";
import {
  evaluateCollectionForProfile,
  resolveRuntimeProfile,
  summarizeProfileDecision,
} from "../runtime-profile/runtime-profile-policy.js";

const maxRetrievalLimit = 20;

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256Text(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function retrievalError(message, code, details = null) {
  return new HttpError(message, {
    status: 400,
    code,
    type: "bad_request",
    details,
  });
}

function parseLimit(value) {
  return Math.min(Math.max(Number(value) || maxRetrievalLimit, 1), maxRetrievalLimit);
}

function normalizeQuery(query) {
  const normalized = String(query ?? "").trim().toLowerCase();
  if (!normalized) {
    throw retrievalError("Retrieval query is required.", "retrieval_query_required", { field: "query" });
  }
  return normalized;
}

function resolveOptionalRetrievalProfile(profile, access) {
  if (profile === undefined || profile === null || String(profile).trim() === "") {
    return (access?.effective_collection_ids ?? []).includes("k12_kgraph_full") ? "demo" : "prod";
  }
  return resolveRuntimeProfile(profile);
}

function tokenize(value) {
  return String(value ?? "")
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/u)
    .map((token) => token.trim())
    .filter(Boolean);
}

function scoreDocument(document, query) {
  const haystack = `${document.title ?? ""} ${document.text ?? ""}`.toLowerCase();
  let score = haystack.includes(query) ? 10 : 0;
  const queryTokens = new Set(tokenize(query));
  const documentTokens = new Set(tokenize(haystack));
  for (const token of queryTokens) {
    if (documentTokens.has(token)) {
      score += 1;
    }
  }
  return score;
}

function sourceRefForRecord(record = {}) {
  return record.source_ref ?? record.source_refs?.[0] ?? null;
}

function recordToDocument({ artifact, record }) {
  const sourceRef = sourceRefForRecord(record);
  if (!sourceRef) {
    return null;
  }
  const recordId = record.id ?? record.topic_key ?? sourceRef.topic_id ?? sourceRef.source_topic_id;
  const collectionId = record.collection_id ?? artifact.collection_id ?? sourceRef.collection_id;
  return {
    document_id: `${collectionId}:${recordId}`,
    collection_id: collectionId,
    source: sourceRef.source ?? null,
    source_ref: sourceRef,
    subject: record.subject ?? null,
    learning_stage: record.learning_stage ?? null,
    title: record.title ?? record.label ?? record.topic_key ?? recordId,
    text: record.text ?? [record.label, ...(record.aliases ?? [])].filter(Boolean).join(" "),
    license_scope: record.license_scope ?? record.metadata?.license_scope ?? artifact.license_scope ?? null,
    artifact_id: artifact.artifact_id,
    checksum_sha256: artifact.checksum_sha256 ?? null,
  };
}

function artifactToDocuments(artifact) {
  if (artifact.schema_version === "source_documents.v1" || Array.isArray(artifact.records)) {
    return (artifact.records ?? []).map((record) => recordToDocument({ artifact, record })).filter(Boolean);
  }
  if (artifact.artifact_type === "topic_candidates" || artifact.schema_version === "topic_candidates.v1" || Array.isArray(artifact.data)) {
    return (artifact.data ?? []).map((record) => recordToDocument({ artifact, record })).filter(Boolean);
  }
  return [];
}

function applyRequestFilters(documents, { subject, learning_stage: learningStage, allowed_source_scopes: allowedScopes }) {
  const scopes = Array.isArray(allowedScopes) && allowedScopes.length > 0 ? new Set(allowedScopes) : null;
  return documents.filter((document) => {
    if (subject && document.subject !== subject) {
      return false;
    }
    if (learningStage && document.learning_stage !== learningStage) {
      return false;
    }
    if (scopes && !scopes.has(document.license_scope)) {
      return false;
    }
    return true;
  });
}

function restrictIndexToCollections(index, collectionIds) {
  const allowedCollections = new Set(collectionIds);
  const documents = (index.documents ?? []).filter((document) => allowedCollections.has(document.collection_id));
  return {
    ...index,
    documents,
    source_artifact_ids: [...new Set(documents.map((document) => document.artifact_id).filter(Boolean))].sort(),
  };
}

function resultFromDocument(document, score) {
  const localId = String(document.document_id).includes(":") ? String(document.document_id).split(":").slice(1).join(":") : document.document_id;
  return {
    result_id: `retrieval:${document.collection_id}:${localId}`,
    collection_id: document.collection_id,
    source: document.source,
    source_ref: document.source_ref,
    title: document.title,
    text: document.text,
    score,
    license_scope: document.license_scope,
    artifact_id: document.artifact_id,
    checksum_sha256: document.checksum_sha256,
  };
}

export function retrieveFromIndex(index, request = {}) {
  const query = normalizeQuery(request.query);
  const filtered = applyRequestFilters(index.documents ?? [], request);
  return filtered
    .map((document) => ({ document, score: scoreDocument(document, query) }))
    .filter((item) => item.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.document.collection_id.localeCompare(right.document.collection_id) ||
        left.document.document_id.localeCompare(right.document.document_id),
    )
    .slice(0, parseLimit(request.limit))
    .map((item) => resultFromDocument(item.document, item.score));
}

export function resolveTenantSourcePolicy({ tenantId = null } = {}) {
  return {
    tenant_id: tenantId ?? null,
    policy_status: "default_policy",
    allowed_collection_ids: [],
    blocked_collection_ids: [],
  };
}

function applyTenantPolicy(collections, tenantTrace) {
  const blocked = new Set(tenantTrace.blocked_collection_ids ?? []);
  return collections.filter((collection) => !blocked.has(collection.collection_id));
}

function profileTraceFor({ profile, collections }) {
  const decisions = collections.map((collection) => evaluateCollectionForProfile(collection, profile, "retrieval"));
  return {
    profile,
    ...summarizeProfileDecision(decisions),
  };
}

export function buildRetrievalIndex({ profile: inputProfile, collections = [], sourceArtifacts = [] } = {}) {
  const profile = resolveRuntimeProfile(inputProfile);
  const profileTrace = profileTraceFor({ profile, collections });
  const allowedCollections = new Set(profileTrace.source_collection_ids);
  const documents = sourceArtifacts
    .filter((artifact) => allowedCollections.has(artifact.collection_id))
    .filter((artifact) => !artifact.profile || artifact.profile === profile)
    .flatMap((artifact) => artifactToDocuments(artifact))
    .sort((left, right) => left.document_id.localeCompare(right.document_id));
  const core = {
    artifact_type: "retrieval_index",
    profile,
    schema_version: "retrieval_index.v1",
    source_artifact_ids: [...new Set(documents.map((document) => document.artifact_id))].sort(),
    documents,
    summary: {
      document_count: documents.length,
    },
    profile_trace: profileTrace,
  };
  const checksum = sha256Text(stableStringify(core));
  return {
    artifact_id: `retrieval-index:${profile}:sha256:${checksum}`,
    checksum_sha256: checksum,
    ...core,
  };
}

async function defaultFindRetrievalSourceArtifacts({ client, profile, collectionIds }) {
  if (!collectionIds.length) {
    return [];
  }
  const result = await client.query(
    `
      SELECT *
      FROM knowledge_source_artifacts
      WHERE publish_status IN ($1, $2)
        AND (
          (artifact_type = $3 AND metadata->>'collection_id' = ANY($5::text[]))
          OR (artifact_type = $4 AND metadata->>'collection_id' = ANY($5::text[]) AND metadata->>'profile' = $6)
        )
      ORDER BY artifact_type ASC, artifact_id ASC
    `,
    ["validated", "published", "normalized_documents", "topic_candidates", collectionIds, profile],
  );
  return result.rows;
}

async function defaultFindRetrievalIndexArtifact({ client, profile }) {
  const result = await client.query(
    `
      SELECT *
      FROM knowledge_source_artifacts
      WHERE artifact_id = $1
        AND artifact_type = $2
        AND publish_status = $3
      LIMIT 1
    `,
    [`retrieval-index:${profile}:latest`, "retrieval_index", "published"],
  );
  return result.rows[0] ?? null;
}

async function loadSourceArtifacts({ rows, readArtifactJson }) {
  const artifacts = [];
  for (const row of rows) {
    const payload = await readArtifactJson(row.storage_path);
    artifacts.push({
      ...payload,
      artifact_id: payload.artifact_id ?? row.artifact_id,
      checksum_sha256: payload.checksum_sha256 ?? row.checksum_sha256,
    });
  }
  return artifacts;
}

export function createKnowledgeRetriever({
  withClient = defaultWithClient,
  listCollections = defaultListCollections,
  findRetrievalIndexArtifact = defaultFindRetrievalIndexArtifact,
  findRetrievalSourceArtifacts = defaultFindRetrievalSourceArtifacts,
  readArtifactJson = defaultReadArtifactJson,
  getConfig = getServiceConfig,
  resolveKnowledgeAccess = defaultResolveKnowledgeAccess,
  findTenantEntitlements = defaultFindTenantEntitlements,
} = {}) {
  async function retrieve(request = {}) {
    normalizeQuery(request.query);
    const limit = parseLimit(request.limit);
    const collections = (await listCollections({ tenantIdentity: request.accessIdentity ?? null })).data ?? [];
    const tenant = resolveTenantSourcePolicy({ tenantId: request.tenant_id });
    const config = getConfig().knowledgeAccess;
    const tenantEntitlements =
      config.enableTenant && (request.accessIdentity?.tenant_id || request.accessIdentity?.user_id)
        ? await findTenantEntitlements({ keyIdentity: request.accessIdentity })
        : [];
    const access = resolveKnowledgeAccess({
      config,
      collections,
      tenantEntitlements,
      keyIdentity: request.accessIdentity ?? null,
      requestedCollectionIds: request.collection_ids ?? [],
    });
    const profile = resolveOptionalRetrievalProfile(request.profile, access);
    const profileTrace = profileTraceFor({ profile, collections: applyTenantPolicy(collections, tenant) });
    const profileAllowedCollectionIds = new Set(profileTrace.source_collection_ids);
    const allowedCollectionIds = access.effective_collection_ids.filter((collectionId) => profileAllowedCollectionIds.has(collectionId));

    return withClient(async (client) => {
      const retrievalIndexRow = await findRetrievalIndexArtifact({ client, profile });
      let index;
      let retrievalMode;
      let retrievalIndexArtifactId = null;
      let retrievalIndexChecksum = null;
      if (retrievalIndexRow) {
        index = await readArtifactJson(retrievalIndexRow.storage_path);
        retrievalMode = "retrieval_index";
        retrievalIndexArtifactId = retrievalIndexRow.artifact_id;
        retrievalIndexChecksum = retrievalIndexRow.checksum_sha256;
      } else {
        const sourceRows = await findRetrievalSourceArtifacts({ client, profile, collectionIds: allowedCollectionIds });
        const sourceArtifacts = await loadSourceArtifacts({ rows: sourceRows, readArtifactJson });
        index = buildRetrievalIndex({ profile, collections, sourceArtifacts });
        retrievalMode = "normalized_scan";
      }

      const policySafeIndex = restrictIndexToCollections(index, allowedCollectionIds);
      const results = retrieveFromIndex(policySafeIndex, { ...request, profile, limit });
      return {
        object: "retrieval_result",
        profile,
        results,
        trace: {
          status: "ok",
          profile,
          filters: {
            subject: request.subject ?? null,
            learning_stage: request.learning_stage ?? null,
            allowed_source_scopes: request.allowed_source_scopes ?? null,
          },
          limit,
          source_collections: profileTrace.source_collection_ids,
          blocked_collections: profileTrace.blocked_collection_ids,
          policy_decisions: profileTrace.policy_decisions,
          retrieval_mode: retrievalMode,
          retrieval_index_artifact_id: retrievalIndexArtifactId,
          retrieval_index_checksum_sha256: retrievalIndexChecksum,
          artifact_ids: policySafeIndex.source_artifact_ids ?? [],
          tenant,
          access,
        },
      };
    });
  }

  return {
    retrieve,
  };
}

async function writeDefaultRetrievalIndex(index) {
  const storageRoot = path.resolve(process.cwd(), getServiceConfig().storageRoot);
  const storagePath = `retrieval-index/${index.profile}/versions/sha256/${index.checksum_sha256}.json`;
  const fullPath = path.join(storageRoot, storagePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  return {
    storage_path: storagePath,
    checksum_sha256: index.checksum_sha256,
  };
}

async function upsertRetrievalArtifact(client, { artifactId, index, storagePath, checksumSha256, metadata }) {
  await client.query(
    `
      INSERT INTO knowledge_source_artifacts
        (artifact_id, artifact_type, source, source_version, storage_path, content_type, publish_status, record_count, checksum_sha256, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (artifact_id) DO UPDATE SET
        artifact_type = EXCLUDED.artifact_type,
        source = EXCLUDED.source,
        source_version = EXCLUDED.source_version,
        storage_path = EXCLUDED.storage_path,
        content_type = EXCLUDED.content_type,
        publish_status = EXCLUDED.publish_status,
        record_count = EXCLUDED.record_count,
        checksum_sha256 = EXCLUDED.checksum_sha256,
        metadata = EXCLUDED.metadata,
        updated_at = now()
    `,
    [
      artifactId,
      "retrieval_index",
      null,
      null,
      storagePath,
      "application/json",
      "published",
      index.summary.document_count,
      checksumSha256,
      JSON.stringify(metadata),
    ],
  );
}

async function insertRetrievalIndexAuditEvent(client, { actor, index, aliasId }) {
  await client.query(
    `
      INSERT INTO knowledge_source_audit_events (event_type, actor, target_type, target_id, payload)
      VALUES ($1, $2, $3, $4, $5)
    `,
    [
      "retrieval_index.profile_published",
      actor,
      "retrieval_index",
      aliasId,
      JSON.stringify({
        profile: index.profile,
        alias_artifact_id: aliasId,
        points_to_artifact_id: index.artifact_id,
        checksum_sha256: index.checksum_sha256,
        profile_trace: index.profile_trace,
      }),
    ],
  );
}

export function createRetrievalIndexBuilder({
  withClient = defaultWithClient,
  listCollections = defaultListCollections,
  findRetrievalSourceArtifacts = defaultFindRetrievalSourceArtifacts,
  readArtifactJson = defaultReadArtifactJson,
  writeArtifact = writeDefaultRetrievalIndex,
} = {}) {
  async function buildRetrievalIndexForProfile({ profile: inputProfile, actor = "script" } = {}) {
    const profile = resolveRuntimeProfile(inputProfile);
    const collections = (await listCollections()).data ?? [];
    const profileTrace = profileTraceFor({ profile, collections });
    const sourceRows = await withClient(async (client) =>
      findRetrievalSourceArtifacts({ client, profile, collectionIds: profileTrace.source_collection_ids }),
    );
    const sourceArtifacts = await loadSourceArtifacts({ rows: sourceRows, readArtifactJson });
    const index = buildRetrievalIndex({ profile, collections, sourceArtifacts });
    const artifactWrite = await writeArtifact(index);
    const aliasId = `retrieval-index:${profile}:latest`;

    await withClient(async (client) => {
      await client.query("BEGIN");
      try {
        await upsertRetrievalArtifact(client, {
          artifactId: index.artifact_id,
          index,
          storagePath: artifactWrite.storage_path,
          checksumSha256: artifactWrite.checksum_sha256,
          metadata: {
            profile,
            alias_artifact_id: aliasId,
            source_artifact_ids: index.source_artifact_ids,
            profile_trace: index.profile_trace,
          },
        });
        await upsertRetrievalArtifact(client, {
          artifactId: aliasId,
          index,
          storagePath: artifactWrite.storage_path,
          checksumSha256: artifactWrite.checksum_sha256,
          metadata: {
            profile,
            points_to_artifact_id: index.artifact_id,
            source_artifact_ids: index.source_artifact_ids,
            profile_trace: index.profile_trace,
          },
        });
        await insertRetrievalIndexAuditEvent(client, { actor, index, aliasId });
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    });

    return {
      object: "retrieval_index_build_result",
      profile,
      alias: {
        artifact_id: aliasId,
        points_to_artifact_id: index.artifact_id,
        checksum_sha256: artifactWrite.checksum_sha256,
        publish_status: "published",
      },
      version: {
        artifact_id: index.artifact_id,
        storage_path: artifactWrite.storage_path,
        checksum_sha256: artifactWrite.checksum_sha256,
        publish_status: "published",
      },
      summary: index.summary,
      profile_trace: index.profile_trace,
    };
  }

  return {
    buildRetrievalIndexForProfile,
  };
}
