import { routeError } from "@/lib/http/errors";
import { requireKnowledgeSourceAuth } from "@/lib/http/service-key-auth";
import { createKnowledgeRetriever } from "@/lib/retrieval/retrieval";

export const runtime = "nodejs";

const retriever = createKnowledgeRetriever();

export async function POST(request) {
  try {
    const auth = await requireKnowledgeSourceAuth(request);
    const body = await request.json();
    return Response.json(await retriever.retrieve({ ...body, accessIdentity: auth.identity }));
  } catch (error) {
    return routeError(error);
  }
}
