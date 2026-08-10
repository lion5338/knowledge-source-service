import { routeError } from "@/lib/http/errors";
import { requireKnowledgeSourceAuth } from "@/lib/http/service-key-auth";
import { resolveRequestKnowledgeAccess } from "@/lib/knowledge-access/request-access-context";
import { getCollection } from "@/lib/source-collections/source-collections";

export const runtime = "nodejs";

export async function GET(request, { params }) {
  try {
    const auth = await requireKnowledgeSourceAuth(request);
    const { collectionId } = await params;
    const decodedCollectionId = decodeURIComponent(collectionId);
    const access = await resolveRequestKnowledgeAccess({
      keyIdentity: auth.identity,
      requestedCollectionIds: [decodedCollectionId],
    });
    return Response.json(await getCollection(decodedCollectionId, { access, tenantIdentity: auth.identity }));
  } catch (error) {
    return routeError(error);
  }
}
