import assert from "node:assert/strict";
import test from "node:test";

import { createSourceCollections } from "../src/lib/source-collections/source-collections.js";

function collectStrings(value, output = []) {
  if (typeof value === "string") {
    output.push(value);
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectStrings(item, output);
    }
    return output;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      collectStrings(item, output);
    }
  }
  return output;
}

function assertNoRawPathLeak(payload) {
  const strings = collectStrings(payload);
  for (const value of strings) {
    assert.equal(/^[A-Za-z]:[\\/]/.test(value), false, `absolute Windows path leaked: ${value}`);
    assert.equal(value.includes("\\\\"), false, `backslash path leaked: ${value}`);
    assert.equal(value.includes("/raw/"), false, `private raw path leaked: ${value}`);
    assert.equal(value.includes("storage/knowledge/raw"), false, `private storage path leaked: ${value}`);
  }
}

test("listCollections returns default seeded collections with policy metadata", async () => {
  const sourceCollections = createSourceCollections({
    withClient: async (callback) =>
      callback({
        query: async () => ({ rows: [] }),
      }),
  });

  const result = await sourceCollections.listCollections();

  assert.equal(result.object, "list");
  assert.deepEqual(
    result.data.map((collection) => collection.collection_id).sort(),
    ["k12_kgraph_full", "learning_commons", "marble"],
  );
  for (const collection of result.data) {
    assert.equal(Array.isArray(collection.publish_profiles), true);
    assert.ok(collection.license_scope);
    assert.ok(collection.trace);
    assert.equal(collection.trace.raw_path_exposed, false);
  }
});

test("listCollections does not expose raw filesystem paths", async () => {
  const sourceCollections = createSourceCollections({
    withClient: async (callback) =>
      callback({
        query: async () => ({
          rows: [
            {
              source: "marble",
              display_name: "Marble",
              repo_url: "C:\\private\\raw\\marble",
              license: "Custom",
              license_scope: "approved_materials",
              attribution: "Marble",
              config: {
                collection_id: "marble",
                source_uri: "C:\\private\\raw\\marble",
                raw_root: "storage/knowledge/raw/marble",
              },
              created_at: "2026-08-10T00:00:00.000Z",
              updated_at: "2026-08-10T00:00:00.000Z",
            },
          ],
        }),
      }),
  });

  const result = await sourceCollections.listCollections();

  assertNoRawPathLeak(result);
});

test("K12 collection is demo-only and not official curriculum verified", async () => {
  const sourceCollections = createSourceCollections({
    withClient: async (callback) =>
      callback({
        query: async () => ({ rows: [] }),
      }),
  });

  const result = await sourceCollections.listCollections();
  const k12 = result.data.find((collection) => collection.collection_id === "k12_kgraph_full");

  assert.ok(k12);
  assert.equal(k12.license, "CC BY-NC-SA 4.0");
  assert.equal(k12.license_scope, "non_commercial_demo_only");
  assert.deepEqual(k12.publish_profiles, ["demo"]);
  assert.equal(k12.official_curriculum_verified, false);
  assert.deepEqual(k12.trace.profile_policy, {
    allowed_profiles: ["demo"],
    blocked_profiles: ["mvp", "prod"],
  });
});

test("getCollection returns K12 detail with profile policy, snapshot, and artifact summary", async () => {
  const sourceCollections = createSourceCollections({
    withClient: async (callback) =>
      callback({
        query: async (sql) => {
          if (sql.includes("FROM knowledge_source_registry")) {
            return { rows: [] };
          }
          if (sql.includes("FROM knowledge_source_versions")) {
            return {
              rows: [
                {
                  source: "k12_dataset",
                  source_version: "sha256:snapshot-test",
                  snapshot_status: "available",
                  manifest: {
                    snapshot_id: "source-snapshot:k12_kgraph_full:sha256:snapshot-test",
                    checksum_sha256: "snapshot-test",
                  },
                  total_bytes: 1234,
                  imported_at: "2026-08-10T00:00:00.000Z",
                  updated_at: "2026-08-10T00:00:00.000Z",
                },
              ],
            };
          }
          if (sql.includes("FROM knowledge_source_artifacts")) {
            return {
              rows: [
                {
                  artifact_id: "source-artifact:k12_kgraph_full:normalized_knowledge_graph:sha256:artifact-test",
                  artifact_type: "normalized_knowledge_graph",
                  publish_status: "imported",
                  checksum_sha256: "artifact-test",
                  record_count: 12,
                  metadata: { collection_id: "k12_kgraph_full" },
                  created_at: "2026-08-10T00:01:00.000Z",
                  updated_at: "2026-08-10T00:01:00.000Z",
                },
              ],
            };
          }
          throw new Error(`Unexpected SQL: ${sql}`);
        },
      }),
  });

  const result = await sourceCollections.getCollection("k12_kgraph_full");

  assert.equal(result.object, "source_collection");
  assert.equal(result.collection_id, "k12_kgraph_full");
  assert.equal(result.source_uri, "datasets/K12-KGraph-HF/K12-KGraph");
  assert.deepEqual(result.trace.profile_policy, {
    allowed_profiles: ["demo"],
    blocked_profiles: ["mvp", "prod"],
  });
  assert.deepEqual(result.snapshot, {
    snapshot_id: "source-snapshot:k12_kgraph_full:sha256:snapshot-test",
    source_version: "sha256:snapshot-test",
    snapshot_status: "available",
    checksum_sha256: "snapshot-test",
    raw_manifest: null,
    total_bytes: 1234,
    imported_at: "2026-08-10T00:00:00.000Z",
    updated_at: "2026-08-10T00:00:00.000Z",
  });
  assert.deepEqual(result.artifacts, [
    {
      artifact_id: "source-artifact:k12_kgraph_full:normalized_knowledge_graph:sha256:artifact-test",
      artifact_type: "normalized_knowledge_graph",
      publish_status: "imported",
      checksum_sha256: "artifact-test",
      record_count: 12,
      created_at: "2026-08-10T00:01:00.000Z",
      updated_at: "2026-08-10T00:01:00.000Z",
    },
  ]);
});

test("getCollection returns stable not_found for unknown collection", async () => {
  const sourceCollections = createSourceCollections({
    withClient: async (callback) =>
      callback({
        query: async () => ({ rows: [] }),
      }),
  });

  await assert.rejects(
    () => sourceCollections.getCollection("unknown_collection"),
    (error) => {
      assert.equal(error.status, 404);
      assert.equal(error.code, "not_found");
      assert.equal(error.type, "not_found");
      return true;
    },
  );
});

test("listCollections can filter by knowledge access scope", async () => {
  const sourceCollections = createSourceCollections({
    withClient: async (callback) =>
      callback({
        query: async () => ({ rows: [] }),
      }),
  });

  const result = await sourceCollections.listCollections({
    access: {
      effective_collection_ids: ["marble"],
    },
  });

  assert.deepEqual(
    result.data.map((collection) => collection.collection_id),
    ["marble"],
  );
});

test("listCollections merges visible tenant collections for tenant identity", async () => {
  const sourceCollections = createSourceCollections({
    withClient: async (callback) =>
      callback({
        query: async (sql) => {
          if (sql.includes("FROM knowledge_source_registry")) {
            return { rows: [] };
          }
          if (sql.includes("FROM knowledge_source_tenant_collections")) {
            return {
              rows: [
                {
                  collection_id: "tenant:tenant_a:uploaded_math",
                  tenant_id: "tenant_a",
                  owner_user_id: null,
                  display_name: "Uploaded Math",
                  collection_type: "tenant_documents",
                  source_family: "tenant_upload",
                  license_scope: "tenant_private",
                  visibility: "tenant_only",
                  ingest_status: "available",
                  snapshot_id: "source-snapshot:tenant:tenant_a:uploaded_math:sha256:snapshot",
                  metadata: { source_ids: ["tenant_uploaded_math"], attribution: "Tenant A" },
                  created_at: "2026-08-10T00:00:00.000Z",
                  updated_at: "2026-08-10T00:00:00.000Z",
                },
              ],
            };
          }
          throw new Error(`Unexpected SQL: ${sql}`);
        },
      }),
  });

  const result = await sourceCollections.listCollections({
    tenantIdentity: { tenant_id: "tenant_a", user_id: null },
    access: { effective_collection_ids: ["tenant:tenant_a:uploaded_math"] },
  });

  assert.deepEqual(
    result.data.map((collection) => collection.collection_id),
    ["tenant:tenant_a:uploaded_math"],
  );
  assert.equal(result.data[0].license_scope, "tenant_private");
  assert.equal(result.data[0].trace.visibility, "tenant_only");
  assert.equal(result.data[0].trace.source, "knowledge_source_tenant_collections");
});

test("getCollection returns not_found for collection outside access scope", async () => {
  const sourceCollections = createSourceCollections({
    withClient: async (callback) =>
      callback({
        query: async () => ({ rows: [] }),
      }),
  });

  await assert.rejects(
    () =>
      sourceCollections.getCollection("k12_kgraph_full", {
        access: {
          effective_collection_ids: ["marble"],
        },
      }),
    (error) => {
      assert.equal(error.status, 404);
      assert.equal(error.code, "not_found");
      return true;
    },
  );
});

test("getCollection does not expose private raw path in detail", async () => {
  const sourceCollections = createSourceCollections({
    withClient: async (callback) =>
      callback({
        query: async (sql) => {
          if (sql.includes("FROM knowledge_source_registry")) {
            return {
              rows: [
                {
                  source: "marble",
                  display_name: "Marble",
                  repo_url: "C:\\private\\raw\\marble",
                  license: "Custom",
                  license_scope: "approved_materials",
                  attribution: "Marble",
                  config: {
                    collection_id: "marble",
                    source_uri: "C:\\private\\raw\\marble",
                    raw_root: "storage/knowledge/raw/marble",
                  },
                  created_at: "2026-08-10T00:00:00.000Z",
                  updated_at: "2026-08-10T00:00:00.000Z",
                },
              ],
            };
          }
          return { rows: [] };
        },
      }),
  });

  const result = await sourceCollections.getCollection("marble");

  assert.equal(result.source_uri, "https://github.com/withmarbleapp/os-taxonomy");
  assert.equal(result.trace.source_uri_redacted, true);
  assertNoRawPathLeak(result);
});
