import { HttpError } from "../http/errors.js";

export const runtimeProfiles = ["demo", "mvp", "prod"];

function profileError(message, code, details = null) {
  return new HttpError(message, {
    status: 400,
    code,
    type: "bad_request",
    details,
  });
}

export function resolveRuntimeProfile(inputProfile = "demo") {
  const profile = String(inputProfile || "demo").trim();
  if (!runtimeProfiles.includes(profile)) {
    throw profileError(`Invalid runtime profile: ${profile}`, "invalid_runtime_profile", {
      profile,
      allowed_profiles: runtimeProfiles,
    });
  }
  return profile;
}

export function evaluateCollectionForProfile(collection, inputProfile, usage = "runtime") {
  const profile = resolveRuntimeProfile(inputProfile);
  const allowedProfiles = Array.isArray(collection.publish_profiles) ? collection.publish_profiles : [];
  const allowed = allowedProfiles.includes(profile);
  const reasonCode = allowed
    ? "profile_allowed"
    : collection.license_scope === "non_commercial_demo_only"
      ? "demo_only_source_blocked"
      : "profile_not_allowed_by_collection";
  return {
    allowed,
    profile,
    usage,
    collection_id: collection.collection_id,
    license_scope: collection.license_scope ?? null,
    allowed_profiles: allowedProfiles,
    reason_code: reasonCode,
  };
}

export function assertCollectionAllowedForProfile(collection, inputProfile, usage = "runtime") {
  const decision = evaluateCollectionForProfile(collection, inputProfile, usage);
  if (!decision.allowed) {
    throw profileError(
      `Collection ${decision.collection_id} is not allowed for runtime profile ${decision.profile}.`,
      decision.reason_code,
      decision,
    );
  }
  return decision;
}

export function summarizeProfileDecision(decisions = []) {
  return {
    source_collection_ids: decisions.filter((decision) => decision.allowed).map((decision) => decision.collection_id).sort(),
    blocked_collection_ids: decisions.filter((decision) => !decision.allowed).map((decision) => decision.collection_id).sort(),
    policy_decisions: decisions,
  };
}
