import { routeError } from "@/lib/http/errors";
import { readArtifactText } from "@/lib/storage/artifacts";
import { getArtifact } from "@/lib/sources/sources";

export const runtime = "nodejs";

export async function GET(_request, { params }) {
  try {
    const { artifactId } = await params;
    const artifact = await getArtifact(decodeURIComponent(artifactId));
    const text = await readArtifactText(artifact.storage_path);
    return new Response(text, {
      headers: {
        "content-type": `${artifact.content_type}; charset=utf-8`,
      },
    });
  } catch (error) {
    return routeError(error);
  }
}
