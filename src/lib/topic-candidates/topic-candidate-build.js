import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

import { getServiceConfig } from "../config.js";
import { withClient as defaultWithClient } from "../db/pool.js";
import { HttpError, notFound } from "../http/errors.js";
import { getCollection as defaultGetCollection } from "../source-collections/source-collections.js";
import { readArtifactJson as defaultReadArtifactJson } from "../storage/artifacts.js";

const runtimeProfiles = ["demo", "mvp", "prod"];
const parentEdgeTypes = new Set(["contains", "parent", "has_child", "part_of"]);

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

function topicCandidateError(message, code, details = null) {
  return new HttpError(message, {
    status: 400,
    code,
    type: "bad_request",
    details,
  });
}

function assertProfileAllowed(collection, profile) {
  if (!runtimeProfiles.includes(profile)) {
    throw topicCandidateError(`Invalid runtime profile: ${profile}`, "invalid_runtime_profile", {
      allowed_profiles: runtimeProfiles,
    });
  }
  const allowedProfiles = collection.publish_profiles ?? [];
  if (!allowedProfiles.includes(profile)) {
    const code = collection.license_scope === "non_commercial_demo_only" ? "demo_only_source_blocked" : "profile_not_allowed_by_collection";
    throw topicCandidateError(`Collection ${collection.collection_id} is not allowed for profile ${profile}.`, code, {
      collection_id: collection.collection_id,
      profile,
      allowed_profiles: allowedProfiles,
      license_scope: collection.license_scope ?? null,
    });
  }
}

function slugPart(value) {
  return String(value ?? "unknown")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function topicKeyFor(node) {
  const sourceTopicId = node.source_ref?.source_topic_id ?? node.id;
  return ["k12", node.subject, node.learning_stage, sourceTopicId].map(slugPart).filter(Boolean).join("_");
}

function parentTopicKeyByChild(sourceArtifact) {
  const nodesById = new Map((sourceArtifact.nodes ?? []).map((node) => [node.id, node]));
  const parents = new Map();
  for (const edge of sourceArtifact.edges ?? []) {
    if (!parentEdgeTypes.has(edge.edge_type)) {
      continue;
    }
    const parent = nodesById.get(edge.source_node_id);
    if (parent) {
      parents.set(edge.target_node_id, topicKeyFor(parent));
    }
  }
  return parents;
}

function candidateFromNode({ node, collection, sourceArtifact, parentKey }) {
  const sourceRef = node.source_ref ?? {};
  return {
    topic_key: topicKeyFor(node),
    label: node.label,
    aliases: Array.isArray(node.aliases) ? node.aliases : [],
    subject: node.subject,
    learning_stage: node.learning_stage,
    topic_family: String(node.node_type ?? "concept").toLowerCase(),
    source: sourceRef.source ?? null,
    source_topic_id: sourceRef.source_topic_id ?? node.id,
    source_node_type: node.node_type ?? null,
    parent_topic_key: parentKey ?? null,
    source_refs: [
      {
        collection_id: collection.collection_id,
        source: sourceRef.source ?? null,
        topic_id: sourceRef.source_topic_id ?? node.id,
      },
    ],
    metadata: {
      collection_id: collection.collection_id,
      source_artifact_id: sourceArtifact.artifact_id,
      source_artifact_checksum_sha256: sourceArtifact.checksum_sha256 ?? null,
      official_curriculum_verified: Boolean(collection.official_curriculum_verified),
      license_scope: collection.license_scope,
    },
  };
}

export function buildTopicCandidateArtifact({ collection, profile, sourceArtifact } = {}) {
  assertProfileAllowed(collection, profile);
  if (sourceArtifact.schema_version !== "source_graph.v1" || !Array.isArray(sourceArtifact.nodes)) {
    throw topicCandidateError("Topic candidates require a normalized source_graph.v1 artifact.", "topic_candidate_invalid_source_artifact", {
      source_artifact_id: sourceArtifact?.artifact_id ?? null,
    });
  }
  const parentKeys = parentTopicKeyByChild(sourceArtifact);
  const data = [...sourceArtifact.nodes]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((node) => candidateFromNode({ node, collection, sourceArtifact, parentKey: parentKeys.get(node.id) }));
  const core = {
    object: "topic_candidate_artifact",
    collection_id: collection.collection_id,
    profile,
    artifact_type: "topic_candidates",
    schema_version: "topic_candidates.v1",
    source_artifact_id: sourceArtifact.artifact_id,
    source_artifact_checksum_sha256: sourceArtifact.checksum_sha256 ?? null,
    license_scope: collection.license_scope,
    data,
    summary: {
      candidate_count: data.length,
      subjects: [...new Set(data.map((candidate) => candidate.subject).filter(Boolean))].sort(),
    },
  };
  const checksum = sha256Text(stableStringify(core));
  return {
    artifact_id: `topic-candidates:${collection.collection_id}:${profile}:sha256:${checksum}`,
    checksum_sha256: checksum,
    ...core,
  };
}

async function writeDefaultArtifact(artifact) {
  const storageRoot = path.resolve(process.cwd(), getServiceConfig().storageRoot);
  const storagePath = `topic-candidates/${artifact.collection_id}/${artifact.profile}/sha256/${artifact.checksum_sha256}.json`;
  const fullPath = path.join(storageRoot, storagePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return {
    storage_path: storagePath,
    checksum_sha256: artifact.checksum_sha256,
  };
}

async function defaultFindSourceArtifact({ client, collectionId }) {
  const result = await client.query(
    `
      SELECT *
      FROM knowledge_source_artifacts
      WHERE artifact_type = $1
        AND publish_status IN ($2, $3)
        AND metadata->>'collection_id' = $4
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1
    `,
    ["normalized_knowledge_graph", "validated", "imported", collectionId],
  );
  const artifact = result.rows[0];
  if (!artifact) {
    throw notFound("Normalized source graph artifact not found.");
  }
  return artifact;
}

async function upsertArtifact(client, { collection, artifact, artifactWrite, sourceArtifact }) {
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
      artifact.artifact_id,
      artifact.artifact_type,
      collection.source_ids?.[0] ?? null,
      sourceArtifact.artifact_id,
      artifactWrite.storage_path,
      "application/json",
      "validated",
      artifact.summary.candidate_count,
      artifactWrite.checksum_sha256,
      JSON.stringify({
        collection_id: artifact.collection_id,
        profile: artifact.profile,
        source_artifact_id: artifact.source_artifact_id,
        source_artifact_checksum_sha256: artifact.source_artifact_checksum_sha256,
        license_scope: artifact.license_scope,
      }),
    ],
  );
}

async function insertAuditEvent(client, { actor, artifact, artifactWrite }) {
  await client.query(
    `
      INSERT INTO knowledge_source_audit_events (event_type, actor, target_type, target_id, payload)
      VALUES ($1, $2, $3, $4, $5)
    `,
    [
      "topic_candidates.built",
      actor,
      "topic_candidate_artifact",
      artifact.artifact_id,
      JSON.stringify({
        collection_id: artifact.collection_id,
        profile: artifact.profile,
        artifact_id: artifact.artifact_id,
        checksum_sha256: artifact.checksum_sha256,
        storage_path: artifactWrite.storage_path,
        candidate_count: artifact.summary.candidate_count,
      }),
    ],
  );
}

export function createTopicCandidateBuilder({
  withClient = defaultWithClient,
  getCollection = defaultGetCollection,
  findSourceArtifact = defaultFindSourceArtifact,
  readArtifactJson = defaultReadArtifactJson,
  writeArtifact = writeDefaultArtifact,
} = {}) {
  async function buildTopicCandidates({ collectionId, profile, actor = "script" } = {}) {
    const collection = await getCollection(collectionId);
    return withClient(async (client) => {
      const sourceArtifactRow = await findSourceArtifact({ client, collectionId, profile });
      const sourceArtifact = await readArtifactJson(sourceArtifactRow.storage_path);
      const candidateArtifact = buildTopicCandidateArtifact({
        collection,
        profile,
        sourceArtifact: {
          ...sourceArtifact,
          artifact_id: sourceArtifact.artifact_id ?? sourceArtifactRow.artifact_id,
          checksum_sha256: sourceArtifact.checksum_sha256 ?? sourceArtifactRow.checksum_sha256,
        },
      });
      const artifactWrite = await writeArtifact(candidateArtifact);

      await client.query("BEGIN");
      try {
        await upsertArtifact(client, { collection, artifact: candidateArtifact, artifactWrite, sourceArtifact: sourceArtifactRow });
        await insertAuditEvent(client, { actor, artifact: candidateArtifact, artifactWrite });
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }

      return {
        object: "topic_candidate_build_result",
        collection_id: collectionId,
        profile,
        artifact: {
          artifact_id: candidateArtifact.artifact_id,
          artifact_type: candidateArtifact.artifact_type,
          storage_path: artifactWrite.storage_path,
          checksum_sha256: artifactWrite.checksum_sha256,
          publish_status: "validated",
          candidate_count: candidateArtifact.summary.candidate_count,
          source_artifact_id: candidateArtifact.source_artifact_id,
        },
      };
    });
  }

  return {
    buildTopicCandidates,
  };
}
