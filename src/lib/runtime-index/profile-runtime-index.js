import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

import { getServiceConfig } from "../config.js";
import { withClient as defaultWithClient } from "../db/pool.js";
import { listCollections as defaultListCollections } from "../source-collections/source-collections.js";
import { readArtifactJson as defaultReadArtifactJson } from "../storage/artifacts.js";
import {
  evaluateCollectionForProfile,
  resolveRuntimeProfile,
  summarizeProfileDecision,
} from "../runtime-profile/runtime-profile-policy.js";

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

export function profileRuntimeIndexAliasId(profile) {
  return `runtime-index:${profile}:latest`;
}

export function profileRuntimeIndexVersionId(profile, checksumSha256) {
  return `runtime-index:${profile}:sha256:${checksumSha256}`;
}

export function profileRuntimeIndexVersionStoragePath(profile, checksumSha256) {
  return `index/profiles/${profile}/versions/sha256/${checksumSha256}.json`;
}

function topicFromCandidate({ candidate, artifact }) {
  return {
    topic_key: candidate.topic_key,
    label: candidate.label,
    subject: candidate.subject ?? null,
    learning_stage: candidate.learning_stage ?? null,
    collection_id: artifact.collection_id,
    retrieved_sources: candidate.source_refs ?? [],
    source_artifact_id: artifact.artifact_id,
    checksum_sha256: artifact.checksum_sha256 ?? null,
    license_scope: candidate.metadata?.license_scope ?? artifact.license_scope ?? null,
    metadata: {
      source_topic_id: candidate.source_topic_id ?? null,
      source_node_type: candidate.source_node_type ?? null,
      parent_topic_key: candidate.parent_topic_key ?? null,
    },
  };
}

export function buildProfileRuntimeIndex({ profile: inputProfile, collections = [], topicCandidateArtifacts = [] } = {}) {
  const profile = resolveRuntimeProfile(inputProfile);
  const decisions = collections.map((collection) => evaluateCollectionForProfile(collection, profile, "runtime_index"));
  const trace = {
    profile,
    ...summarizeProfileDecision(decisions),
  };
  const allowedCollectionIds = new Set(trace.source_collection_ids);
  const topics = topicCandidateArtifacts
    .filter((artifact) => artifact.profile === profile)
    .filter((artifact) => allowedCollectionIds.has(artifact.collection_id))
    .flatMap((artifact) => (artifact.data ?? []).map((candidate) => topicFromCandidate({ candidate, artifact })))
    .sort((left, right) => left.topic_key.localeCompare(right.topic_key));
  const sources = trace.source_collection_ids.map((collectionId) => {
    const collection = collections.find((item) => item.collection_id === collectionId) ?? {};
    return {
      collection_id: collectionId,
      source_ids: collection.source_ids ?? [],
      license_scope: collection.license_scope ?? null,
    };
  });
  const core = {
    index_version: `runtime-index.${profile}`,
    profile,
    sources,
    topics,
    profile_trace: trace,
  };
  const checksum = sha256Text(stableStringify(core));
  return {
    ...core,
    checksum_sha256: checksum,
    artifact_id: profileRuntimeIndexVersionId(profile, checksum),
  };
}

async function writeDefaultArtifact(index) {
  const storageRoot = path.resolve(process.cwd(), getServiceConfig().storageRoot);
  const storagePath = profileRuntimeIndexVersionStoragePath(index.profile, index.checksum_sha256);
  const fullPath = path.join(storageRoot, storagePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  return {
    storage_path: storagePath,
    checksum_sha256: index.checksum_sha256,
  };
}

async function defaultFindTopicCandidateArtifact({ client, collectionId, profile }) {
  const result = await client.query(
    `
      SELECT *
      FROM knowledge_source_artifacts
      WHERE artifact_type = $1
        AND publish_status = $2
        AND metadata->>'collection_id' = $3
        AND metadata->>'profile' = $4
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1
    `,
    ["topic_candidates", "validated", collectionId, profile],
  );
  return result.rows[0] ?? null;
}

async function loadTopicCandidateArtifacts({ client, profile, collections, findTopicCandidateArtifact, readArtifactJson }) {
  const artifacts = [];
  for (const collection of collections) {
    const row = await findTopicCandidateArtifact({ client, collectionId: collection.collection_id, profile });
    if (!row) {
      continue;
    }
    const payload = await readArtifactJson(row.storage_path);
    artifacts.push({
      ...payload,
      artifact_id: payload.artifact_id ?? row.artifact_id,
      checksum_sha256: payload.checksum_sha256 ?? row.checksum_sha256,
    });
  }
  return artifacts;
}

async function upsertRuntimeArtifact(client, { artifactId, index, storagePath, checksumSha256, metadata }) {
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
      "runtime_index",
      null,
      null,
      storagePath,
      "application/json",
      "published",
      index.topics.length,
      checksumSha256,
      JSON.stringify(metadata),
    ],
  );
}

async function insertAuditEvent(client, { actor, index, aliasId }) {
  await client.query(
    `
      INSERT INTO knowledge_source_audit_events (event_type, actor, target_type, target_id, payload)
      VALUES ($1, $2, $3, $4, $5)
    `,
    [
      "runtime_index.profile_published",
      actor,
      "runtime_index",
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

export function createProfileRuntimeIndexPublisher({
  withClient = defaultWithClient,
  listCollections = defaultListCollections,
  findTopicCandidateArtifact = defaultFindTopicCandidateArtifact,
  readArtifactJson = defaultReadArtifactJson,
  writeArtifact = writeDefaultArtifact,
} = {}) {
  async function publishRuntimeIndexForProfile({ profile: inputProfile, actor = "script" } = {}) {
    const profile = resolveRuntimeProfile(inputProfile);
    const collections = (await listCollections()).data ?? [];
    return withClient(async (client) => {
      const topicCandidateArtifacts = await loadTopicCandidateArtifacts({
        client,
        profile,
        collections,
        findTopicCandidateArtifact,
        readArtifactJson,
      });
      const index = buildProfileRuntimeIndex({ profile, collections, topicCandidateArtifacts });
      const artifactWrite = await writeArtifact(index);
      const aliasId = profileRuntimeIndexAliasId(profile);
      const aliasMetadata = {
        profile,
        points_to_artifact_id: index.artifact_id,
        source_collection_ids: index.profile_trace.source_collection_ids,
        blocked_collection_ids: index.profile_trace.blocked_collection_ids,
        checksum_sha256: index.checksum_sha256,
      };
      const versionMetadata = {
        profile,
        alias_artifact_id: aliasId,
        source_collection_ids: index.profile_trace.source_collection_ids,
        blocked_collection_ids: index.profile_trace.blocked_collection_ids,
        profile_trace: index.profile_trace,
      };

      await client.query("BEGIN");
      try {
        await upsertRuntimeArtifact(client, {
          artifactId: index.artifact_id,
          index,
          storagePath: artifactWrite.storage_path,
          checksumSha256: artifactWrite.checksum_sha256,
          metadata: versionMetadata,
        });
        await upsertRuntimeArtifact(client, {
          artifactId: aliasId,
          index,
          storagePath: artifactWrite.storage_path,
          checksumSha256: artifactWrite.checksum_sha256,
          metadata: aliasMetadata,
        });
        if (profile === "demo") {
          await upsertRuntimeArtifact(client, {
            artifactId: "runtime-index:latest",
            index,
            storagePath: artifactWrite.storage_path,
            checksumSha256: artifactWrite.checksum_sha256,
            metadata: {
              ...aliasMetadata,
              compatibility_alias: true,
              compatibility_profile: "demo",
            },
          });
        }
        await insertAuditEvent(client, { actor, index, aliasId });
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }

      return {
        object: "runtime_index_publish_result",
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
        summary: {
          source_count: index.sources.length,
          topic_count: index.topics.length,
          source_ref_count: index.topics.reduce((sum, topic) => sum + (topic.retrieved_sources?.length ?? 0), 0),
        },
        profile_trace: index.profile_trace,
      };
    });
  }

  return {
    publishRuntimeIndexForProfile,
  };
}
