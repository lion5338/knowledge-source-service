import { withClient as defaultWithClient } from "../db/pool.js";
import { badRequest, notFound } from "../http/errors.js";
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
      return {
        object: "list",
        data: result.rows.map(rowToArtifact),
      };
    });
  }

  async function getArtifact(artifactId) {
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
      return rowToArtifact(row);
    });
  }

  async function getArtifactPayload(artifactId) {
    const artifact = await getArtifact(artifactId);
    const text = await readArtifactText(artifact.storage_path);
    let json = null;
    if (artifact.content_type === "application/json") {
      json = JSON.parse(text);
    }
    return {
      ...artifact,
      text: json ? undefined : text,
      json,
    };
  }

  async function getLatestRuntimeIndex() {
    const artifact = await getArtifact("runtime-index:latest");
    const alias = artifactToAlias(artifact);
    const version = alias.points_to_artifact_id ? artifactToVersion(await getArtifact(alias.points_to_artifact_id)) : null;
    const index = await readArtifactJson(artifact.storage_path);
    return {
      trace_mode: version ? "content_addressed_version" : "legacy_alias_only",
      alias,
      version,
      artifact,
      summary: summarizeRuntimeIndex(index),
      index,
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
