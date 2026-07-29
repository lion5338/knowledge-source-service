export function readEnv(name, fallback) {
  return process.env[name] ?? process.env[name.toLowerCase()] ?? fallback;
}

export function getServiceConfig() {
  return {
    storageRoot: readEnv("KNOWLEDGE_SOURCE_STORAGE_ROOT", "storage/knowledge"),
  };
}
