import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { aiWorkflowKnowledgeDir, defaultStorageRoot, projectRoot } from "../lib/paths.mjs";
import { withClient } from "../lib/db.mjs";

const storageRoot = path.resolve(process.env.KNOWLEDGE_SOURCE_STORAGE_ROOT ?? defaultStorageRoot);
const sourceRoot = path.resolve(process.env.AI_WORKFLOW_KNOWLEDGE_DIR ?? aiWorkflowKnowledgeDir);

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function fileExists(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function sha256File(filePath) {
  const buffer = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function normalizeSourceName(source) {
  if (source === "learning-commons") {
    return "learning_commons";
  }
  if (source === "k12-dataset") {
    return "k12_dataset";
  }
  return source;
}

function artifactIdFor(relativePath) {
  if (relativePath === "index/knowledge-index.json") {
    return "runtime-index:latest";
  }
  return relativePath
    .replace(/\\/g, "/")
    .replace(/\.jsonl?$/i, "")
    .replace(/[^a-zA-Z0-9:_/-]+/g, "-")
    .replace(/\//g, ":");
}

function artifactTypeFor(relativePath) {
  if (relativePath.startsWith("raw/")) {
    return "raw_snapshot_file";
  }
  if (relativePath.startsWith("normalized/")) {
    return "normalized_artifact";
  }
  if (relativePath.startsWith("mappings/")) {
    return "mapping_artifact";
  }
  if (relativePath.startsWith("index/")) {
    return "runtime_index";
  }
  if (relativePath.startsWith("reports/")) {
    return "report_artifact";
  }
  if (relativePath === "sources.json") {
    return "source_registry_config";
  }
  return "knowledge_artifact";
}

async function listFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(fullPath)));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

async function upsertSources(client, sourcesConfig) {
  for (const source of sourcesConfig.sources ?? []) {
    const normalizedSource = normalizeSourceName(source.source);
    await client.query(
      `
        INSERT INTO knowledge_source_registry
          (source, display_name, repo_url, license, license_scope, attribution, config)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (source) DO UPDATE SET
          display_name = EXCLUDED.display_name,
          repo_url = EXCLUDED.repo_url,
          license = EXCLUDED.license,
          license_scope = EXCLUDED.license_scope,
          attribution = EXCLUDED.attribution,
          config = EXCLUDED.config,
          updated_at = now()
      `,
      [
        normalizedSource,
        source.source,
        source.repo_url ?? null,
        source.license ?? null,
        source.license_scope ?? null,
        source.attribution ?? null,
        JSON.stringify(source),
      ],
    );

    const snapshotPath = path.join(sourceRoot, "raw", source.source, source.version, "snapshot.json");
    const snapshot = await readJsonIfExists(snapshotPath);
    await client.query(
      `
        INSERT INTO knowledge_source_versions
          (source, source_version, raw_root, snapshot_path, manifest, total_bytes)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (source, source_version) DO UPDATE SET
          raw_root = EXCLUDED.raw_root,
          snapshot_path = EXCLUDED.snapshot_path,
          manifest = EXCLUDED.manifest,
          total_bytes = EXCLUDED.total_bytes,
          updated_at = now()
      `,
      [
        normalizedSource,
        source.version,
        path.relative(projectRoot, path.join(storageRoot, "raw", source.source, source.version)).replace(/\\/g, "/"),
        (await fileExists(snapshotPath)) ? path.relative(projectRoot, path.join(storageRoot, "raw", source.source, source.version, "snapshot.json")).replace(/\\/g, "/") : null,
        JSON.stringify(snapshot ?? {}),
        Number(snapshot?.total_bytes ?? 0),
      ],
    );
  }
}

async function upsertArtifacts(client, copiedFiles) {
  for (const filePath of copiedFiles) {
    const relativePath = path.relative(storageRoot, filePath).replace(/\\/g, "/");
    const checksum = await sha256File(filePath);
    const sourceMatch = relativePath.match(/^raw\/([^/]+)\/([^/]+)\//);
    const normalizedSource = sourceMatch ? normalizeSourceName(sourceMatch[1]) : null;
    const sourceVersion = sourceMatch?.[2] ?? null;
    const artifactId = artifactIdFor(relativePath);
    const contentType = relativePath.endsWith(".jsonl") ? "application/x-jsonlines" : relativePath.endsWith(".md") ? "text/markdown" : "application/json";
    await client.query(
      `
        INSERT INTO knowledge_source_artifacts
          (artifact_id, artifact_type, source, source_version, storage_path, content_type, checksum_sha256, metadata)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (artifact_id) DO UPDATE SET
          artifact_type = EXCLUDED.artifact_type,
          source = EXCLUDED.source,
          source_version = EXCLUDED.source_version,
          storage_path = EXCLUDED.storage_path,
          content_type = EXCLUDED.content_type,
          checksum_sha256 = EXCLUDED.checksum_sha256,
          metadata = EXCLUDED.metadata,
          updated_at = now()
      `,
      [
        artifactId,
        artifactTypeFor(relativePath),
        normalizedSource,
        sourceVersion,
        relativePath,
        contentType,
        checksum,
        JSON.stringify({
          imported_from: path.relative(projectRoot, path.join(sourceRoot, relativePath)).replace(/\\/g, "/"),
        }),
      ],
    );
  }
}

await fs.mkdir(storageRoot, { recursive: true });
await fs.cp(sourceRoot, storageRoot, { recursive: true, force: true });

const sourcesConfig = await readJsonIfExists(path.join(sourceRoot, "sources.json"));
const copiedFiles = await listFiles(storageRoot);

await withClient(async (client) => {
  await client.query("BEGIN");
  try {
    if (sourcesConfig) {
      await upsertSources(client, sourcesConfig);
    }
    await upsertArtifacts(client, copiedFiles);
    await client.query(
      `
        INSERT INTO knowledge_source_audit_events (event_type, actor, target_type, target_id, payload)
        VALUES ($1, $2, $3, $4, $5)
      `,
      [
        "knowledge_source.imported_ai_workflow_knowledge",
        "script",
        "knowledge_source_storage",
        "storage/knowledge",
        JSON.stringify({
          source_root: sourceRoot,
          storage_root: storageRoot,
          file_count: copiedFiles.length,
        }),
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
});

console.log(
  JSON.stringify(
    {
      source_root: sourceRoot,
      storage_root: storageRoot,
      file_count: copiedFiles.length,
      source_count: sourcesConfig?.sources?.length ?? 0,
    },
    null,
    2,
  ),
);
