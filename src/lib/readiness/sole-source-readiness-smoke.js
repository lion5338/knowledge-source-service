import { getServiceConfig } from "../config.js";
import { resolveKnowledgeAccess as defaultResolveKnowledgeAccess } from "../knowledge-access/knowledge-access-resolver.js";
import { createKnowledgeRetriever } from "../retrieval/retrieval.js";
import { getLatestRuntimeIndex, listArtifacts } from "../sources/sources.js";
import { listCollections } from "../source-collections/source-collections.js";
import { createTopicCandidateExporter } from "../topic-candidates/topic-candidate-export.js";

const requiredCollectionIds = ["k12_kgraph_full", "marble", "learning_commons"];
const runtimeProfiles = ["demo", "mvp", "prod"];
const demoOnlyCollectionId = "k12_kgraph_full";
const demoOnlyLicenseScope = "non_commercial_demo_only";
const openStatuses = new Set(["validated", "published"]);

function pass() {
  return { severity: "passed" };
}

function warning(reason, details = {}) {
  return { severity: "warning", reason, details };
}

function fail(reason, details = {}) {
  return { severity: "failed", reason, details };
}

function compactFailure({ checkName, result }) {
  return {
    status: "failed",
    failed_check: checkName,
    reason: result.reason,
    details: result.details ?? {},
  };
}

function hasPrivatePath(value) {
  if (typeof value !== "string") {
    return false;
  }
  return (
    /^[A-Za-z]:[\\/]/.test(value) ||
    /^\/(?:home|Users|var|tmp|mnt|workspace|app|srv|opt|c|d)\//i.test(value) ||
    value.includes("K12_DATASET_RAW_DIR") ||
    value.includes("storage/knowledge/raw")
  );
}

function findRawLeak(value, path = "$") {
  if (hasPrivatePath(value)) {
    return { path, value };
  }
  if (!value || typeof value !== "object") {
    return null;
  }
  if (value.raw_path_exposed === true) {
    return { path: `${path}.raw_path_exposed`, value: true };
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const leak = findRawLeak(item, `${path}[${index}]`);
      if (leak) {
        return leak;
      }
    }
    return null;
  }
  for (const [key, item] of Object.entries(value)) {
    const leak = findRawLeak(item, `${path}.${key}`);
    if (leak) {
      return leak;
    }
  }
  return null;
}

function assertNoRawLeak(value) {
  const leak = findRawLeak(value);
  if (leak) {
    return fail("raw_path_exposed", leak);
  }
  return pass();
}

function collectionById(collections) {
  return new Map(collections.map((collection) => [collection.collection_id, collection]));
}

function checkSourceCollections(response) {
  const rawLeak = assertNoRawLeak(response);
  if (rawLeak.severity === "failed") {
    return rawLeak;
  }
  const collections = response.data ?? [];
  const byId = collectionById(collections);
  const missing = requiredCollectionIds.filter((collectionId) => !byId.has(collectionId));
  if (missing.length) {
    return fail("source_collection_missing", { missing_collection_ids: missing });
  }
  const k12 = byId.get(demoOnlyCollectionId);
  if (k12.license_scope !== demoOnlyLicenseScope || k12.official_curriculum_verified !== false) {
    return fail("k12_profile_policy_invalid", {
      license_scope: k12.license_scope ?? null,
      official_curriculum_verified: k12.official_curriculum_verified ?? null,
    });
  }
  if (!Array.isArray(k12.publish_profiles) || k12.publish_profiles.length !== 1 || k12.publish_profiles[0] !== "demo") {
    return fail("k12_publish_profile_invalid", { publish_profiles: k12.publish_profiles ?? null });
  }
  return pass();
}

function checkNormalizedArtifacts(response) {
  const rawLeak = assertNoRawLeak(response);
  if (rawLeak.severity === "failed") {
    return rawLeak;
  }
  const artifacts = (response.data ?? []).filter(
    (artifact) => openStatuses.has(artifact.publish_status) && ["normalized_knowledge_graph", "normalized_documents"].includes(artifact.artifact_type),
  );
  if (!artifacts.length) {
    return fail("normalized_artifact_missing");
  }
  const missingProvenance = artifacts.find(
    (artifact) => !artifact.artifact_id || !artifact.checksum_sha256 || !(artifact.metadata?.collection_id ?? artifact.source),
  );
  if (missingProvenance) {
    return fail("normalized_artifact_missing_provenance", { artifact_id: missingProvenance.artifact_id ?? null });
  }
  return pass();
}

function checkTopicCandidateExport(response) {
  const rawLeak = assertNoRawLeak(response);
  if (rawLeak.severity === "failed") {
    return rawLeak;
  }
  if (!response.artifact_id || !response.checksum_sha256 || !response.license_scope || response.profile !== "demo") {
    return fail("topic_candidate_export_missing_provenance", {
      artifact_id: response.artifact_id ?? null,
      checksum_sha256: response.checksum_sha256 ?? null,
      license_scope: response.license_scope ?? null,
      profile: response.profile ?? null,
    });
  }
  if (response.trace?.raw_path_exposed === true) {
    return fail("raw_path_exposed", { path: "$.trace.raw_path_exposed", value: true });
  }
  return pass();
}

function runtimeIndexContainsDemoOnlySource(response) {
  const sources = response.index?.sources ?? [];
  const topics = response.index?.topics ?? [];
  return [...sources, ...topics].some(
    (item) => item.collection_id === demoOnlyCollectionId || item.license_scope === demoOnlyLicenseScope,
  );
}

function checkRuntimeIndex(response, profile) {
  const rawLeak = assertNoRawLeak(response);
  if (rawLeak.severity === "failed") {
    return rawLeak;
  }
  if (response.profile !== profile || !response.alias?.artifact_id || !response.alias?.checksum_sha256 || !response.profile_trace) {
    return fail("runtime_index_missing_provenance", {
      profile: response.profile ?? null,
      alias_artifact_id: response.alias?.artifact_id ?? null,
      checksum_sha256: response.alias?.checksum_sha256 ?? null,
      has_profile_trace: Boolean(response.profile_trace),
    });
  }
  if (profile !== "demo" && runtimeIndexContainsDemoOnlySource(response)) {
    return fail("demo_only_source_present", { profile });
  }
  return pass();
}

function retrievalResultMissingProvenance(result) {
  return (result.results ?? []).find(
    (item) => !item.source_ref || !item.artifact_id || !item.checksum_sha256 || !item.license_scope,
  );
}

function retrievalContainsDemoOnlySource(result) {
  return (result.results ?? []).some(
    (item) => item.collection_id === demoOnlyCollectionId || item.license_scope === demoOnlyLicenseScope,
  );
}

function checkRetrieval(response, profile, { requireResults = false } = {}) {
  const rawLeak = assertNoRawLeak(response);
  if (rawLeak.severity === "failed") {
    return rawLeak;
  }
  if (response.profile !== profile || !response.trace?.profile || !Array.isArray(response.trace?.policy_decisions)) {
    return fail("retrieval_missing_profile_trace", {
      profile: response.profile ?? null,
      trace_profile: response.trace?.profile ?? null,
    });
  }
  const missingProvenance = retrievalResultMissingProvenance(response);
  if (missingProvenance) {
    return fail("retrieval_result_missing_provenance", { result_id: missingProvenance.result_id ?? null });
  }
  if (profile !== "demo" && retrievalContainsDemoOnlySource(response)) {
    return fail("demo_only_source_present", { profile });
  }
  if (profile !== "demo" && (response.results ?? []).length === 0) {
    const result = requireResults ? fail : warning;
    return result("retrieval_profile_has_no_results", { profile });
  }
  return pass();
}

function approvedNormalizedDocumentCollections({ artifacts = [], collections = [], profile }) {
  const collectionById = new Map(collections.map((collection) => [collection.collection_id, collection]));
  return [
    ...new Set(
      artifacts
        .filter((artifact) => artifact.artifact_type === "normalized_documents")
        .filter((artifact) => openStatuses.has(artifact.publish_status))
        .map((artifact) => artifact.metadata?.collection_id ?? artifact.source)
        .filter(Boolean)
        .filter((collectionId) => {
          const collection = collectionById.get(collectionId);
          return (
            collection &&
            collection.license_scope !== demoOnlyLicenseScope &&
            Array.isArray(collection.publish_profiles) &&
            collection.publish_profiles.includes(profile)
          );
        }),
    ),
  ].sort();
}

function checkProfilePolicy({ runtimeIndexes, retrievals }) {
  for (const profile of ["mvp", "prod"]) {
    const runtimeIndex = runtimeIndexes[profile];
    const retrieval = retrievals[profile];
    const blockedInRuntime = runtimeIndex?.profile_trace?.blocked_collection_ids?.includes(demoOnlyCollectionId);
    const blockedInRetrieval = retrieval?.trace?.blocked_collections?.includes(demoOnlyCollectionId);
    if (!blockedInRuntime || !blockedInRetrieval) {
      return fail("demo_only_source_not_blocked", {
        profile,
        runtime_blocked: Boolean(blockedInRuntime),
        retrieval_blocked: Boolean(blockedInRetrieval),
      });
    }
  }
  return pass();
}

function checkDefaultAccessScope({ access, expectedDefaultCollectionIds, k12Enabled }) {
  const effective = new Set(access.effective_collection_ids ?? []);
  const missing = expectedDefaultCollectionIds.filter((collectionId) => !effective.has(collectionId));
  if (missing.length) {
    return fail("default_access_missing_collection", {
      missing_collection_ids: missing,
      effective_collection_ids: access.effective_collection_ids ?? [],
    });
  }
  if (!k12Enabled && effective.has(demoOnlyCollectionId)) {
    return fail("k12_enabled_without_env", {
      effective_collection_ids: access.effective_collection_ids ?? [],
    });
  }
  return pass();
}

function checkK12DisabledAccessGate({ access, k12Enabled, collections }) {
  if (k12Enabled || !collectionById(collections).has(demoOnlyCollectionId)) {
    return pass();
  }
  if ((access.effective_collection_ids ?? []).includes(demoOnlyCollectionId)) {
    return fail("k12_not_blocked_by_access_resolver", {
      effective_collection_ids: access.effective_collection_ids ?? [],
    });
  }
  if (!(access.blocked_collection_ids ?? []).includes(demoOnlyCollectionId)) {
    return fail("k12_block_missing_from_access_trace", {
      blocked_collection_ids: access.blocked_collection_ids ?? [],
    });
  }
  return pass();
}

function checkTenantFallbackAccess({ access, expectedDefaultCollectionIds }) {
  if (access.access_mode !== "tenant_fallback_default") {
    return fail("tenant_fallback_mode_invalid", { access_mode: access.access_mode });
  }
  return checkDefaultAccessScope({
    access,
    expectedDefaultCollectionIds,
    k12Enabled: access.trace?.enable_k12 === true,
  });
}

function checkTenantOverlayAccess({ access, expectedCollectionId }) {
  if (!expectedCollectionId) {
    return pass();
  }
  if (access.access_mode !== "tenant_overlay") {
    return fail("tenant_overlay_mode_invalid", { access_mode: access.access_mode });
  }
  if (!(access.effective_collection_ids ?? []).includes(expectedCollectionId)) {
    return fail("tenant_overlay_collection_missing", {
      expected_collection_id: expectedCollectionId,
      effective_collection_ids: access.effective_collection_ids ?? [],
    });
  }
  return pass();
}

function readinessRetrievalQuery(profile) {
  return profile === "demo" ? "Book" : "AI area";
}

function statusValue(result) {
  return result.severity;
}

export function createSoleSourceReadinessSmoke({
  listCollections: listSourceCollections = listCollections,
  listArtifacts: listKnowledgeArtifacts = listArtifacts,
  exportTopicCandidates = createTopicCandidateExporter().exportTopicCandidates,
  getLatestRuntimeIndex: getRuntimeIndex = getLatestRuntimeIndex,
  retrieve = createKnowledgeRetriever().retrieve,
  knowledgeAccessConfig = getServiceConfig().knowledgeAccess,
  resolveKnowledgeAccess = defaultResolveKnowledgeAccess,
  tenantFallbackIdentity = {
    key_id: "readiness:tenant_fallback",
    key_type: "tenant",
    tenant_id: "readiness_tenant",
    user_id: null,
    scopes: ["knowledge:read"],
    metadata: {},
  },
  tenantOverlayFixture = null,
} = {}) {
  async function runCheck(checkName, checks, warnings, action) {
    try {
      const result = await action();
      checks[checkName] = statusValue(result);
      if (result.severity === "warning") {
        warnings.push({ check: checkName, reason: result.reason, details: result.details ?? {} });
      }
      return result.severity === "failed" ? compactFailure({ checkName, result }) : null;
    } catch (error) {
      checks[checkName] = "failed";
      return compactFailure({
        checkName,
        result: fail("check_threw", {
          message: error.message,
          code: error.code ?? null,
        }),
      });
    }
  }

  async function run() {
    const checks = {};
    const warnings = [];
    const runtimeIndexes = {};
    const retrievals = {};
    let sourceCollectionResponse;
    let artifactResponse;

    const sourceFailure = await runCheck("source_collections", checks, warnings, async () => {
      sourceCollectionResponse = await listSourceCollections();
      return checkSourceCollections(sourceCollectionResponse);
    });
    if (sourceFailure) return { ...sourceFailure, checks };

    const artifactFailure = await runCheck("normalized_artifacts", checks, warnings, async () => {
      artifactResponse = await listKnowledgeArtifacts({ limit: 500 });
      return checkNormalizedArtifacts(artifactResponse);
    });
    if (artifactFailure) return { ...artifactFailure, checks };

    const accessCollections = sourceCollectionResponse?.data ?? [];
    const defaultAccess = resolveKnowledgeAccess({
      config: knowledgeAccessConfig,
      collections: accessCollections,
      tenantEntitlements: [],
      keyIdentity: null,
    });
    const defaultAccessFailure = await runCheck("default_access_scope", checks, warnings, async () =>
      checkDefaultAccessScope({
        access: defaultAccess,
        expectedDefaultCollectionIds: knowledgeAccessConfig.defaultCollectionIds ?? [],
        k12Enabled: knowledgeAccessConfig.enableK12 === true,
      }),
    );
    if (defaultAccessFailure) return { ...defaultAccessFailure, checks };

    const k12AccessFailure = await runCheck("k12_disabled_access_gate", checks, warnings, async () =>
      checkK12DisabledAccessGate({
        access: defaultAccess,
        k12Enabled: knowledgeAccessConfig.enableK12 === true,
        collections: accessCollections,
      }),
    );
    if (k12AccessFailure) return { ...k12AccessFailure, checks };

    if (knowledgeAccessConfig.enableTenant) {
      const tenantFallbackAccess = resolveKnowledgeAccess({
        config: knowledgeAccessConfig,
        collections: accessCollections,
        tenantEntitlements: [],
        keyIdentity: tenantFallbackIdentity,
      });
      const tenantFallbackFailure = await runCheck("tenant_fallback_access", checks, warnings, async () =>
        checkTenantFallbackAccess({
          access: tenantFallbackAccess,
          expectedDefaultCollectionIds: knowledgeAccessConfig.defaultCollectionIds ?? [],
        }),
      );
      if (tenantFallbackFailure) return { ...tenantFallbackFailure, checks };

      if (tenantOverlayFixture) {
        const tenantOverlayAccess = resolveKnowledgeAccess({
          config: knowledgeAccessConfig,
          collections: accessCollections,
          tenantEntitlements: tenantOverlayFixture.entitlements ?? [],
          keyIdentity: tenantOverlayFixture.keyIdentity ?? tenantFallbackIdentity,
        });
        const tenantOverlayFailure = await runCheck("tenant_overlay_access", checks, warnings, async () =>
          checkTenantOverlayAccess({
            access: tenantOverlayAccess,
            expectedCollectionId: tenantOverlayFixture.expected_collection_id,
          }),
        );
        if (tenantOverlayFailure) return { ...tenantOverlayFailure, checks };
      }
    }

    const topicFailure = await runCheck("topic_candidates_export", checks, warnings, async () =>
      checkTopicCandidateExport(
        await exportTopicCandidates({
          profile: "demo",
          collectionId: demoOnlyCollectionId,
          limit: 1,
        }),
      ),
    );
    if (topicFailure) return { ...topicFailure, checks };

    for (const profile of runtimeProfiles) {
      const failure = await runCheck(`runtime_index_${profile}`, checks, warnings, async () => {
        runtimeIndexes[profile] = await getRuntimeIndex({ profile });
        return checkRuntimeIndex(runtimeIndexes[profile], profile);
      });
      if (failure) return { ...failure, checks };
    }

    for (const profile of runtimeProfiles) {
      const failure = await runCheck(`retrieve_${profile}`, checks, warnings, async () => {
        retrievals[profile] = await retrieve({ profile, query: readinessRetrievalQuery(profile), limit: 3 });
        return checkRetrieval(retrievals[profile], profile, {
          requireResults:
            profile !== "demo" &&
            approvedNormalizedDocumentCollections({
              artifacts: artifactResponse?.data ?? [],
              collections: sourceCollectionResponse?.data ?? [],
              profile,
            }).length > 0,
        });
      });
      if (failure) return { ...failure, checks };
    }

    const policyFailure = await runCheck("profile_policy", checks, warnings, async () =>
      checkProfilePolicy({ runtimeIndexes, retrievals, sourceCollections: sourceCollectionResponse?.data ?? [] }),
    );
    if (policyFailure) return { ...policyFailure, checks };

    return {
      status: "ok",
      checks,
      warnings,
    };
  }

  return {
    run,
  };
}
