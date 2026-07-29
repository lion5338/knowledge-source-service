import { routeError } from "@/lib/http/errors";
import { getLatestRuntimeIndex } from "@/lib/sources/sources";

export const runtime = "nodejs";

export async function GET() {
  try {
    const { artifact, index } = await getLatestRuntimeIndex();
    return Response.json({
      object: "runtime_index",
      artifact,
      index,
    });
  } catch (error) {
    return routeError(error);
  }
}
