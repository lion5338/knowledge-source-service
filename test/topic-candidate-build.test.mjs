import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTopicCandidateArtifact,
  createTopicCandidateBuilder,
} from "../src/lib/topic-candidates/topic-candidate-build.js";

function normalizedGraph() {
  return {
    artifact_id: "source-artifact:k12_kgraph_full:normalized_knowledge_graph:sha256:source-test",
    checksum_sha256: "source-test",
    collection_id: "k12_kgraph_full",
    artifact_type: "normalized_knowledge_graph",
    schema_version: "source_graph.v1",
    source_snapshot_id: "source-snapshot:k12_kgraph_full:sha256:snapshot-test",
    license_scope: "non_commercial_demo_only",
    attribution: "K12 attribution",
    nodes: [
      {
        id: "math_7a_rjb_ch3_s1",
        label: "Chapter 3 Section 1",
        aliases: ["Chapter 3 Section 1"],
        subject: "mathematics",
        learning_stage: "junior_high",
        node_type: "Section",
        source_ref: {
          collection_id: "k12_kgraph_full",
          source: "k12_dataset",
          source_topic_id: "math_7a_rjb_ch3_s1",
        },
        license_scope: "non_commercial_demo_only",
      },
      {
        id: "math_7a_rjb_cpt41",
        label: "linear equation in one unknown",
        aliases: ["one-variable linear equation"],
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
    edges: [
      {
        source_node_id: "math_7a_rjb_ch3_s1",
        target_node_id: "math_7a_rjb_cpt41",
        edge_type: "contains",
        source_ref: {
          collection_id: "k12_kgraph_full",
          source: "k12_dataset",
          source_edge_id: "edge-1",
        },
        license_scope: "non_commercial_demo_only",
      },
    ],
    summary: { node_count: 2, edge_count: 1, subjects: ["mathematics"] },
  };
}

const k12Collection = {
  collection_id: "k12_kgraph_full",
  license_scope: "non_commercial_demo_only",
  publish_profiles: ["demo"],
  official_curriculum_verified: false,
};

test("K12 normalized graph builds topic candidate artifact", () => {
  const artifact = buildTopicCandidateArtifact({
    collection: k12Collection,
    profile: "demo",
    sourceArtifact: normalizedGraph(),
  });

  assert.equal(artifact.object, "topic_candidate_artifact");
  assert.equal(artifact.collection_id, "k12_kgraph_full");
  assert.equal(artifact.profile, "demo");
  assert.equal(artifact.artifact_type, "topic_candidates");
  assert.equal(artifact.schema_version, "topic_candidates.v1");
  assert.equal(artifact.data.length, 2);
});

test("candidate topic_key is deterministic", () => {
  const first = buildTopicCandidateArtifact({
    collection: k12Collection,
    profile: "demo",
    sourceArtifact: normalizedGraph(),
  });
  const second = buildTopicCandidateArtifact({
    collection: k12Collection,
    profile: "demo",
    sourceArtifact: normalizedGraph(),
  });

  assert.equal(first.artifact_id, second.artifact_id);
  assert.equal(first.data[1].topic_key, "k12_mathematics_junior_high_math_7a_rjb_cpt41");
});

test("candidate includes source_artifact_id and license_scope", () => {
  const artifact = buildTopicCandidateArtifact({
    collection: k12Collection,
    profile: "demo",
    sourceArtifact: normalizedGraph(),
  });
  const candidate = artifact.data.find((item) => item.source_topic_id === "math_7a_rjb_cpt41");

  assert.equal(candidate.metadata.source_artifact_id, normalizedGraph().artifact_id);
  assert.equal(candidate.metadata.license_scope, "non_commercial_demo_only");
  assert.deepEqual(candidate.source_refs, [
    {
      collection_id: "k12_kgraph_full",
      source: "k12_dataset",
      topic_id: "math_7a_rjb_cpt41",
    },
  ]);
});

test("candidate includes parent topic when graph has parent relation", () => {
  const artifact = buildTopicCandidateArtifact({
    collection: k12Collection,
    profile: "demo",
    sourceArtifact: normalizedGraph(),
  });
  const candidate = artifact.data.find((item) => item.source_topic_id === "math_7a_rjb_cpt41");

  assert.equal(candidate.parent_topic_key, "k12_mathematics_junior_high_math_7a_rjb_ch3_s1");
});

test("candidate artifact rejects prod profile for K12 full", () => {
  assert.throws(
    () =>
      buildTopicCandidateArtifact({
        collection: k12Collection,
        profile: "prod",
        sourceArtifact: normalizedGraph(),
      }),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.code, "demo_only_source_blocked");
      return true;
    },
  );
});

test("builder publishes topic candidate artifact through artifact store", async () => {
  const queries = [];
  const builder = createTopicCandidateBuilder({
    getCollection: async () => k12Collection,
    findSourceArtifact: async () => ({
      artifact_id: normalizedGraph().artifact_id,
      storage_path: "source-artifacts/k12/graph.json",
      checksum_sha256: "source-test",
      publish_status: "validated",
    }),
    readArtifactJson: async () => normalizedGraph(),
    writeArtifact: async (artifact) => ({
      storage_path: `topic-candidates/${artifact.collection_id}/${artifact.profile}/sha256/${artifact.checksum_sha256}.json`,
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

  const result = await builder.buildTopicCandidates({ collectionId: "k12_kgraph_full", profile: "demo", actor: "test" });

  assert.equal(result.object, "topic_candidate_build_result");
  assert.equal(result.artifact.artifact_type, "topic_candidates");
  assert.equal(
    queries.some((query) => query.sql.includes("knowledge_source_artifacts") && query.params[1] === "topic_candidates"),
    true,
  );
  assert.equal(
    queries.some((query) => query.sql.includes("knowledge_source_audit_events") && query.params[0] === "topic_candidates.built"),
    true,
  );
});
