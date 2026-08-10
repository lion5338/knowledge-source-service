import { routeError } from "@/lib/http/errors";
import { requireKnowledgeSourceAuth } from "@/lib/http/service-key-auth";
import { resolveRequestKnowledgeAccess } from "@/lib/knowledge-access/request-access-context";
import { createTopicCandidateExporter } from "@/lib/topic-candidates/topic-candidate-export";

export const runtime = "nodejs";

const exporter = createTopicCandidateExporter();

export async function GET(request) {
  try {
    const auth = await requireKnowledgeSourceAuth(request);
    const { searchParams } = new URL(request.url);
    const collectionId = searchParams.get("collection_id");
    const access = await resolveRequestKnowledgeAccess({
      keyIdentity: auth.identity,
      requestedCollectionIds: collectionId ? [collectionId] : [],
    });
    return Response.json(
      await exporter.exportTopicCandidates({
        profile: searchParams.get("profile"),
        collectionId,
        subject: searchParams.get("subject"),
        learningStage: searchParams.get("learning_stage"),
        nodeType: searchParams.get("node_type"),
        limit: searchParams.get("limit"),
        cursor: searchParams.get("cursor"),
        download: searchParams.get("download") === "true",
        access,
      }),
    );
  } catch (error) {
    return routeError(error);
  }
}
