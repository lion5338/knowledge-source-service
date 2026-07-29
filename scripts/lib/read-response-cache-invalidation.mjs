import { createClient } from "redis";
import { mutableReadCacheKeysForArtifacts } from "../../src/lib/http/read-response-cache-keys.mjs";

async function createRedisClient(redisUrl, options) {
  const client = createClient({ url: redisUrl, ...options });
  client.on("error", () => {});
  await client.connect();
  return client;
}

export { mutableReadCacheKeysForArtifacts };

export async function invalidateKnowledgeSourceReadCacheAfterImport({
  redisUrl = process.env.REDIS_URL ?? process.env.redis_url ?? "",
  connectTimeoutMs = 500,
  redisClientFactory = createRedisClient,
  artifacts = [],
} = {}) {
  if (!redisUrl) {
    return { status: "bypass", keys: [] };
  }

  const keys = mutableReadCacheKeysForArtifacts(artifacts);
  if (!keys.length) {
    return { status: "ok", keys };
  }

  let client;
  try {
    client = await redisClientFactory(redisUrl, { socket: { connectTimeout: connectTimeoutMs } });
    await client.del(keys);
    return { status: "ok", keys };
  } catch {
    return { status: "bypass", keys };
  } finally {
    await client?.quit?.().catch?.(() => {});
  }
}
