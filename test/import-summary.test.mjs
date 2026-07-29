import assert from "node:assert/strict";
import test from "node:test";

import { buildImportSummary } from "../scripts/import/import-summary.mjs";

test("buildImportSummary classifies artifacts by previous checksum and includes runtime index trace", () => {
  const summary = buildImportSummary({
    sourceRoot: "C:/Question_Generation/core/ai-workflow-service/knowledge",
    storageRoot: "C:/Question_Generation/core/knowledge-source-service/storage/knowledge",
    sourceCount: 3,
    artifacts: [
      {
        artifact_id: "runtime-index:latest",
        artifact_type: "runtime_index",
        storage_path: "index/knowledge-index.json",
        checksum_sha256: "runtime-new",
        publish_status: "published",
        previous_checksum_sha256: "runtime-old",
      },
      {
        artifact_id: "normalized:marble-topics",
        artifact_type: "normalized_artifact",
        storage_path: "normalized/marble-topics.json",
        checksum_sha256: "same-checksum",
        publish_status: "imported",
        previous_checksum_sha256: "same-checksum",
      },
      {
        artifact_id: "raw:marble:v1:topics",
        artifact_type: "raw_snapshot_file",
        storage_path: "raw/marble/v1/topics.json",
        checksum_sha256: "created-checksum",
        publish_status: "imported",
        previous_checksum_sha256: null,
      },
    ],
  });

  assert.equal(summary.source_count, 3);
  assert.equal(summary.artifact_count, 3);
  assert.equal(summary.created_count, 1);
  assert.equal(summary.changed_count, 1);
  assert.equal(summary.unchanged_count, 1);
  assert.deepEqual(summary.runtime_index, {
    artifact_id: "runtime-index:latest",
    checksum_sha256: "runtime-new",
    publish_status: "published",
  });
  assert.deepEqual(
    summary.artifacts.map((artifact) => ({
      artifact_id: artifact.artifact_id,
      change_status: artifact.change_status,
    })),
    [
      { artifact_id: "runtime-index:latest", change_status: "changed" },
      { artifact_id: "normalized:marble-topics", change_status: "unchanged" },
      { artifact_id: "raw:marble:v1:topics", change_status: "created" },
    ],
  );
});
