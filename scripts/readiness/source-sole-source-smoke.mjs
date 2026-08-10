import { createSoleSourceReadinessSmoke } from "../../src/lib/readiness/sole-source-readiness-smoke.js";

const result = await createSoleSourceReadinessSmoke().run();

console.log(JSON.stringify(result, null, 2));

if (result.status === "failed") {
  process.exitCode = 1;
}
