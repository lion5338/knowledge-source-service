import { k12KnowledgeCollectionId } from "./default-knowledge.js";

export function sortIds(values = []) {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

export function collectionById(collections = []) {
  return new Map(collections.map((collection) => [collection.collection_id, collection]));
}

export function isK12Collection(collectionId) {
  return collectionId === k12KnowledgeCollectionId;
}

export function accessPolicyDecision({
  collectionId,
  collection = null,
  allowed,
  reasonCode,
  source = null,
  entitlement = null,
} = {}) {
  return {
    collection_id: collectionId,
    allowed: Boolean(allowed),
    reason_code: reasonCode,
    license_scope: collection?.license_scope ?? null,
    source,
    access_level: entitlement?.access_level ?? null,
    source_type: entitlement?.source_type ?? null,
    tenant_id: entitlement?.tenant_id ?? null,
    user_id: entitlement?.user_id ?? null,
  };
}
