import assert from "node:assert/strict";
import fs from "fs/promises";
import os from "os";
import path from "path";
import test from "node:test";

import {
  getNormalizedArtifactAdapter,
  listNormalizedArtifactAdapters,
} from "../src/lib/source-artifacts/adapters/registry.js";

async function createK12GraphFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "k12-registry-adapter-"));
  await fs.mkdir(path.join(root, "kg"), { recursive: true });
  await fs.writeFile(path.join(root, "manifest.json"), "{}\n", "utf8");
  await fs.writeFile(path.join(root, "snapshot.json"), "{}\n", "utf8");
  await fs.writeFile(
    path.join(root, "kg", "math_7a_rjb.json"),
    `${JSON.stringify({ nodes: [{ id: "math_7a_rjb_cpt41", name: "linear equation" }], edges: [] }, null, 2)}\n`,
    "utf8",
  );
  return root;
}

test("adapter registry resolves marble normalized_documents adapter", () => {
  const adapter = getNormalizedArtifactAdapter({
    collectionId: "marble",
    artifactType: "normalized_documents",
  });

  assert.equal(adapter.collection_id, "marble");
  assert.equal(adapter.artifact_type, "normalized_documents");
  assert.equal(typeof adapter.buildArtifact, "function");
  assert.equal(typeof adapter.inspectRawManifest, "function");
});

test("adapter registry resolves learning_commons normalized_documents adapter", () => {
  const adapter = getNormalizedArtifactAdapter({
    collectionId: "learning_commons",
    artifactType: "normalized_documents",
  });

  assert.equal(adapter.collection_id, "learning_commons");
  assert.equal(adapter.artifact_type, "normalized_documents");
  assert.equal(typeof adapter.buildArtifact, "function");
  assert.equal(typeof adapter.inspectRawManifest, "function");
});

test("adapter registry preserves k12 normalized_knowledge_graph behavior", () => {
  const adapter = getNormalizedArtifactAdapter({
    collectionId: "k12_kgraph_full",
    artifactType: "normalized_knowledge_graph",
  });

  assert.equal(adapter.collection_id, "k12_kgraph_full");
  assert.equal(adapter.artifact_type, "normalized_knowledge_graph");
  assert.equal(typeof adapter.buildArtifact, "function");
  assert.equal(typeof adapter.inspectRawManifest, "function");
});

test("all supported normalized artifact adapters are registered", () => {
  assert.deepEqual(listNormalizedArtifactAdapters(), [
    {
      collection_id: "k12_kgraph_full",
      artifact_type: "normalized_knowledge_graph",
    },
    {
      collection_id: "marble",
      artifact_type: "normalized_documents",
    },
    {
      collection_id: "learning_commons",
      artifact_type: "normalized_documents",
    },
  ]);
});

test("k12 registry adapter builds normalized graph artifact", async () => {
  const sourceRoot = await createK12GraphFixture();
  const adapter = getNormalizedArtifactAdapter({
    collectionId: "k12_kgraph_full",
    artifactType: "normalized_knowledge_graph",
  });
  const artifact = await adapter.buildArtifact({
    collection: {
      collection_id: "k12_kgraph_full",
      source_ids: ["k12_dataset"],
      license_scope: "non_commercial_demo_only",
      attribution: "K12 attribution",
    },
    snapshot: {
      snapshot_id: "source-snapshot:k12_kgraph_full:sha256:test",
      raw_manifest: {
        detected_files: [{ path: "kg/math_7a_rjb.json" }],
      },
    },
    sourceRoot,
  });

  assert.equal(artifact.collection_id, "k12_kgraph_full");
  assert.equal(artifact.artifact_type, "normalized_knowledge_graph");
  assert.equal(artifact.nodes[0].source_ref.collection_id, "k12_kgraph_full");
});

test("unsupported collection and artifact type returns stable source_collection_not_supported error", () => {
  assert.throws(
    () =>
      getNormalizedArtifactAdapter({
        collectionId: "marble",
        artifactType: "normalized_knowledge_graph",
      }),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.code, "source_collection_not_supported");
      assert.equal(error.details.collection_id, "marble");
      assert.equal(error.details.artifact_type, "normalized_knowledge_graph");
      return true;
    },
  );
});
