import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..", "..", "..");

export const openApiSpecPath = path.join(projectRoot, "openapi", "knowledge-source-service.openapi.yaml");

export async function loadOpenApiSpec() {
  return parse(await fs.readFile(openApiSpecPath, "utf8"));
}
