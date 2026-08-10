import { routeError } from "@/lib/http/errors";
import { requireKnowledgeSourceAuth } from "@/lib/http/service-key-auth";
import { resolveRequestKnowledgeAccess } from "@/lib/knowledge-access/request-access-context";
import { listArtifacts } from "@/lib/sources/sources";

export const runtime = "nodejs";

export async function GET(request) {
  try {
    const auth = await requireKnowledgeSourceAuth(request);
    const access = await resolveRequestKnowledgeAccess({ keyIdentity: auth.identity });
    const { searchParams } = new URL(request.url);
    return Response.json(
      await listArtifacts({
        artifactType: searchParams.get("artifact_type") ?? "",
        source: searchParams.get("source") ?? "",
        publishStatus: searchParams.get("publish_status") ?? "",
        limit: searchParams.get("limit"),
        access,
      }),
    );
  } catch (error) {
    return routeError(error);
  }
}
