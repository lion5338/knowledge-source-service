import assert from "node:assert/strict";
import test from "node:test";

import { HttpError } from "../src/lib/http/errors.js";
import { createSources } from "../src/lib/sources/sources.js";

function createQueryRecorder(rows = []) {
  const queries = [];
  const sources = createSources({
    withClient: async (callback) =>
      callback({
        query: async (sql, params = []) => {
          queries.push({ sql, params });
          return { rows };
        },
      }),
  });
  return { sources, queries };
}

test("listArtifacts filters by publish_status while preserving existing filters", async () => {
  const { sources, queries } = createQueryRecorder([
    {
      artifact_id: "runtime-index:latest",
      artifact_type: "runtime_index",
      source: null,
      source_version: null,
      storage_path: "index/knowledge-index.json",
      content_type: "application/json",
      publish_status: "published",
      record_count: null,
      checksum_sha256: "runtime-checksum",
      metadata: {},
      created_at: "2026-07-29T12:00:00.000Z",
      updated_at: "2026-07-29T12:00:00.000Z",
    },
  ]);

  const result = await sources.listArtifacts({
    artifactType: "runtime_index",
    source: "marble",
    publishStatus: "published",
    limit: 25,
  });

  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].publish_status, "published");
  assert.match(queries[0].sql, /artifact_type = \$1/);
  assert.match(queries[0].sql, /source = \$2/);
  assert.match(queries[0].sql, /publish_status = \$3/);
  assert.deepEqual(queries[0].params, ["runtime_index", "marble", "published", 25]);
});

test("listArtifacts rejects unsupported publish_status values", async () => {
  const { sources } = createQueryRecorder();

  await assert.rejects(
    () => sources.listArtifacts({ publishStatus: "unknown" }),
    (error) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 400);
      assert.equal(error.code, "bad_request");
      assert.equal(error.details.field, "publish_status");
      return true;
    },
  );
});

test("listArtifacts filters artifacts by knowledge access scope", async () => {
  const { sources } = createQueryRecorder([
    {
      artifact_id: "source-artifact:k12",
      artifact_type: "normalized_documents",
      source: "k12_dataset",
      source_version: null,
      storage_path: "k12.json",
      content_type: "application/json",
      publish_status: "published",
      record_count: 1,
      checksum_sha256: "k12",
      metadata: { collection_id: "k12_kgraph_full" },
      created_at: "2026-08-10T00:00:00.000Z",
      updated_at: "2026-08-10T00:00:00.000Z",
    },
    {
      artifact_id: "source-artifact:marble",
      artifact_type: "normalized_documents",
      source: "marble",
      source_version: null,
      storage_path: "marble.json",
      content_type: "application/json",
      publish_status: "published",
      record_count: 1,
      checksum_sha256: "marble",
      metadata: { collection_id: "marble" },
      created_at: "2026-08-10T00:00:00.000Z",
      updated_at: "2026-08-10T00:00:00.000Z",
    },
  ]);

  const result = await sources.listArtifacts({
    access: { effective_collection_ids: ["marble"] },
  });

  assert.deepEqual(
    result.data.map((artifact) => artifact.artifact_id),
    ["source-artifact:marble"],
  );
});

test("getArtifact returns not_found for artifact outside knowledge access scope", async () => {
  const { sources } = createQueryRecorder([
    {
      artifact_id: "source-artifact:k12",
      artifact_type: "normalized_documents",
      source: "k12_dataset",
      source_version: null,
      storage_path: "k12.json",
      content_type: "application/json",
      publish_status: "published",
      record_count: 1,
      checksum_sha256: "k12",
      metadata: { collection_id: "k12_kgraph_full" },
      created_at: "2026-08-10T00:00:00.000Z",
      updated_at: "2026-08-10T00:00:00.000Z",
    },
  ]);

  await assert.rejects(
    () => sources.getArtifact("source-artifact:k12", { access: { effective_collection_ids: ["marble"] } }),
    (error) => {
      assert.equal(error.status, 404);
      assert.equal(error.code, "not_found");
      return true;
    },
  );
});

test("runtime index artifact metadata is filtered by knowledge access scope", async () => {
  const { sources } = createQueryRecorder([
    {
      artifact_id: "runtime-index:demo:latest",
      artifact_type: "runtime_index",
      source: null,
      source_version: null,
      storage_path: "demo.json",
      content_type: "application/json",
      publish_status: "published",
      record_count: 2,
      checksum_sha256: "demo",
      metadata: {
        source_collection_ids: ["k12_kgraph_full", "marble"],
        blocked_collection_ids: [],
        profile_trace: {
          source_collection_ids: ["k12_kgraph_full", "marble"],
          blocked_collection_ids: [],
        },
      },
      created_at: "2026-08-10T00:00:00.000Z",
      updated_at: "2026-08-10T00:00:00.000Z",
    },
  ]);

  const artifact = await sources.getArtifact("runtime-index:demo:latest", {
    access: {
      effective_collection_ids: ["marble"],
      blocked_collection_ids: ["k12_kgraph_full"],
    },
  });

  assert.deepEqual(artifact.metadata.source_collection_ids, ["marble"]);
  assert.deepEqual(artifact.metadata.blocked_collection_ids, ["k12_kgraph_full"]);
  assert.deepEqual(artifact.metadata.profile_trace.source_collection_ids, ["marble"]);
});
