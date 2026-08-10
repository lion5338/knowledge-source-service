import { routeError } from "@/lib/http/errors";
import {
  getRedisResponseCache,
  latestRuntimeIndexResponseHeaders,
  knowledgeAccessCacheScope,
  runtimeIndexLatestCacheKey,
  withCachedApiResponse,
} from "@/lib/http/read-response-cache";
import { knowledgeAccessHeaders } from "@/lib/http/knowledge-access-headers";
import { requireKnowledgeSourceAuth } from "@/lib/http/service-key-auth";
import { resolveRequestKnowledgeAccess } from "@/lib/knowledge-access/request-access-context";
import { getLatestRuntimeIndex } from "@/lib/sources/sources";

export const runtime = "nodejs";

function runtimeProfileForAccess(access) {
  return (access.effective_collection_ids ?? []).includes("k12_kgraph_full") ? "demo" : "prod";
}

export async function GET(request) {
  try {
    const auth = await requireKnowledgeSourceAuth(request);
    const access = await resolveRequestKnowledgeAccess({ keyIdentity: auth.identity });
    const { searchParams } = new URL(request.url);
    const profileParam = searchParams.get("profile");
    const profile = profileParam ?? runtimeProfileForAccess(access);
    const accessScope = knowledgeAccessCacheScope({ access });
    return await withCachedApiResponse({
      cache: getRedisResponseCache(),
      cacheKey: runtimeIndexLatestCacheKey(profileParam, accessScope),
      ttlSeconds: 30,
      request,
      buildResponse: async () => {
        const runtimeIndex = await getLatestRuntimeIndex({ profile, access });
        return Response.json(
          {
            object: "runtime_index",
            ...runtimeIndex,
          },
          {
            headers: {
              ...latestRuntimeIndexResponseHeaders(runtimeIndex),
              ...knowledgeAccessHeaders(access),
            },
          },
        );
      },
    });
  } catch (error) {
    return routeError(error);
  }
}
