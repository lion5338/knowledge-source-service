import assert from "node:assert/strict";
import fs from "fs/promises";
import os from "os";
import path from "path";
import test from "node:test";

import { validateNormalizedArtifact } from "../src/lib/source-artifacts/normalized-artifact-validation.js";
import { buildNormalizedArtifact } from "../src/lib/source-artifacts/normalized-artifacts.js";

const marbleCollection = {
  collection_id: "marble",
  source_ids: ["marble"],
  license_scope: "open_educational_source",
  attribution: "Marble attribution",
  publish_profiles: ["demo", "mvp", "prod"],
};

const marbleSnapshot = {
  snapshot_id: "source-snapshot:marble:sha256:snapshot-test",
  checksum_sha256: "snapshot-test",
  raw_manifest: {
    detected_files: [
      { path: "topics.json" },
      { path: "dependencies.json" },
      { path: "snapshot.json" },
    ],
  },
};

async function createMarbleFixture({ topics = null } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "marble-normalized-"));
  await fs.writeFile(path.join(root, "snapshot.json"), "{}\n", "utf8");
  await fs.writeFile(
    path.join(root, "dependencies.json"),
    `${JSON.stringify({ version: "v1", dependencies: [] }, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(
    path.join(root, "topics.json"),
    `${JSON.stringify(
      topics ?? {
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
            evidence: ["Identify equivalent fractions", "Explain why two fractions are equal"],
            assessmentPrompt: "Can the learner explain why 1/2 and 2/4 are equal?",
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return root;
}

test("Marble adapter converts fixture taxonomy into normalized_documents artifact", async () => {
  const sourceRoot = await createMarbleFixture();

  const artifact = await buildNormalizedArtifact({
    collection: marbleCollection,
    snapshot: marbleSnapshot,
    sourceRoot,
    artifactType: "normalized_documents",
  });

  assert.equal(artifact.collection_id, "marble");
  assert.equal(artifact.artifact_type, "normalized_documents");
  assert.equal(artifact.schema_version, "source_documents.v1");
  assert.equal(artifact.source_snapshot_id, marbleSnapshot.snapshot_id);
  assert.equal(artifact.license_scope, "open_educational_source");
  assert.equal(artifact.records.length, 1);
  assert.deepEqual(artifact.summary, {
    record_count: 1,
    subjects: ["mathematics"],
  });
  assert.deepEqual(validateNormalizedArtifact(artifact).ok, true);
});

test("Marble normalized artifact id is deterministic", async () => {
  const sourceRoot = await createMarbleFixture();

  const first = await buildNormalizedArtifact({
    collection: marbleCollection,
    snapshot: marbleSnapshot,
    sourceRoot,
    artifactType: "normalized_documents",
  });
  const second = await buildNormalizedArtifact({
    collection: marbleCollection,
    snapshot: marbleSnapshot,
    sourceRoot,
    artifactType: "normalized_documents",
  });

  assert.equal(first.artifact_id, second.artifact_id);
  assert.equal(first.checksum_sha256, second.checksum_sha256);
  assert.match(first.artifact_id, /^source-artifact:marble:normalized_documents:sha256:[a-f0-9]{64}$/);
});

test("Marble records include source_ref and license_scope", async () => {
  const sourceRoot = await createMarbleFixture();

  const artifact = await buildNormalizedArtifact({
    collection: marbleCollection,
    snapshot: marbleSnapshot,
    sourceRoot,
    artifactType: "normalized_documents",
  });

  assert.deepEqual(artifact.records[0].source_ref, {
    collection_id: "marble",
    source: "marble",
    topic_id: "mt_fraction_equivalence",
  });
  assert.equal(artifact.records[0].license_scope, "open_educational_source");
  assert.equal(artifact.records[0].learning_stage, "elementary");
  assert.match(artifact.records[0].text, /Equivalent fractions/);
});

test("Marble adapter preserves attribution from collection manifest", async () => {
  const sourceRoot = await createMarbleFixture();

  const artifact = await buildNormalizedArtifact({
    collection: marbleCollection,
    snapshot: marbleSnapshot,
    sourceRoot,
    artifactType: "normalized_documents",
  });

  assert.equal(artifact.attribution, "Marble attribution");
});

test("Marble adapter rejects invalid fixture shape with actionable error", async () => {
  const sourceRoot = await createMarbleFixture({ topics: { topics: "not-an-array" } });

  await assert.rejects(
    () =>
      buildNormalizedArtifact({
        collection: marbleCollection,
        snapshot: marbleSnapshot,
        sourceRoot,
        artifactType: "normalized_documents",
      }),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.code, "normalized_artifact_invalid_source_shape");
      assert.match(error.message, /topics\.json/);
      return true;
    },
  );
});
