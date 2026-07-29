import assert from "node:assert/strict";
import test from "node:test";

import { requireServiceKeyAuth } from "../src/lib/http/service-key-auth.js";

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
