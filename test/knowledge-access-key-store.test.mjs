import assert from "node:assert/strict";
import test from "node:test";

import { hashAccessKey, keyPrefix } from "../src/lib/knowledge-access/key-hashing.js";
import { createAccessKeyStore } from "../src/lib/knowledge-access/key-store.js";

function createMockStore({ rows = [] } = {}) {
  const queries = [];
  const store = createAccessKeyStore({
    withClient: async (callback) =>
      callback({
        query: async (sql, params = []) => {
          queries.push({ sql, params });
          return { rows };
        },
      }),
  });
  return { store, queries };
}

test("hashAccessKey returns deterministic sha256 without exposing plaintext", () => {
  const hash = hashAccessKey("tenant-secret-key");

  assert.equal(hash, "6bb9e18101dd41f96fe9e6fc113e2229192c8bdb5911c32e044c07501f1815d9");
  assert.equal(hash.includes("tenant-secret-key"), false);
});

test("keyPrefix returns a short non-secret prefix", () => {
  assert.equal(keyPrefix("tenant-secret-key"), "tenant");
  assert.equal(keyPrefix("abc"), "abc");
  assert.equal(keyPrefix(""), null);
});

test("key store looks up active key by sha256 hash", async () => {
  const { store, queries } = createMockStore({
    rows: [
      {
        key_id: "key_123",
        key_type: "tenant",
        tenant_id: "tenant_123",
        user_id: "user_123",
        scopes: ["knowledge:read"],
        status: "active",
        expires_at: null,
        metadata: { label: "Primary tenant key" },
      },
    ],
  });

  const identity = await store.findAccessKeyIdentity({ bearerToken: "tenant-secret-key" });

  assert.deepEqual(identity, {
    key_id: "key_123",
    key_type: "tenant",
    tenant_id: "tenant_123",
    user_id: "user_123",
    scopes: ["knowledge:read"],
    metadata: { label: "Primary tenant key" },
  });
  assert.equal(JSON.stringify(identity).includes("tenant-secret-key"), false);
  assert.equal(JSON.stringify(identity).includes(hashAccessKey("tenant-secret-key")), false);
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /FROM knowledge_source_api_keys/);
  assert.match(queries[0].sql, /status = \$2/);
  assert.match(queries[0].sql, /expires_at IS NULL OR expires_at > now\(\)/);
  assert.deepEqual(queries[0].params, [hashAccessKey("tenant-secret-key"), "active"]);
});

test("key store rejects suspended key", async () => {
  const { store } = createMockStore({ rows: [] });

  assert.equal(await store.findAccessKeyIdentity({ bearerToken: "suspended-key" }), null);
});

test("key store rejects expired key", async () => {
  const { store, queries } = createMockStore({ rows: [] });

  assert.equal(await store.findAccessKeyIdentity({ bearerToken: "expired-key" }), null);
  assert.match(queries[0].sql, /expires_at IS NULL OR expires_at > now\(\)/);
});

test("key store returns null when key is unknown", async () => {
  const { store } = createMockStore({ rows: [] });

  assert.equal(await store.findAccessKeyIdentity({ bearerToken: "unknown-key" }), null);
});

test("key store returns null for missing bearer token without querying DB", async () => {
  const { store, queries } = createMockStore();

  assert.equal(await store.findAccessKeyIdentity({ bearerToken: "" }), null);
  assert.equal(await store.findAccessKeyIdentity({ bearerToken: null }), null);
  assert.deepEqual(queries, []);
});
