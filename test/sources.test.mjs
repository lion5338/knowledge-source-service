import assert from "node:assert/strict";
import test from "node:test";

import { createSources } from "../src/lib/sources/sources.js";

test("getLatestRuntimeIndex returns trace metadata for the latest runtime index", async () => {
  const runtimeIndex = {
    index_version: "knowledge-index.test",
    built_at: "2026-07-29T12:00:00.000Z",
    sources: [{ source: "marble" }, { source: "learning_commons" }],
    topics: [
      { topic_key: "fraction_equivalence", retrieved_sources: [{ source: "marble" }, { source: "learning_commons" }] },
      { topic_key: "rectangle_area", retrieved_sources: [{ source: "marble" }] },
      { topic_key: "empty_refs" },
    ],
  };
  const artifactRow = {
    artifact_id: "runtime-index:latest",
    artifact_type: "runtime_index",
    source: null,
    source_version: null,
    storage_path: "index/knowledge-index.json",
    content_type: "application/json",
    record_count: null,
    checksum_sha256: "sha256-test",
    publish_status: "published",
    metadata: { imported_from: "knowledge/index/knowledge-index.json" },
    created_at: "2026-07-29T12:00:01.000Z",
    updated_at: "2026-07-29T12:00:01.000Z",
  };
  const sources = createSources({
    withClient: async (callback) =>
      callback({
        query: async () => ({ rows: [artifactRow] }),
      }),
    readArtifactJson: async (storagePath) => {
      assert.equal(storagePath, "index/knowledge-index.json");
      return runtimeIndex;
    },
    readArtifactText: async () => {
      throw new Error("readArtifactText should not be used for runtime index JSON");
    },
  });

  const result = await sources.getLatestRuntimeIndex();

  assert.deepEqual(result.summary, {
    index_version: "knowledge-index.test",
    built_at: "2026-07-29T12:00:00.000Z",
    source_count: 2,
    topic_count: 3,
    source_ref_count: 3,
  });
  assert.equal(result.artifact.publish_status, "published");
  assert.equal(result.artifact.checksum_sha256, "sha256-test");
  assert.equal(result.index, runtimeIndex);
});

test("getLatestRuntimeIndex exposes alias and resolved immutable version metadata", async () => {
  const runtimeIndex = {
    index_version: "knowledge-index.test",
    built_at: "2026-07-29T12:00:00.000Z",
    sources: [],
    topics: [],
  };
  const latestRow = {
    artifact_id: "runtime-index:latest",
    artifact_type: "runtime_index",
    source: null,
    source_version: null,
    storage_path: "index/knowledge-index.json",
    content_type: "application/json",
    record_count: null,
    checksum_sha256: "sha256-test",
    publish_status: "published",
    metadata: {
      points_to_artifact_id: "runtime-index:sha256:sha256-test",
    },
    created_at: "2026-07-29T12:00:01.000Z",
    updated_at: "2026-07-29T12:00:01.000Z",
  };
  const versionRow = {
    ...latestRow,
    artifact_id: "runtime-index:sha256:sha256-test",
    storage_path: "index/versions/sha256/sha256-test.json",
    metadata: {
      alias_artifact_id: "runtime-index:latest",
    },
  };
  const queries = [];
  const sources = createSources({
    withClient: async (callback) =>
      callback({
        query: async (sql, params = []) => {
          queries.push({ sql, params });
          return { rows: [params[0] === "runtime-index:latest" ? latestRow : versionRow] };
        },
      }),
    readArtifactJson: async () => runtimeIndex,
  });

  const result = await sources.getLatestRuntimeIndex();

  assert.equal(result.trace_mode, "content_addressed_version");
  assert.deepEqual(result.alias, {
    artifact_id: "runtime-index:latest",
    points_to_artifact_id: "runtime-index:sha256:sha256-test",
    checksum_sha256: "sha256-test",
    publish_status: "published",
  });
  assert.deepEqual(result.version, {
    artifact_id: "runtime-index:sha256:sha256-test",
    storage_path: "index/versions/sha256/sha256-test.json",
    checksum_sha256: "sha256-test",
    publish_status: "published",
  });
  assert.deepEqual(
    queries.map((query) => query.params[0]),
    ["runtime-index:latest", "runtime-index:sha256:sha256-test"],
  );
});

test("getLatestRuntimeIndex selects demo alias when profile=demo", async () => {
  const runtimeIndex = {
    index_version: "runtime-index.demo",
    profile: "demo",
    sources: [],
    topics: [],
    profile_trace: { profile: "demo", source_collection_ids: [], blocked_collection_ids: [], policy_decisions: [] },
  };
  const latestRow = {
    artifact_id: "runtime-index:demo:latest",
    artifact_type: "runtime_index",
    source: null,
    source_version: null,
    storage_path: "index/profiles/demo/latest.json",
    content_type: "application/json",
    record_count: null,
    checksum_sha256: "demo-checksum",
    publish_status: "published",
    metadata: {
      profile: "demo",
      points_to_artifact_id: "runtime-index:demo:sha256:demo-checksum",
    },
    created_at: "2026-08-10T12:00:01.000Z",
    updated_at: "2026-08-10T12:00:01.000Z",
  };
  const versionRow = {
    ...latestRow,
    artifact_id: "runtime-index:demo:sha256:demo-checksum",
    metadata: { profile: "demo", alias_artifact_id: "runtime-index:demo:latest" },
  };
  const queries = [];
  const sources = createSources({
    withClient: async (callback) =>
      callback({
        query: async (_sql, params = []) => {
          queries.push(params[0]);
          return { rows: [params[0] === "runtime-index:demo:latest" ? latestRow : versionRow] };
        },
      }),
    readArtifactJson: async () => runtimeIndex,
  });

  const result = await sources.getLatestRuntimeIndex({ profile: "demo" });

  assert.equal(result.profile, "demo");
  assert.equal(result.alias.artifact_id, "runtime-index:demo:latest");
  assert.equal(result.profile_trace.profile, "demo");
  assert.deepEqual(queries, ["runtime-index:demo:latest", "runtime-index:demo:sha256:demo-checksum"]);
});

test("getLatestRuntimeIndex selects mvp alias when profile=mvp", async () => {
  const row = {
    artifact_id: "runtime-index:mvp:latest",
    artifact_type: "runtime_index",
    source: null,
    source_version: null,
    storage_path: "index/profiles/mvp/latest.json",
    content_type: "application/json",
    record_count: null,
    checksum_sha256: "mvp-checksum",
    publish_status: "published",
    metadata: { profile: "mvp" },
    created_at: "2026-08-10T12:00:01.000Z",
    updated_at: "2026-08-10T12:00:01.000Z",
  };
  const queries = [];
  const sources = createSources({
    withClient: async (callback) =>
      callback({
        query: async (_sql, params = []) => {
          queries.push(params[0]);
          return { rows: [row] };
        },
      }),
    readArtifactJson: async () => ({ profile: "mvp", sources: [], topics: [] }),
  });

  const result = await sources.getLatestRuntimeIndex({ profile: "mvp" });

  assert.equal(result.profile, "mvp");
  assert.equal(result.alias.artifact_id, "runtime-index:mvp:latest");
  assert.deepEqual(queries, ["runtime-index:mvp:latest"]);
});

test("getLatestRuntimeIndex rejects invalid profile", async () => {
  const sources = createSources();

  await assert.rejects(
    () => sources.getLatestRuntimeIndex({ profile: "invalid" }),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.code, "invalid_runtime_profile");
      return true;
    },
  );
});

test("getLatestRuntimeIndex marks legacy alias-only trace when latest has no version pointer", async () => {
  const runtimeIndex = {
    index_version: "knowledge-index.legacy",
    sources: [],
    topics: [],
  };
  const latestRow = {
    artifact_id: "runtime-index:latest",
    artifact_type: "runtime_index",
    source: null,
    source_version: null,
    storage_path: "index/knowledge-index.json",
    content_type: "application/json",
    record_count: null,
    checksum_sha256: "legacy-sha256",
    publish_status: "published",
    metadata: {},
    created_at: "2026-07-29T12:00:01.000Z",
    updated_at: "2026-07-29T12:00:01.000Z",
  };
  const queries = [];
  const sources = createSources({
    withClient: async (callback) =>
      callback({
        query: async (_sql, params = []) => {
          queries.push(params[0]);
          return { rows: [latestRow] };
        },
      }),
    readArtifactJson: async () => runtimeIndex,
  });

  const result = await sources.getLatestRuntimeIndex();

  assert.equal(result.trace_mode, "legacy_alias_only");
  assert.deepEqual(result.alias, {
    artifact_id: "runtime-index:latest",
    points_to_artifact_id: null,
    checksum_sha256: "legacy-sha256",
    publish_status: "published",
  });
  assert.equal(result.version, null);
  assert.deepEqual(queries, ["runtime-index:latest"]);
});

test("getLatestRuntimeIndex filters runtime payload by access effective collections", async () => {
  const runtimeIndex = {
    index_version: "runtime-index.demo",
    profile: "demo",
    sources: [
      { collection_id: "k12_kgraph_full", source_ids: ["k12_dataset"] },
      { collection_id: "marble", source_ids: ["marble"] },
    ],
    topics: [
      {
        topic_key: "linear_equation",
        collection_id: "k12_kgraph_full",
        retrieved_sources: [{ collection_id: "k12_kgraph_full", source: "k12_dataset" }],
      },
      {
        topic_key: "fraction_equivalence",
        collection_id: "marble",
        retrieved_sources: [{ collection_id: "marble", source: "marble" }],
      },
    ],
    profile_trace: {
      profile: "demo",
      source_collection_ids: ["k12_kgraph_full", "marble"],
      blocked_collection_ids: [],
      policy_decisions: [],
    },
  };
  const row = {
    artifact_id: "runtime-index:demo:latest",
    artifact_type: "runtime_index",
    source: null,
    source_version: null,
    storage_path: "index/profiles/demo/latest.json",
    content_type: "application/json",
    record_count: null,
    checksum_sha256: "demo-checksum",
    publish_status: "published",
    metadata: { profile: "demo" },
    created_at: "2026-08-10T12:00:01.000Z",
    updated_at: "2026-08-10T12:00:01.000Z",
  };
  const sources = createSources({
    withClient: async (callback) =>
      callback({
        query: async () => ({ rows: [row] }),
      }),
    readArtifactJson: async () => runtimeIndex,
  });

  const result = await sources.getLatestRuntimeIndex({
    profile: "demo",
    access: {
      access_mode: "default_only",
      effective_collection_ids: ["marble"],
      blocked_collection_ids: ["k12_kgraph_full"],
    },
  });

  assert.deepEqual(
    result.index.sources.map((source) => source.collection_id),
    ["marble"],
  );
  assert.deepEqual(
    result.index.topics.map((topic) => topic.topic_key),
    ["fraction_equivalence"],
  );
  assert.deepEqual(result.profile_trace.access.effective_collection_ids, ["marble"]);
  assert.deepEqual(result.summary, {
    index_version: "runtime-index.demo",
    built_at: null,
    source_count: 1,
    topic_count: 1,
    source_ref_count: 1,
  });
});

test("getRuntimeIndexDiff compares explicit runtime index artifact ids", async () => {
  const artifactRows = {
    "runtime-index:sha256:from": {
      artifact_id: "runtime-index:sha256:from",
      artifact_type: "runtime_index",
      source: null,
      source_version: null,
      storage_path: "index/versions/sha256/from.json",
      content_type: "application/json",
      record_count: null,
      checksum_sha256: "from",
      publish_status: "published",
      metadata: {},
      created_at: "2026-07-29T12:00:00.000Z",
      updated_at: "2026-07-29T12:00:00.000Z",
    },
    "runtime-index:sha256:to": {
      artifact_id: "runtime-index:sha256:to",
      artifact_type: "runtime_index",
      source: null,
      source_version: null,
      storage_path: "index/versions/sha256/to.json",
      content_type: "application/json",
      record_count: null,
      checksum_sha256: "to",
      publish_status: "published",
      metadata: {},
      created_at: "2026-07-29T12:01:00.000Z",
      updated_at: "2026-07-29T12:01:00.000Z",
    },
  };
  const indexes = {
    "index/versions/sha256/from.json": { sources: [{ source: "marble" }], topics: [] },
    "index/versions/sha256/to.json": {
      sources: [{ source: "marble" }],
      topics: [{ topic_key: "fraction_equivalence", retrieved_sources: [] }],
    },
  };
  const sources = createSources({
    withClient: async (callback) =>
      callback({
        query: async (_sql, params = []) => ({ rows: [artifactRows[params[0]]] }),
      }),
    readArtifactJson: async (storagePath) => indexes[storagePath],
  });

  const result = await sources.getRuntimeIndexDiff({
    from: "runtime-index:sha256:from",
    to: "runtime-index:sha256:to",
  });

  assert.equal(result.object, "runtime_index_diff");
  assert.equal(result.status, "ok");
  assert.equal(result.selection.mode, "explicit_artifact_ids");
  assert.deepEqual(result.from, {
    artifact_id: "runtime-index:sha256:from",
    checksum_sha256: "from",
  });
  assert.deepEqual(result.to, {
    artifact_id: "runtime-index:sha256:to",
    checksum_sha256: "to",
  });
  assert.deepEqual(result.summary, {
    source_count_delta: 0,
    topic_count_delta: 1,
    source_ref_count_delta: 0,
  });
  assert.deepEqual(result.topics.added, ["fraction_equivalence"]);
});

test("getRuntimeIndexDiff reports insufficient history when default diff has only one pinned version", async () => {
  const latestRow = {
    artifact_id: "runtime-index:latest",
    artifact_type: "runtime_index",
    source: null,
    source_version: null,
    storage_path: "index/knowledge-index.json",
    content_type: "application/json",
    record_count: null,
    checksum_sha256: "to",
    publish_status: "published",
    metadata: {
      points_to_artifact_id: "runtime-index:sha256:to",
    },
    created_at: "2026-07-29T12:01:00.000Z",
    updated_at: "2026-07-29T12:01:00.000Z",
  };
  const toRow = {
    ...latestRow,
    artifact_id: "runtime-index:sha256:to",
    storage_path: "index/versions/sha256/to.json",
    metadata: {},
  };
  const sources = createSources({
    withClient: async (callback) =>
      callback({
        query: async (sql, params = []) => {
          if (sql.includes("ORDER BY created_at DESC")) {
            return { rows: [toRow] };
          }
          return { rows: [params[0] === "runtime-index:latest" ? latestRow : toRow] };
        },
      }),
    readArtifactJson: async () => ({ sources: [], topics: [] }),
  });

  const result = await sources.getRuntimeIndexDiff();

  assert.equal(result.status, "insufficient_history");
  assert.deepEqual(result.selection, {
    mode: "latest_vs_previous_published_artifact",
    to_source: "latest_alias_pointer",
    from_source: "artifact_created_at_desc",
  });
  assert.equal(result.from, null);
  assert.deepEqual(result.to, {
    artifact_id: "runtime-index:sha256:to",
    checksum_sha256: "to",
  });
  assert.equal(result.summary, null);
  assert.deepEqual(result.topics, { added: [], removed: [], changed: [] });
  assert.deepEqual(result.sources, { added: [], removed: [] });
});

test("getRuntimeIndexDiff rejects partial explicit artifact ids", async () => {
  const sources = createSources();

  await assert.rejects(
    () => sources.getRuntimeIndexDiff({ from: "runtime-index:sha256:from" }),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.code, "bad_request");
      assert.equal(error.details.field, "from_to");
      return true;
    },
  );
});
