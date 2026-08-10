import { withClient as defaultWithClient } from "../db/pool.js";
import { notFound } from "../http/errors.js";

const runtimeProfiles = ["demo", "mvp", "prod"];

const defaultSourceCollectionManifests = [
  {
    collection_id: "k12_kgraph_full",
    collection_type: "knowledge_graph",
    source_family: "k12",
    display_name: "K12-KGraph Full",
    source_ids: ["k12_dataset"],
    source_uri: "datasets/K12-KGraph-HF/K12-KGraph",
    license: "CC BY-NC-SA 4.0",
    license_scope: "non_commercial_demo_only",
    attribution:
      "K12-KGraph / K12-Dataset by haolpku, built from PEP Chinese K-12 textbooks. Dataset license: CC BY-NC-SA 4.0.",
    locale: "zh-CN",
    curriculum_region: "mainland_china",
    official_curriculum_verified: false,
    publish_profiles: ["demo"],
    ingest_status: "planned",
    snapshot_id: null,
  },
  {
    collection_id: "marble",
    collection_type: "taxonomy",
    source_family: "marble",
    display_name: "Marble Skill Taxonomy",
    source_ids: ["marble"],
    source_uri: "https://github.com/withmarbleapp/os-taxonomy",
    license: "ODbL-1.0 / CC-BY-SA-4.0",
    license_scope: "open_educational_source",
    attribution:
      "Marble Skill Taxonomy (v1) - Copyright Generative Spark, Inc. (Marble), licensed under ODbL 1.0 and CC BY-SA 4.0.",
    locale: "en",
    curriculum_region: null,
    official_curriculum_verified: false,
    publish_profiles: ["demo", "mvp", "prod"],
    ingest_status: "planned",
    snapshot_id: null,
  },
  {
    collection_id: "learning_commons",
    collection_type: "knowledge_graph",
    source_family: "learning_commons",
    display_name: "Learning Commons Knowledge Graph",
    source_ids: ["learning_commons"],
    source_uri: "https://github.com/learning-commons-org/knowledge-graph",
    license: "CC BY-4.0",
    license_scope: "open_educational_source",
    attribution: "Knowledge Graph is provided by Learning Commons under the CC BY-4.0 license.",
    locale: "en",
    curriculum_region: null,
    official_curriculum_verified: false,
    publish_profiles: ["demo", "mvp", "prod"],
    ingest_status: "planned",
    snapshot_id: null,
  },
];

const defaultManifestByCollectionId = new Map(
  defaultSourceCollectionManifests.map((manifest) => [manifest.collection_id, manifest]),
);

function normalizeSourceId(value) {
  const source = String(value ?? "").trim().toLowerCase();
  if (source === "learning-commons") {
    return "learning_commons";
  }
  if (source === "k12-dataset" || source === "k12_dataset") {
    return "k12_dataset";
  }
  return source;
}

function collectionIdForRow(row = {}) {
  const configured = row.config?.collection_id ?? row.config?.collectionId;
  if (configured) {
    return String(configured);
  }
  const source = normalizeSourceId(row.source);
  if (source === "k12_dataset") {
    return "k12_kgraph_full";
  }
  return source;
}

function sourceIdsForRow(row = {}, fallback = {}) {
  const configured = row.config?.source_ids ?? row.config?.sourceIds;
  if (Array.isArray(configured) && configured.length > 0) {
    return configured.map(normalizeSourceId).filter(Boolean);
  }
  const source = normalizeSourceId(row.source);
  return source ? [source] : fallback.source_ids ?? [];
}

function isSafeSourceUri(value) {
  const uri = String(value ?? "").trim();
  if (!uri) {
    return false;
  }
  if (/^[A-Za-z]:[\\/]/.test(uri)) {
    return false;
  }
  if (uri.includes("\\") || uri.includes("/raw/") || uri.includes("storage/knowledge/raw")) {
    return false;
  }
  return true;
}

function normalizePublishProfiles(value, fallback = []) {
  const raw = Array.isArray(value) ? value : [];
  const profiles = raw.filter((profile) => runtimeProfiles.includes(profile));
  return profiles.length > 0 ? profiles : fallback;
}

function profilePolicy(publishProfiles = []) {
  const allowed = normalizePublishProfiles(publishProfiles);
  return {
    allowed_profiles: allowed,
    blocked_profiles: runtimeProfiles.filter((profile) => !allowed.includes(profile)),
  };
}

function collectionFromManifest(manifest = {}, { includeSourceUri = false } = {}) {
  const publishProfiles = normalizePublishProfiles(manifest.publish_profiles, []);
  const collection = {
    collection_id: manifest.collection_id,
    collection_type: manifest.collection_type,
    source_family: manifest.source_family,
    display_name: manifest.display_name,
    source_ids: Array.isArray(manifest.source_ids) ? manifest.source_ids : [],
    license: manifest.license,
    license_scope: manifest.license_scope,
    attribution: manifest.attribution,
    locale: manifest.locale ?? null,
    curriculum_region: manifest.curriculum_region ?? null,
    official_curriculum_verified: Boolean(manifest.official_curriculum_verified),
    publish_profiles: publishProfiles,
    ingest_status: manifest.ingest_status ?? "planned",
    snapshot_id: manifest.snapshot_id ?? null,
    created_at: manifest.created_at ?? null,
    updated_at: manifest.updated_at ?? null,
    trace: {
      source: "default_source_collection_manifest",
      raw_path_exposed: false,
      profile_policy: profilePolicy(publishProfiles),
    },
  };
  if (includeSourceUri) {
    collection.source_uri = isSafeSourceUri(manifest.source_uri) ? manifest.source_uri : null;
  }
  return collection;
}

function collectionFromRow(row = {}, { includeSourceUri = false } = {}) {
  const collectionId = collectionIdForRow(row);
  const fallback = defaultManifestByCollectionId.get(collectionId) ?? {};
  const config = row.config ?? {};
  const publishProfiles = normalizePublishProfiles(
    config.publish_profiles ?? config.publishProfiles ?? config.enabled_profiles ?? config.enabledProfiles,
    fallback.publish_profiles ?? [],
  );
  const sourceUri = [config.source_uri, config.sourceUri, row.repo_url, fallback.source_uri].find(isSafeSourceUri);

  const collection = {
    collection_id: collectionId,
    collection_type: config.collection_type ?? config.collectionType ?? fallback.collection_type ?? "knowledge_source",
    source_family: config.source_family ?? config.sourceFamily ?? fallback.source_family ?? collectionId,
    display_name: row.display_name ?? fallback.display_name ?? collectionId,
    source_ids: sourceIdsForRow(row, fallback),
    license: row.license ?? fallback.license ?? null,
    license_scope: row.license_scope ?? config.license_scope ?? config.licenseScope ?? fallback.license_scope ?? null,
    attribution: row.attribution ?? fallback.attribution ?? null,
    locale: config.locale ?? fallback.locale ?? null,
    curriculum_region: config.curriculum_region ?? config.curriculumRegion ?? fallback.curriculum_region ?? null,
    official_curriculum_verified: Boolean(
      config.official_curriculum_verified ??
        config.officialCurriculumVerified ??
        fallback.official_curriculum_verified ??
        false,
    ),
    publish_profiles: publishProfiles,
    ingest_status: config.ingest_status ?? config.ingestStatus ?? fallback.ingest_status ?? "planned",
    snapshot_id: config.snapshot_id ?? config.snapshotId ?? fallback.snapshot_id ?? null,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
    trace: {
      source: "knowledge_source_registry",
      raw_path_exposed: false,
      profile_policy: profilePolicy(publishProfiles),
      registry_source: row.source ?? null,
      source_uri_redacted: Boolean(sourceUri && sourceUri !== (config.source_uri ?? config.sourceUri ?? row.repo_url)),
    },
  };
  if (includeSourceUri) {
    collection.source_uri = sourceUri ?? null;
  }
  return collection;
}

function tenantCollectionFromRow(row = {}, { includeSourceUri = false } = {}) {
  const metadata = row.metadata ?? {};
  const sourceIds = Array.isArray(metadata.source_ids) && metadata.source_ids.length > 0 ? metadata.source_ids : [row.collection_id];
  const collection = {
    collection_id: row.collection_id,
    collection_type: row.collection_type ?? "tenant_documents",
    source_family: row.source_family ?? "tenant_upload",
    display_name: row.display_name,
    source_ids: sourceIds,
    license: metadata.license ?? null,
    license_scope: row.license_scope ?? "tenant_private",
    attribution: metadata.attribution ?? null,
    locale: metadata.locale ?? null,
    curriculum_region: null,
    official_curriculum_verified: false,
    publish_profiles: runtimeProfiles,
    ingest_status: row.ingest_status ?? "planned",
    snapshot_id: row.snapshot_id ?? null,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
    trace: {
      source: "knowledge_source_tenant_collections",
      raw_path_exposed: false,
      profile_policy: profilePolicy(runtimeProfiles),
      tenant_id: row.tenant_id ?? null,
      owner_user_id: row.owner_user_id ?? null,
      visibility: row.visibility ?? "tenant_only",
    },
  };
  if (includeSourceUri) {
    collection.source_uri = isSafeSourceUri(metadata.source_uri) ? metadata.source_uri : null;
  }
  return collection;
}

function mergeDefaultAndRegistryCollections(rows = [], tenantRows = [], options = {}) {
  const collections = new Map(
    defaultSourceCollectionManifests.map((manifest) => [manifest.collection_id, collectionFromManifest(manifest)]),
  );
  for (const row of rows) {
    collections.set(collectionIdForRow(row), collectionFromRow(row));
  }
  for (const row of tenantRows) {
    collections.set(row.collection_id, tenantCollectionFromRow(row, options));
  }
  return [...collections.values()].sort((a, b) => a.collection_id.localeCompare(b.collection_id));
}

function artifactSummary(row = {}) {
  return {
    artifact_id: row.artifact_id,
    artifact_type: row.artifact_type,
    publish_status: row.publish_status,
    checksum_sha256: row.checksum_sha256 ?? null,
    record_count: row.record_count ?? null,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
  };
}

function snapshotSummary(collectionId, row = {}) {
  if (!row.source_version) {
    return null;
  }
  const manifest = row.manifest ?? {};
  const snapshotId =
    manifest.snapshot_id ??
    manifest.snapshotId ??
    (String(row.source_version).startsWith("source-snapshot:")
      ? row.source_version
      : `source-snapshot:${collectionId}:${row.source_version}`);
  return {
    snapshot_id: snapshotId,
    source_version: row.source_version,
    snapshot_status: row.snapshot_status,
    checksum_sha256: manifest.checksum_sha256 ?? manifest.checksumSha256 ?? null,
    raw_manifest: manifest.raw_manifest ?? manifest.rawManifest ?? null,
    total_bytes: Number(row.total_bytes ?? manifest.total_bytes ?? 0),
    imported_at: row.imported_at ?? null,
    updated_at: row.updated_at ?? null,
  };
}

function collectionDetail(collection, { snapshot = null, artifacts = [] } = {}) {
  return {
    object: "source_collection",
    ...collection,
    snapshot,
    artifacts: artifacts.map(artifactSummary),
  };
}

function accessAllowsCollection(access, collectionId) {
  if (!access) {
    return true;
  }
  return new Set(access.effective_collection_ids ?? []).has(collectionId);
}

function tenantIdentityFromOptions(options = {}) {
  const identity = options.tenantIdentity ?? options.access ?? null;
  if (!identity?.tenant_id && !identity?.user_id) {
    return null;
  }
  return {
    tenant_id: identity.tenant_id ?? null,
    user_id: identity.user_id ?? null,
  };
}

async function findTenantCollectionRows(client, options = {}) {
  const identity = tenantIdentityFromOptions(options);
  if (!identity?.tenant_id) {
    return [];
  }
  const result = await client.query(
    `
      SELECT collection_id, tenant_id, owner_user_id, display_name, collection_type, source_family,
             license_scope, visibility, ingest_status, snapshot_id, metadata, created_at, updated_at
      FROM knowledge_source_tenant_collections
      WHERE tenant_id = $1
        AND (
          visibility IN ($2, $3)
          OR ($4::text IS NOT NULL AND owner_user_id = $4::text)
        )
      ORDER BY collection_id ASC
    `,
    [identity.tenant_id, "tenant_only", "shared_with_tenant", identity.user_id],
  );
  return result.rows ?? [];
}

export function createSourceCollections({ withClient = defaultWithClient } = {}) {
  async function listCollections(options = {}) {
    return withClient(async (client) => {
      const result = await client.query(
        `
          SELECT *
          FROM knowledge_source_registry
          ORDER BY source ASC
        `,
      );
      const tenantRows = await findTenantCollectionRows(client, options);
      return {
        object: "list",
        data: mergeDefaultAndRegistryCollections(result.rows, tenantRows).filter((collection) =>
          accessAllowsCollection(options.access, collection.collection_id),
        ),
      };
    });
  }

  async function getCollection(collectionId, options = {}) {
    return withClient(async (client) => {
      const registryResult = await client.query(
        `
          SELECT *
          FROM knowledge_source_registry
          ORDER BY source ASC
        `,
      );
      const registryRows = registryResult.rows ?? [];
      const tenantRows = await findTenantCollectionRows(client, options);
      const row = registryRows.find((candidate) => collectionIdForRow(candidate) === collectionId);
      const manifest = defaultManifestByCollectionId.get(collectionId);
      const tenantRow = tenantRows.find((candidate) => candidate.collection_id === collectionId);
      if (!row && !manifest && !tenantRow) {
        throw notFound(`Source collection not found: ${collectionId}`);
      }
      if (!accessAllowsCollection(options.access, collectionId)) {
        throw notFound(`Source collection not found: ${collectionId}`);
      }

      const collection = tenantRow
        ? tenantCollectionFromRow(tenantRow, { includeSourceUri: true })
        : row
        ? collectionFromRow(row, { includeSourceUri: true })
        : collectionFromManifest(manifest, { includeSourceUri: true });
      const sourceIds = collection.source_ids;

      const [snapshotResult, artifactsResult] = await Promise.all([
        client.query(
          `
            SELECT source, source_version, snapshot_status, manifest, total_bytes, imported_at, updated_at
            FROM knowledge_source_versions
            WHERE source = ANY($1::text[])
            ORDER BY imported_at DESC, updated_at DESC
            LIMIT 1
          `,
          [sourceIds],
        ),
        client.query(
          `
            SELECT artifact_id, artifact_type, publish_status, checksum_sha256, record_count, metadata, created_at, updated_at
            FROM knowledge_source_artifacts
            WHERE source = ANY($1::text[])
               OR metadata->>'collection_id' = $2
               OR metadata->>'source_collection_id' = $2
            ORDER BY updated_at DESC, created_at DESC
            LIMIT 20
          `,
          [sourceIds, collectionId],
        ),
      ]);

      return collectionDetail(collection, {
        snapshot: snapshotSummary(collectionId, snapshotResult.rows?.[0]),
        artifacts: artifactsResult.rows ?? [],
      });
    });
  }

  return {
    listCollections,
    getCollection,
  };
}

const defaultSourceCollections = createSourceCollections();

export const { listCollections, getCollection } = defaultSourceCollections;
export { defaultSourceCollectionManifests, profilePolicy };
