export function knowledgeAccessHeaders(access = {}) {
  return {
    "X-Knowledge-Access-Mode": access.access_mode ?? "default_only",
    "X-Knowledge-Effective-Collections": (access.effective_collection_ids ?? []).join(";"),
  };
}
