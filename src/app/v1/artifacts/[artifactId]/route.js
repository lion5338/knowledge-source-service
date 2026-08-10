import { routeError } from "@/lib/http/errors";
import {
  artifactDetailCacheKey,
  artifactResponseHeaders,
  getRedisResponseCache,
  knowledgeAccessCacheScope,
  responseCacheTtlSeconds,
  withCachedApiResponse,
} from "@/lib/http/read-response-cache";
import { knowledgeAccessHeaders } from "@/lib/http/knowledge-access-headers";
import { requireKnowledgeSourceAuth } from "@/lib/http/service-key-auth";
import { resolveRequestKnowledgeAccess } from "@/lib/knowledge-access/request-access-context";
import { getArtifactPayload } from "@/lib/sources/sources";

export const runtime = "nodejs";

export async function GET(request, { params }) {
  try {
    const auth = await requireKnowledgeSourceAuth(request);
    const access = await resolveRequestKnowledgeAccess({ keyIdentity: auth.identity });
    const accessScope = knowledgeAccessCacheScope({ access });
    const { artifactId } = await params;
    const decodedArtifactId = decodeURIComponent(artifactId);
    return await withCachedApiResponse({
      cache: getRedisResponseCache(),
      cacheKey: artifactDetailCacheKey(decodedArtifactId, accessScope),
      ttlSeconds: responseCacheTtlSeconds({ artifactId: decodedArtifactId }),
      request,
      buildResponse: async () => {
        const payload = await getArtifactPayload(decodedArtifactId, { access });
        return Response.json(payload, {
          headers: {
            ...artifactResponseHeaders(payload),
            ...knowledgeAccessHeaders(access),
          },
        });
      },
    });
  } catch (error) {
    return routeError(error);
  }
}
