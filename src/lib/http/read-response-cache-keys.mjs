import crypto from "crypto";

export const mutableResponseCacheTtlSeconds = 30;
export const immutableResponseCacheTtlSeconds = 31536000;

const cacheKeyPrefix = "knowledge-source:v1";

export function isImmutableArtifactId(artifactId) {
  return artifactId?.startsWith("runtime-index:sha256:") || /^runtime-index:(demo|mvp|prod):sha256:/.test(artifactId ?? "");
}

export function responseCacheTtlSeconds({ artifactId } = {}) {
  return isImmutableArtifactId(artifactId) ? immutableResponseCacheTtlSeconds : mutableResponseCacheTtlSeconds;
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function knowledgeAccessCacheScope({ access = null } = {}) {
  if (!access) {
    return null;
  }
  const scope = {
    access_mode: access.access_mode ?? "default_only",
    tenant_id: access.tenant_id ?? null,
    user_id: access.user_id ?? null,
    effective_collection_ids: [...(access.effective_collection_ids ?? [])].sort(),
  };
  return crypto.createHash("sha256").update(stableStringify(scope)).digest("hex").slice(0, 16);
}

export function runtimeIndexLatestCacheKey(profile = null, accessScope = null) {
  const base = profile ? `${cacheKeyPrefix}:runtime-index:latest:${profile}` : `${cacheKeyPrefix}:runtime-index:latest`;
  return accessScope ? `${base}:access:${accessScope}` : base;
}

export function artifactDetailCacheKey(artifactId, accessScope = null) {
  const base = `${cacheKeyPrefix}:artifacts:${encodeURIComponent(artifactId)}:detail`;
  return accessScope ? `${base}:access:${accessScope}` : base;
}

export function artifactRawCacheKey(artifactId, accessScope = null) {
  const base = `${cacheKeyPrefix}:artifacts:${encodeURIComponent(artifactId)}:raw`;
  return accessScope ? `${base}:access:${accessScope}` : base;
}

export function mutableReadCacheKeysForArtifacts(artifacts = []) {
  const keys = new Set([runtimeIndexLatestCacheKey(), runtimeIndexLatestCacheKey("demo"), runtimeIndexLatestCacheKey("mvp"), runtimeIndexLatestCacheKey("prod")]);
  for (const artifact of artifacts) {
    if (!artifact?.artifact_id || isImmutableArtifactId(artifact.artifact_id)) {
      continue;
    }
    keys.add(artifactDetailCacheKey(artifact.artifact_id));
    keys.add(artifactRawCacheKey(artifact.artifact_id));
  }
  return [...keys];
}
