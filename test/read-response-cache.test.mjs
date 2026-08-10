import assert from "node:assert/strict";
import test from "node:test";

import {
  artifactResponseHeaders,
  artifactDetailCacheKey,
  artifactRawCacheKey,
  createRedisResponseCache,
  invalidateKnowledgeSourceReadCache,
  latestRuntimeIndexResponseHeaders,
  responseCacheTtlSeconds,
  runtimeIndexLatestCacheKey,
  knowledgeAccessCacheScope,
  withCachedApiResponse,
} from "../src/lib/http/read-response-cache.js";

function fakeArtifact(overrides = {}) {
  return {
    artifact_id: "runtime-index:sha256:abc123",
    checksum_sha256: "abc123",
    content_type: "application/json",
    publish_status: "published",
    ...overrides,
  };
}

function mapCache(seed = new Map()) {
  const calls = [];
  return {
    calls,
    async get(key) {
      calls.push(["get", key]);
      return seed.get(key) ?? null;
    },
    async set(key, value, options) {
      calls.push(["set", key, options]);
      seed.set(key, value);
    },
    async delete(keys) {
      calls.push(["delete", keys]);
      for (const key of keys) {
        seed.delete(key);
      }
      return keys.length;
    },
  };
}

test("read response cache keys use the knowledge-source v1 namespace", () => {
  assert.equal(runtimeIndexLatestCacheKey(), "knowledge-source:v1:runtime-index:latest");
  assert.equal(runtimeIndexLatestCacheKey("demo"), "knowledge-source:v1:runtime-index:latest:demo");
  assert.equal(runtimeIndexLatestCacheKey("mvp"), "knowledge-source:v1:runtime-index:latest:mvp");
  assert.match(runtimeIndexLatestCacheKey(null, "scope123"), /^knowledge-source:v1:runtime-index:latest:access:scope123$/);
  assert.equal(
    artifactDetailCacheKey("runtime-index:sha256:abc123"),
    "knowledge-source:v1:artifacts:runtime-index%3Asha256%3Aabc123:detail",
  );
  assert.equal(
    artifactRawCacheKey("runtime-index:latest"),
    "knowledge-source:v1:artifacts:runtime-index%3Alatest:raw",
  );
});

test("knowledgeAccessCacheScope is stable for the same effective access", () => {
  const first = knowledgeAccessCacheScope({
    access: {
      access_mode: "tenant_overlay",
      tenant_id: "tenant_a",
      user_id: null,
      effective_collection_ids: ["marble", "tenant:tenant_a:math"],
    },
  });
  const second = knowledgeAccessCacheScope({
    access: {
      access_mode: "tenant_overlay",
      tenant_id: "tenant_a",
      user_id: null,
      effective_collection_ids: ["tenant:tenant_a:math", "marble"],
    },
  });

  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{16}$/);
});

test("artifactResponseHeaders marks immutable content-addressed artifacts as strongly cacheable", () => {
  const headers = artifactResponseHeaders(fakeArtifact());

  assert.equal(headers["ETag"], '"sha256:abc123"');
  assert.equal(headers["Cache-Control"], "public, max-age=31536000, immutable");
  assert.equal(headers["X-Artifact-ID"], "runtime-index:sha256:abc123");
  assert.equal(headers["X-Artifact-Checksum-SHA256"], "abc123");
  assert.equal(headers["X-Artifact-Publish-Status"], "published");
});

test("artifactResponseHeaders keeps mutable aliases revalidation-only", () => {
  const headers = artifactResponseHeaders(
    fakeArtifact({
      artifact_id: "runtime-index:latest",
      checksum_sha256: "latest-checksum",
    }),
  );

  assert.equal(headers["ETag"], '"sha256:latest-checksum"');
  assert.equal(headers["Cache-Control"], "no-cache");
});

test("latestRuntimeIndexResponseHeaders prefers resolved immutable version metadata for tracing", () => {
  const headers = latestRuntimeIndexResponseHeaders({
    profile: "demo",
    trace_mode: "content_addressed_version",
    alias: {
      artifact_id: "runtime-index:latest",
      checksum_sha256: "alias-checksum",
      publish_status: "published",
    },
    version: {
      artifact_id: "runtime-index:sha256:abc123",
      checksum_sha256: "abc123",
      publish_status: "published",
    },
  });

  assert.equal(headers["ETag"], '"sha256:abc123"');
  assert.equal(headers["Cache-Control"], "no-cache");
  assert.equal(headers["X-Knowledge-Source-Trace-Mode"], "content_addressed_version");
  assert.equal(headers["X-Knowledge-Source-Profile"], "demo");
  assert.equal(headers["X-Runtime-Index-Alias-ID"], "runtime-index:latest");
  assert.equal(headers["X-Runtime-Index-Version-ID"], "runtime-index:sha256:abc123");
  assert.equal(headers["X-Artifact-ID"], "runtime-index:sha256:abc123");
  assert.equal(headers["X-Artifact-Checksum-SHA256"], "abc123");
});

test("responseCacheTtlSeconds uses long TTL for immutable runtime index artifacts", () => {
  assert.equal(responseCacheTtlSeconds({ artifactId: "runtime-index:sha256:abc123" }), 31536000);
  assert.equal(responseCacheTtlSeconds({ artifactId: "runtime-index:latest" }), 30);
  assert.equal(responseCacheTtlSeconds({ artifactId: "source:demo:file.json" }), 30);
});

test("createRedisResponseCache is disabled when REDIS_URL is not configured", () => {
  assert.equal(createRedisResponseCache({ redisUrl: "" }), null);
});

test("createRedisResponseCache stores serialized response entries through Redis when configured", async () => {
  const store = new Map();
  const calls = [];
  const cache = createRedisResponseCache({
    redisUrl: "redis://localhost:6379",
    redisClientFactory: async (redisUrl, options) => {
      calls.push(["connect", redisUrl, options]);
      return {
        async get(key) {
          calls.push(["get", key]);
          return store.get(key) ?? null;
        },
        async set(key, value, options) {
          calls.push(["set", key, options]);
          store.set(key, value);
        },
      };
    },
  });

  await cache.set("knowledge-source:v1:test", { status: 200, headers: { ETag: '"sha256:a"' }, body: "{}" }, { ttlSeconds: 30 });
  const cached = await cache.get("knowledge-source:v1:test");

  assert.deepEqual(cached, { status: 200, headers: { ETag: '"sha256:a"' }, body: "{}" });
  assert.deepEqual(calls, [
    ["connect", "redis://localhost:6379", { socket: { connectTimeout: 500 } }],
    ["set", "knowledge-source:v1:test", { EX: 30 }],
    ["get", "knowledge-source:v1:test"],
  ]);
});

test("withCachedApiResponse bypasses cache when Redis cache is not configured", async () => {
  let builds = 0;

  const first = await withCachedApiResponse({
    cache: null,
    cacheKey: "knowledge-source:v1:test",
    ttlSeconds: 30,
    buildResponse: async () => {
      builds += 1;
      return Response.json({ builds }, { headers: { ETag: '"sha256:a"' } });
    },
  });
  const second = await withCachedApiResponse({
    cache: null,
    cacheKey: "knowledge-source:v1:test",
    ttlSeconds: 30,
    buildResponse: async () => {
      builds += 1;
      return Response.json({ builds }, { headers: { ETag: '"sha256:a"' } });
    },
  });

  assert.equal(builds, 2);
  assert.equal(first.headers.get("X-Knowledge-Source-Cache"), "bypass");
  assert.equal(second.headers.get("X-Knowledge-Source-Cache"), "bypass");
  assert.deepEqual(await second.json(), { builds: 2 });
});

test("withCachedApiResponse reads API body and headers metadata from enabled cache", async () => {
  const cache = mapCache();
  let builds = 0;

  const first = await withCachedApiResponse({
    cache,
    cacheKey: "knowledge-source:v1:test",
    ttlSeconds: 30,
    buildResponse: async () => {
      builds += 1;
      return Response.json({ from: "origin" }, { headers: { ETag: '"sha256:a"', "X-Artifact-ID": "a" } });
    },
  });
  const second = await withCachedApiResponse({
    cache,
    cacheKey: "knowledge-source:v1:test",
    ttlSeconds: 30,
    buildResponse: async () => {
      builds += 1;
      return Response.json({ from: "should-not-run" });
    },
  });

  assert.equal(builds, 1);
  assert.equal(first.headers.get("X-Knowledge-Source-Cache"), "miss");
  assert.equal(second.headers.get("X-Knowledge-Source-Cache"), "hit");
  assert.equal(second.headers.get("ETag"), '"sha256:a"');
  assert.equal(second.headers.get("X-Artifact-ID"), "a");
  assert.deepEqual(await second.json(), { from: "origin" });
  assert.deepEqual(cache.calls.map((call) => call[0]), ["get", "set", "get"]);
});

test("withCachedApiResponse returns 304 when If-None-Match matches cached metadata", async () => {
  const cache = mapCache(
    new Map([
      [
        "knowledge-source:v1:test",
        {
          status: 200,
          headers: { ETag: '"sha256:a"', "Content-Type": "application/json" },
          body: JSON.stringify({ cached: true }),
        },
      ],
    ]),
  );

  const response = await withCachedApiResponse({
    cache,
    cacheKey: "knowledge-source:v1:test",
    ttlSeconds: 30,
    request: new Request("http://test.local", {
      headers: { "If-None-Match": '"sha256:a"' },
    }),
    buildResponse: async () => {
      throw new Error("buildResponse should not run on cache hit");
    },
  });

  assert.equal(response.status, 304);
  assert.equal(response.headers.get("ETag"), '"sha256:a"');
  assert.equal(response.headers.get("X-Knowledge-Source-Cache"), "hit");
  assert.equal(await response.text(), "");
});

test("withCachedApiResponse falls back to origin when enabled cache errors", async () => {
  const cache = {
    async get() {
      throw new Error("redis unavailable");
    },
    async set() {
      throw new Error("redis unavailable");
    },
  };

  const response = await withCachedApiResponse({
    cache,
    cacheKey: "knowledge-source:v1:test",
    ttlSeconds: 30,
    buildResponse: async () => Response.json({ from: "origin" }, { headers: { ETag: '"sha256:a"' } }),
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-Knowledge-Source-Cache"), "bypass");
  assert.deepEqual(await response.json(), { from: "origin" });
});

test("invalidateKnowledgeSourceReadCache deletes latest and mutable artifact response keys after import publish", async () => {
  const cache = mapCache();

  const result = await invalidateKnowledgeSourceReadCache({
    cache,
    artifacts: [
      { artifact_id: "runtime-index:latest" },
      { artifact_id: "runtime-index:sha256:abc123" },
      { artifact_id: "reports:latest-import-summary" },
    ],
  });

  assert.equal(result.status, "ok");
  assert.deepEqual(result.keys, [
    "knowledge-source:v1:runtime-index:latest",
    "knowledge-source:v1:runtime-index:latest:demo",
    "knowledge-source:v1:runtime-index:latest:mvp",
    "knowledge-source:v1:runtime-index:latest:prod",
    "knowledge-source:v1:artifacts:runtime-index%3Alatest:detail",
    "knowledge-source:v1:artifacts:runtime-index%3Alatest:raw",
    "knowledge-source:v1:artifacts:reports%3Alatest-import-summary:detail",
    "knowledge-source:v1:artifacts:reports%3Alatest-import-summary:raw",
  ]);
  assert.deepEqual(cache.calls, [["delete", result.keys]]);
});

test("invalidateKnowledgeSourceReadCache is a no-op when Redis cache is not configured", async () => {
  const result = await invalidateKnowledgeSourceReadCache({
    cache: null,
    artifacts: [{ artifact_id: "runtime-index:latest" }],
  });

  assert.deepEqual(result, {
    status: "bypass",
    keys: [],
  });
});
