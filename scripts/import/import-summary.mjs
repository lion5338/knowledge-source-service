export const latestImportSummaryArtifactId = "import-summary:latest";
export const latestImportSummaryStoragePath = "reports/latest-import-summary.json";

function changeStatusFor(artifact) {
  if (!artifact.previous_checksum_sha256) {
    return "created";
  }
  if (artifact.previous_checksum_sha256 === artifact.checksum_sha256) {
    return "unchanged";
  }
  return "changed";
}

export function buildImportSummary({ sourceRoot, storageRoot, sourceCount, artifacts }) {
  const summarizedArtifacts = artifacts.map((artifact) => ({
    artifact_id: artifact.artifact_id,
    artifact_type: artifact.artifact_type,
    storage_path: artifact.storage_path,
    checksum_sha256: artifact.checksum_sha256,
    publish_status: artifact.publish_status,
    change_status: changeStatusFor(artifact),
  }));
  const runtimeIndex = summarizedArtifacts.find((artifact) => artifact.artifact_id === "runtime-index:latest") ?? null;

  return {
    source_root: sourceRoot,
    storage_root: storageRoot,
    source_count: sourceCount,
    artifact_count: summarizedArtifacts.length,
    created_count: summarizedArtifacts.filter((artifact) => artifact.change_status === "created").length,
    changed_count: summarizedArtifacts.filter((artifact) => artifact.change_status === "changed").length,
    unchanged_count: summarizedArtifacts.filter((artifact) => artifact.change_status === "unchanged").length,
    runtime_index: runtimeIndex
      ? {
          artifact_id: runtimeIndex.artifact_id,
          checksum_sha256: runtimeIndex.checksum_sha256,
          publish_status: runtimeIndex.publish_status,
        }
      : null,
    artifacts: summarizedArtifacts,
  };
}
