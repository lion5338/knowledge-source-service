import assert from "node:assert/strict";
import test from "node:test";

import {
  createTopicCandidateExporter,
  encodeTopicCandidateCursor,
} from "../src/lib/topic-candidates/topic-candidate-export.js";

const k12Collection = {
  collection_id: "k12_kgraph_full",
  license_scope: "non_commercial_demo_only",
  publish_profiles: ["demo"],
};

const artifactRow = {
  artifact_id: "topic-candidates:k12_kgraph_full:demo:sha256:candidate-test",
  storage_path: "topic-candidates/k12/demo.json",
  checksum_sha256: "candidate-test",
  publish_status: "validated",
  metadata: {
    collection_id: "k12_kgraph_full",
    profile: "demo",
    source_artifact_id: "source-artifact:k12_kgraph_full:normalized_knowledge_graph:sha256:source-test",
    license_scope: "non_commercial_demo_only",
  },
};

const candidateArtifact = {
  artifact_id: artifactRow.artifact_id,
  checksum_sha256: artifactRow.checksum_sha256,
  collection_id: "k12_kgraph_full",
  profile: "demo",
  source_artifact_id: artifactRow.metadata.source_artifact_id,
  license_scope: "non_commercial_demo_only",
  data: [
    {
      topic_key: "k12_mathematics_junior_high_math_7a_rjb_cpt41",
      label: "linear equation",
      subject: "mathematics",
      learning_stage: "junior_high",
      source_node_type: "Concept",
      metadata: { license_scope: "non_commercial_demo_only" },
    },
    {
      topic_key: "k12_mathematics_primary_math_primary_cpt1",
      label: "addition",
      subject: "mathematics",
      learning_stage: "primary",
      source_node_type: "Skill",
      metadata: { license_scope: "non_commercial_demo_only" },
    },
  ],
};

function exporter(overrides = {}) {
  return createTopicCandidateExporter({
    getCollection: async () => k12Collection,
    findCandidateArtifact: async () => artifactRow,
    readArtifactJson: async () => candidateArtifact,
    ...overrides,
  });
}

test("exportTopicCandidates returns candidates from artifact", async () => {
  const result = await exporter().exportTopicCandidates({ profile: "demo", collectionId: "k12_kgraph_full" });

  assert.equal(result.object, "topic_candidate_export");
  assert.equal(result.artifact_id, artifactRow.artifact_id);
  assert.equal(result.checksum_sha256, "candidate-test");
  assert.equal(result.source_artifact_id, artifactRow.metadata.source_artifact_id);
  assert.equal(result.license_scope, "non_commercial_demo_only");
  assert.equal(result.data.length, 2);
  assert.equal(result.trace.raw_path_exposed, false);
});

test("exportTopicCandidates derives compatible profile when profile is omitted", async () => {
  const calls = [];
  const result = await exporter({
    findCandidateArtifact: async ({ profile }) => {
      calls.push(profile);
      return artifactRow;
    },
  }).exportTopicCandidates({
    collectionId: "k12_kgraph_full",
    access: {
      effective_collection_ids: ["k12_kgraph_full"],
    },
  });

  assert.equal(result.profile, "demo");
  assert.equal(result.trace.profile_source, "access_resolver_default");
  assert.equal(result.trace.profile_deprecated, true);
  assert.deepEqual(calls, ["demo"]);
});

test("export filters by subject", async () => {
  const result = await exporter().exportTopicCandidates({
    profile: "demo",
    collectionId: "k12_kgraph_full",
    subject: "mathematics",
  });

  assert.equal(result.data.length, 2);
  assert.equal(result.trace.filters.subject, "mathematics");
});

test("export filters by learning_stage", async () => {
  const result = await exporter().exportTopicCandidates({
    profile: "demo",
    collectionId: "k12_kgraph_full",
    learningStage: "junior_high",
  });

  assert.deepEqual(
    result.data.map((candidate) => candidate.topic_key),
    ["k12_mathematics_junior_high_math_7a_rjb_cpt41"],
  );
});

test("export filters by node_type", async () => {
  const result = await exporter().exportTopicCandidates({
    profile: "demo",
    collectionId: "k12_kgraph_full",
    nodeType: "Skill",
  });

  assert.deepEqual(
    result.data.map((candidate) => candidate.topic_key),
    ["k12_mathematics_primary_math_primary_cpt1"],
  );
});

test("export rejects invalid profile", async () => {
  await assert.rejects(
    () => exporter().exportTopicCandidates({ profile: "invalid", collectionId: "k12_kgraph_full" }),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.code, "invalid_runtime_profile");
      return true;
    },
  );
});

test("export rejects K12 full with mvp/prod profile", async () => {
  await assert.rejects(
    () => exporter().exportTopicCandidates({ profile: "prod", collectionId: "k12_kgraph_full" }),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.code, "demo_only_source_blocked");
      return true;
    },
  );
});

test("pagination returns stable first page", async () => {
  const result = await exporter().exportTopicCandidates({ profile: "demo", collectionId: "k12_kgraph_full", limit: 1 });

  assert.equal(result.data.length, 1);
  assert.equal(result.pagination.limit, 1);
  assert.equal(result.pagination.has_more, true);
  assert.ok(result.pagination.next_cursor);
});

test("cursor returns next page without duplicates", async () => {
  const first = await exporter().exportTopicCandidates({ profile: "demo", collectionId: "k12_kgraph_full", limit: 1 });
  const second = await exporter().exportTopicCandidates({
    profile: "demo",
    collectionId: "k12_kgraph_full",
    limit: 1,
    cursor: first.pagination.next_cursor,
  });

  assert.notEqual(first.data[0].topic_key, second.data[0].topic_key);
  assert.equal(second.pagination.has_more, false);
});

test("limit is clamped to safe maximum", async () => {
  const result = await exporter().exportTopicCandidates({ profile: "demo", collectionId: "k12_kgraph_full", limit: 9999 });

  assert.equal(result.pagination.limit, 500);
});

test("download mode returns artifact reference", async () => {
  const result = await exporter().exportTopicCandidates({
    profile: "demo",
    collectionId: "k12_kgraph_full",
    download: true,
  });

  assert.deepEqual(result.data, []);
  assert.deepEqual(result.artifact, {
    artifact_id: artifactRow.artifact_id,
    checksum_sha256: artifactRow.checksum_sha256,
    download_url: `/v1/artifacts/${encodeURIComponent(artifactRow.artifact_id)}`,
  });
});

test("export returns not_found when collection is outside knowledge access scope", async () => {
  await assert.rejects(
    () =>
      exporter().exportTopicCandidates({
        profile: "demo",
        collectionId: "k12_kgraph_full",
        access: {
          effective_collection_ids: ["marble"],
        },
      }),
    (error) => {
      assert.equal(error.status, 404);
      assert.equal(error.code, "not_found");
      return true;
    },
  );
});

test("pagination preserves same artifact id and checksum across pages", async () => {
  const cursor = encodeTopicCandidateCursor({ artifactId: artifactRow.artifact_id, offset: 1 });
  const result = await exporter().exportTopicCandidates({
    profile: "demo",
    collectionId: "k12_kgraph_full",
    limit: 1,
    cursor,
  });

  assert.equal(result.artifact_id, artifactRow.artifact_id);
  assert.equal(result.checksum_sha256, artifactRow.checksum_sha256);
});
