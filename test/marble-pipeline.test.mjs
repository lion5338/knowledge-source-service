import assert from "node:assert/strict";
import fs from "fs/promises";
import os from "os";
import path from "path";
import test from "node:test";

import { createKnowledgeRetriever, buildRetrievalIndex } from "../src/lib/retrieval/retrieval.js";
import { buildNormalizedArtifact, createNormalizedArtifactBuilder } from "../src/lib/source-artifacts/normalized-artifacts.js";
import { inspectSourceCollectionSnapshot } from "../src/lib/source-collections/source-snapshot-ingest.js";

const marbleCollection = {
  object: "source_collection",
  collection_id: "marble",
  source_ids: ["marble"],
  source_uri: "https://github.com/withmarbleapp/os-taxonomy",
  license_scope: "open_educational_source",
  attribution: "Marble attribution",
  publish_profiles: ["demo", "mvp", "prod"],
};

const k12Collection = {
  collection_id: "k12_kgraph_full",
  source_ids: ["k12_dataset"],
  publish_profiles: ["demo"],
  license_scope: "non_commercial_demo_only",
};

async function createMarbleFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "marble-pipeline-"));
  await fs.writeFile(path.join(root, "snapshot.json"), `${JSON.stringify({ created_at: "2026-01-01T00:00:00.000Z" })}\n`, "utf8");
  await fs.writeFile(path.join(root, "dependencies.json"), `${JSON.stringify({ version: "v1", dependencies: [] })}\n`, "utf8");
  await fs.writeFile(
    path.join(root, "topics.json"),
    `${JSON.stringify({
      version: "v1",
      topics: [
        {
          id: "mt_fraction_equivalence",
          type: "CONCEPTUAL",
          subject: "Mathematics",
          domain: "Fractions",
          name: "Fraction equivalence",
          description: "Equivalent fractions represent the same value.",
          ageRangeStart: 8,
          ageRangeEnd: 10,
          evidence: ["Identify equivalent fractions"],
          assessmentPrompt: "Can the learner explain equivalent fractions?",
        },
      ],
    })}\n`,
    "utf8",
  );
  return root;
}

test("Marble snapshot ingest inspects managed raw snapshot without leaking raw path", async () => {
  const sourceRoot = await createMarbleFixture();

  const snapshot = await inspectSourceCollectionSnapshot({
    collectionId: "marble",
    sourceRoot,
    getCollection: async () => marbleCollection,
  });

  assert.match(snapshot.snapshot_id, /^source-snapshot:marble:sha256:[a-f0-9]{64}$/);
  assert.equal(snapshot.license_scope, "open_educational_source");
  assert.deepEqual(
    snapshot.raw_manifest.detected_files.map((file) => file.path).sort(),
    ["dependencies.json", "snapshot.json", "topics.json"],
  );
  assert.equal(JSON.stringify(snapshot).includes(sourceRoot), false);
});

test("Marble build script publishes validated normalized_documents metadata", async () => {
  const sourceRoot = await createMarbleFixture();
  const snapshot = await inspectSourceCollectionSnapshot({
    collectionId: "marble",
    sourceRoot,
    getCollection: async () => marbleCollection,
  });
  const queries = [];
  const builder = createNormalizedArtifactBuilder({
    getCollection: async () => ({ ...marbleCollection, snapshot }),
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
    collectionId: "marble",
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

test("retrieval index includes Marble normalized document for mvp", async () => {
  const sourceRoot = await createMarbleFixture();
  const snapshot = await inspectSourceCollectionSnapshot({
    collectionId: "marble",
    sourceRoot,
    getCollection: async () => marbleCollection,
  });
  const artifact = await buildNormalizedArtifact({
    collection: marbleCollection,
    snapshot,
    sourceRoot,
    artifactType: "normalized_documents",
  });

  const index = buildRetrievalIndex({
    profile: "mvp",
    collections: [k12Collection, marbleCollection],
    sourceArtifacts: [artifact],
  });

  assert.equal(index.documents.length, 1);
  assert.equal(index.documents[0].collection_id, "marble");
  assert.equal(index.documents[0].license_scope, "open_educational_source");
});

test("mvp retrieve returns Marble result with open_educational_source license", async () => {
  const sourceRoot = await createMarbleFixture();
  const snapshot = await inspectSourceCollectionSnapshot({
    collectionId: "marble",
    sourceRoot,
    getCollection: async () => marbleCollection,
  });
  const artifact = await buildNormalizedArtifact({
    collection: marbleCollection,
    snapshot,
    sourceRoot,
    artifactType: "normalized_documents",
  });
  const retriever = createKnowledgeRetriever({
    listCollections: async () => ({ data: [k12Collection, marbleCollection] }),
    findRetrievalIndexArtifact: async () => null,
    findRetrievalSourceArtifacts: async () => [{ artifact_id: artifact.artifact_id, storage_path: "marble-docs.json", checksum_sha256: artifact.checksum_sha256 }],
    readArtifactJson: async () => artifact,
  });

  const result = await retriever.retrieve({ profile: "mvp", query: "fraction equivalence" });

  assert.equal(result.results[0].collection_id, "marble");
  assert.equal(result.results[0].license_scope, "open_educational_source");
  assert.equal(result.results[0].artifact_id, artifact.artifact_id);
});
