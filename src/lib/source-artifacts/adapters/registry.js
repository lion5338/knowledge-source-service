import { HttpError } from "../../http/errors.js";
import { k12NormalizedKnowledgeGraphAdapter } from "./k12-normalized-knowledge-graph.js";
import { learningCommonsNormalizedDocumentsAdapter } from "./learning-commons-normalized-documents.js";
import { marbleNormalizedDocumentsAdapter } from "./marble-normalized-documents.js";

function sourceArtifactError(message, code, details = null) {
  return new HttpError(message, {
    status: 400,
    code,
    type: "bad_request",
    details,
  });
}

function unsupportedAdapter({ collectionId, artifactType }) {
  throw sourceArtifactError(
    `Normalized artifact build is not supported for collection/type: ${collectionId}/${artifactType}`,
    "source_collection_not_supported",
    { collection_id: collectionId, artifact_type: artifactType },
  );
}

const adapters = [
  k12NormalizedKnowledgeGraphAdapter,
  marbleNormalizedDocumentsAdapter,
  learningCommonsNormalizedDocumentsAdapter,
];

export function getNormalizedArtifactAdapter({ collectionId, artifactType } = {}) {
  const adapter = adapters.find((candidate) => candidate.collection_id === collectionId && candidate.artifact_type === artifactType);
  if (!adapter) {
    unsupportedAdapter({ collectionId, artifactType });
  }
  return adapter;
}

export function listNormalizedArtifactAdapters() {
  return adapters.map((adapter) => ({
    collection_id: adapter.collection_id,
    artifact_type: adapter.artifact_type,
  }));
}
