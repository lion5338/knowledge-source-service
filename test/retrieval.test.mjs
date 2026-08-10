import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRetrievalIndex,
  createKnowledgeRetriever,
  createRetrievalIndexBuilder,
  resolveTenantSourcePolicy,
  retrieveFromIndex,
} from "../src/lib/retrieval/retrieval.js";

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

const normalizedDocumentsArtifact = {
  artifact_id: "source-artifact:marble:normalized_documents:sha256:docs",
  checksum_sha256: "docs",
  collection_id: "marble",
  artifact_type: "normalized_documents",
  schema_version: "source_documents.v1",
  license_scope: "open_educational_source",
  records: [
    {
      id: "marble_fraction_equivalence",
      title: "Fraction equivalence",
      subject: "mathematics",
      learning_stage: "elementary",
      text: "Equivalent fractions represent the same value.",
      source_ref: { collection_id: "marble", source: "marble", topic_id: "marble_fraction_equivalence" },
      license_scope: "open_educational_source",
    },
    {
      id: "marble_rectangle_area",
      title: "Rectangle area",
      subject: "mathematics",
      learning_stage: "elementary",
      text: "Area of a rectangle is length times width.",
      source_ref: { collection_id: "marble", source: "marble", topic_id: "marble_rectangle_area" },
      license_scope: "open_educational_source",
    },
  ],
};

const k12CandidateArtifact = {
  artifact_id: "topic-candidates:k12_kgraph_full:demo:sha256:k12",
  checksum_sha256: "k12",
  collection_id: "k12_kgraph_full",
  profile: "demo",
  artifact_type: "topic_candidates",
  license_scope: "non_commercial_demo_only",
  data: [
    {
      topic_key: "k12_mathematics_junior_high_math_7a_rjb_cpt41",
      label: "linear equation in one unknown",
      aliases: ["one-variable linear equation"],
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

function retriever(overrides = {}) {
  return createKnowledgeRetriever({
    listCollections: async () => ({ data: collections }),
    findRetrievalIndexArtifact: async () => null,
    findRetrievalSourceArtifacts: async ({ profile }) =>
      profile === "demo"
        ? [
            { artifact_id: normalizedDocumentsArtifact.artifact_id, storage_path: "marble-docs.json", checksum_sha256: "docs" },
            { artifact_id: k12CandidateArtifact.artifact_id, storage_path: "k12-candidates.json", checksum_sha256: "k12" },
          ]
        : [{ artifact_id: normalizedDocumentsArtifact.artifact_id, storage_path: "marble-docs.json", checksum_sha256: "docs" }],
    readArtifactJson: async (storagePath) => {
      if (storagePath === "marble-docs.json") return normalizedDocumentsArtifact;
      if (storagePath === "k12-candidates.json") return k12CandidateArtifact;
      throw new Error(`Unexpected storage path: ${storagePath}`);
    },
    getConfig: () => ({
      knowledgeAccess: {
        enableTenant: false,
        enableK12: false,
        defaultKnowledge: ["marble", "learning_commons"],
        defaultCollectionIds: ["marble", "learning_commons"],
      },
    }),
    ...overrides,
  });
}

test("retrieve returns lexical matches from normalized documents", async () => {
  const result = await retriever().retrieve({ profile: "mvp", query: "fraction equivalence" });

  assert.equal(result.object, "retrieval_result");
  assert.equal(result.results[0].result_id, "retrieval:marble:marble_fraction_equivalence");
  assert.equal(result.results[0].artifact_id, normalizedDocumentsArtifact.artifact_id);
  assert.equal(result.results[0].license_scope, "open_educational_source");
});

test("retrieve filters by subject", async () => {
  const result = await retriever().retrieve({ profile: "mvp", query: "fraction", subject: "science" });

  assert.deepEqual(result.results, []);
  assert.equal(result.trace.filters.subject, "science");
});

test("retrieve filters by learning_stage", async () => {
  const result = await retriever().retrieve({ profile: "mvp", query: "fraction", learning_stage: "junior_high" });

  assert.deepEqual(result.results, []);
});

test("retrieve clamps limit", async () => {
  const result = await retriever().retrieve({ profile: "mvp", query: "area fraction", limit: 999 });

  assert.equal(result.trace.limit, 20);
});

test("retrieve returns empty result with ok trace for no match", async () => {
  const result = await retriever().retrieve({ profile: "mvp", query: "photosynthesis" });

  assert.deepEqual(result.results, []);
  assert.equal(result.trace.status, "ok");
});

test("retrieve validates missing query", async () => {
  await assert.rejects(
    () => retriever().retrieve({ profile: "mvp", query: "  " }),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.code, "retrieval_query_required");
      return true;
    },
  );
});

test("retrieve allows missing profile and uses access scope", async () => {
  const result = await retriever().retrieve({ query: "fraction" });

  assert.equal(result.profile, "prod");
  assert.equal(result.results[0].collection_id, "marble");
  assert.deepEqual(result.trace.access.effective_collection_ids, ["marble"]);
});

test("mvp retrieve does not return K12 demo-only results", async () => {
  const result = await retriever().retrieve({ profile: "mvp", query: "linear equation" });

  assert.deepEqual(result.results, []);
  assert.deepEqual(result.trace.blocked_collections, ["k12_kgraph_full"]);
});

test("prod retrieve does not return K12 demo-only results", async () => {
  const result = await retriever().retrieve({ profile: "prod", query: "linear equation" });

  assert.deepEqual(result.results, []);
  assert.deepEqual(result.trace.blocked_collections, ["k12_kgraph_full"]);
});

test("demo retrieve may return K12 result only when K12 access is enabled", async () => {
  const result = await retriever({
    getConfig: () => ({
      knowledgeAccess: {
        enableTenant: false,
        enableK12: true,
        defaultKnowledge: ["marble"],
        defaultCollectionIds: ["marble", "k12_kgraph_full"],
      },
    }),
  }).retrieve({ profile: "demo", query: "linear equation" });

  assert.equal(result.results[0].collection_id, "k12_kgraph_full");
  assert.equal(result.results[0].license_scope, "non_commercial_demo_only");
});

test("demo retrieve hard-blocks K12 when ENABLE_K12 is false", async () => {
  const result = await retriever().retrieve({ profile: "demo", query: "linear equation" });

  assert.deepEqual(result.results, []);
  assert.deepEqual(result.trace.access.blocked_collection_ids, ["k12_kgraph_full"]);
});

test("tenant key can overlay a tenant collection into retrieval scope", async () => {
  const tenantCollection = {
    collection_id: "tenant:tenant_a:uploaded_math",
    source_ids: ["tenant_uploaded_math"],
    publish_profiles: ["demo", "mvp", "prod"],
    license_scope: "tenant_private",
  };
  const tenantArtifact = {
    artifact_id: "source-artifact:tenant:tenant_a:uploaded_math:normalized_documents:sha256:docs",
    checksum_sha256: "tenant-docs",
    collection_id: "tenant:tenant_a:uploaded_math",
    artifact_type: "normalized_documents",
    schema_version: "source_documents.v1",
    license_scope: "tenant_private",
    records: [
      {
        id: "tenant_linear_equation",
        title: "Tenant linear equation",
        subject: "mathematics",
        learning_stage: "junior_high",
        text: "Tenant uploaded lesson about linear equation.",
        source_ref: {
          collection_id: "tenant:tenant_a:uploaded_math",
          source: "tenant_uploaded_math",
          topic_id: "tenant_linear_equation",
        },
        license_scope: "tenant_private",
      },
    ],
  };
  const result = await retriever({
    listCollections: async () => ({ data: [...collections, tenantCollection] }),
    findRetrievalSourceArtifacts: async ({ collectionIds }) =>
      collectionIds.includes(tenantCollection.collection_id)
        ? [{ artifact_id: tenantArtifact.artifact_id, storage_path: "tenant-docs.json", checksum_sha256: "tenant-docs" }]
        : [],
    readArtifactJson: async (storagePath) => {
      if (storagePath === "tenant-docs.json") return tenantArtifact;
      return normalizedDocumentsArtifact;
    },
    getConfig: () => ({
      knowledgeAccess: {
        enableTenant: true,
        enableK12: false,
        defaultKnowledge: ["marble", "learning_commons"],
        defaultCollectionIds: ["marble", "learning_commons"],
      },
    }),
    findTenantEntitlements: async () => [
      {
        collection_id: tenantCollection.collection_id,
        tenant_id: "tenant_a",
        user_id: null,
        enabled: true,
        access_level: "read",
        source_type: "tenant_upload",
      },
    ],
  }).retrieve({
    query: "linear equation",
    accessIdentity: {
      key_id: "key_tenant_a",
      key_type: "tenant",
      tenant_id: "tenant_a",
      user_id: null,
      scopes: ["knowledge:read"],
      metadata: {},
    },
  });

  assert.equal(result.results[0].collection_id, tenantCollection.collection_id);
  assert.equal(result.trace.access.access_mode, "tenant_overlay");
  assert.deepEqual(result.trace.access.tenant_collection_ids, [tenantCollection.collection_id]);
});

test("trace includes policy_decisions with reason_code", async () => {
  const result = await retriever().retrieve({ profile: "prod", query: "fraction" });

  assert.equal(
    result.trace.policy_decisions.some(
      (decision) => decision.collection_id === "k12_kgraph_full" && decision.reason_code === "demo_only_source_blocked",
    ),
    true,
  );
});

test("buildRetrievalIndex creates deterministic profile artifact", () => {
  const first = buildRetrievalIndex({
    profile: "mvp",
    collections,
    sourceArtifacts: [normalizedDocumentsArtifact],
  });
  const second = buildRetrievalIndex({
    profile: "mvp",
    collections,
    sourceArtifacts: [normalizedDocumentsArtifact],
  });

  assert.equal(first.artifact_id, second.artifact_id);
  assert.match(first.artifact_id, /^retrieval-index:mvp:sha256:[a-f0-9]{64}$/);
});

test("retrieveFromIndex returns same result as lexical normalized scan for fixture", () => {
  const index = buildRetrievalIndex({ profile: "mvp", collections, sourceArtifacts: [normalizedDocumentsArtifact] });
  const result = retrieveFromIndex(index, { query: "fraction equivalence", limit: 20 });

  assert.equal(result[0].result_id, "retrieval:marble:marble_fraction_equivalence");
});

test("retrieve response includes retrieval index artifact id", async () => {
  const index = buildRetrievalIndex({ profile: "mvp", collections, sourceArtifacts: [normalizedDocumentsArtifact] });
  const result = await retriever({
    findRetrievalIndexArtifact: async () => ({
      artifact_id: index.artifact_id,
      storage_path: "retrieval-index.json",
      checksum_sha256: index.checksum_sha256,
    }),
    readArtifactJson: async (storagePath) => {
      if (storagePath === "retrieval-index.json") return index;
      return normalizedDocumentsArtifact;
    },
  }).retrieve({ profile: "mvp", query: "fraction" });

  assert.equal(result.trace.retrieval_mode, "retrieval_index");
  assert.equal(result.trace.retrieval_index_artifact_id, index.artifact_id);
});

test("retrieval index excludes blocked profile sources", () => {
  const index = buildRetrievalIndex({
    profile: "prod",
    collections,
    sourceArtifacts: [normalizedDocumentsArtifact, k12CandidateArtifact],
  });

  assert.equal(index.documents.some((document) => document.collection_id === "k12_kgraph_full"), false);
  assert.deepEqual(index.profile_trace.blocked_collection_ids, ["k12_kgraph_full"]);
});

test("retrieve hard-gates stale retrieval index documents with current profile policy", async () => {
  const staleIndex = {
    artifact_id: "retrieval-index:prod:sha256:stale",
    checksum_sha256: "stale",
    artifact_type: "retrieval_index",
    profile: "prod",
    schema_version: "retrieval_index.v1",
    source_artifact_ids: [k12CandidateArtifact.artifact_id],
    documents: [
      {
        document_id: "k12_kgraph_full:linear",
        collection_id: "k12_kgraph_full",
        source: "k12_dataset",
        source_ref: { collection_id: "k12_kgraph_full", source: "k12_dataset", topic_id: "linear" },
        subject: "mathematics",
        learning_stage: "junior_high",
        title: "linear equation",
        text: "linear equation",
        license_scope: "non_commercial_demo_only",
        artifact_id: k12CandidateArtifact.artifact_id,
        checksum_sha256: k12CandidateArtifact.checksum_sha256,
      },
    ],
  };
  const result = await retriever({
    findRetrievalIndexArtifact: async () => ({
      artifact_id: "retrieval-index:prod:latest",
      storage_path: "stale-index.json",
      checksum_sha256: "stale",
    }),
    readArtifactJson: async () => staleIndex,
  }).retrieve({ profile: "prod", query: "linear equation" });

  assert.deepEqual(result.results, []);
  assert.deepEqual(result.trace.blocked_collections, ["k12_kgraph_full"]);
});

test("latest alias points to content-addressed retrieval index", async () => {
  const writes = [];
  const builder = createRetrievalIndexBuilder({
    listCollections: async () => ({ data: collections }),
    findRetrievalSourceArtifacts: async () => [{ artifact_id: normalizedDocumentsArtifact.artifact_id, storage_path: "docs.json", checksum_sha256: "docs" }],
    readArtifactJson: async () => normalizedDocumentsArtifact,
    writeArtifact: async (index) => {
      writes.push(index);
      return { storage_path: `retrieval-index/${index.profile}.json`, checksum_sha256: index.checksum_sha256 };
    },
    withClient: async (callback) =>
      callback({
        query: async () => ({ rows: [] }),
      }),
  });

  const result = await builder.buildRetrievalIndexForProfile({ profile: "mvp", actor: "test" });

  assert.equal(result.alias.artifact_id, "retrieval-index:mvp:latest");
  assert.equal(result.alias.points_to_artifact_id, result.version.artifact_id);
  assert.equal(writes[0].profile, "mvp");
});

test("retrieve accepts tenant_id and records tenant trace", async () => {
  const result = await retriever().retrieve({ profile: "prod", query: "fraction", tenant_id: "tenant_a" });

  assert.deepEqual(result.trace.tenant, {
    tenant_id: "tenant_a",
    policy_status: "default_policy",
    allowed_collection_ids: [],
    blocked_collection_ids: [],
  });
});

test("default tenant policy does not grant extra sources", () => {
  assert.deepEqual(resolveTenantSourcePolicy({ tenantId: "tenant_a" }), {
    tenant_id: "tenant_a",
    policy_status: "default_policy",
    allowed_collection_ids: [],
    blocked_collection_ids: [],
  });
});

test("tenant policy blocks unknown tenant source by default", async () => {
  const result = await retriever().retrieve({
    profile: "prod",
    query: "linear equation",
    tenant_id: "tenant_a",
  });

  assert.deepEqual(result.results, []);
});
