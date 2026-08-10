import { withClient as defaultWithClient } from "../db/pool.js";
import { hashAccessKey } from "./key-hashing.js";

function normalizeScopes(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function identityFromRow(row = {}) {
  if (!row.key_id) {
    return null;
  }
  return {
    key_id: row.key_id,
    key_type: row.key_type,
    tenant_id: row.tenant_id ?? null,
    user_id: row.user_id ?? null,
    scopes: normalizeScopes(row.scopes),
    metadata: row.metadata ?? {},
  };
}

export function createAccessKeyStore({ withClient = defaultWithClient } = {}) {
  async function findAccessKeyIdentity({ bearerToken } = {}) {
    const token = String(bearerToken ?? "");
    if (!token) {
      return null;
    }
    const keyHash = hashAccessKey(token);
    return withClient(async (client) => {
      const result = await client.query(
        `
          SELECT key_id, key_type, tenant_id, user_id, scopes, metadata
          FROM knowledge_source_api_keys
          WHERE key_hash_sha256 = $1
            AND status = $2
            AND (expires_at IS NULL OR expires_at > now())
          LIMIT 1
        `,
        [keyHash, "active"],
      );
      return identityFromRow(result.rows?.[0]);
    });
  }

  return {
    findAccessKeyIdentity,
  };
}

export const accessKeyStore = createAccessKeyStore();
export const findAccessKeyIdentity = accessKeyStore.findAccessKeyIdentity;
