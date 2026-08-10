import crypto from "crypto";

import { getServiceConfig, readEnv } from "../config.js";
import { findAccessKeyIdentity as defaultFindAccessKeyIdentity } from "../knowledge-access/key-store.js";
import { bearerToken } from "./bearer-token.js";
import { unauthorized } from "./errors.js";

function configuredServiceKey(serviceKey) {
  return serviceKey?.trim?.() ?? "";
}

function constantTimeEquals(actual, expected) {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  const sameLength = actualBuffer.length === expectedBuffer.length;
  const safeActualBuffer = sameLength ? actualBuffer : Buffer.alloc(expectedBuffer.length);
  return crypto.timingSafeEqual(safeActualBuffer, expectedBuffer) && sameLength;
}

export async function requireServiceKeyAuth(request, { serviceKey = readEnv("KNOWLEDGE_SOURCE_KEY", "") } = {}) {
  const expected = configuredServiceKey(serviceKey);
  if (!expected) {
    return { enabled: false };
  }

  const actual = bearerToken(request);
  if (!actual || !constantTimeEquals(actual, expected)) {
    throw unauthorized();
  }

  return { enabled: true };
}

function serviceIdentity() {
  return {
    key_id: "service:knowledge_source",
    key_type: "service",
    tenant_id: null,
    user_id: null,
    scopes: ["knowledge:read", "knowledge:admin"],
    metadata: {},
  };
}

export async function requireKnowledgeSourceAuth(
  request,
  {
    serviceKey = readEnv("KNOWLEDGE_SOURCE_KEY", ""),
    knowledgeAccessConfig = getServiceConfig().knowledgeAccess,
    findAccessKeyIdentity = defaultFindAccessKeyIdentity,
  } = {},
) {
  const expected = configuredServiceKey(serviceKey);
  const actual = bearerToken(request);
  if (expected && actual && constantTimeEquals(actual, expected)) {
    return {
      enabled: true,
      mode: "service_key",
      identity: serviceIdentity(),
    };
  }

  if (knowledgeAccessConfig?.enableTenant) {
    const identity = actual ? await findAccessKeyIdentity({ bearerToken: actual }) : null;
    if (!identity) {
      throw unauthorized();
    }
    return {
      enabled: true,
      mode: "tenant_key",
      identity,
    };
  }

  if (!expected) {
    return {
      enabled: false,
      mode: "disabled",
      identity: null,
    };
  }
  throw unauthorized();
}
