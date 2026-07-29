import { routeError } from "@/lib/http/errors";
import { listSources } from "@/lib/sources/sources";

export const runtime = "nodejs";

export async function GET() {
  try {
    return Response.json(await listSources());
  } catch (error) {
    return routeError(error);
  }
}
