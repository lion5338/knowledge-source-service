import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

import { getServiceConfig } from "../config.js";
import { withClient as defaultWithClient } from "../db/pool.js";
import { defaultSourceCollectionManifests } from "./source-collections.js";

export const sourceCollectionSummaryArtifactId = "source-collections:summary:latest";
export const sourceCollectionSummaryStoragePath = "reports/source-collections-summary-latest.json";

const runtimeProfiles = ["demo", "mvp", "prod"];

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

function countBy(values) {
  const counts = {};
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function collectionPolicySummary(collection) {
  return {
    collection_id: collection.collection_id,
    source_ids: [...(collection.source_ids ?? [])].sort(),
    license: collection.license ?? null,
    license_scope: collection.license_scope ?? null,
    publish_profiles: [...(collection.publish_profiles ?? [])].filter((profile) => runtimeProfiles.includes(profile)).sort(),
    official_curriculum_verified: Boolean(collection.official_curriculum_verified),
  };
}

export function buildSourceCollectionImportSummary({ collections = [] } = {}) {
  const collectionSummaries = collections
    .map(collectionPolicySummary)
    .sort((left, right) => left.collection_id.localeCompare(right.collection_id));
  const summaryWithoutChecksum = {
    object: "source_collection_import_summary",
    schema_version: "source_collections.summary.v1",
    collection_count: collectionSummaries.length,
    collection_ids: collectionSummaries.map((collection) => collection.collection_id),
    license_scope_counts: countBy(collectionSummaries.map((collection) => collection.license_scope ?? "unknown")),
    profile_coverage: Object.fromEntries(
      runtimeProfiles.map((profile) => [
        profile,
        collectionSummaries.filter((collection) => collection.publish_profiles.includes(profile)).length,
      ]),
    ),
    collections: collectionSummaries,
  };
  return {
    ...summaryWithoutChecksum,
    checksum_sha256: sha256Text(stableStringify(summaryWithoutChecksum)),
  };
}

async function writeDefaultSummaryArtifact(summary) {
  const storageRoot = path.resolve(process.cwd(), getServiceConfig().storageRoot);
  const fullPath = path.join(storageRoot, sourceCollectionSummaryStoragePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  const checksum = sha256Text(await fs.readFile(fullPath, "utf8"));
  return {
    storage_path: sourceCollectionSummaryStoragePath,
    checksum_sha256: checksum,
  };
}

async function upsertCollectionManifest(client, manifest) {
  const source = manifest.source_ids?.[0];
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
      source,
      manifest.display_name,
      manifest.source_uri ?? null,
      manifest.license ?? null,
      manifest.license_scope ?? null,
      manifest.attribution ?? null,
      JSON.stringify(manifest),
    ],
  );
}

async function upsertSummaryArtifact(client, { storagePath, checksumSha256, summary }) {
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
      sourceCollectionSummaryArtifactId,
      "source_collection_summary",
      null,
      null,
      storagePath,
      "application/json",
      "imported",
      summary.collection_count,
      checksumSha256,
      JSON.stringify({
        schema_version: summary.schema_version,
        collection_ids: summary.collection_ids,
        manifest_checksum_sha256: summary.checksum_sha256,
      }),
    ],
  );
}

async function insertSeedAuditEvent(client, { actor, summary, artifact }) {
  await client.query(
    `
      INSERT INTO knowledge_source_audit_events (event_type, actor, target_type, target_id, payload)
      VALUES ($1, $2, $3, $4, $5)
    `,
    [
      "source_collection.seeded",
      actor,
      "source_collection_registry",
      "source_collections",
      JSON.stringify({
        collection_count: summary.collection_count,
        collection_ids: summary.collection_ids,
        artifact_id: sourceCollectionSummaryArtifactId,
        artifact_checksum_sha256: artifact.checksum_sha256,
        manifest_checksum_sha256: summary.checksum_sha256,
      }),
    ],
  );
}

export function createSourceCollectionSeeder({
  withClient = defaultWithClient,
  manifests = defaultSourceCollectionManifests,
  writeSummaryArtifact = writeDefaultSummaryArtifact,
} = {}) {
  async function seedSourceCollections({ actor = "script" } = {}) {
    const summary = buildSourceCollectionImportSummary({ collections: manifests });
    const artifactWrite = await writeSummaryArtifact(summary);
    const artifact = {
      artifact_id: sourceCollectionSummaryArtifactId,
      artifact_type: "source_collection_summary",
      storage_path: artifactWrite.storage_path,
      checksum_sha256: artifactWrite.checksum_sha256,
      publish_status: "imported",
    };

    await withClient(async (client) => {
      await client.query("BEGIN");
      try {
        for (const manifest of manifests) {
          await upsertCollectionManifest(client, manifest);
        }
        await upsertSummaryArtifact(client, {
          storagePath: artifact.storage_path,
          checksumSha256: artifact.checksum_sha256,
          summary,
        });
        await insertSeedAuditEvent(client, { actor, summary, artifact });
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    });

    return {
      object: "source_collection_seed_result",
      collection_count: summary.collection_count,
      collection_ids: summary.collection_ids,
      artifact,
      summary,
    };
  }

  return {
    seedSourceCollections,
  };
}
