import { routeError } from "@/lib/http/errors";
import { listSourceVersions } from "@/lib/sources/sources";

export const runtime = "nodejs";

export async function GET(_request, { params }) {
  try {
    const { source } = await params;
    return Response.json(await listSourceVersions(decodeURIComponent(source)));
  } catch (error) {
    return routeError(error);
  }
}
