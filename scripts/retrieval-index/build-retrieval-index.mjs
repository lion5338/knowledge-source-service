import { createRetrievalIndexBuilder } from "../../src/lib/retrieval/retrieval.js";

const args = process.argv.slice(2);
const profileIndex = args.findIndex((arg) => arg === "--profile");
const profile = profileIndex >= 0 ? args[profileIndex + 1] : null;

if (!profile) {
  console.error("Usage: npm run retrieval-index:build -- --profile <demo|mvp|prod>");
  process.exit(1);
}

const builder = createRetrievalIndexBuilder();
const result = await builder.buildRetrievalIndexForProfile({ profile, actor: "script" });

console.log(JSON.stringify(result, null, 2));
