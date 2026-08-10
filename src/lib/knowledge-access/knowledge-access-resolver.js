import { accessPolicyDecision, collectionById, isK12Collection, sortIds } from "./access-policy.js";
import { defaultSharedKnowledgeCollectionIds, resolveDefaultCollectionIds } from "./default-knowledge.js";

const defaultConfig = {
  enableTenant: false,
  enableK12: false,
  defaultKnowledge: defaultSharedKnowledgeCollectionIds,
  defaultCollectionIds: defaultSharedKnowledgeCollectionIds,
};

function normalizedConfig(config = {}) {
  const enableK12 = Boolean(config.enableK12);
  const defaultKnowledge = Array.isArray(config.defaultKnowledge) ? config.defaultKnowledge : defaultSharedKnowledgeCollectionIds;
  const defaultCollectionIds = Array.isArray(config.defaultCollectionIds)
    ? config.defaultCollectionIds
    : resolveDefaultCollectionIds({ enableK12, defaultKnowledge });
  return {
    ...defaultConfig,
    ...config,
    enableTenant: Boolean(config.enableTenant),
    enableK12,
    defaultKnowledge,
    defaultCollectionIds,
  };
}

function identityStatus({ enableTenant, keyIdentity }) {
  if (!enableTenant) {
    return "tenant_disabled";
  }
  return keyIdentity?.tenant_id || keyIdentity?.user_id ? "tenant_identity_resolved" : "tenant_identity_missing";
}

function defaultKnowledgeTrace(defaultKnowledge = []) {
  return defaultKnowledge.join(";");
}

function relevantIdsFor({
  requestedCollectionIds,
  defaultCollectionIds,
  tenantEntitlements,
  includeTenantEntitlements,
  collectionsById,
  enableK12,
}) {
  if (requestedCollectionIds.length > 0) {
    return requestedCollectionIds;
  }
  const entitlementIds = includeTenantEntitlements ? tenantEntitlements.map((entitlement) => entitlement.collection_id) : [];
  const ids = [...defaultCollectionIds, ...entitlementIds];
  if (!enableK12 && collectionsById.has("k12_kgraph_full")) {
    ids.push("k12_kgraph_full");
  }
  return sortIds(ids);
}

function decisionForCollection({
  collectionId,
  collectionsById,
  config,
  defaultAllowed,
  entitlementByCollectionId,
  requestedCollectionIds,
}) {
  const collection = collectionsById.get(collectionId) ?? null;
  const entitlement = entitlementByCollectionId.get(collectionId) ?? null;
  if (!collection) {
    return accessPolicyDecision({
      collectionId,
      allowed: false,
      reasonCode: "collection_unknown",
      source: "request",
      entitlement,
    });
  }
  if (isK12Collection(collectionId) && !config.enableK12) {
    return accessPolicyDecision({
      collectionId,
      collection,
      allowed: false,
      reasonCode: "k12_disabled_by_env",
      source: entitlement ? "tenant_entitlement" : "default",
      entitlement,
    });
  }
  if (entitlement && entitlement.enabled === false) {
    return accessPolicyDecision({
      collectionId,
      collection,
      allowed: false,
      reasonCode: "entitlement_disabled",
      source: "tenant_entitlement",
      entitlement,
    });
  }
  if (entitlement?.enabled !== false) {
    if (entitlement) {
      return accessPolicyDecision({
        collectionId,
        collection,
        allowed: true,
        reasonCode: "tenant_entitled",
        source: "tenant_entitlement",
        entitlement,
      });
    }
    if (defaultAllowed.has(collectionId)) {
      return accessPolicyDecision({
        collectionId,
        collection,
        allowed: true,
        reasonCode: "default_allowed",
        source: "default",
      });
    }
  }
  return accessPolicyDecision({
    collectionId,
    collection,
    allowed: false,
    reasonCode: requestedCollectionIds.length > 0 ? "not_in_effective_scope" : "not_allowed",
    source: requestedCollectionIds.length > 0 ? "request" : null,
    entitlement,
  });
}

function tenantCollectionAllowed({ collectionId, entitlement, collectionsById, config }) {
  const collection = collectionsById.get(collectionId);
  return Boolean(
    collection &&
      entitlement?.enabled !== false &&
      (!isK12Collection(collectionId) || config.enableK12),
  );
}

export function resolveKnowledgeAccess({
  config: inputConfig = defaultConfig,
  collections = [],
  tenantEntitlements = [],
  keyIdentity = null,
  requestedCollectionIds = [],
} = {}) {
  const config = normalizedConfig(inputConfig);
  const collectionsById = collectionById(collections);
  const includeTenantEntitlements = config.enableTenant && Boolean(keyIdentity?.tenant_id || keyIdentity?.user_id);
  const defaultCollectionIds = sortIds(
    config.defaultCollectionIds.filter(
      (collectionId) => collectionsById.has(collectionId) && (!isK12Collection(collectionId) || config.enableK12),
    ),
  );
  const defaultAllowed = new Set(defaultCollectionIds);
  const entitlementByCollectionId = new Map(
    (includeTenantEntitlements ? tenantEntitlements : []).map((entitlement) => [entitlement.collection_id, entitlement]),
  );
  const relatedIds = relevantIdsFor({
    requestedCollectionIds: sortIds(requestedCollectionIds),
    defaultCollectionIds,
    tenantEntitlements,
    includeTenantEntitlements,
    collectionsById,
    enableK12: config.enableK12,
  });
  const allDecisions = relatedIds.map((collectionId) =>
    decisionForCollection({
      collectionId,
      collectionsById,
      config,
      defaultAllowed,
      entitlementByCollectionId,
      requestedCollectionIds,
    }),
  );
  const tenantCollectionIds = sortIds(
    (includeTenantEntitlements ? tenantEntitlements : [])
      .filter((entitlement) =>
        tenantCollectionAllowed({
          collectionId: entitlement.collection_id,
          entitlement,
          collectionsById,
          config,
        }),
      )
      .map((entitlement) => entitlement.collection_id),
  );
  const requestedSet = requestedCollectionIds.length > 0 ? new Set(sortIds(requestedCollectionIds)) : null;
  const allowedIdsBeforeRequest = new Set(allDecisions.filter((decision) => decision.allowed).map((decision) => decision.collection_id));
  const effectiveCollectionIds = sortIds(
    [...allowedIdsBeforeRequest].filter((collectionId) => !requestedSet || requestedSet.has(collectionId)),
  );
  const blockedCollectionIds = requestedSet
    ? sortIds([...requestedSet].filter((collectionId) => !effectiveCollectionIds.includes(collectionId)))
    : sortIds(allDecisions.filter((decision) => !decision.allowed).map((decision) => decision.collection_id));
  const hasTenantOverlay = tenantCollectionIds.length > 0;
  const status = identityStatus({ enableTenant: config.enableTenant, keyIdentity });
  const fallbackUsed = config.enableTenant && (!hasTenantOverlay || status === "tenant_identity_missing");
  const accessMode = !config.enableTenant || status === "tenant_identity_missing"
    ? "default_only"
    : hasTenantOverlay
      ? "tenant_overlay"
      : "tenant_fallback_default";

  return {
    access_mode: accessMode,
    tenant_enabled: config.enableTenant,
    tenant_id: config.enableTenant ? keyIdentity?.tenant_id ?? null : null,
    user_id: config.enableTenant ? keyIdentity?.user_id ?? null : null,
    default_collection_ids: defaultCollectionIds,
    tenant_collection_ids: tenantCollectionIds,
    requested_collection_ids: sortIds(requestedCollectionIds),
    effective_collection_ids: effectiveCollectionIds,
    blocked_collection_ids: blockedCollectionIds,
    policy_decisions: allDecisions,
    trace: {
      default_knowledge: defaultKnowledgeTrace(config.defaultKnowledge),
      enable_tenant: config.enableTenant,
      enable_k12: config.enableK12,
      fallback_used: fallbackUsed,
      identity_status: status,
    },
  };
}
