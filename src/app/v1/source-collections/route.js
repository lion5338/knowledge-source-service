import { routeError } from "@/lib/http/errors";
import { requireKnowledgeSourceAuth } from "@/lib/http/service-key-auth";
import { resolveRequestKnowledgeAccess } from "@/lib/knowledge-access/request-access-context";
import { listCollections } from "@/lib/source-collections/source-collections";

export const runtime = "nodejs";

export async function GET(request) {
  try {
    const auth = await requireKnowledgeSourceAuth(request);
    const access = await resolveRequestKnowledgeAccess({ keyIdentity: auth.identity });
    return Response.json(await listCollections({ access, tenantIdentity: auth.identity }));
  } catch (error) {
    return routeError(error);
  }
}
