import { readEnv } from "@/lib/config";

export function getDatabaseConfig() {
  return {
    host: readEnv("PGHOST", "127.0.0.1"),
    port: Number(readEnv("PGPORT", 5432)),
    database: readEnv("PGDATABASE", "knowledge_source"),
    user: readEnv("PGUSER", "eval_user"),
    password: readEnv("PGPASSWORD", "change-me-local-dev"),
  };
}
