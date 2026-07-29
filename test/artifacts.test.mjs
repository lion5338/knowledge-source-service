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
