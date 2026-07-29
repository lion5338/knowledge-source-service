import { routeError } from "@/lib/http/errors";
import {
  artifactDetailCacheKey,
  artifactResponseHeaders,
  getRedisResponseCache,
  responseCacheTtlSeconds,
  withCachedApiResponse,
} from "@/lib/http/read-response-cache";
import { requireServiceKeyAuth } from "@/lib/http/service-key-auth";
import { getArtifactPayload } from "@/lib/sources/sources";

export const runtime = "nodejs";

export async function GET(request, { params }) {
  try {
    await requireServiceKeyAuth(request);
    const { artifactId } = await params;
    const decodedArtifactId = decodeURIComponent(artifactId);
    return await withCachedApiResponse({
      cache: getRedisResponseCache(),
      cacheKey: artifactDetailCacheKey(decodedArtifactId),
      ttlSeconds: responseCacheTtlSeconds({ artifactId: decodedArtifactId }),
      request,
      buildResponse: async () => {
        const payload = await getArtifactPayload(decodedArtifactId);
        return Response.json(payload, {
          headers: artifactResponseHeaders(payload),
        });
      },
    });
  } catch (error) {
    return routeError(error);
  }
}
