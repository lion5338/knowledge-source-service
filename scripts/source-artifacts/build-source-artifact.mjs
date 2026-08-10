import { createNormalizedArtifactBuilder } from "../../src/lib/source-artifacts/normalized-artifacts.js";

const args = process.argv.slice(2);
const collectionId = args.find((arg) => !arg.startsWith("-"));
const typeIndex = args.findIndex((arg) => arg === "--type");
const artifactType = typeIndex >= 0 ? args[typeIndex + 1] : null;

if (!collectionId || !artifactType) {
  console.error("Usage: npm run source-artifacts:build -- <collection_id> --type <artifact_type>");
  process.exit(1);
}

const builder = createNormalizedArtifactBuilder();
const result = await builder.buildSourceArtifact({ collectionId, artifactType, actor: "script" });

console.log(JSON.stringify(result, null, 2));
