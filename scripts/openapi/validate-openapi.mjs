import { validateOpenApiSpec } from "./validator.mjs";

const result = await validateOpenApiSpec();
console.log(JSON.stringify(result, null, 2));
