import assert from "node:assert/strict";
import test from "node:test";

import {
  getKnowledgeAccessConfig,
  parseDefaultKnowledge,
  resolveDefaultCollectionIds,
} from "../src/lib/knowledge-access/default-knowledge.js";

test("DEFAULT_KNOWLEDGE parses semicolon separated collection ids", () => {
  assert.deepEqual(parseDefaultKnowledge("marble;learning_commons"), ["marble", "learning_commons"]);
});

test("DEFAULT_KNOWLEDGE trims whitespace and removes duplicates while preserving order", () => {
  assert.deepEqual(parseDefaultKnowledge(" marble ; learning_commons ; marble "), ["marble", "learning_commons"]);
});

test("DEFAULT_KNOWLEDGE rejects display names that are not collection ids", () => {
  assert.throws(
    () => parseDefaultKnowledge("Marble;Learning Commons"),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.code, "invalid_default_knowledge_collection_id");
      assert.deepEqual(error.details.allowed_collection_ids, ["k12_kgraph_full", "learning_commons", "marble"]);
      return true;
    },
  );
});

test("empty DEFAULT_KNOWLEDGE falls back to marble and learning_commons", () => {
  assert.deepEqual(parseDefaultKnowledge(""), ["marble", "learning_commons"]);
  assert.deepEqual(parseDefaultKnowledge(undefined), ["marble", "learning_commons"]);
});

test("ENABLE_K12=false does not include k12_kgraph_full", () => {
  assert.deepEqual(
    resolveDefaultCollectionIds({
      enableK12: false,
      defaultKnowledge: ["marble", "learning_commons", "k12_kgraph_full"],
    }),
    ["marble", "learning_commons"],
  );
});

test("ENABLE_K12=true appends k12_kgraph_full once", () => {
  assert.deepEqual(
    resolveDefaultCollectionIds({
      enableK12: true,
      defaultKnowledge: ["marble", "learning_commons"],
    }),
    ["marble", "learning_commons", "k12_kgraph_full"],
  );
  assert.deepEqual(
    resolveDefaultCollectionIds({
      enableK12: true,
      defaultKnowledge: ["k12_kgraph_full", "marble"],
    }),
    ["marble", "k12_kgraph_full"],
  );
});

test("getKnowledgeAccessConfig uses conservative production defaults", () => {
  assert.deepEqual(
    getKnowledgeAccessConfig({
      ENABLE_TENANT: undefined,
      ENABLE_K12: undefined,
      DEFAULT_KNOWLEDGE: undefined,
    }),
    {
      enableTenant: false,
      enableK12: false,
      defaultKnowledge: ["marble", "learning_commons"],
      defaultCollectionIds: ["marble", "learning_commons"],
    },
  );
});

test("getKnowledgeAccessConfig accepts explicit tenant and K12 env flags", () => {
  assert.deepEqual(
    getKnowledgeAccessConfig({
      ENABLE_TENANT: "true",
      ENABLE_K12: "true",
      DEFAULT_KNOWLEDGE: "marble;learning_commons",
    }),
    {
      enableTenant: true,
      enableK12: true,
      defaultKnowledge: ["marble", "learning_commons"],
      defaultCollectionIds: ["marble", "learning_commons", "k12_kgraph_full"],
    },
  );
});

test("getKnowledgeAccessConfig rejects invalid boolean env values", () => {
  assert.throws(
    () =>
      getKnowledgeAccessConfig({
        ENABLE_TENANT: "sometimes",
        ENABLE_K12: "false",
        DEFAULT_KNOWLEDGE: "marble",
      }),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.code, "invalid_knowledge_access_boolean");
      assert.equal(error.details.name, "ENABLE_TENANT");
      return true;
    },
  );
});
