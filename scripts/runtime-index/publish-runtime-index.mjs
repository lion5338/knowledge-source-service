import { createProfileRuntimeIndexPublisher } from "../../src/lib/runtime-index/profile-runtime-index.js";

const args = process.argv.slice(2);
const profileIndex = args.findIndex((arg) => arg === "--profile");
const profile = profileIndex >= 0 ? args[profileIndex + 1] : null;

if (!profile) {
  console.error("Usage: npm run runtime-index:publish -- --profile <demo|mvp|prod>");
  process.exit(1);
}

const publisher = createProfileRuntimeIndexPublisher();
const result = await publisher.publishRuntimeIndexForProfile({ profile, actor: "script" });

console.log(JSON.stringify(result, null, 2));
