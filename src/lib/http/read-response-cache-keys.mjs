export const mutableResponseCacheTtlSeconds = 30;
export const immutableResponseCacheTtlSeconds = 31536000;

const cacheKeyPrefix = "knowledge-source:v1";

export function isImmutableArtifactId(artifactId) {
  return artifactId?.startsWith("runtime-index:sha256:") ?? false;
}

export function responseCacheTtlSeconds({ artifactId } = {}) {
  return isImmutableArtifactId(artifactId) ? immutableResponseCacheTtlSeconds : mutableResponseCacheTtlSeconds;
}

export function runtimeIndexLatestCacheKey() {
  return `${cacheKeyPrefix}:runtime-index:latest`;
}

export function artifactDetailCacheKey(artifactId) {
  return `${cacheKeyPrefix}:artifacts:${encodeURIComponent(artifactId)}:detail`;
}

export function artifactRawCacheKey(artifactId) {
  return `${cacheKeyPrefix}:artifacts:${encodeURIComponent(artifactId)}:raw`;
}

export function mutableReadCacheKeysForArtifacts(artifacts = []) {
  const keys = new Set([runtimeIndexLatestCacheKey()]);
  for (const artifact of artifacts) {
    if (!artifact?.artifact_id || isImmutableArtifactId(artifact.artifact_id)) {
      continue;
    }
    keys.add(artifactDetailCacheKey(artifact.artifact_id));
    keys.add(artifactRawCacheKey(artifact.artifact_id));
  }
  return [...keys];
}
