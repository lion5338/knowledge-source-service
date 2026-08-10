import { getServiceConfig } from "../config.js";
import { listCollections as defaultListCollections } from "../source-collections/source-collections.js";
import { resolveKnowledgeAccess as defaultResolveKnowledgeAccess } from "./knowledge-access-resolver.js";
import { findTenantEntitlements as defaultFindTenantEntitlements } from "./tenant-entitlements.js";

function requestedIdsFrom(value = []) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? "").trim()).filter(Boolean);
  }
  const raw = String(value ?? "").trim();
  return raw ? [raw] : [];
}

export function createRequestKnowledgeAccessContext({
  getConfig = getServiceConfig,
  listCollections = defaultListCollections,
  findTenantEntitlements = defaultFindTenantEntitlements,
  resolveKnowledgeAccess = defaultResolveKnowledgeAccess,
} = {}) {
  async function resolveRequestKnowledgeAccess({ keyIdentity = null, requestedCollectionIds = [] } = {}) {
    const config = getConfig().knowledgeAccess;
    const collections = (await listCollections({ tenantIdentity: keyIdentity })).data ?? [];
    const tenantEntitlements =
      config.enableTenant && (keyIdentity?.tenant_id || keyIdentity?.user_id)
        ? await findTenantEntitlements({ keyIdentity })
        : [];
    return resolveKnowledgeAccess({
      config,
      collections,
      tenantEntitlements,
      keyIdentity,
      requestedCollectionIds: requestedIdsFrom(requestedCollectionIds),
    });
  }

  return {
    resolveRequestKnowledgeAccess,
  };
}

const defaultRequestKnowledgeAccessContext = createRequestKnowledgeAccessContext();
export const resolveRequestKnowledgeAccess = defaultRequestKnowledgeAccessContext.resolveRequestKnowledgeAccess;
export { requestedIdsFrom };
