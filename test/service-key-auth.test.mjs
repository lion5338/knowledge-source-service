import assert from "node:assert/strict";
import test from "node:test";

import { requireKnowledgeSourceAuth, requireServiceKeyAuth } from "../src/lib/http/service-key-auth.js";

function requestWithAuthorization(value) {
  return new Request("http://test.local/v1/runtime-index/latest", {
    headers: value ? { Authorization: value } : {},
  });
}

async function rejectsUnauthorized(request, serviceKey) {
  await assert.rejects(
    () => requireServiceKeyAuth(request, { serviceKey }),
    (error) => {
      assert.equal(error.status, 401);
      assert.equal(error.code, "unauthorized");
      assert.equal(error.type, "auth_error");
      assert.equal(error.message, "Unauthorized.");
      assert.equal(error.details, null);
      return true;
    },
  );
}

test("requireServiceKeyAuth bypasses auth when KNOWLEDGE_SOURCE_KEY is not configured", async () => {
  const result = await requireServiceKeyAuth(requestWithAuthorization(null), { serviceKey: "" });

  assert.deepEqual(result, {
    enabled: false,
  });
});

test("requireServiceKeyAuth rejects missing bearer credentials with a unified 401", async () => {
  await rejectsUnauthorized(requestWithAuthorization(null), "demo-secret");
});

test("requireServiceKeyAuth rejects malformed bearer credentials with a unified 401", async () => {
  await rejectsUnauthorized(requestWithAuthorization("Basic demo-secret"), "demo-secret");
  await rejectsUnauthorized(requestWithAuthorization("Bearer"), "demo-secret");
  await rejectsUnauthorized(requestWithAuthorization("Bearer "), "demo-secret");
});

test("requireServiceKeyAuth rejects wrong bearer credentials with a unified 401", async () => {
  await rejectsUnauthorized(requestWithAuthorization("Bearer wrong-secret"), "demo-secret");
});

test("requireServiceKeyAuth accepts the correct bearer token", async () => {
  const result = await requireServiceKeyAuth(requestWithAuthorization("Bearer demo-secret"), {
    serviceKey: "demo-secret",
  });

  assert.deepEqual(result, {
    enabled: true,
  });
});

test("protected demo read handlers can gate requests with service key auth", async () => {
  async function protectedHandler(request) {
    await requireServiceKeyAuth(request, { serviceKey: "demo-secret" });
    return Response.json({ ok: true });
  }

  await rejectsUnauthorized(requestWithAuthorization(null), "demo-secret");
  const response = await protectedHandler(requestWithAuthorization("Bearer demo-secret"));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test("unprotected handlers stay open regardless of service key configuration", async () => {
  async function unprotectedHandler() {
    return Response.json({ openapi: "3.0.3" });
  }

  const response = await unprotectedHandler(requestWithAuthorization(null));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { openapi: "3.0.3" });
});

test("requireKnowledgeSourceAuth accepts service key without tenant key lookup", async () => {
  let lookupCount = 0;
  const result = await requireKnowledgeSourceAuth(requestWithAuthorization("Bearer demo-secret"), {
    serviceKey: "demo-secret",
    knowledgeAccessConfig: { enableTenant: true },
    findAccessKeyIdentity: async () => {
      lookupCount += 1;
      return null;
    },
  });

  assert.equal(lookupCount, 0);
  assert.equal(result.enabled, true);
  assert.equal(result.mode, "service_key");
  assert.deepEqual(result.identity, {
    key_id: "service:knowledge_source",
    key_type: "service",
    tenant_id: null,
    user_id: null,
    scopes: ["knowledge:read", "knowledge:admin"],
    metadata: {},
  });
});

test("requireKnowledgeSourceAuth rejects wrong key when tenant access is disabled", async () => {
  await assert.rejects(
    () =>
      requireKnowledgeSourceAuth(requestWithAuthorization("Bearer tenant-secret"), {
        serviceKey: "demo-secret",
        knowledgeAccessConfig: { enableTenant: false },
        findAccessKeyIdentity: async () => ({
          key_id: "key_1",
          key_type: "tenant",
          tenant_id: "tenant_a",
          user_id: null,
          scopes: ["knowledge:read"],
          metadata: {},
        }),
      }),
    (error) => {
      assert.equal(error.status, 401);
      assert.equal(error.code, "unauthorized");
      return true;
    },
  );
});

test("requireKnowledgeSourceAuth accepts active tenant key when tenant access is enabled", async () => {
  const result = await requireKnowledgeSourceAuth(requestWithAuthorization("Bearer tenant-secret"), {
    serviceKey: "demo-secret",
    knowledgeAccessConfig: { enableTenant: true },
    findAccessKeyIdentity: async ({ bearerToken }) => {
      assert.equal(bearerToken, "tenant-secret");
      return {
        key_id: "key_1",
        key_type: "tenant",
        tenant_id: "tenant_a",
        user_id: null,
        scopes: ["knowledge:read"],
        metadata: { label: "Tenant A" },
      };
    },
  });

  assert.equal(result.enabled, true);
  assert.equal(result.mode, "tenant_key");
  assert.equal(result.identity.tenant_id, "tenant_a");
  assert.equal(result.identity.metadata.label, "Tenant A");
});

test("requireKnowledgeSourceAuth returns unified 401 for missing tenant key", async () => {
  await assert.rejects(
    () =>
      requireKnowledgeSourceAuth(requestWithAuthorization(null), {
        serviceKey: "",
        knowledgeAccessConfig: { enableTenant: true },
        findAccessKeyIdentity: async () => null,
      }),
    (error) => {
      assert.equal(error.status, 401);
      assert.equal(error.code, "unauthorized");
      assert.equal(error.message, "Unauthorized.");
      return true;
    },
  );
});
