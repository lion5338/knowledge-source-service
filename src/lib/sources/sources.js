import { withClient as defaultWithClient } from "../db/pool.js";
import { badRequest, notFound } from "../http/errors.js";
import { resolveRuntimeProfile } from "../runtime-profile/runtime-profile-policy.js";
import { readArtifactJson as defaultReadArtifactJson, readArtifactText as defaultReadArtifactText } from "../storage/artifacts.js";
import { diffRuntimeIndexes } from "./runtime-index-diff.js";

const allowedPublishStatuses = new Set(["imported", "published", "validated", "deprecated"]);

function rowToSource(row) {
  return {
    source: row.source,
    display_name: row.display_name,
    repo_url: row.repo_url,
    license: row.license,
    license_scope: row.license_scope,
    attribution: row.attribution,
    config: row.config ?? {},
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function rowToVersion(row) {
  return {
    source: row.source,
    source_version: row.source_version,
    snapshot_status: row.snapshot_status,
    storage_driver: row.storage_driver,
    raw_root: row.raw_root,
    snapshot_path: row.snapshot_path,
    manifest: row.manifest ?? {},
    total_bytes: Number(row.total_bytes ?? 0),
    imported_at: row.imported_at,
    updated_at: row.updated_at,
  };
}

function rowToArtifact(row) {
  return {
    artifact_id: row.artifact_id,
    artifact_type: row.artifact_type,
    source: row.source,
    source_version: row.source_version,
    storage_path: row.storage_path,
    content_type: row.content_type,
    publish_status: row.publish_status,
    record_count: row.record_count,
    checksum_sha256: row.checksum_sha256,
    metadata: row.metadata ?? {},
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function artifactCollectionId(artifact = {}) {
  return artifact.metadata?.collection_id ?? artifact.metadata?.source_collection_id ?? null;
}

function accessAllowsArtifact(access, artifact = {}) {
  if (!access) {
    return true;
  }
  const collectionId = artifactCollectionId(artifact);
  if (!collectionId) {
    return true;
  }
  return new Set(access.effective_collection_ids ?? []).has(collectionId);
}

function accessFilteredArtifactMetadata(metadata = {}, access = null) {
  if (!access) {
    return metadata;
  }
  const allowedCollections = new Set(access.effective_collection_ids ?? []);
  const sourceCollectionIds = Array.isArray(metadata.source_collection_ids)
    ? metadata.source_collection_ids.filter((collectionId) => allowedCollections.has(collectionId))
    : metadata.source_collection_ids;
  const blockedCollectionIds = [
    ...new Set([...(metadata.blocked_collection_ids ?? []), ...(access.blocked_collection_ids ?? [])]),
  ].sort();
  return {
    ...metadata,
    source_collection_ids: sourceCollectionIds,
    blocked_collection_ids: blockedCollectionIds,
    profile_trace: metadata.profile_trace
      ? {
          ...metadata.profile_trace,
          source_collection_ids: Array.isArray(metadata.profile_trace.source_collection_ids)
            ? metadata.profile_trace.source_collection_ids.filter((collectionId) => allowedCollections.has(collectionId))
            : metadata.profile_trace.source_collection_ids,
          blocked_collection_ids: [
            ...new Set([...(metadata.profile_trace.blocked_collection_ids ?? []), ...(access.blocked_collection_ids ?? [])]),
          ].sort(),
          access,
        }
      : metadata.profile_trace,
  };
}

function artifactForAccess(artifact, access = null) {
  if (!access || artifact.artifact_type !== "runtime_index") {
    return artifact;
  }
  return {
    ...artifact,
    metadata: accessFilteredArtifactMetadata(artifact.metadata, access),
  };
}

function summarizeRuntimeIndex(index) {
  const sources = Array.isArray(index.sources) ? index.sources : [];
  const topics = Array.isArray(index.topics) ? index.topics : [];
  return {
    index_version: index.index_version ?? null,
    built_at: index.built_at ?? null,
    source_count: sources.length,
    topic_count: topics.length,
    source_ref_count: topics.reduce(
      (sum, topic) => sum + (Array.isArray(topic.retrieved_sources) ? topic.retrieved_sources.length : 0),
      0,
    ),
  };
}

function runtimeTopicCollectionId(topic = {}) {
  return topic.collection_id ?? topic.retrieved_sources?.find((source) => source.collection_id)?.collection_id ?? null;
}

function restrictRuntimeIndexToAccess(index, access = null) {
  if (!access) {
    return index;
  }
  const allowedCollections = new Set(access.effective_collection_ids ?? []);
  const sources = (index.sources ?? []).filter((source) => {
    if (!source.collection_id) {
      return true;
    }
    return allowedCollections.has(source.collection_id);
  });
  const topics = (index.topics ?? [])
    .filter((topic) => {
      const collectionId = runtimeTopicCollectionId(topic);
      return !collectionId || allowedCollections.has(collectionId);
    })
    .map((topic) => ({
      ...topic,
      retrieved_sources: (topic.retrieved_sources ?? []).filter((source) => !source.collection_id || allowedCollections.has(source.collection_id)),
    }));
  const sourceCollectionIds = (index.profile_trace?.source_collection_ids ?? []).filter((collectionId) => allowedCollections.has(collectionId));
  return {
    ...index,
    sources,
    topics,
    profile_trace: index.profile_trace
      ? {
          ...index.profile_trace,
          source_collection_ids: sourceCollectionIds,
          blocked_collection_ids: [
            ...new Set([...(index.profile_trace.blocked_collection_ids ?? []), ...(access.blocked_collection_ids ?? [])]),
          ].sort(),
          access,
        }
      : { access },
  };
}

function artifactToAlias(artifact) {
  return {
    artifact_id: artifact.artifact_id,
    points_to_artifact_id: artifact.metadata.points_to_artifact_id ?? null,
    checksum_sha256: artifact.checksum_sha256,
    publish_status: artifact.publish_status,
  };
}

function artifactToVersion(artifact) {
  return {
    artifact_id: artifact.artifact_id,
    storage_path: artifact.storage_path,
    checksum_sha256: artifact.checksum_sha256,
    publish_status: artifact.publish_status,
  };
}

function artifactToDiffEndpoint(artifact) {
  return artifact
    ? {
        artifact_id: artifact.artifact_id,
        checksum_sha256: artifact.checksum_sha256,
      }
    : null;
}

export function createSources({
  withClient = defaultWithClient,
  readArtifactJson = defaultReadArtifactJson,
  readArtifactText = defaultReadArtifactText,
} = {}) {
  async function listSources() {
    return withClient(async (client) => {
      const result = await client.query(
        `
          SELECT *
          FROM knowledge_source_registry
          ORDER BY source ASC
        `,
      );
      return {
        object: "list",
        data: result.rows.map(rowToSource),
      };
    });
  }

  async function listSourceVersions(source) {
    return withClient(async (client) => {
      const result = await client.query(
        `
          SELECT *
          FROM knowledge_source_versions
          WHERE source = $1
          ORDER BY imported_at DESC
        `,
        [source],
      );
      return {
        object: "list",
        source,
        data: result.rows.map(rowToVersion),
      };
    });
  }

  async function listArtifacts(options = {}) {
    const params = [];
    const filters = [];
    const publishStatus = options.publishStatus?.trim?.() ?? "";
    if (publishStatus && !allowedPublishStatuses.has(publishStatus)) {
      throw badRequest("Unsupported artifact publish_status.", {
        field: "publish_status",
        allowed_values: [...allowedPublishStatuses],
      });
    }
    if (options.artifactType) {
      params.push(options.artifactType);
      filters.push(`artifact_type = $${params.length}`);
    }
    if (options.source) {
      params.push(options.source);
      filters.push(`source = $${params.length}`);
    }
    if (publishStatus) {
      params.push(publishStatus);
      filters.push(`publish_status = $${params.length}`);
    }
    params.push(Math.min(Number(options.limit) || 100, 500));

    return withClient(async (client) => {
      const result = await client.query(
        `
          SELECT *
          FROM knowledge_source_artifacts
          ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
          ORDER BY artifact_type ASC, artifact_id ASC
          LIMIT $${params.length}
        `,
        params,
      );
      const artifacts = result.rows
        .map(rowToArtifact)
        .filter((artifact) => accessAllowsArtifact(options.access, artifact))
        .map((artifact) => artifactForAccess(artifact, options.access));
      return {
        object: "list",
        data: artifacts,
      };
    });
  }

  async function getArtifact(artifactId, options = {}) {
    return withClient(async (client) => {
      const result = await client.query(
        `
          SELECT *
          FROM knowledge_source_artifacts
          WHERE artifact_id = $1
        `,
        [artifactId],
      );
      const row = result.rows[0];
      if (!row) {
        throw notFound("Knowledge source artifact not found.");
      }
      const artifact = rowToArtifact(row);
      if (!accessAllowsArtifact(options.access, artifact)) {
        throw notFound("Knowledge source artifact not found.");
      }
      return artifactForAccess(artifact, options.access);
    });
  }

  async function getArtifactPayload(artifactId, options = {}) {
    const artifact = await getArtifact(artifactId, options);
    const text = await readArtifactText(artifact.storage_path);
    let json = null;
    if (artifact.content_type === "application/json") {
      json = JSON.parse(text);
      if (artifact.artifact_type === "runtime_index") {
        json = restrictRuntimeIndexToAccess(json, options.access ?? null);
      }
    }
    return {
      ...artifact,
      text: json ? undefined : text,
      json,
    };
  }

  async function getLatestRuntimeIndex(options = {}) {
    const hasExplicitProfile = Object.hasOwn(options, "profile");
    const profile = resolveRuntimeProfile(options.profile);
    const aliasArtifactId = hasExplicitProfile ? `runtime-index:${profile}:latest` : "runtime-index:latest";
    const artifact = await getArtifact(aliasArtifactId);
    const alias = artifactToAlias(artifact);
    const version = alias.points_to_artifact_id ? artifactToVersion(await getArtifact(alias.points_to_artifact_id)) : null;
    const index = restrictRuntimeIndexToAccess(await readArtifactJson(artifact.storage_path), options.access ?? null);
    return {
      profile: index.profile ?? artifact.metadata.profile ?? artifact.metadata.compatibility_profile ?? profile,
      trace_mode: version ? "content_addressed_version" : "legacy_alias_only",
      alias,
      version,
      artifact,
      summary: summarizeRuntimeIndex(index),
      profile_trace:
        index.profile_trace ?? {
          profile: index.profile ?? artifact.metadata.profile ?? artifact.metadata.compatibility_profile ?? profile,
          source_collection_ids: artifact.metadata.source_collection_ids ?? [],
          blocked_collection_ids: artifact.metadata.blocked_collection_ids ?? [],
          policy_decisions: artifact.metadata.profile_trace?.policy_decisions ?? [],
        },
      index,
      access_trace: options.access ?? null,
    };
  }

  async function listPublishedRuntimeIndexVersions() {
    return withClient(async (client) => {
      const result = await client.query(
        `
          SELECT *
          FROM knowledge_source_artifacts
          WHERE artifact_type = $1
            AND publish_status = $2
            AND artifact_id <> $3
          ORDER BY created_at DESC, artifact_id DESC
          LIMIT 100
        `,
        ["runtime_index", "published", "runtime-index:latest"],
      );
      return result.rows.map(rowToArtifact);
    });
  }

  async function resolveDefaultRuntimeIndexDiffArtifacts() {
    const latest = await getArtifact("runtime-index:latest");
    const toArtifactId = latest.metadata.points_to_artifact_id;
    if (!toArtifactId) {
      return { fromArtifact: null, toArtifact: latest };
    }
    const toArtifact = await getArtifact(toArtifactId);
    const versions = await listPublishedRuntimeIndexVersions();
    const fromArtifact = versions.find((artifact) => artifact.artifact_id !== toArtifact.artifact_id) ?? null;
    return { fromArtifact, toArtifact };
  }

  function insufficientHistoryResponse(toArtifact) {
    return {
      object: "runtime_index_diff",
      status: "insufficient_history",
      selection: {
        mode: "latest_vs_previous_published_artifact",
        to_source: "latest_alias_pointer",
        from_source: "artifact_created_at_desc",
      },
      from: null,
      to: artifactToDiffEndpoint(toArtifact),
      summary: null,
      topics: { added: [], removed: [], changed: [] },
      sources: { added: [], removed: [] },
    };
  }

  async function getRuntimeIndexDiff(options = {}) {
    if (Boolean(options.from) !== Boolean(options.to)) {
      throw badRequest("Runtime index diff requires both from and to artifact ids.", {
        field: "from_to",
      });
    }
    const explicit = Boolean(options.from && options.to);
    const { fromArtifact, toArtifact } = explicit
      ? {
          fromArtifact: await getArtifact(options.from),
          toArtifact: await getArtifact(options.to),
        }
      : await resolveDefaultRuntimeIndexDiffArtifacts();

    if (!fromArtifact) {
      return insufficientHistoryResponse(toArtifact);
    }

    const diff = diffRuntimeIndexes(
      await readArtifactJson(fromArtifact.storage_path),
      await readArtifactJson(toArtifact.storage_path),
    );
    return {
      object: "runtime_index_diff",
      status: "ok",
      selection: explicit
        ? {
            mode: "explicit_artifact_ids",
            from_source: "query.from",
            to_source: "query.to",
          }
        : {
            mode: "latest_vs_previous_published_artifact",
            to_source: "latest_alias_pointer",
            from_source: "artifact_created_at_desc",
          },
      from: artifactToDiffEndpoint(fromArtifact),
      to: artifactToDiffEndpoint(toArtifact),
      ...diff,
    };
  }

  return {
    listSources,
    listSourceVersions,
    listArtifacts,
    getArtifact,
    getArtifactPayload,
    getLatestRuntimeIndex,
    getRuntimeIndexDiff,
  };
}

const defaultSources = createSources();

export const {
  listSources,
  listSourceVersions,
  listArtifacts,
  getArtifact,
  getArtifactPayload,
  getLatestRuntimeIndex,
  getRuntimeIndexDiff,
} = defaultSources;
