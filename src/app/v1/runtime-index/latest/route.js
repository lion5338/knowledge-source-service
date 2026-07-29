import { routeError } from "@/lib/http/errors";
import {
  getRedisResponseCache,
  latestRuntimeIndexResponseHeaders,
  runtimeIndexLatestCacheKey,
  withCachedApiResponse,
} from "@/lib/http/read-response-cache";
import { requireServiceKeyAuth } from "@/lib/http/service-key-auth";
import { getLatestRuntimeIndex } from "@/lib/sources/sources";

export const runtime = "nodejs";

export async function GET(request) {
  try {
    await requireServiceKeyAuth(request);
    return await withCachedApiResponse({
      cache: getRedisResponseCache(),
      cacheKey: runtimeIndexLatestCacheKey(),
      ttlSeconds: 30,
      request,
      buildResponse: async () => {
        const runtimeIndex = await getLatestRuntimeIndex();
        return Response.json(
          {
            object: "runtime_index",
            ...runtimeIndex,
          },
          {
            headers: latestRuntimeIndexResponseHeaders(runtimeIndex),
          },
        );
      },
    });
  } catch (error) {
    return routeError(error);
  }
}
