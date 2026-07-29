import pg from "pg";
import dotenv from "dotenv";
import path from "path";
import { projectRoot } from "./paths.mjs";

const { Pool } = pg;

dotenv.config({ path: path.join(projectRoot, ".env.local") });
dotenv.config({ path: path.join(projectRoot, ".env") });

export function getDatabaseConfig() {
  return {
    host: process.env.PGHOST ?? "127.0.0.1",
    port: Number(process.env.PGPORT ?? 5432),
    database: process.env.PGDATABASE ?? "knowledge_source",
    user: process.env.PGUSER ?? "eval_user",
    password: process.env.PGPASSWORD ?? "change-me-local-dev",
  };
}

export function createPool() {
  return new Pool(getDatabaseConfig());
}

export async function withClient(callback) {
  const pool = createPool();
  const client = await pool.connect();
  try {
    return await callback(client);
  } finally {
    client.release();
    await pool.end();
  }
}
