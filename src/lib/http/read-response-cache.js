import { readEnv } from "../config.js";
import {
  artifactDetailCacheKey,
  artifactRawCacheKey,
  immutableResponseCacheTtlSeconds,
  isImmutableArtifactId,
  mutableReadCacheKeysForArtifacts,
  responseCacheTtlSeconds,
  runtimeIndexLatestCacheKey,
} from "./read-response-cache-keys.mjs";

const immutableCacheControl = `public, max-age=${immutableResponseCacheTtlSeconds}, immutable`;
const mutableCacheControl = "no-cache";

let redisCacheInstance;

function headerEntries(headers) {
  return Object.fromEntries(new Headers(headers).entries());
}

function quotedSha256(checksum) {
  return checksum ? `"sha256:${checksum}"` : null;
}

function matchesIfNoneMatch(request, etag) {
  const ifNoneMatch = request?.headers?.get?.("if-none-match");
  if (!ifNoneMatch || !etag) {
    return false;
  }
  return ifNoneMatch
    .split(",")
    .map((value) => value.trim())
    .includes(etag);
}

function responseWithCacheStatus(response, status) {
  const headers = new Headers(response.headers);
  headers.set("X-Knowledge-Source-Cache", status);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function notModifiedResponse(headers) {
  return new Response(null, {
    status: 304,
    headers,
  });
}

async function serializeResponse(response) {
  return {
    status: response.status,
    headers: headerEntries(response.headers),
    body: await response.text(),
  };
}

function responseFromCachedEntry(entry) {
  return new Response(entry.body, {
    status: entry.status,
    headers: entry.headers,
  });
}

async function safeCacheGet(cache, key) {
  try {
    return { entry: await cache.get(key), ok: true };
  } catch {
    return { entry: null, ok: false };
  }
}

async function safeCacheSet(cache, key, value, options) {
  try {
    await cache.set(key, value, options);
    return true;
  } catch {
    return false;
  }
}

async function safeCacheDelete(cache, keys) {
  try {
    await cache.delete(keys);
    return true;
  } catch {
    return false;
  }
}

async function createRedisClient(redisUrl, options) {
  const { createClient } = await import("redis");
  const client = createClient({ url: redisUrl, ...options });
  client.on("error", () => {});
  await client.connect();
  return client;
}

export function artifactResponseHeaders(artifact) {
  const etag = quotedSha256(artifact.checksum_sha256);
  const headers = {
    "Cache-Control": isImmutableArtifactId(artifact.artifact_id) ? immutableCacheControl : mutableCacheControl,
    "X-Artifact-ID": artifact.artifact_id,
    "X-Artifact-Publish-Status": artifact.publish_status,
  };
  if (etag) {
    headers.ETag = etag;
    headers["X-Artifact-Checksum-SHA256"] = artifact.checksum_sha256;
  }
  return headers;
}

export function latestRuntimeIndexResponseHeaders(runtimeIndex) {
  const resolvedArtifact = runtimeIndex.version ?? runtimeIndex.alias;
  const checksum = resolvedArtifact?.checksum_sha256 ?? null;
  const etag = quotedSha256(checksum);
  const headers = {
    "Cache-Control": mutableCacheControl,
    "X-Knowledge-Source-Trace-Mode": runtimeIndex.trace_mode,
    "X-Runtime-Index-Alias-ID": runtimeIndex.alias.artifact_id,
    "X-Artifact-ID": resolvedArtifact.artifact_id,
    "X-Artifact-Publish-Status": resolvedArtifact.publish_status,
  };
  if (runtimeIndex.version?.artifact_id) {
    headers["X-Runtime-Index-Version-ID"] = runtimeIndex.version.artifact_id;
  }
  if (etag) {
    headers.ETag = etag;
    headers["X-Artifact-Checksum-SHA256"] = checksum;
  }
  return headers;
}

export async function withCachedApiResponse({ cache, cacheKey, ttlSeconds, request = null, buildResponse }) {
  if (!cache) {
    const response = responseWithCacheStatus(await buildResponse(), "bypass");
    if (matchesIfNoneMatch(request, response.headers.get("etag"))) {
      return notModifiedResponse(response.headers);
    }
    return response;
  }

  const { entry: cached, ok: cacheAvailable } = await safeCacheGet(cache, cacheKey);
  if (cached) {
    const response = responseWithCacheStatus(responseFromCachedEntry(cached), "hit");
    if (matchesIfNoneMatch(request, response.headers.get("etag"))) {
      return notModifiedResponse(response.headers);
    }
    return response;
  }

  const response = responseWithCacheStatus(await buildResponse(), cacheAvailable ? "miss" : "bypass");
  const responseForCache = response.clone();
  await safeCacheSet(cache, cacheKey, await serializeResponse(responseForCache), { ttlSeconds });
  if (matchesIfNoneMatch(request, response.headers.get("etag"))) {
    return notModifiedResponse(response.headers);
  }
  return response;
}

export async function invalidateKnowledgeSourceReadCache({ cache = getRedisResponseCache(), artifacts = [] } = {}) {
  if (!cache) {
    return { status: "bypass", keys: [] };
  }
  const keys = mutableReadCacheKeysForArtifacts(artifacts);
  const deleted = keys.length ? await safeCacheDelete(cache, keys) : true;
  return {
    status: deleted ? "ok" : "bypass",
    keys,
  };
}

export function createRedisResponseCache({
  redisUrl = readEnv("REDIS_URL", ""),
  connectTimeoutMs = 500,
  redisClientFactory = createRedisClient,
} = {}) {
  if (!redisUrl) {
    return null;
  }

  let clientPromise;
  async function getClient() {
    clientPromise ??= redisClientFactory(redisUrl, { socket: { connectTimeout: connectTimeoutMs } }).catch((error) => {
      clientPromise = null;
      throw error;
    });
    return clientPromise;
  }

  return {
    async get(key) {
      const value = await (await getClient()).get(key);
      return value ? JSON.parse(value) : null;
    },
    async set(key, value, { ttlSeconds }) {
      await (await getClient()).set(key, JSON.stringify(value), { EX: ttlSeconds });
    },
    async delete(keys) {
      if (keys.length) {
        await (await getClient()).del(keys);
      }
    },
  };
}

export function getRedisResponseCache() {
  redisCacheInstance ??= createRedisResponseCache();
  return redisCacheInstance;
}

export {
  artifactDetailCacheKey,
  artifactRawCacheKey,
  mutableReadCacheKeysForArtifacts,
  responseCacheTtlSeconds,
  runtimeIndexLatestCacheKey,
};
