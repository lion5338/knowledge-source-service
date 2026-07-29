import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import {
  buildImportSummary,
  latestImportSummaryArtifactId,
  latestImportSummaryStoragePath,
} from "./import-summary.mjs";
import {
  buildRuntimeIndexPins,
  latestRuntimeIndexArtifactId,
  latestRuntimeIndexStoragePath,
} from "./runtime-index-pinning.mjs";
import { aiWorkflowKnowledgeDir, defaultStorageRoot, projectRoot } from "../lib/paths.mjs";
import { withClient } from "../lib/db.mjs";
import { invalidateKnowledgeSourceReadCacheAfterImport } from "../lib/read-response-cache-invalidation.mjs";

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
  if (relativePath === latestRuntimeIndexStoragePath) {
    return latestRuntimeIndexArtifactId;
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

function publishStatusFor(artifactId) {
  return artifactId === latestRuntimeIndexArtifactId ? "published" : "imported";
}

async function previousChecksumFor(client, artifactId) {
  const result = await client.query(
    `
      SELECT checksum_sha256
      FROM knowledge_source_artifacts
      WHERE artifact_id = $1
    `,
    [artifactId],
  );
  return result.rows[0]?.checksum_sha256 ?? null;
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
  const artifacts = [];
  for (const filePath of copiedFiles) {
    const relativePath = path.relative(storageRoot, filePath).replace(/\\/g, "/");
    if (relativePath === latestImportSummaryStoragePath || relativePath.startsWith("index/versions/")) {
      continue;
    }
    const checksum = await sha256File(filePath);
    const sourceMatch = relativePath.match(/^raw\/([^/]+)\/([^/]+)\//);
    const normalizedSource = sourceMatch ? normalizeSourceName(sourceMatch[1]) : null;
    const sourceVersion = sourceMatch?.[2] ?? null;
    const artifactId = artifactIdFor(relativePath);
    const contentType = relativePath.endsWith(".jsonl") ? "application/x-jsonlines" : relativePath.endsWith(".md") ? "text/markdown" : "application/json";
    const publishStatus = publishStatusFor(artifactId);
    const previousChecksum = await previousChecksumFor(client, artifactId);
    const runtimeIndexPins =
      artifactId === latestRuntimeIndexArtifactId
        ? buildRuntimeIndexPins({
            checksumSha256: checksum,
            index: await readJsonIfExists(filePath),
          })
        : null;
    await client.query(
      `
        INSERT INTO knowledge_source_artifacts
          (artifact_id, artifact_type, source, source_version, storage_path, content_type, publish_status, checksum_sha256, metadata)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (artifact_id) DO UPDATE SET
          artifact_type = EXCLUDED.artifact_type,
          source = EXCLUDED.source,
          source_version = EXCLUDED.source_version,
          storage_path = EXCLUDED.storage_path,
          content_type = EXCLUDED.content_type,
          publish_status = EXCLUDED.publish_status,
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
        publishStatus,
        checksum,
        JSON.stringify(
          runtimeIndexPins?.latest_metadata ?? {
            imported_from: path.relative(projectRoot, path.join(sourceRoot, relativePath)).replace(/\\/g, "/"),
          },
        ),
      ],
    );
    artifacts.push({
      artifact_id: artifactId,
      artifact_type: artifactTypeFor(relativePath),
      storage_path: relativePath,
      checksum_sha256: checksum,
      publish_status: publishStatus,
      previous_checksum_sha256: previousChecksum,
    });
    if (runtimeIndexPins) {
      const pinnedArtifact = await upsertPinnedRuntimeIndexArtifact(client, filePath, checksum, runtimeIndexPins);
      artifacts.push(pinnedArtifact);
    }
  }
  return artifacts;
}

async function upsertPinnedRuntimeIndexArtifact(client, latestFilePath, checksum, runtimeIndexPins) {
  const pinnedPath = path.join(storageRoot, runtimeIndexPins.pinned_storage_path);
  await fs.mkdir(path.dirname(pinnedPath), { recursive: true });
  await fs.copyFile(latestFilePath, pinnedPath);
  const previousChecksum = await previousChecksumFor(client, runtimeIndexPins.pinned_artifact_id);
  await client.query(
    `
      INSERT INTO knowledge_source_artifacts
        (artifact_id, artifact_type, source, source_version, storage_path, content_type, publish_status, checksum_sha256, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (artifact_id) DO UPDATE SET
        artifact_type = EXCLUDED.artifact_type,
        source = EXCLUDED.source,
        source_version = EXCLUDED.source_version,
        storage_path = EXCLUDED.storage_path,
        content_type = EXCLUDED.content_type,
        publish_status = EXCLUDED.publish_status,
        checksum_sha256 = EXCLUDED.checksum_sha256,
        metadata = EXCLUDED.metadata,
        updated_at = now()
    `,
    [
      runtimeIndexPins.pinned_artifact_id,
      "runtime_index",
      null,
      null,
      runtimeIndexPins.pinned_storage_path,
      "application/json",
      "published",
      checksum,
      JSON.stringify(runtimeIndexPins.pinned_metadata),
    ],
  );
  return {
    artifact_id: runtimeIndexPins.pinned_artifact_id,
    artifact_type: "runtime_index",
    storage_path: runtimeIndexPins.pinned_storage_path,
    checksum_sha256: checksum,
    publish_status: "published",
    previous_checksum_sha256: previousChecksum,
  };
}

async function writeImportSummaryReport(summary) {
  const reportPath = path.join(storageRoot, latestImportSummaryStoragePath);
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  return reportPath;
}

async function upsertImportSummaryArtifact(client, reportPath) {
  const checksum = await sha256File(reportPath);
  const previousChecksum = await previousChecksumFor(client, latestImportSummaryArtifactId);
  await client.query(
    `
      INSERT INTO knowledge_source_artifacts
        (artifact_id, artifact_type, source, source_version, storage_path, content_type, publish_status, checksum_sha256, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (artifact_id) DO UPDATE SET
        artifact_type = EXCLUDED.artifact_type,
        source = EXCLUDED.source,
        source_version = EXCLUDED.source_version,
        storage_path = EXCLUDED.storage_path,
        content_type = EXCLUDED.content_type,
        publish_status = EXCLUDED.publish_status,
        checksum_sha256 = EXCLUDED.checksum_sha256,
        metadata = EXCLUDED.metadata,
        updated_at = now()
    `,
    [
      latestImportSummaryArtifactId,
      "report_artifact",
      null,
      null,
      latestImportSummaryStoragePath,
      "application/json",
      "imported",
      checksum,
      JSON.stringify({
        generated_by: "import-ai-workflow-knowledge",
      }),
    ],
  );
  return {
    artifact_id: latestImportSummaryArtifactId,
    artifact_type: "report_artifact",
    storage_path: latestImportSummaryStoragePath,
    checksum_sha256: checksum,
    publish_status: "imported",
    previous_checksum_sha256: previousChecksum,
  };
}

await fs.mkdir(storageRoot, { recursive: true });
await fs.cp(sourceRoot, storageRoot, { recursive: true, force: true });

const sourcesConfig = await readJsonIfExists(path.join(sourceRoot, "sources.json"));
const copiedFiles = await listFiles(storageRoot);
let importedArtifacts = [];

await withClient(async (client) => {
  await client.query("BEGIN");
  try {
    if (sourcesConfig) {
      await upsertSources(client, sourcesConfig);
    }
    const artifactSummaries = await upsertArtifacts(client, copiedFiles);
    const summary = buildImportSummary({
      sourceRoot,
      storageRoot,
      sourceCount: sourcesConfig?.sources?.length ?? 0,
      artifacts: artifactSummaries,
    });
    const reportPath = await writeImportSummaryReport(summary);
    const importSummaryArtifact = await upsertImportSummaryArtifact(client, reportPath);
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
          file_count: artifactSummaries.length,
          import_summary: summary,
        }),
      ],
    );
    await client.query("COMMIT");
    importedArtifacts = [...artifactSummaries, importSummaryArtifact];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
});

await invalidateKnowledgeSourceReadCacheAfterImport({
  artifacts: importedArtifacts,
});

console.log(
  JSON.stringify(
    await readJsonIfExists(path.join(storageRoot, latestImportSummaryStoragePath)),
    null,
    2,
  ),
);
