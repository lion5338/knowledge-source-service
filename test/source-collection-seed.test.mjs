import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSourceCollectionImportSummary,
  createSourceCollectionSeeder,
  sourceCollectionSummaryArtifactId,
} from "../src/lib/source-collections/source-collection-seed.js";

test("buildSourceCollectionImportSummary includes collection count and license summary", () => {
  const summary = buildSourceCollectionImportSummary({
    collections: [
      {
        collection_id: "k12_kgraph_full",
        source_ids: ["k12_dataset"],
        license: "CC BY-NC-SA 4.0",
        license_scope: "non_commercial_demo_only",
        publish_profiles: ["demo"],
        official_curriculum_verified: false,
      },
      {
        collection_id: "marble",
        source_ids: ["marble"],
        license: "ODbL-1.0 / CC-BY-SA-4.0",
        license_scope: "open_educational_source",
        publish_profiles: ["demo", "mvp", "prod"],
        official_curriculum_verified: false,
      },
    ],
  });

  assert.equal(summary.object, "source_collection_import_summary");
  assert.equal(summary.collection_count, 2);
  assert.deepEqual(summary.collection_ids, ["k12_kgraph_full", "marble"]);
  assert.deepEqual(summary.license_scope_counts, {
    non_commercial_demo_only: 1,
    open_educational_source: 1,
  });
  assert.deepEqual(summary.profile_coverage, {
    demo: 2,
    mvp: 1,
    prod: 1,
  });
});

test("seed writes audit event for source_collection.seeded", async () => {
  const queries = [];
  const writes = [];
  const seeder = createSourceCollectionSeeder({
    writeSummaryArtifact: async (summary) => {
      writes.push(summary);
      return {
        storage_path: "reports/source-collections-summary-latest.json",
        checksum_sha256: "summary-checksum",
      };
    },
    withClient: async (callback) =>
      callback({
        query: async (sql, params = []) => {
          queries.push({ sql, params });
          return { rows: [] };
        },
      }),
  });

  const result = await seeder.seedSourceCollections({ actor: "test" });

  assert.equal(result.artifact.artifact_id, sourceCollectionSummaryArtifactId);
  assert.equal(writes.length, 1);
  assert.equal(
    queries.some((query) => query.sql.includes("knowledge_source_audit_events") && query.params[0] === "source_collection.seeded"),
    true,
  );
});

test("summary artifact checksum changes when manifest changes", () => {
  const first = buildSourceCollectionImportSummary({
    collections: [
      {
        collection_id: "marble",
        source_ids: ["marble"],
        license: "ODbL-1.0 / CC-BY-SA-4.0",
        license_scope: "open_educational_source",
        publish_profiles: ["demo", "mvp", "prod"],
      },
    ],
  });
  const second = buildSourceCollectionImportSummary({
    collections: [
      {
        collection_id: "marble",
        source_ids: ["marble"],
        license: "ODbL-1.0 / CC-BY-SA-4.0",
        license_scope: "restricted_review",
        publish_profiles: ["demo"],
      },
    ],
  });

  assert.notEqual(first.checksum_sha256, second.checksum_sha256);
});
