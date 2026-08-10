import { withClient as defaultWithClient } from "../db/pool.js";

function hasTenantIdentity(identity = {}) {
  return Boolean(identity?.tenant_id || identity?.user_id);
}

function rowToEntitlement(row = {}) {
  return {
    entitlement_id: row.entitlement_id,
    collection_id: row.collection_id,
    tenant_id: row.tenant_id ?? null,
    user_id: row.user_id ?? null,
    access_level: row.access_level ?? null,
    source_type: row.source_type ?? null,
    enabled: row.enabled !== false,
    metadata: row.metadata ?? {},
  };
}

export function createTenantEntitlementStore({ withClient = defaultWithClient } = {}) {
  async function findTenantEntitlements({ keyIdentity } = {}) {
    if (!hasTenantIdentity(keyIdentity)) {
      return [];
    }
    return withClient(async (client) => {
      const result = await client.query(
        `
          SELECT entitlement_id, collection_id, tenant_id, user_id, access_level, source_type, enabled, metadata
          FROM knowledge_source_collection_entitlements
          WHERE enabled = true
            AND (
              ($1::text IS NOT NULL AND tenant_id = $1::text AND user_id IS NULL)
              OR ($2::text IS NOT NULL AND user_id = $2::text)
              OR ($1::text IS NOT NULL AND $2::text IS NOT NULL AND tenant_id = $1::text AND user_id = $2::text)
            )
          ORDER BY collection_id ASC, user_id NULLS FIRST
        `,
        [keyIdentity.tenant_id ?? null, keyIdentity.user_id ?? null],
      );
      return (result.rows ?? []).map(rowToEntitlement);
    });
  }

  return {
    findTenantEntitlements,
  };
}

export const tenantEntitlementStore = createTenantEntitlementStore();
export const findTenantEntitlements = tenantEntitlementStore.findTenantEntitlements;
