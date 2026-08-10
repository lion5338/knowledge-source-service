import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCollectionAllowedForProfile,
  evaluateCollectionForProfile,
  resolveRuntimeProfile,
  summarizeProfileDecision,
} from "../src/lib/runtime-profile/runtime-profile-policy.js";

const k12Collection = {
  collection_id: "k12_kgraph_full",
  publish_profiles: ["demo"],
  license_scope: "non_commercial_demo_only",
};

test("resolveRuntimeProfile accepts demo mvp prod and defaults to demo", () => {
  assert.equal(resolveRuntimeProfile(), "demo");
  assert.equal(resolveRuntimeProfile(""), "demo");
  assert.equal(resolveRuntimeProfile("demo"), "demo");
  assert.equal(resolveRuntimeProfile("mvp"), "mvp");
  assert.equal(resolveRuntimeProfile("prod"), "prod");
});

test("resolveRuntimeProfile rejects invalid profile", () => {
  assert.throws(
    () => resolveRuntimeProfile("invalid"),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.code, "invalid_runtime_profile");
      return true;
    },
  );
});

test("K12 full is allowed for demo runtime", () => {
  const decision = assertCollectionAllowedForProfile(k12Collection, "demo", "runtime_index");

  assert.deepEqual(decision, {
    allowed: true,
    profile: "demo",
    usage: "runtime_index",
    collection_id: "k12_kgraph_full",
    license_scope: "non_commercial_demo_only",
    allowed_profiles: ["demo"],
    reason_code: "profile_allowed",
  });
});

test("K12 full is blocked for mvp/prod runtime", () => {
  for (const profile of ["mvp", "prod"]) {
    assert.throws(
      () => assertCollectionAllowedForProfile(k12Collection, profile, "runtime_index"),
      (error) => {
        assert.equal(error.status, 400);
        assert.equal(error.code, "demo_only_source_blocked");
        assert.equal(error.details.collection_id, "k12_kgraph_full");
        assert.equal(error.details.profile, profile);
        return true;
      },
    );
  }
});

test("policy decision includes license_scope and reason_code", () => {
  assert.deepEqual(evaluateCollectionForProfile(k12Collection, "prod", "runtime_index"), {
    allowed: false,
    profile: "prod",
    usage: "runtime_index",
    collection_id: "k12_kgraph_full",
    license_scope: "non_commercial_demo_only",
    allowed_profiles: ["demo"],
    reason_code: "demo_only_source_blocked",
  });
});

test("summarizeProfileDecision reports included and blocked collection ids", () => {
  const decisions = [
    evaluateCollectionForProfile(k12Collection, "demo", "runtime_index"),
    evaluateCollectionForProfile(
      {
        collection_id: "marble",
        publish_profiles: ["demo", "mvp", "prod"],
        license_scope: "open_educational_source",
      },
      "demo",
      "runtime_index",
    ),
  ];

  assert.deepEqual(summarizeProfileDecision(decisions), {
    source_collection_ids: ["k12_kgraph_full", "marble"],
    blocked_collection_ids: [],
    policy_decisions: decisions,
  });
});
