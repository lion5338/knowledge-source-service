import { routeError } from "@/lib/http/errors";
import {
  artifactResponseHeaders,
  artifactRawCacheKey,
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
      cacheKey: artifactRawCacheKey(decodedArtifactId, accessScope),
      ttlSeconds: responseCacheTtlSeconds({ artifactId: decodedArtifactId }),
      request,
      buildResponse: async () => {
        const artifact = await getArtifactPayload(decodedArtifactId, { access });
        const text = artifact.json ? JSON.stringify(artifact.json, null, 2) : artifact.text;
        return new Response(text, {
          headers: {
            ...artifactResponseHeaders(artifact),
            ...knowledgeAccessHeaders(access),
            "content-type": `${artifact.content_type}; charset=utf-8`,
          },
        });
      },
    });
  } catch (error) {
    return routeError(error);
  }
}
