import { HttpError } from "../http/errors.js";

export const defaultSharedKnowledgeCollectionIds = ["marble", "learning_commons"];
export const k12KnowledgeCollectionId = "k12_kgraph_full";
export const supportedDefaultKnowledgeCollectionIds = [
  k12KnowledgeCollectionId,
  "learning_commons",
  "marble",
];

function knowledgeAccessError(message, code, details = null) {
  return new HttpError(message, {
    status: 400,
    code,
    type: "bad_request",
    details,
  });
}

function unique(values) {
  return values.filter((value, index) => values.indexOf(value) === index);
}

export function parseKnowledgeAccessBoolean(value, { name, fallback = false } = {}) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }
  throw knowledgeAccessError(`Invalid boolean value for ${name}.`, "invalid_knowledge_access_boolean", {
    name,
    value: String(value),
    allowed_values: ["true", "false", "1", "0", "yes", "no", "on", "off"],
  });
}

export function parseDefaultKnowledge(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return [...defaultSharedKnowledgeCollectionIds];
  }
  const collectionIds = unique(
    raw
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean),
  );
  const invalid = collectionIds.filter((collectionId) => !supportedDefaultKnowledgeCollectionIds.includes(collectionId));
  if (invalid.length) {
    throw knowledgeAccessError(
      `DEFAULT_KNOWLEDGE contains unsupported collection ids: ${invalid.join(", ")}`,
      "invalid_default_knowledge_collection_id",
      {
        invalid_collection_ids: invalid,
        allowed_collection_ids: supportedDefaultKnowledgeCollectionIds,
      },
    );
  }
  return collectionIds;
}

export function resolveDefaultCollectionIds({ enableK12 = false, defaultKnowledge = defaultSharedKnowledgeCollectionIds } = {}) {
  const withoutK12 = unique(defaultKnowledge).filter((collectionId) => collectionId !== k12KnowledgeCollectionId);
  if (!enableK12) {
    return withoutK12;
  }
  return [...withoutK12, k12KnowledgeCollectionId];
}

export function getKnowledgeAccessConfig(env = process.env) {
  const enableTenant = parseKnowledgeAccessBoolean(env.ENABLE_TENANT ?? env.enable_tenant, {
    name: "ENABLE_TENANT",
    fallback: false,
  });
  const enableK12 = parseKnowledgeAccessBoolean(env.ENABLE_K12 ?? env.enable_k12, {
    name: "ENABLE_K12",
    fallback: false,
  });
  const defaultKnowledge = parseDefaultKnowledge(env.DEFAULT_KNOWLEDGE ?? env.default_knowledge);
  return {
    enableTenant,
    enableK12,
    defaultKnowledge,
    defaultCollectionIds: resolveDefaultCollectionIds({ enableK12, defaultKnowledge }),
  };
}
