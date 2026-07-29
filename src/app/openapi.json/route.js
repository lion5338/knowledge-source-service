import { routeError } from "@/lib/http/errors";
import { loadOpenApiSpec } from "@/lib/openapi/spec.mjs";

export const runtime = "nodejs";

export async function GET() {
  try {
    return Response.json(await loadOpenApiSpec(), {
      headers: {
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    return routeError(error);
  }
}
