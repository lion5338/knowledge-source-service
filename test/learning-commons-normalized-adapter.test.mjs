import assert from "node:assert/strict";
import fs from "fs/promises";
import os from "os";
import path from "path";
import test from "node:test";

import { validateNormalizedArtifact } from "../src/lib/source-artifacts/normalized-artifact-validation.js";
import { buildNormalizedArtifact } from "../src/lib/source-artifacts/normalized-artifacts.js";

const learningCommonsCollection = {
  collection_id: "learning_commons",
  source_ids: ["learning_commons"],
  license_scope: "open_educational_source",
  attribution: "Learning Commons attribution",
  publish_profiles: ["demo", "mvp", "prod"],
};

const learningCommonsSnapshot = {
  snapshot_id: "source-snapshot:learning_commons:sha256:snapshot-test",
  checksum_sha256: "snapshot-test",
  raw_manifest: {
    detected_files: [
      { path: "nodes.jsonl" },
      { path: "relationships.jsonl" },
      { path: "snapshot.json" },
    ],
  },
};

async function createLearningCommonsFixture({ node = null } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "learning-commons-normalized-"));
  await fs.writeFile(path.join(root, "snapshot.json"), "{}\n", "utf8");
  await fs.writeFile(path.join(root, "relationships.jsonl"), '{"type":"relationship","identifier":"rel-1"}\n', "utf8");
  await fs.writeFile(
    path.join(root, "nodes.jsonl"),
    `${JSON.stringify(
      node ?? {
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
      },
    )}\n`,
    "utf8",
  );
  return root;
}

test("Learning Commons adapter converts fixture graph into normalized_documents artifact", async () => {
  const sourceRoot = await createLearningCommonsFixture();

  const artifact = await buildNormalizedArtifact({
    collection: learningCommonsCollection,
    snapshot: learningCommonsSnapshot,
    sourceRoot,
    artifactType: "normalized_documents",
  });

  assert.equal(artifact.collection_id, "learning_commons");
  assert.equal(artifact.artifact_type, "normalized_documents");
  assert.equal(artifact.schema_version, "source_documents.v1");
  assert.equal(artifact.source_snapshot_id, learningCommonsSnapshot.snapshot_id);
  assert.equal(artifact.license_scope, "open_educational_source");
  assert.equal(artifact.records.length, 1);
  assert.deepEqual(artifact.summary, {
    record_count: 1,
    subjects: ["mathematics"],
  });
  assert.deepEqual(validateNormalizedArtifact(artifact).ok, true);
});

test("Learning Commons normalized artifact id is deterministic", async () => {
  const sourceRoot = await createLearningCommonsFixture();

  const first = await buildNormalizedArtifact({
    collection: learningCommonsCollection,
    snapshot: learningCommonsSnapshot,
    sourceRoot,
    artifactType: "normalized_documents",
  });
  const second = await buildNormalizedArtifact({
    collection: learningCommonsCollection,
    snapshot: learningCommonsSnapshot,
    sourceRoot,
    artifactType: "normalized_documents",
  });

  assert.equal(first.artifact_id, second.artifact_id);
  assert.equal(first.checksum_sha256, second.checksum_sha256);
  assert.match(first.artifact_id, /^source-artifact:learning_commons:normalized_documents:sha256:[a-f0-9]{64}$/);
});

test("Learning Commons records include source_ref and license_scope", async () => {
  const sourceRoot = await createLearningCommonsFixture();

  const artifact = await buildNormalizedArtifact({
    collection: learningCommonsCollection,
    snapshot: learningCommonsSnapshot,
    sourceRoot,
    artifactType: "normalized_documents",
  });

  assert.deepEqual(artifact.records[0].source_ref, {
    collection_id: "learning_commons",
    source: "learning_commons",
    topic_id: "lc_area_model",
  });
  assert.equal(artifact.records[0].license_scope, "open_educational_source");
  assert.equal(artifact.records[0].learning_stage, "middle_school");
  assert.match(artifact.records[0].text, /Area model/);
});

test("Learning Commons adapter preserves attribution from collection manifest", async () => {
  const sourceRoot = await createLearningCommonsFixture();

  const artifact = await buildNormalizedArtifact({
    collection: learningCommonsCollection,
    snapshot: learningCommonsSnapshot,
    sourceRoot,
    artifactType: "normalized_documents",
  });

  assert.equal(artifact.attribution, "Learning Commons attribution");
});

test("Learning Commons adapter rejects invalid fixture shape with actionable error", async () => {
  const sourceRoot = await createLearningCommonsFixture({ node: { type: "node", labels: [] } });

  await assert.rejects(
    () =>
      buildNormalizedArtifact({
        collection: learningCommonsCollection,
        snapshot: learningCommonsSnapshot,
        sourceRoot,
        artifactType: "normalized_documents",
      }),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.code, "normalized_artifact_invalid_source_shape");
      assert.match(error.message, /nodes\.jsonl/);
      return true;
    },
  );
});
