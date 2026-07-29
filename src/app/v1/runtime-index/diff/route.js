import { routeError } from "@/lib/http/errors";
import { requireServiceKeyAuth } from "@/lib/http/service-key-auth";
import { getRuntimeIndexDiff } from "@/lib/sources/sources";

export const runtime = "nodejs";

export async function GET(request) {
  try {
    await requireServiceKeyAuth(request);
    const { searchParams } = new URL(request.url);
    return Response.json(
      await getRuntimeIndexDiff({
        from: searchParams.get("from") ?? "",
        to: searchParams.get("to") ?? "",
      }),
    );
  } catch (error) {
    return routeError(error);
  }
}
