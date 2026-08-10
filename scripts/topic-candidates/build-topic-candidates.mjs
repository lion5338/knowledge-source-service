import { createTopicCandidateBuilder } from "../../src/lib/topic-candidates/topic-candidate-build.js";

const args = process.argv.slice(2);

function optionValue(name) {
  const index = args.findIndex((arg) => arg === name);
  return index >= 0 ? args[index + 1] : null;
}

const profile = optionValue("--profile");
const collectionId = optionValue("--collection_id");

if (!profile || !collectionId) {
  console.error("Usage: npm run topic-candidates:build -- --profile <demo|mvp|prod> --collection_id <collection_id>");
  process.exit(1);
}

const builder = createTopicCandidateBuilder();
const result = await builder.buildTopicCandidates({ collectionId, profile, actor: "script" });

console.log(JSON.stringify(result, null, 2));
