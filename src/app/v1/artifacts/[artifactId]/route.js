import { routeError } from "@/lib/http/errors";
import { getArtifactPayload } from "@/lib/sources/sources";

export const runtime = "nodejs";

export async function GET(_request, { params }) {
  try {
    const { artifactId } = await params;
    const payload = await getArtifactPayload(decodeURIComponent(artifactId));
    return Response.json(payload);
  } catch (error) {
    return routeError(error);
  }
}
