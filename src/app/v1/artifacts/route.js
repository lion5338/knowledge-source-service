import { routeError } from "@/lib/http/errors";
import { listArtifacts } from "@/lib/sources/sources";

export const runtime = "nodejs";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    return Response.json(
      await listArtifacts({
        artifactType: searchParams.get("artifact_type") ?? "",
        source: searchParams.get("source") ?? "",
        limit: searchParams.get("limit"),
      }),
    );
  } catch (error) {
    return routeError(error);
  }
}
