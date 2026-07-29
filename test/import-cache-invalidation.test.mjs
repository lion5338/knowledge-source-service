import assert from "node:assert/strict";
import test from "node:test";

import {
  invalidateKnowledgeSourceReadCacheAfterImport,
  mutableReadCacheKeysForArtifacts,
} from "../scripts/lib/read-response-cache-invalidation.mjs";

test("import cache invalidation uses the same knowledge-source v1 mutable read keys", () => {
  assert.deepEqual(
    mutableReadCacheKeysForArtifacts([
      { artifact_id: "runtime-index:latest" },
      { artifact_id: "runtime-index:sha256:abc123" },
      { artifact_id: "import-summary:latest" },
    ]),
    [
      "knowledge-source:v1:runtime-index:latest",
      "knowledge-source:v1:artifacts:runtime-index%3Alatest:detail",
      "knowledge-source:v1:artifacts:runtime-index%3Alatest:raw",
      "knowledge-source:v1:artifacts:import-summary%3Alatest:detail",
      "knowledge-source:v1:artifacts:import-summary%3Alatest:raw",
    ],
  );
});

test("import cache invalidation deletes Redis keys when REDIS_URL is configured", async () => {
  const calls = [];
  const result = await invalidateKnowledgeSourceReadCacheAfterImport({
    redisUrl: "redis://localhost:6379",
    artifacts: [{ artifact_id: "runtime-index:latest" }],
    redisClientFactory: async (redisUrl, options) => {
      calls.push(["connect", redisUrl, options]);
      return {
        async del(keys) {
          calls.push(["del", keys]);
        },
        async quit() {
          calls.push(["quit"]);
        },
      };
    },
  });

  assert.equal(result.status, "ok");
  assert.deepEqual(result.keys, [
    "knowledge-source:v1:runtime-index:latest",
    "knowledge-source:v1:artifacts:runtime-index%3Alatest:detail",
    "knowledge-source:v1:artifacts:runtime-index%3Alatest:raw",
  ]);
  assert.deepEqual(calls, [
    ["connect", "redis://localhost:6379", { socket: { connectTimeout: 500 } }],
    ["del", result.keys],
    ["quit"],
  ]);
});
