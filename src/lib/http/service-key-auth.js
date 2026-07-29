import crypto from "crypto";
import { readEnv } from "../config.js";
import { unauthorized } from "./errors.js";

function configuredServiceKey(serviceKey) {
  return serviceKey?.trim?.() ?? "";
}

function bearerToken(request) {
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/);
  return match?.[1] ?? "";
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
