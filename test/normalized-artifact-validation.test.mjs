import assert from "node:assert/strict";
import test from "node:test";

import { validateNormalizedArtifact } from "../src/lib/source-artifacts/normalized-artifact-validation.js";
import { createNormalizedArtifactBuilder } from "../src/lib/source-artifacts/normalized-artifacts.js";

function validGraph() {
  return {
    artifact_id: "source-artifact:k12_kgraph_full:normalized_knowledge_graph:sha256:test",
    collection_id: "k12_kgraph_full",
    artifact_type: "normalized_knowledge_graph",
    schema_version: "source_graph.v1",
    source_snapshot_id: "source-snapshot:k12_kgraph_full:sha256:test",
    license_scope: "non_commercial_demo_only",
    attribution: "K12 attribution",
    nodes: [
      {
        id: "math_7a_rjb_cpt41",
        label: "linear equation",
        subject: "mathematics",
        learning_stage: "junior_high",
        node_type: "Concept",
        source_ref: {
          collection_id: "k12_kgraph_full",
          source: "k12_dataset",
          source_topic_id: "math_7a_rjb_cpt41",
        },
        license_scope: "non_commercial_demo_only",
      },
    ],
    edges: [],
    summary: { node_count: 1, edge_count: 0, subjects: ["mathematics"] },
  };
}

function validDocuments() {
  return {
    artifact_id: "source-artifact:marble:normalized_documents:sha256:test",
    collection_id: "marble",
    artifact_type: "normalized_documents",
    schema_version: "source_documents.v1",
    source_snapshot_id: "source-snapshot:marble:sha256:test",
    license_scope: "open_educational_source",
    attribution: "Marble attribution",
    records: [
      {
        id: "fraction_equivalence",
        title: "Fraction equivalence",
        subject: "mathematics",
        learning_stage: "elementary",
        text: "Equivalent fractions",
        source_ref: {
          collection_id: "marble",
          source: "marble",
          topic_id: "fraction_equivalence",
        },
        license_scope: "open_educational_source",
      },
    ],
    summary: { record_count: 1, subjects: ["mathematics"] },
  };
}

test("valid K12 normalized graph passes", () => {
  assert.deepEqual(validateNormalizedArtifact(validGraph()), {
    ok: true,
    error_count: 0,
    errors: [],
    summary: {
      artifact_type: "normalized_knowledge_graph",
      record_count: 1,
    },
  });
});

test("valid normalized documents pass", () => {
  assert.deepEqual(validateNormalizedArtifact(validDocuments()).ok, true);
});

test("missing source_ref fails", () => {
  const graph = validGraph();
  delete graph.nodes[0].source_ref;

  const result = validateNormalizedArtifact(graph);

  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, "normalized_artifact_missing_source_ref");
});

test("missing license_scope fails", () => {
  const graph = validGraph();
  delete graph.nodes[0].license_scope;

  const result = validateNormalizedArtifact(graph);

  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, "normalized_artifact_missing_license_scope");
});

test("record with absolute raw path fails", () => {
  const graph = validGraph();
  graph.nodes[0].metadata = { raw_path: "C:\\private\\raw\\k12" };

  const result = validateNormalizedArtifact(graph);

  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, "normalized_artifact_raw_path_leak");
});

test("record with UNC raw path fails", () => {
  const graph = validGraph();
  graph.nodes[0].metadata = { raw_path: "\\\\nas\\raw\\k12" };

  const result = validateNormalizedArtifact(graph);

  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, "normalized_artifact_raw_path_leak");
});

test("record with LaTeX title does not count as raw path leak", () => {
  const documents = validDocuments();
  documents.records[0].title = "Using $\\frac{3}{4}$ and $\\pi$";
  documents.records[0].text = "Using $\\frac{3}{4}$ and $\\pi$";

  const result = validateNormalizedArtifact(documents);

  assert.equal(result.ok, true);
});

test("build script does not publish invalid artifact", async () => {
  const builder = createNormalizedArtifactBuilder({
    getCollection: async () => ({
      collection_id: "k12_kgraph_full",
      source_ids: ["k12_dataset"],
      license_scope: "non_commercial_demo_only",
      publish_profiles: ["demo"],
      snapshot: {
        snapshot_id: "source-snapshot:k12_kgraph_full:sha256:test",
        raw_manifest: { detected_files: [{ path: "kg/invalid.json" }] },
      },
    }),
    resolveSourceRoot: async () => "unused",
    buildArtifact: async () => {
      const graph = validGraph();
      delete graph.nodes[0].source_ref;
      return graph;
    },
    writeArtifact: async () => {
      throw new Error("invalid artifact must not be written");
    },
    withClient: async () => {
      throw new Error("invalid artifact must not be published");
    },
  });

  await assert.rejects(
    () => builder.buildSourceArtifact({ collectionId: "k12_kgraph_full", artifactType: "normalized_knowledge_graph" }),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.code, "normalized_artifact_invalid");
      return true;
    },
  );
});
