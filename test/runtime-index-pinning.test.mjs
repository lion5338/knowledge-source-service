import assert from "node:assert/strict";
import test from "node:test";

import { buildRuntimeIndexPins } from "../scripts/import/runtime-index-pinning.mjs";

test("buildRuntimeIndexPins creates content-addressed pinned artifact records", () => {
  const pins = buildRuntimeIndexPins({
    latestArtifactId: "runtime-index:latest",
    latestStoragePath: "index/knowledge-index.json",
    checksumSha256: "c9fc09b0201305301de107dae51ef2b41b5af70423400b42515b8b0ca8f6ac0c",
    index: {
      index_version: "knowledge-index.2026-07-28T10-05-52-492Z",
    },
  });

  assert.deepEqual(pins, {
    pinned_artifact_id:
      "runtime-index:sha256:c9fc09b0201305301de107dae51ef2b41b5af70423400b42515b8b0ca8f6ac0c",
    pinned_storage_path:
      "index/versions/sha256/c9fc09b0201305301de107dae51ef2b41b5af70423400b42515b8b0ca8f6ac0c.json",
    latest_metadata: {
      points_to_artifact_id:
        "runtime-index:sha256:c9fc09b0201305301de107dae51ef2b41b5af70423400b42515b8b0ca8f6ac0c",
      index_version: "knowledge-index.2026-07-28T10-05-52-492Z",
      source_artifact_path: "index/knowledge-index.json",
    },
    pinned_metadata: {
      alias_artifact_id: "runtime-index:latest",
      index_version: "knowledge-index.2026-07-28T10-05-52-492Z",
      source_artifact_path: "index/knowledge-index.json",
    },
  });
});
