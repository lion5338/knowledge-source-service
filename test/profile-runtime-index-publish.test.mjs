import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProfileRuntimeIndex,
  createProfileRuntimeIndexPublisher,
} from "../src/lib/runtime-index/profile-runtime-index.js";

const collections = [
  {
    collection_id: "k12_kgraph_full",
    source_ids: ["k12_dataset"],
    publish_profiles: ["demo"],
    license_scope: "non_commercial_demo_only",
  },
  {
    collection_id: "marble",
    source_ids: ["marble"],
    publish_profiles: ["demo", "mvp", "prod"],
    license_scope: "open_educational_source",
  },
];

const k12Candidates = {
  artifact_id: "topic-candidates:k12_kgraph_full:demo:sha256:candidates",
  checksum_sha256: "candidates",
  collection_id: "k12_kgraph_full",
  profile: "demo",
  data: [
    {
      topic_key: "k12_mathematics_junior_high_math_7a_rjb_cpt41",
      label: "linear equation",
      subject: "mathematics",
      learning_stage: "junior_high",
      source_refs: [{ collection_id: "k12_kgraph_full", source: "k12_dataset", topic_id: "math_7a_rjb_cpt41" }],
      metadata: {
        license_scope: "non_commercial_demo_only",
        source_artifact_id: "source-artifact:k12",
      },
    },
  ],
};

test("publish demo runtime index creates profile latest alias", async () => {
  const writes = [];
  const publisher = createProfileRuntimeIndexPublisher({
    listCollections: async () => ({ data: collections }),
    findTopicCandidateArtifact: async () => ({ artifact_id: k12Candidates.artifact_id, checksum_sha256: "candidates", storage_path: "topic.json" }),
    readArtifactJson: async () => k12Candidates,
    writeArtifact: async (index) => {
      writes.push(index);
      return { storage_path: `index/profiles/${index.profile}.json`, checksum_sha256: index.checksum_sha256 };
    },
    withClient: async (callback) =>
      callback({
        query: async () => ({ rows: [] }),
      }),
  });

  const result = await publisher.publishRuntimeIndexForProfile({ profile: "demo", actor: "test" });

  assert.equal(result.alias.artifact_id, "runtime-index:demo:latest");
  assert.match(result.version.artifact_id, /^runtime-index:demo:sha256:[a-f0-9]{64}$/);
  assert.equal(writes[0].profile, "demo");
});

test("publish mvp runtime index does not include K12 full demo-only collection", () => {
  const index = buildProfileRuntimeIndex({
    profile: "mvp",
    collections,
    topicCandidateArtifacts: [],
  });

  assert.equal(index.profile, "mvp");
  assert.deepEqual(index.profile_trace.source_collection_ids, ["marble"]);
  assert.deepEqual(index.profile_trace.blocked_collection_ids, ["k12_kgraph_full"]);
  assert.equal(index.topics.some((topic) => topic.collection_id === "k12_kgraph_full"), false);
});

test("publish prod runtime index does not fallback to demo alias", async () => {
  const artifactIds = [];
  const publisher = createProfileRuntimeIndexPublisher({
    listCollections: async () => ({ data: collections }),
    findTopicCandidateArtifact: async () => null,
    writeArtifact: async (index) => ({ storage_path: `index/profiles/${index.profile}.json`, checksum_sha256: index.checksum_sha256 }),
    withClient: async (callback) =>
      callback({
        query: async (_sql, params = []) => {
          artifactIds.push(params[0]);
          return { rows: [] };
        },
      }),
  });

  await publisher.publishRuntimeIndexForProfile({ profile: "prod", actor: "test" });

  assert.ok(artifactIds.includes("runtime-index:prod:latest"));
  assert.equal(artifactIds.includes("runtime-index:demo:latest"), false);
});

test("published profile alias points to immutable content-addressed artifact", async () => {
  const publisher = createProfileRuntimeIndexPublisher({
    listCollections: async () => ({ data: collections }),
    findTopicCandidateArtifact: async () => ({ artifact_id: k12Candidates.artifact_id, checksum_sha256: "candidates", storage_path: "topic.json" }),
    readArtifactJson: async () => k12Candidates,
    writeArtifact: async (index) => ({ storage_path: `index/profiles/${index.profile}.json`, checksum_sha256: index.checksum_sha256 }),
    withClient: async (callback) =>
      callback({
        query: async () => ({ rows: [] }),
      }),
  });

  const result = await publisher.publishRuntimeIndexForProfile({ profile: "demo", actor: "test" });

  assert.equal(result.alias.points_to_artifact_id, result.version.artifact_id);
  assert.match(result.alias.points_to_artifact_id, /^runtime-index:demo:sha256:/);
});

test("publish summary includes blocked collections", () => {
  const index = buildProfileRuntimeIndex({ profile: "prod", collections, topicCandidateArtifacts: [] });

  assert.deepEqual(index.profile_trace.blocked_collection_ids, ["k12_kgraph_full"]);
  assert.equal(
    index.profile_trace.policy_decisions.some(
      (decision) => decision.collection_id === "k12_kgraph_full" && decision.reason_code === "demo_only_source_blocked",
    ),
    true,
  );
});

test("demo runtime index includes K12 full demo topic refs", () => {
  const index = buildProfileRuntimeIndex({
    profile: "demo",
    collections,
    topicCandidateArtifacts: [k12Candidates],
  });

  assert.equal(index.topics.length, 1);
  assert.deepEqual(index.topics[0].retrieved_sources, k12Candidates.data[0].source_refs);
});

test("demo K12 topic refs include demo-only license metadata", () => {
  const index = buildProfileRuntimeIndex({
    profile: "demo",
    collections,
    topicCandidateArtifacts: [k12Candidates],
  });

  assert.equal(index.topics[0].license_scope, "non_commercial_demo_only");
  assert.equal(index.topics[0].source_artifact_id, k12Candidates.artifact_id);
});

test("mvp/prod runtime index excludes K12 full demo-only refs", () => {
  for (const profile of ["mvp", "prod"]) {
    const index = buildProfileRuntimeIndex({
      profile,
      collections,
      topicCandidateArtifacts: [k12Candidates],
    });

    assert.equal(index.topics.some((topic) => topic.collection_id === "k12_kgraph_full"), false);
  }
});
