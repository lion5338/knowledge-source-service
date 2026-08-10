import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

import { getServiceConfig } from "../config.js";
import { getNormalizedArtifactAdapter } from "../source-artifacts/adapters/registry.js";
import { withClient as defaultWithClient } from "../db/pool.js";
import { HttpError } from "../http/errors.js";
import { getCollection as defaultGetCollection } from "./source-collections.js";

const snapshotArtifactType = "source_snapshot_manifest";

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

async function sha256File(filePath) {
  return crypto.createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function toStoragePath(value) {
  return value.replace(/\\/g, "/");
}

function sourceDirectoryCandidates(sourceIds = []) {
  return [...new Set(sourceIds.flatMap((sourceId) => [sourceId, sourceId.replaceAll("_", "-")]))];
}

function sourceSnapshotError(message, code, details = null) {
  return new HttpError(message, {
    status: 400,
    code,
    type: "bad_request",
    details,
  });
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function fileStat(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile() ? stat : null;
  } catch {
    return null;
  }
}

async function listJsonFiles(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await listJsonFiles(fullPath)));
      } else if (entry.isFile() && entry.name.endsWith(".json")) {
        files.push(fullPath);
      }
    }
    return files;
  } catch {
    return [];
  }
}

async function inspectDetectedFile(sourceRoot, relativePath) {
  const fullPath = path.join(sourceRoot, relativePath);
  const stat = await fileStat(fullPath);
  if (!stat) {
    return null;
  }
  return {
    path: toStoragePath(relativePath),
    bytes: stat.size,
    checksum_sha256: await sha256File(fullPath),
  };
}

async function inspectK12RawManifest(sourceRoot) {
  const missingFiles = [];
  const manifest = await inspectDetectedFile(sourceRoot, "manifest.json");
  const snapshot = await inspectDetectedFile(sourceRoot, "snapshot.json");
  if (!manifest) {
    missingFiles.push("manifest.json");
  }
  if (!snapshot) {
    missingFiles.push("snapshot.json");
  }

  const kgRoot = path.join(sourceRoot, "kg");
  const kgFiles = (await listJsonFiles(kgRoot)).sort((left, right) => left.localeCompare(right));
  if (!(await pathExists(kgRoot)) || kgFiles.length === 0) {
    missingFiles.push("kg/*.json");
  }
  if (missingFiles.length > 0) {
    throw sourceSnapshotError(
      `K12 source snapshot is missing required raw files: ${missingFiles.join(", ")}`,
      "source_snapshot_missing_required_file",
      { collection_id: "k12_kgraph_full", missing_files: missingFiles },
    );
  }

  const detectedFiles = [manifest, snapshot];
  for (const filePath of kgFiles) {
    const stat = await fs.stat(filePath);
    detectedFiles.push({
      path: toStoragePath(path.relative(sourceRoot, filePath)),
      bytes: stat.size,
      checksum_sha256: await sha256File(filePath),
    });
  }
  detectedFiles.sort((left, right) => left.path.localeCompare(right.path));

  return {
    file_count: detectedFiles.length,
    total_bytes: detectedFiles.reduce((total, file) => total + file.bytes, 0),
    detected_files: detectedFiles,
  };
}

function normalizedArtifactTypeForCollection(collectionId) {
  if (collectionId === "k12_kgraph_full") {
    return "normalized_knowledge_graph";
  }
  return "normalized_documents";
}

export async function inspectSourceCollectionSnapshot({
  collectionId,
  sourceRoot,
  getCollection = defaultGetCollection,
  collection = null,
} = {}) {
  const resolvedCollection = collection ?? (await getCollection(collectionId));
  const resolvedSourceRoot = path.resolve(sourceRoot);
  const rawManifest =
    collectionId === "k12_kgraph_full"
      ? await inspectK12RawManifest(resolvedSourceRoot)
      : await getNormalizedArtifactAdapter({
          collectionId,
          artifactType: normalizedArtifactTypeForCollection(collectionId),
        }).inspectRawManifest({ collection: resolvedCollection, sourceRoot: resolvedSourceRoot });
  const rawSnapshotMetadata = await readJsonIfExists(path.join(sourceRoot, "snapshot.json"));
  const checksumInput = {
    collection_id: collectionId,
    source_uri: resolvedCollection.source_uri ?? null,
    license_scope: resolvedCollection.license_scope ?? null,
    raw_manifest: rawManifest,
  };
  const checksum = sha256Text(stableStringify(checksumInput));

  return {
    snapshot_id: `source-snapshot:${collectionId}:sha256:${checksum}`,
    collection_id: collectionId,
    source_uri: resolvedCollection.source_uri ?? null,
    checksum_sha256: checksum,
    raw_manifest: rawManifest,
    license_scope: resolvedCollection.license_scope ?? null,
    attribution: resolvedCollection.attribution ?? null,
    publish_profiles: resolvedCollection.publish_profiles ?? [],
    created_at: rawSnapshotMetadata?.downloaded_at ?? rawSnapshotMetadata?.created_at ?? "1970-01-01T00:00:00.000Z",
  };
}

async function resolveDefaultSourceRoot({ collection }) {
  const storageRoot = path.resolve(process.cwd(), getServiceConfig().storageRoot);
  const rawRoot = path.join(storageRoot, "raw");
  for (const sourceDirectory of sourceDirectoryCandidates(collection.source_ids)) {
    const sourceRoot = path.join(rawRoot, sourceDirectory);
    const entries = await fs.readdir(sourceRoot, { withFileTypes: true }).catch(() => []);
    const versions = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const fullPath = path.join(sourceRoot, entry.name);
        const stat = await fs.stat(fullPath);
        versions.push({ fullPath, mtimeMs: stat.mtimeMs, name: entry.name });
      }
    }
    versions.sort((left, right) => right.mtimeMs - left.mtimeMs || right.name.localeCompare(left.name));
    if (versions[0]) {
      return versions[0].fullPath;
    }
  }
  throw sourceSnapshotError(
    `No managed raw snapshot directory was found for source collection: ${collection.collection_id}`,
    "source_snapshot_missing_required_file",
    { collection_id: collection.collection_id, missing_files: ["managed raw snapshot directory"] },
  );
}

async function writeDefaultSnapshotArtifact(snapshot) {
  const storageRoot = path.resolve(process.cwd(), getServiceConfig().storageRoot);
  const storagePath = `snapshots/${snapshot.collection_id}/sha256/${snapshot.checksum_sha256}.json`;
  const fullPath = path.join(storageRoot, storagePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  return {
    storage_path: storagePath,
    checksum_sha256: sha256Text(await fs.readFile(fullPath, "utf8")),
  };
}

async function upsertSnapshotVersion(client, { collection, snapshot, artifact }) {
  const source = collection.source_ids[0];
  await client.query(
    `
      INSERT INTO knowledge_source_versions
        (source, source_version, snapshot_status, storage_driver, snapshot_path, manifest, total_bytes)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (source, source_version) DO UPDATE SET
        snapshot_status = EXCLUDED.snapshot_status,
        storage_driver = EXCLUDED.storage_driver,
        snapshot_path = EXCLUDED.snapshot_path,
        manifest = EXCLUDED.manifest,
        total_bytes = EXCLUDED.total_bytes,
        updated_at = now()
    `,
    [
      source,
      snapshot.snapshot_id,
      "available",
      "local",
      artifact.storage_path,
      JSON.stringify(snapshot),
      snapshot.raw_manifest.total_bytes,
    ],
  );
}

async function upsertSnapshotArtifact(client, { collection, snapshot, artifact }) {
  const source = collection.source_ids[0];
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
      snapshot.snapshot_id,
      snapshotArtifactType,
      source,
      snapshot.snapshot_id,
      artifact.storage_path,
      "application/json",
      "imported",
      snapshot.raw_manifest.file_count,
      artifact.checksum_sha256,
      JSON.stringify({
        collection_id: collection.collection_id,
        source_snapshot_id: snapshot.snapshot_id,
        raw_checksum_sha256: snapshot.checksum_sha256,
        license_scope: snapshot.license_scope,
        publish_profiles: snapshot.publish_profiles,
      }),
    ],
  );
}

async function insertSnapshotAuditEvent(client, { actor, snapshot, artifact }) {
  await client.query(
    `
      INSERT INTO knowledge_source_audit_events (event_type, actor, target_type, target_id, payload)
      VALUES ($1, $2, $3, $4, $5)
    `,
    [
      "source_snapshot.ingested",
      actor,
      "source_snapshot",
      snapshot.snapshot_id,
      JSON.stringify({
        collection_id: snapshot.collection_id,
        snapshot_id: snapshot.snapshot_id,
        checksum_sha256: snapshot.checksum_sha256,
        artifact_checksum_sha256: artifact.checksum_sha256,
        storage_path: artifact.storage_path,
      }),
    ],
  );
}

export function createSourceCollectionIngestor({
  withClient = defaultWithClient,
  getCollection = defaultGetCollection,
  resolveSourceRoot = resolveDefaultSourceRoot,
  writeSnapshotArtifact = writeDefaultSnapshotArtifact,
} = {}) {
  async function ingestSourceCollectionSnapshot({ collectionId, actor = "script" } = {}) {
    const collection = await getCollection(collectionId);
    const sourceRoot = await resolveSourceRoot({ collectionId, collection });
    const snapshot = await inspectSourceCollectionSnapshot({
      collectionId,
      sourceRoot,
      collection,
      getCollection,
    });
    const artifact = {
      artifact_id: snapshot.snapshot_id,
      artifact_type: snapshotArtifactType,
      ...(await writeSnapshotArtifact(snapshot)),
      publish_status: "imported",
    };

    await withClient(async (client) => {
      await client.query("BEGIN");
      try {
        await upsertSnapshotVersion(client, { collection, snapshot, artifact });
        await upsertSnapshotArtifact(client, { collection, snapshot, artifact });
        await insertSnapshotAuditEvent(client, { actor, snapshot, artifact });
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    });

    return {
      object: "source_snapshot_ingest_result",
      collection_id: collectionId,
      snapshot,
      artifact,
    };
  }

  return {
    ingestSourceCollectionSnapshot,
  };
}
