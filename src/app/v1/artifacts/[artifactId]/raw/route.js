import { routeError } from "@/lib/http/errors";
import {
  artifactResponseHeaders,
  artifactRawCacheKey,
  getRedisResponseCache,
  responseCacheTtlSeconds,
  withCachedApiResponse,
} from "@/lib/http/read-response-cache";
import { requireServiceKeyAuth } from "@/lib/http/service-key-auth";
import { readArtifactText } from "@/lib/storage/artifacts";
import { getArtifact } from "@/lib/sources/sources";

export const runtime = "nodejs";

export async function GET(request, { params }) {
  try {
    await requireServiceKeyAuth(request);
    const { artifactId } = await params;
    const decodedArtifactId = decodeURIComponent(artifactId);
    return await withCachedApiResponse({
      cache: getRedisResponseCache(),
      cacheKey: artifactRawCacheKey(decodedArtifactId),
      ttlSeconds: responseCacheTtlSeconds({ artifactId: decodedArtifactId }),
      request,
      buildResponse: async () => {
        const artifact = await getArtifact(decodedArtifactId);
        const text = await readArtifactText(artifact.storage_path);
        return new Response(text, {
          headers: {
            ...artifactResponseHeaders(artifact),
            "content-type": `${artifact.content_type}; charset=utf-8`,
          },
        });
      },
    });
  } catch (error) {
    return routeError(error);
  }
}
