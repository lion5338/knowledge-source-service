import assert from "node:assert/strict";
import fs from "fs/promises";
import os from "os";
import path from "path";
import test from "node:test";

import {
  createSourceCollectionIngestor,
  inspectSourceCollectionSnapshot,
} from "../src/lib/source-collections/source-snapshot-ingest.js";

function collectStrings(value, output = []) {
  if (typeof value === "string") {
    output.push(value);
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectStrings(item, output);
    }
    return output;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      collectStrings(item, output);
    }
  }
  return output;
}

function assertNoRawPathLeak(payload) {
  for (const value of collectStrings(payload)) {
    assert.equal(/^[A-Za-z]:[\\/]/.test(value), false, `absolute Windows path leaked: ${value}`);
    assert.equal(value.includes("\\\\"), false, `backslash path leaked: ${value}`);
    assert.equal(value.includes("/raw/"), false, `private raw path leaked: ${value}`);
    assert.equal(value.includes("storage/knowledge/raw"), false, `private storage path leaked: ${value}`);
  }
}

async function createK12Fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "k12-snapshot-"));
  await fs.mkdir(path.join(root, "kg"), { recursive: true });
  await fs.writeFile(
    path.join(root, "manifest.json"),
    `${JSON.stringify({ source: "k12_dataset", version: "fixture" }, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(
    path.join(root, "snapshot.json"),
    `${JSON.stringify({ snapshot: "fixture" }, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(
    path.join(root, "kg", "math_7a_rjb.json"),
    `${JSON.stringify({ nodes: [{ id: "math_7a_rjb_cpt41", name: "linear equation" }], edges: [] }, null, 2)}\n`,
    "utf8",
  );
  return root;
}

const k12Collection = {
  object: "source_collection",
  collection_id: "k12_kgraph_full",
  source_ids: ["k12_dataset"],
  source_uri: "datasets/K12-KGraph-HF/K12-KGraph",
  license_scope: "non_commercial_demo_only",
  attribution: "K12 attribution",
  publish_profiles: ["demo"],
};

test("inspect K12 fixture creates deterministic snapshot id", async () => {
  const sourceRoot = await createK12Fixture();

  const first = await inspectSourceCollectionSnapshot({
    collectionId: "k12_kgraph_full",
    sourceRoot,
    getCollection: async () => k12Collection,
  });
  const second = await inspectSourceCollectionSnapshot({
    collectionId: "k12_kgraph_full",
    sourceRoot,
    getCollection: async () => k12Collection,
  });

  assert.equal(first.snapshot_id, second.snapshot_id);
  assert.equal(first.checksum_sha256, second.checksum_sha256);
  assert.match(first.snapshot_id, /^source-snapshot:k12_kgraph_full:sha256:[a-f0-9]{64}$/);
  assert.deepEqual(
    first.raw_manifest.detected_files.map((file) => file.path).sort(),
    ["kg/math_7a_rjb.json", "manifest.json", "snapshot.json"],
  );
});

test("snapshot metadata includes license_scope from collection", async () => {
  const sourceRoot = await createK12Fixture();

  const snapshot = await inspectSourceCollectionSnapshot({
    collectionId: "k12_kgraph_full",
    sourceRoot,
    getCollection: async () => k12Collection,
  });

  assert.equal(snapshot.license_scope, "non_commercial_demo_only");
  assert.deepEqual(snapshot.publish_profiles, ["demo"]);
  assert.equal(snapshot.attribution, "K12 attribution");
});

test("missing K12 raw files fails with actionable error", async () => {
  const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "k12-missing-"));
  await fs.mkdir(path.join(sourceRoot, "kg"), { recursive: true });

  await assert.rejects(
    () =>
      inspectSourceCollectionSnapshot({
        collectionId: "k12_kgraph_full",
        sourceRoot,
        getCollection: async () => k12Collection,
      }),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.code, "source_snapshot_missing_required_file");
      assert.match(error.message, /manifest\.json/);
      assert.match(error.message, /snapshot\.json/);
      return true;
    },
  );
});

test("snapshot response never exposes absolute private path", async () => {
  const sourceRoot = await createK12Fixture();

  const snapshot = await inspectSourceCollectionSnapshot({
    collectionId: "k12_kgraph_full",
    sourceRoot,
    getCollection: async () => k12Collection,
  });

  assertNoRawPathLeak(snapshot);
});

test("ingest persists snapshot metadata and audit event", async () => {
  const sourceRoot = await createK12Fixture();
  const queries = [];
  const ingestor = createSourceCollectionIngestor({
    resolveSourceRoot: async () => sourceRoot,
    getCollection: async () => k12Collection,
    withClient: async (callback) =>
      callback({
        query: async (sql, params = []) => {
          queries.push({ sql, params });
          return { rows: [] };
        },
      }),
    writeSnapshotArtifact: async () => ({
      storage_path: "snapshots/k12_kgraph_full/sha256/snapshot.json",
      checksum_sha256: "snapshot-artifact-checksum",
    }),
  });

  const result = await ingestor.ingestSourceCollectionSnapshot({ collectionId: "k12_kgraph_full", actor: "test" });

  assert.equal(result.object, "source_snapshot_ingest_result");
  assert.equal(result.collection_id, "k12_kgraph_full");
  assert.equal(result.snapshot.license_scope, "non_commercial_demo_only");
  assert.equal(
    queries.some(
      (query) =>
        query.sql.includes("knowledge_source_versions") &&
        query.params.includes(result.snapshot.snapshot_id),
    ),
    true,
  );
  assert.equal(
    queries.some((query) => query.sql.includes("knowledge_source_audit_events") && query.params[0] === "source_snapshot.ingested"),
    true,
  );
  assert.equal(
    queries.some((query) => query.sql.includes("knowledge_source_artifacts") && query.params[1] === "source_snapshot_manifest"),
    true,
  );
});
