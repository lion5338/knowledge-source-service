import assert from "node:assert/strict";
import test from "node:test";

import { resolveKnowledgeAccess } from "../src/lib/knowledge-access/knowledge-access-resolver.js";

const collections = [
  {
    collection_id: "k12_kgraph_full",
    license_scope: "non_commercial_demo_only",
  },
  {
    collection_id: "marble",
    license_scope: "open_educational_source",
  },
  {
    collection_id: "learning_commons",
    license_scope: "open_educational_source",
  },
  {
    collection_id: "tenant:tenant_123:uploaded_textbook_abc",
    license_scope: "tenant_private",
  },
];

const defaultConfig = {
  enableTenant: false,
  enableK12: false,
  defaultKnowledge: ["marble", "learning_commons"],
  defaultCollectionIds: ["marble", "learning_commons"],
};

const tenantConfig = {
  ...defaultConfig,
  enableTenant: true,
};

const k12Config = {
  enableTenant: false,
  enableK12: true,
  defaultKnowledge: ["marble", "learning_commons"],
  defaultCollectionIds: ["marble", "learning_commons", "k12_kgraph_full"],
};

const keyIdentity = {
  key_id: "key_123",
  key_type: "tenant",
  tenant_id: "tenant_123",
  user_id: "user_123",
  scopes: ["knowledge:read"],
};

test("ENABLE_TENANT=false returns default collections only", () => {
  const access = resolveKnowledgeAccess({ config: defaultConfig, collections });

  assert.equal(access.access_mode, "default_only");
  assert.equal(access.tenant_enabled, false);
  assert.equal(access.tenant_id, null);
  assert.equal(access.user_id, null);
  assert.deepEqual(access.default_collection_ids, ["learning_commons", "marble"]);
  assert.deepEqual(access.tenant_collection_ids, []);
  assert.deepEqual(access.effective_collection_ids, ["learning_commons", "marble"]);
  assert.deepEqual(access.blocked_collection_ids, ["k12_kgraph_full"]);
  assert.deepEqual(
    access.policy_decisions.map(({ collection_id, allowed, reason_code }) => ({ collection_id, allowed, reason_code })),
    [
      { collection_id: "k12_kgraph_full", allowed: false, reason_code: "k12_disabled_by_env" },
      { collection_id: "learning_commons", allowed: true, reason_code: "default_allowed" },
      { collection_id: "marble", allowed: true, reason_code: "default_allowed" },
    ],
  );
  assert.deepEqual(access.trace, {
    default_knowledge: "marble;learning_commons",
    enable_tenant: false,
    enable_k12: false,
    fallback_used: false,
    identity_status: "tenant_disabled",
  });
});

test("ENABLE_TENANT=false ignores tenant key lookup and entitlements", () => {
  const access = resolveKnowledgeAccess({
    config: defaultConfig,
    collections,
    keyIdentity,
    tenantEntitlements: [
      {
        collection_id: "tenant:tenant_123:uploaded_textbook_abc",
        enabled: true,
        tenant_id: "tenant_123",
        user_id: "user_123",
      },
      {
        collection_id: "k12_kgraph_full",
        enabled: true,
        tenant_id: "tenant_123",
      },
    ],
  });

  assert.equal(access.access_mode, "default_only");
  assert.deepEqual(access.tenant_collection_ids, []);
  assert.deepEqual(access.effective_collection_ids, ["learning_commons", "marble"]);
  assert.equal(
    access.policy_decisions.some((decision) => decision.collection_id === "tenant:tenant_123:uploaded_textbook_abc"),
    false,
  );
});

test("ENABLE_TENANT=true with missing identity falls back to default collections", () => {
  const access = resolveKnowledgeAccess({ config: tenantConfig, collections });

  assert.equal(access.access_mode, "default_only");
  assert.deepEqual(access.effective_collection_ids, ["learning_commons", "marble"]);
  assert.equal(access.trace.fallback_used, true);
  assert.equal(access.trace.identity_status, "tenant_identity_missing");
});

test("tenant with no entitlements falls back to DEFAULT_KNOWLEDGE", () => {
  const access = resolveKnowledgeAccess({
    config: tenantConfig,
    collections,
    keyIdentity,
    tenantEntitlements: [],
  });

  assert.equal(access.access_mode, "tenant_fallback_default");
  assert.equal(access.tenant_id, "tenant_123");
  assert.equal(access.user_id, "user_123");
  assert.deepEqual(access.effective_collection_ids, ["learning_commons", "marble"]);
  assert.equal(access.trace.fallback_used, true);
  assert.equal(access.trace.identity_status, "tenant_identity_resolved");
});

test("ENABLE_TENANT=true overlays tenant entitlements on defaults", () => {
  const access = resolveKnowledgeAccess({
    config: tenantConfig,
    collections,
    keyIdentity,
    tenantEntitlements: [
      {
        collection_id: "tenant:tenant_123:uploaded_textbook_abc",
        enabled: true,
        access_level: "read",
        source_type: "tenant_uploaded",
        tenant_id: "tenant_123",
        user_id: "user_123",
      },
    ],
  });

  assert.equal(access.access_mode, "tenant_overlay");
  assert.deepEqual(access.tenant_collection_ids, ["tenant:tenant_123:uploaded_textbook_abc"]);
  assert.deepEqual(access.effective_collection_ids, [
    "learning_commons",
    "marble",
    "tenant:tenant_123:uploaded_textbook_abc",
  ]);
  assert.equal(
    access.policy_decisions.find((decision) => decision.collection_id === "tenant:tenant_123:uploaded_textbook_abc")
      .reason_code,
    "tenant_entitled",
  );
});

test("ENABLE_K12=false blocks K12 even when entitlement grants K12", () => {
  const access = resolveKnowledgeAccess({
    config: tenantConfig,
    collections,
    keyIdentity,
    tenantEntitlements: [
      {
        collection_id: "k12_kgraph_full",
        enabled: true,
        access_level: "read",
        source_type: "shared",
        tenant_id: "tenant_123",
      },
    ],
  });

  assert.equal(access.effective_collection_ids.includes("k12_kgraph_full"), false);
  assert.deepEqual(access.blocked_collection_ids, ["k12_kgraph_full"]);
  assert.equal(
    access.policy_decisions.find((decision) => decision.collection_id === "k12_kgraph_full").reason_code,
    "k12_disabled_by_env",
  );
});

test("ENABLE_K12=true allows K12 and marks non_commercial_demo_only in trace", () => {
  const access = resolveKnowledgeAccess({ config: k12Config, collections });

  assert.deepEqual(access.effective_collection_ids, ["k12_kgraph_full", "learning_commons", "marble"]);
  const k12Decision = access.policy_decisions.find((decision) => decision.collection_id === "k12_kgraph_full");
  assert.equal(k12Decision.allowed, true);
  assert.equal(k12Decision.reason_code, "default_allowed");
  assert.equal(k12Decision.license_scope, "non_commercial_demo_only");
});

test("requested collection ids can only narrow effective access", () => {
  const access = resolveKnowledgeAccess({
    config: tenantConfig,
    collections,
    keyIdentity,
    tenantEntitlements: [
      {
        collection_id: "tenant:tenant_123:uploaded_textbook_abc",
        enabled: true,
        tenant_id: "tenant_123",
      },
    ],
    requestedCollectionIds: ["marble", "k12_kgraph_full", "unknown_collection"],
  });

  assert.deepEqual(access.requested_collection_ids, ["k12_kgraph_full", "marble", "unknown_collection"]);
  assert.deepEqual(access.tenant_collection_ids, ["tenant:tenant_123:uploaded_textbook_abc"]);
  assert.deepEqual(access.effective_collection_ids, ["marble"]);
  assert.deepEqual(access.blocked_collection_ids, ["k12_kgraph_full", "unknown_collection"]);
  assert.equal(
    access.policy_decisions.find((decision) => decision.collection_id === "unknown_collection").reason_code,
    "collection_unknown",
  );
});

test("disabled entitlements are not added to effective access", () => {
  const access = resolveKnowledgeAccess({
    config: tenantConfig,
    collections,
    keyIdentity,
    tenantEntitlements: [
      {
        collection_id: "tenant:tenant_123:uploaded_textbook_abc",
        enabled: false,
        tenant_id: "tenant_123",
      },
    ],
  });

  assert.equal(access.access_mode, "tenant_fallback_default");
  assert.deepEqual(access.tenant_collection_ids, []);
  assert.equal(
    access.policy_decisions.find((decision) => decision.collection_id === "tenant:tenant_123:uploaded_textbook_abc")
      .reason_code,
    "entitlement_disabled",
  );
});

test("resolver output is deterministic and sorted", () => {
  const access = resolveKnowledgeAccess({
    config: {
      enableTenant: true,
      enableK12: true,
      defaultKnowledge: ["marble", "k12_kgraph_full", "learning_commons"],
      defaultCollectionIds: ["marble", "k12_kgraph_full", "learning_commons"],
    },
    collections: [...collections].reverse(),
    keyIdentity,
    tenantEntitlements: [
      {
        collection_id: "tenant:tenant_123:uploaded_textbook_abc",
        enabled: true,
        tenant_id: "tenant_123",
      },
      {
        collection_id: "learning_commons",
        enabled: true,
        tenant_id: "tenant_123",
      },
    ],
  });

  assert.deepEqual(access.default_collection_ids, ["k12_kgraph_full", "learning_commons", "marble"]);
  assert.deepEqual(access.tenant_collection_ids, ["learning_commons", "tenant:tenant_123:uploaded_textbook_abc"]);
  assert.deepEqual(access.effective_collection_ids, [
    "k12_kgraph_full",
    "learning_commons",
    "marble",
    "tenant:tenant_123:uploaded_textbook_abc",
  ]);
  assert.deepEqual(
    access.policy_decisions.map((decision) => decision.collection_id),
    ["k12_kgraph_full", "learning_commons", "marble", "tenant:tenant_123:uploaded_textbook_abc"],
  );
});
