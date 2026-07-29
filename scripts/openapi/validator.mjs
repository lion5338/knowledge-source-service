import SwaggerParser from "@apidevtools/swagger-parser";
import { openApiSpecPath } from "../../src/lib/openapi/spec.mjs";

export async function validateOpenApiSpec() {
  await SwaggerParser.validate(openApiSpecPath);
  return {
    status: "ok",
    path: openApiSpecPath,
  };
}
