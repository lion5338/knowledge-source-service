export const latestRuntimeIndexArtifactId = "runtime-index:latest";
export const latestRuntimeIndexStoragePath = "index/knowledge-index.json";

export function pinnedRuntimeIndexArtifactId(checksumSha256) {
  return `runtime-index:sha256:${checksumSha256}`;
}

export function pinnedRuntimeIndexStoragePath(checksumSha256) {
  return `index/versions/sha256/${checksumSha256}.json`;
}

export function buildRuntimeIndexPins({
  latestArtifactId = latestRuntimeIndexArtifactId,
  latestStoragePath = latestRuntimeIndexStoragePath,
  checksumSha256,
  index,
}) {
  const pinnedArtifactId = pinnedRuntimeIndexArtifactId(checksumSha256);
  const indexVersion = index?.index_version ?? null;
  return {
    pinned_artifact_id: pinnedArtifactId,
    pinned_storage_path: pinnedRuntimeIndexStoragePath(checksumSha256),
    latest_metadata: {
      points_to_artifact_id: pinnedArtifactId,
      index_version: indexVersion,
      source_artifact_path: latestStoragePath,
    },
    pinned_metadata: {
      alias_artifact_id: latestArtifactId,
      index_version: indexVersion,
      source_artifact_path: latestStoragePath,
    },
  };
}
