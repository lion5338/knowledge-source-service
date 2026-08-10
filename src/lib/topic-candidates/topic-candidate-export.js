import { Buffer } from "buffer";

import { withClient as defaultWithClient } from "../db/pool.js";
import { HttpError, notFound } from "../http/errors.js";
import { getCollection as defaultGetCollection } from "../source-collections/source-collections.js";
import { readArtifactJson as defaultReadArtifactJson } from "../storage/artifacts.js";

const runtimeProfiles = ["demo", "mvp", "prod"];
const maxLimit = 500;

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

function chooseDefaultProfile(collection = {}) {
  const allowedProfiles = collection.publish_profiles ?? [];
  if (allowedProfiles.includes("prod")) {
    return "prod";
  }
  if (allowedProfiles.includes("mvp")) {
    return "mvp";
  }
  return allowedProfiles[0] ?? "demo";
}

function resolveExportProfile(collection, profile) {
  const hasExplicitProfile = profile !== undefined && profile !== null && String(profile).trim() !== "";
  const resolvedProfile = hasExplicitProfile ? String(profile).trim() : chooseDefaultProfile(collection);
  assertProfileAllowed(collection, resolvedProfile);
  return {
    profile: resolvedProfile,
    profileSource: hasExplicitProfile ? "request_compatibility" : "access_resolver_default",
  };
}

function assertAccessAllowed(access, collectionId) {
  if (!access) {
    return;
  }
  if (!(access.effective_collection_ids ?? []).includes(collectionId)) {
    throw notFound("Topic candidate artifact not found.");
  }
}

export function encodeTopicCandidateCursor({ artifactId, offset }) {
  return Buffer.from(JSON.stringify({ artifact_id: artifactId, offset }), "utf8").toString("base64url");
}

function decodeTopicCandidateCursor(cursor) {
  if (!cursor) {
    return { offset: 0 };
  }
  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    return {
      artifact_id: decoded.artifact_id,
      offset: Number(decoded.offset ?? 0),
    };
  } catch {
    throw topicCandidateError("Topic candidate cursor is invalid.", "invalid_topic_candidate_cursor");
  }
}

function applyFilters(candidates, { subject, learningStage, nodeType }) {
  return candidates.filter((candidate) => {
    if (subject && candidate.subject !== subject) {
      return false;
    }
    if (learningStage && candidate.learning_stage !== learningStage) {
      return false;
    }
    if (nodeType && candidate.source_node_type !== nodeType) {
      return false;
    }
    return true;
  });
}

function paginate(candidates, { artifactId, cursor, limit }) {
  const requestedLimit = Number(limit) || maxLimit;
  const safeLimit = Math.min(Math.max(requestedLimit, 1), maxLimit);
  const decoded = decodeTopicCandidateCursor(cursor);
  if (decoded.artifact_id && decoded.artifact_id !== artifactId) {
    throw topicCandidateError("Topic candidate cursor does not match the selected artifact.", "invalid_topic_candidate_cursor");
  }
  const offset = Math.max(decoded.offset ?? 0, 0);
  const data = candidates.slice(offset, offset + safeLimit);
  const nextOffset = offset + data.length;
  const hasMore = nextOffset < candidates.length;
  return {
    data,
    pagination: {
      limit: safeLimit,
      next_cursor: hasMore ? encodeTopicCandidateCursor({ artifactId, offset: nextOffset }) : null,
      has_more: hasMore,
    },
  };
}

async function defaultFindCandidateArtifact({ client, collectionId, profile }) {
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
  const artifact = result.rows[0];
  if (!artifact) {
    throw notFound("Topic candidate artifact not found.");
  }
  return artifact;
}

export function createTopicCandidateExporter({
  withClient = defaultWithClient,
  getCollection = defaultGetCollection,
  findCandidateArtifact = defaultFindCandidateArtifact,
  readArtifactJson = defaultReadArtifactJson,
} = {}) {
  async function exportTopicCandidates({
    profile,
    collectionId,
    subject = null,
    learningStage = null,
    nodeType = null,
    limit = maxLimit,
    cursor = null,
    download = false,
    access = null,
  } = {}) {
    assertAccessAllowed(access, collectionId);
    const collection = await getCollection(collectionId);
    const resolved = resolveExportProfile(collection, profile);
    return withClient(async (client) => {
      const artifactRow = await findCandidateArtifact({ client, collectionId, profile: resolved.profile });
      const artifactPayload = await readArtifactJson(artifactRow.storage_path);
      const artifactId = artifactPayload.artifact_id ?? artifactRow.artifact_id;
      const checksum = artifactPayload.checksum_sha256 ?? artifactRow.checksum_sha256;
      const candidates = applyFilters(artifactPayload.data ?? [], { subject, learningStage, nodeType });
      const page = download ? { data: [], pagination: { limit: Math.min(Number(limit) || maxLimit, maxLimit), next_cursor: null, has_more: false } } : paginate(candidates, { artifactId, cursor, limit });

      return {
        object: "topic_candidate_export",
        profile: resolved.profile,
        collection_id: collectionId,
        artifact_id: artifactId,
        checksum_sha256: checksum,
        source_artifact_id: artifactPayload.source_artifact_id ?? artifactRow.metadata?.source_artifact_id ?? null,
        license_scope: artifactPayload.license_scope ?? artifactRow.metadata?.license_scope ?? null,
        data: page.data,
        pagination: page.pagination,
        artifact: {
          artifact_id: artifactId,
          checksum_sha256: checksum,
          download_url: `/v1/artifacts/${encodeURIComponent(artifactId)}`,
        },
        trace: {
          profile: resolved.profile,
          profile_source: resolved.profileSource,
          profile_deprecated: true,
          filters: {
            subject,
            learning_stage: learningStage,
            node_type: nodeType,
          },
          candidate_count: Array.isArray(artifactPayload.data) ? artifactPayload.data.length : 0,
          returned_count: page.data.length,
          raw_path_exposed: false,
          access,
        },
      };
    });
  }

  return {
    exportTopicCandidates,
  };
}
