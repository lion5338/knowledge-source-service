import { withClient } from "@/lib/db/pool";
import { notFound } from "@/lib/http/errors";
import { readArtifactJson, readArtifactText } from "@/lib/storage/artifacts";

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
    record_count: row.record_count,
    checksum_sha256: row.checksum_sha256,
    metadata: row.metadata ?? {},
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function listSources() {
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

export async function listSourceVersions(source) {
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

export async function listArtifacts(options = {}) {
  const params = [];
  const filters = [];
  if (options.artifactType) {
    params.push(options.artifactType);
    filters.push(`artifact_type = $${params.length}`);
  }
  if (options.source) {
    params.push(options.source);
    filters.push(`source = $${params.length}`);
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

export async function getArtifact(artifactId) {
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

export async function getArtifactPayload(artifactId) {
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

export async function getLatestRuntimeIndex() {
  const artifact = await getArtifact("runtime-index:latest");
  const index = await readArtifactJson(artifact.storage_path);
  return {
    artifact,
    index,
  };
}
