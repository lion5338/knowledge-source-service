import assert from "node:assert/strict";
import test from "node:test";

import { createSoleSourceReadinessSmoke } from "../src/lib/readiness/sole-source-readiness-smoke.js";

const collections = [
  {
    collection_id: "k12_kgraph_full",
    license_scope: "non_commercial_demo_only",
    official_curriculum_verified: false,
    publish_profiles: ["demo"],
    trace: { raw_path_exposed: false },
  },
  {
    collection_id: "marble",
    license_scope: "open_educational_source",
    publish_profiles: ["demo", "mvp", "prod"],
    trace: { raw_path_exposed: false },
  },
  {
    collection_id: "learning_commons",
    license_scope: "open_educational_source",
    publish_profiles: ["demo", "mvp", "prod"],
    trace: { raw_path_exposed: false },
  },
];

const accessDefaults = {
  enableTenant: false,
  enableK12: false,
  defaultKnowledge: ["marble", "learning_commons"],
  defaultCollectionIds: ["marble", "learning_commons"],
};

const k12NormalizedArtifact = {
  artifact_id: "source-artifact:k12_kgraph_full:normalized_knowledge_graph:sha256:k12",
  artifact_type: "normalized_knowledge_graph",
  publish_status: "validated",
  checksum_sha256: "k12",
  metadata: {
    collection_id: "k12_kgraph_full",
    license_scope: "non_commercial_demo_only",
  },
};

const normalizedArtifact = {
  artifact_id: "source-artifact:marble:normalized_documents:sha256:docs",
  artifact_type: "normalized_documents",
  publish_status: "validated",
  checksum_sha256: "docs",
  metadata: {
    collection_id: "marble",
    license_scope: "open_educational_source",
  },
};

const topicCandidateExport = {
  object: "topic_candidate_export",
  profile: "demo",
  collection_id: "k12_kgraph_full",
  artifact_id: "topic-candidates:k12_kgraph_full:demo:sha256:k12",
  checksum_sha256: "k12",
  license_scope: "non_commercial_demo_only",
  data: [
    {
      topic_key: "k12_topic",
      label: "Book",
      source_refs: [{ collection_id: "k12_kgraph_full", source: "k12_dataset", topic_id: "book" }],
      metadata: { license_scope: "non_commercial_demo_only" },
    },
  ],
  trace: {
    profile: "demo",
    raw_path_exposed: false,
  },
};

function runtimeIndex(profile, overrides = {}) {
  const blocked = profile === "demo" ? [] : ["k12_kgraph_full"];
  return {
    profile,
    alias: {
      artifact_id: `runtime-index:${profile}:latest`,
      points_to_artifact_id: `runtime-index:${profile}:sha256:${profile}`,
      checksum_sha256: profile,
      publish_status: "published",
    },
    version: {
      artifact_id: `runtime-index:${profile}:sha256:${profile}`,
      checksum_sha256: profile,
      publish_status: "published",
    },
    artifact: {
      artifact_id: `runtime-index:${profile}:latest`,
      checksum_sha256: profile,
      publish_status: "published",
      metadata: {},
    },
    summary: {
      source_count: 1,
      topic_count: profile === "demo" ? 1 : 0,
      source_ref_count: profile === "demo" ? 1 : 0,
    },
    profile_trace: {
      profile,
      source_collection_ids: profile === "demo" ? ["k12_kgraph_full", "marble", "learning_commons"] : ["marble", "learning_commons"],
      blocked_collection_ids: blocked,
      policy_decisions: collections.map((collection) => ({
        collection_id: collection.collection_id,
        license_scope: collection.license_scope,
        allowed: profile === "demo" || collection.collection_id !== "k12_kgraph_full",
        reason_code: profile !== "demo" && collection.collection_id === "k12_kgraph_full" ? "demo_only_source_blocked" : "profile_allowed",
      })),
    },
    index: {
      profile,
      sources: profile === "demo" ? [{ collection_id: "k12_kgraph_full", license_scope: "non_commercial_demo_only" }] : [],
      topics:
        profile === "demo"
          ? [
              {
                topic_key: "k12_topic",
                collection_id: "k12_kgraph_full",
                license_scope: "non_commercial_demo_only",
                source_artifact_id: "topic-candidates:k12_kgraph_full:demo:sha256:k12",
                checksum_sha256: "k12",
                retrieved_sources: [{ collection_id: "k12_kgraph_full", source: "k12_dataset", topic_id: "book" }],
              },
            ]
          : [],
    },
    ...overrides,
  };
}

function retrievalResult(profile, overrides = {}) {
  return {
    object: "retrieval_result",
    profile,
    results:
      profile === "demo"
        ? [
            {
              result_id: "retrieval:k12_kgraph_full:k12_topic",
              collection_id: "k12_kgraph_full",
              source: "k12_dataset",
              source_ref: { collection_id: "k12_kgraph_full", source: "k12_dataset", topic_id: "book" },
              title: "Book",
              text: "Book",
              score: 11,
              license_scope: "non_commercial_demo_only",
              artifact_id: "topic-candidates:k12_kgraph_full:demo:sha256:k12",
              checksum_sha256: "k12",
            },
          ]
        : [],
    trace: {
      status: "ok",
      profile,
      source_collections: profile === "demo" ? ["k12_kgraph_full", "marble", "learning_commons"] : ["marble", "learning_commons"],
      blocked_collections: profile === "demo" ? [] : ["k12_kgraph_full"],
      policy_decisions: [],
      retrieval_mode: "retrieval_index",
      retrieval_index_artifact_id: `retrieval-index:${profile}:latest`,
      retrieval_index_checksum_sha256: profile,
      artifact_ids: profile === "demo" ? ["topic-candidates:k12_kgraph_full:demo:sha256:k12"] : [],
      tenant: {
        tenant_id: null,
        policy_status: "default_policy",
        allowed_collection_ids: [],
        blocked_collection_ids: [],
      },
    },
    ...overrides,
  };
}

function smoke(overrides = {}) {
  return createSoleSourceReadinessSmoke({
    listCollections: async () => ({ object: "list", data: collections }),
    listArtifacts: async () => ({ object: "list", data: [k12NormalizedArtifact] }),
    exportTopicCandidates: async () => topicCandidateExport,
    getLatestRuntimeIndex: async ({ profile }) => runtimeIndex(profile),
    retrieve: async ({ profile }) => retrievalResult(profile),
    knowledgeAccessConfig: accessDefaults,
    ...overrides,
  });
}

test("sole source smoke returns ok with warnings for empty mvp and prod retrieval results", async () => {
  const result = await smoke().run();

  assert.equal(result.status, "ok");
  assert.equal(result.checks.source_collections, "passed");
  assert.equal(result.checks.default_access_scope, "passed");
  assert.equal(result.checks.k12_disabled_access_gate, "passed");
  assert.equal(result.checks.retrieve_mvp, "warning");
  assert.equal(result.checks.retrieve_prod, "warning");
  assert.deepEqual(
    result.warnings.map((item) => [item.check, item.reason]),
    [
      ["retrieve_mvp", "retrieval_profile_has_no_results"],
      ["retrieve_prod", "retrieval_profile_has_no_results"],
    ],
  );
});

test("sole source smoke verifies tenant fallback uses DEFAULT_KNOWLEDGE", async () => {
  const result = await smoke({
    knowledgeAccessConfig: {
      ...accessDefaults,
      enableTenant: true,
    },
  }).run();

  assert.equal(result.status, "ok");
  assert.equal(result.checks.tenant_fallback_access, "passed");
});

test("sole source smoke verifies tenant entitlement overlay when fixture is present", async () => {
  const tenantCollection = {
    collection_id: "tenant:tenant_a:uploaded_math",
    license_scope: "tenant_private",
    official_curriculum_verified: false,
    publish_profiles: ["demo", "mvp", "prod"],
    trace: { raw_path_exposed: false },
  };
  const result = await smoke({
    listCollections: async () => ({ object: "list", data: [...collections, tenantCollection] }),
    knowledgeAccessConfig: {
      ...accessDefaults,
      enableTenant: true,
    },
    tenantOverlayFixture: {
      keyIdentity: {
        key_id: "key_tenant_a",
        key_type: "tenant",
        tenant_id: "tenant_a",
        user_id: null,
        scopes: ["knowledge:read"],
        metadata: {},
      },
      entitlements: [
        {
          collection_id: tenantCollection.collection_id,
          tenant_id: "tenant_a",
          user_id: null,
          enabled: true,
          access_level: "read",
          source_type: "tenant_uploaded",
        },
      ],
      expected_collection_id: tenantCollection.collection_id,
    },
  }).run();

  assert.equal(result.status, "ok");
  assert.equal(result.checks.tenant_overlay_access, "passed");
});

test("sole source smoke requires mvp retrieval result when approved normalized docs exist", async () => {
  const result = await smoke({
    listArtifacts: async () => ({ object: "list", data: [normalizedArtifact] }),
  }).run();

  assert.equal(result.status, "failed");
  assert.equal(result.failed_check, "retrieve_mvp");
  assert.equal(result.reason, "retrieval_profile_has_no_results");
});

test("sole source smoke accepts Marble result for mvp", async () => {
  const result = await smoke({
    listArtifacts: async () => ({ object: "list", data: [normalizedArtifact] }),
    retrieve: async ({ profile }) =>
      profile === "mvp" || profile === "prod"
        ? retrievalResult("mvp", {
            results: [
              {
                result_id: `retrieval:marble:mt_fraction_equivalence:${profile}`,
                collection_id: "marble",
                source_ref: { collection_id: "marble", source: "marble", topic_id: "mt_fraction_equivalence" },
                title: "Fraction equivalence",
                text: "Equivalent fractions represent the same value.",
                score: 11,
                license_scope: "open_educational_source",
                artifact_id: normalizedArtifact.artifact_id,
                checksum_sha256: normalizedArtifact.checksum_sha256,
              },
            ],
            profile,
            trace: {
              ...retrievalResult(profile).trace,
              artifact_ids: [normalizedArtifact.artifact_id],
            },
          })
        : retrievalResult(profile),
  }).run();

  assert.equal(result.status, "ok");
  assert.equal(result.checks.retrieve_mvp, "passed");
  assert.equal(result.checks.retrieve_prod, "passed");
});

test("sole source smoke requires prod retrieval result when approved normalized docs exist", async () => {
  const result = await smoke({
    listArtifacts: async () => ({
      object: "list",
      data: [
        {
          ...normalizedArtifact,
          artifact_id: "source-artifact:learning_commons:normalized_documents:sha256:docs",
          metadata: {
            collection_id: "learning_commons",
            license_scope: "open_educational_source",
          },
        },
      ],
    }),
    retrieve: async ({ profile }) =>
      profile === "mvp"
        ? retrievalResult("mvp", {
            results: [
              {
                result_id: "retrieval:marble:mt_fraction_equivalence",
                collection_id: "marble",
                source_ref: { collection_id: "marble", source: "marble", topic_id: "mt_fraction_equivalence" },
                title: "Fraction equivalence",
                text: "Equivalent fractions represent the same value.",
                score: 11,
                license_scope: "open_educational_source",
                artifact_id: normalizedArtifact.artifact_id,
                checksum_sha256: normalizedArtifact.checksum_sha256,
              },
            ],
          })
        : retrievalResult(profile),
  }).run();

  assert.equal(result.status, "failed");
  assert.equal(result.failed_check, "retrieve_prod");
  assert.equal(result.reason, "retrieval_profile_has_no_results");
});

test("sole source smoke accepts Learning Commons result for prod", async () => {
  const learningCommonsArtifact = {
    ...normalizedArtifact,
    artifact_id: "source-artifact:learning_commons:normalized_documents:sha256:docs",
    metadata: {
      collection_id: "learning_commons",
      license_scope: "open_educational_source",
    },
  };
  const result = await smoke({
    listArtifacts: async () => ({ object: "list", data: [normalizedArtifact, learningCommonsArtifact] }),
    retrieve: async ({ profile }) => {
      if (profile === "mvp") {
        return retrievalResult("mvp", {
          results: [
            {
              result_id: "retrieval:marble:mt_fraction_equivalence",
              collection_id: "marble",
              source_ref: { collection_id: "marble", source: "marble", topic_id: "mt_fraction_equivalence" },
              title: "Fraction equivalence",
              text: "Equivalent fractions represent the same value.",
              score: 11,
              license_scope: "open_educational_source",
              artifact_id: normalizedArtifact.artifact_id,
              checksum_sha256: normalizedArtifact.checksum_sha256,
            },
          ],
        });
      }
      if (profile === "prod") {
        return retrievalResult("prod", {
          results: [
            {
              result_id: "retrieval:learning_commons:lc_area_model",
              collection_id: "learning_commons",
              source_ref: { collection_id: "learning_commons", source: "learning_commons", topic_id: "lc_area_model" },
              title: "Area model",
              text: "Area model",
              score: 11,
              license_scope: "open_educational_source",
              artifact_id: learningCommonsArtifact.artifact_id,
              checksum_sha256: learningCommonsArtifact.checksum_sha256,
            },
          ],
        });
      }
      return retrievalResult(profile);
    },
  }).run();

  assert.equal(result.status, "ok");
  assert.equal(result.checks.retrieve_mvp, "passed");
  assert.equal(result.checks.retrieve_prod, "passed");
});

test("sole source smoke reports failed_check on source collection failure", async () => {
  const result = await smoke({
    listCollections: async () => {
      throw new Error("database unavailable");
    },
  }).run();

  assert.equal(result.status, "failed");
  assert.equal(result.failed_check, "source_collections");
  assert.equal(result.reason, "check_threw");
});

test("sole source smoke rejects mvp runtime containing demo-only K12", async () => {
  const result = await smoke({
    getLatestRuntimeIndex: async ({ profile }) =>
      profile === "mvp"
        ? runtimeIndex("mvp", {
            index: {
              profile: "mvp",
              sources: [{ collection_id: "k12_kgraph_full", license_scope: "non_commercial_demo_only" }],
              topics: [],
            },
          })
        : runtimeIndex(profile),
  }).run();

  assert.equal(result.status, "failed");
  assert.equal(result.failed_check, "runtime_index_mvp");
  assert.equal(result.reason, "demo_only_source_present");
});

test("sole source smoke verifies topic candidates do not expose raw path", async () => {
  const result = await smoke({
    exportTopicCandidates: async () => ({
      ...topicCandidateExport,
      trace: { raw_path_exposed: true },
    }),
  }).run();

  assert.equal(result.status, "failed");
  assert.equal(result.failed_check, "topic_candidates_export");
  assert.equal(result.reason, "raw_path_exposed");
});

test("sole source smoke verifies retrieve response has artifact checksum license and profile trace", async () => {
  const result = await smoke({
    retrieve: async ({ profile }) =>
      profile === "demo"
        ? retrievalResult("demo", {
            results: [
              {
                result_id: "retrieval:k12_kgraph_full:k12_topic",
                collection_id: "k12_kgraph_full",
                source_ref: { collection_id: "k12_kgraph_full", topic_id: "book" },
                title: "Book",
                text: "Book",
                score: 11,
                license_scope: "non_commercial_demo_only",
                artifact_id: "topic-candidates:k12_kgraph_full:demo:sha256:k12",
              },
            ],
          })
        : retrievalResult(profile),
  }).run();

  assert.equal(result.status, "failed");
  assert.equal(result.failed_check, "retrieve_demo");
  assert.equal(result.reason, "retrieval_result_missing_provenance");
});
