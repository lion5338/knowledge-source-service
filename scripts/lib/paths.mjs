import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const projectRoot = path.resolve(__dirname, "..", "..");
export const migrationsDir = path.join(projectRoot, "db", "migrations");
export const defaultStorageRoot = path.join(projectRoot, "storage", "knowledge");
export const aiWorkflowKnowledgeDir = path.resolve(projectRoot, "..", "ai-workflow-service", "knowledge");
