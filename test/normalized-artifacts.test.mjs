import assert from "node:assert/strict";
import fs from "fs/promises";
import os from "os";
import path from "path";
import test from "node:test";

import {
  buildNormalizedArtifact,
  createNormalizedArtifactBuilder,
} from "../src/lib/source-artifacts/normalized-artifacts.js";

async function createK12GraphFixture({ graph = null } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "k12-normalized-"));
  await fs.mkdir(path.join(root, "kg"), { recursive: true });
  await fs.writeFile(path.join(root, "manifest.json"), "{}\n", "utf8");
  await fs.writeFile(path.join(root, "snapshot.json"), "{}\n", "utf8");
  await fs.writeFile(
    path.join(root, "kg", "math_7a_rjb.json"),
    `${JSON.stringify(
      graph ?? {
        nodes: [
          {
            id: "math_7a_rjb_cpt41",
            label: "Concept",
            name: "linear equation in one unknown",
            properties: { definition: "An equation with one unknown variable." },
          },
        ],
        edges: [],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return root;
}

const k12Collection = {
  collection_id: "k12_kgraph_full",
  source_ids: ["k12_dataset"],
  license_scope: "non_commercial_demo_only",
  attribution: "K12 attribution",
  publish_profiles: ["demo"],
};

const k12Snapshot = {
  snapshot_id: "source-snapshot:k12_kgraph_full:sha256:snapshot-test",
  checksum_sha256: "snapshot-test",
  raw_manifest: {
    detected_files: [{ path: "kg/math_7a_rjb.json" }],
  },
};

test("K12 adapter converts fixture graph into normalized graph artifact", async () => {
  const sourceRoot = await createK12GraphFixture();

  const artifact = await buildNormalizedArtifact({
    collection: k12Collection,
    snapshot: k12Snapshot,
    sourceRoot,
    artifactType: "normalized_knowledge_graph",
  });

  assert.equal(artifact.collection_id, "k12_kgraph_full");
  assert.equal(artifact.artifact_type, "normalized_knowledge_graph");
  assert.equal(artifact.schema_version, "source_graph.v1");
  assert.equal(artifact.source_snapshot_id, k12Snapshot.snapshot_id);
  assert.equal(artifact.license_scope, "non_commercial_demo_only");
  assert.equal(artifact.nodes.length, 1);
  assert.deepEqual(artifact.summary, {
    node_count: 1,
    edge_count: 0,
    subjects: ["mathematics"],
  });
});

test("normalized graph artifact id is deterministic", async () => {
  const sourceRoot = await createK12GraphFixture();

  const first = await buildNormalizedArtifact({
    collection: k12Collection,
    snapshot: k12Snapshot,
    sourceRoot,
    artifactType: "normalized_knowledge_graph",
  });
  const second = await buildNormalizedArtifact({
    collection: k12Collection,
    snapshot: k12Snapshot,
    sourceRoot,
    artifactType: "normalized_knowledge_graph",
  });

  assert.equal(first.artifact_id, second.artifact_id);
  assert.equal(first.checksum_sha256, second.checksum_sha256);
  assert.match(first.artifact_id, /^source-artifact:k12_kgraph_full:normalized_knowledge_graph:sha256:[a-f0-9]{64}$/);
});

test("each K12 node includes source_ref and license_scope", async () => {
  const sourceRoot = await createK12GraphFixture();

  const artifact = await buildNormalizedArtifact({
    collection: k12Collection,
    snapshot: k12Snapshot,
    sourceRoot,
    artifactType: "normalized_knowledge_graph",
  });

  assert.deepEqual(artifact.nodes[0].source_ref, {
    collection_id: "k12_kgraph_full",
    source: "k12_dataset",
    source_topic_id: "math_7a_rjb_cpt41",
  });
  assert.equal(artifact.nodes[0].license_scope, "non_commercial_demo_only");
});

test("demo-critical K12 topic appears in normalized graph", async () => {
  const sourceRoot = await createK12GraphFixture();

  const artifact = await buildNormalizedArtifact({
    collection: k12Collection,
    snapshot: k12Snapshot,
    sourceRoot,
    artifactType: "normalized_knowledge_graph",
  });

  assert.ok(artifact.nodes.some((node) => node.id === "math_7a_rjb_cpt41"));
});

test("invalid K12 source shape returns validation error", async () => {
  const sourceRoot = await createK12GraphFixture({ graph: { nodes: "not-an-array", edges: [] } });

  await assert.rejects(
    () =>
      buildNormalizedArtifact({
        collection: k12Collection,
        snapshot: k12Snapshot,
        sourceRoot,
        artifactType: "normalized_knowledge_graph",
      }),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.code, "normalized_artifact_invalid_source_shape");
      return true;
    },
  );
});

test("builder publishes normalized artifact metadata through artifact store", async () => {
  const sourceRoot = await createK12GraphFixture();
  const queries = [];
  const builder = createNormalizedArtifactBuilder({
    getCollection: async () => ({ ...k12Collection, snapshot: k12Snapshot }),
    resolveSourceRoot: async () => sourceRoot,
    writeArtifact: async (artifact) => ({
      storage_path: `source-artifacts/${artifact.collection_id}/${artifact.artifact_type}/sha256/${artifact.checksum_sha256}.json`,
      checksum_sha256: artifact.checksum_sha256,
    }),
    withClient: async (callback) =>
      callback({
        query: async (sql, params = []) => {
          queries.push({ sql, params });
          return { rows: [] };
        },
      }),
  });

  const result = await builder.buildSourceArtifact({
    collectionId: "k12_kgraph_full",
    artifactType: "normalized_knowledge_graph",
    actor: "test",
  });

  assert.equal(result.object, "source_artifact_build_result");
  assert.equal(result.artifact.artifact_type, "normalized_knowledge_graph");
  assert.equal(
    queries.some((query) => query.sql.includes("knowledge_source_artifacts") && query.params[1] === "normalized_knowledge_graph"),
    true,
  );
  assert.equal(
    queries.some((query) => query.sql.includes("knowledge_source_audit_events") && query.params[0] === "source_artifact.built"),
    true,
  );
});
