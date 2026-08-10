import assert from "node:assert/strict";
import fs from "fs/promises";
import os from "os";
import path from "path";
import test from "node:test";

import { createKnowledgeRetriever, buildRetrievalIndex } from "../src/lib/retrieval/retrieval.js";
import { buildNormalizedArtifact, createNormalizedArtifactBuilder } from "../src/lib/source-artifacts/normalized-artifacts.js";
import { inspectSourceCollectionSnapshot } from "../src/lib/source-collections/source-snapshot-ingest.js";

const learningCommonsCollection = {
  object: "source_collection",
  collection_id: "learning_commons",
  source_ids: ["learning_commons"],
  source_uri: "https://github.com/learning-commons-org/knowledge-graph",
  license_scope: "open_educational_source",
  attribution: "Learning Commons attribution",
  publish_profiles: ["demo", "mvp", "prod"],
};

const k12Collection = {
  collection_id: "k12_kgraph_full",
  source_ids: ["k12_dataset"],
  publish_profiles: ["demo"],
  license_scope: "non_commercial_demo_only",
};

async function createLearningCommonsFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "learning-commons-pipeline-"));
  await fs.writeFile(path.join(root, "snapshot.json"), `${JSON.stringify({ created_at: "2026-01-01T00:00:00.000Z" })}\n`, "utf8");
  await fs.writeFile(path.join(root, "relationships.jsonl"), '{"type":"relationship","identifier":"rel-1"}\n', "utf8");
  await fs.writeFile(
    path.join(root, "nodes.jsonl"),
    `${JSON.stringify({
      type: "node",
      identifier: "lc_area_model",
      labels: ["Activity"],
      properties: {
        identifier: "lc_area_model",
        name: "Area model",
        academicSubject: "Mathematics",
        gradeLevel: "[\"6\"]",
        educationalUse: "activity",
        audience: "[\"Teacher\",\"Student\"]",
        courseCode: "im360:6",
        curriculumLabel: "Lesson",
        attributionStatement: "Learning Commons attribution",
      },
    })}\n`,
    "utf8",
  );
  return root;
}

test("Learning Commons snapshot ingest inspects managed raw snapshot without leaking raw path", async () => {
  const sourceRoot = await createLearningCommonsFixture();

  const snapshot = await inspectSourceCollectionSnapshot({
    collectionId: "learning_commons",
    sourceRoot,
    getCollection: async () => learningCommonsCollection,
  });

  assert.match(snapshot.snapshot_id, /^source-snapshot:learning_commons:sha256:[a-f0-9]{64}$/);
  assert.equal(snapshot.license_scope, "open_educational_source");
  assert.deepEqual(
    snapshot.raw_manifest.detected_files.map((file) => file.path).sort(),
    ["nodes.jsonl", "relationships.jsonl", "snapshot.json"],
  );
  assert.equal(JSON.stringify(snapshot).includes(sourceRoot), false);
});

test("Learning Commons build script publishes validated normalized_documents metadata", async () => {
  const sourceRoot = await createLearningCommonsFixture();
  const snapshot = await inspectSourceCollectionSnapshot({
    collectionId: "learning_commons",
    sourceRoot,
    getCollection: async () => learningCommonsCollection,
  });
  const queries = [];
  const builder = createNormalizedArtifactBuilder({
    getCollection: async () => ({ ...learningCommonsCollection, snapshot }),
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
    collectionId: "learning_commons",
    artifactType: "normalized_documents",
    actor: "test",
  });

  assert.equal(result.artifact.artifact_type, "normalized_documents");
  assert.equal(result.artifact.publish_status, "validated");
  assert.equal(result.artifact.summary.record_count, 1);
  assert.equal(
    queries.some((query) => query.sql.includes("knowledge_source_artifacts") && query.params[1] === "normalized_documents" && query.params[7] === 1),
    true,
  );
});

test("retrieval index includes Learning Commons normalized document for prod", async () => {
  const sourceRoot = await createLearningCommonsFixture();
  const snapshot = await inspectSourceCollectionSnapshot({
    collectionId: "learning_commons",
    sourceRoot,
    getCollection: async () => learningCommonsCollection,
  });
  const artifact = await buildNormalizedArtifact({
    collection: learningCommonsCollection,
    snapshot,
    sourceRoot,
    artifactType: "normalized_documents",
  });

  const index = buildRetrievalIndex({
    profile: "prod",
    collections: [k12Collection, learningCommonsCollection],
    sourceArtifacts: [artifact],
  });

  assert.equal(index.documents.length, 1);
  assert.equal(index.documents[0].collection_id, "learning_commons");
  assert.equal(index.documents[0].license_scope, "open_educational_source");
});

test("prod retrieve returns Learning Commons result with open_educational_source license", async () => {
  const sourceRoot = await createLearningCommonsFixture();
  const snapshot = await inspectSourceCollectionSnapshot({
    collectionId: "learning_commons",
    sourceRoot,
    getCollection: async () => learningCommonsCollection,
  });
  const artifact = await buildNormalizedArtifact({
    collection: learningCommonsCollection,
    snapshot,
    sourceRoot,
    artifactType: "normalized_documents",
  });
  const retriever = createKnowledgeRetriever({
    listCollections: async () => ({ data: [k12Collection, learningCommonsCollection] }),
    findRetrievalIndexArtifact: async () => null,
    findRetrievalSourceArtifacts: async () => [
      { artifact_id: artifact.artifact_id, storage_path: "learning-commons-docs.json", checksum_sha256: artifact.checksum_sha256 },
    ],
    readArtifactJson: async () => artifact,
  });

  const result = await retriever.retrieve({ profile: "prod", query: "area model" });

  assert.equal(result.results[0].collection_id, "learning_commons");
  assert.equal(result.results[0].license_scope, "open_educational_source");
  assert.equal(result.results[0].artifact_id, artifact.artifact_id);
});
