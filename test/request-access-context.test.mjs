import assert from "node:assert/strict";
import test from "node:test";

import { createRequestKnowledgeAccessContext } from "../src/lib/knowledge-access/request-access-context.js";

test("request access context resolves tenant collection entitlements after loading tenant collections", async () => {
  const calls = [];
  const context = createRequestKnowledgeAccessContext({
    getConfig: () => ({
      knowledgeAccess: {
        enableTenant: true,
        enableK12: false,
        defaultKnowledge: ["marble", "learning_commons"],
        defaultCollectionIds: ["marble", "learning_commons"],
      },
    }),
    listCollections: async (options) => {
      calls.push(["listCollections", options.tenantIdentity]);
      return {
        data: [
          { collection_id: "marble", license_scope: "open_educational_source" },
          { collection_id: "tenant:tenant_a:uploaded_math", license_scope: "tenant_private" },
        ],
      };
    },
    findTenantEntitlements: async ({ keyIdentity }) => {
      calls.push(["findTenantEntitlements", keyIdentity.tenant_id]);
      return [
        {
          collection_id: "tenant:tenant_a:uploaded_math",
          tenant_id: "tenant_a",
          user_id: null,
          enabled: true,
          access_level: "read",
          source_type: "tenant_uploaded",
        },
      ];
    },
  });

  const access = await context.resolveRequestKnowledgeAccess({
    keyIdentity: {
      key_id: "key_tenant_a",
      key_type: "tenant",
      tenant_id: "tenant_a",
      user_id: null,
      scopes: ["knowledge:read"],
      metadata: {},
    },
  });

  assert.deepEqual(access.effective_collection_ids, ["marble", "tenant:tenant_a:uploaded_math"]);
  assert.deepEqual(access.tenant_collection_ids, ["tenant:tenant_a:uploaded_math"]);
  assert.equal(access.access_mode, "tenant_overlay");
  assert.equal(calls[0][0], "listCollections");
  assert.equal(calls[0][1].tenant_id, "tenant_a");
});
