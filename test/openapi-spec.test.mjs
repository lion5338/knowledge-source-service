import assert from "node:assert/strict";
import test from "node:test";

import { validateOpenApiSpec } from "../scripts/openapi/validator.mjs";
import { loadOpenApiSpec, openApiSpecPath } from "../src/lib/openapi/spec.mjs";

test("OpenAPI spec documents the demo API surface", async () => {
  const spec = await loadOpenApiSpec();

  assert.equal(spec.openapi, "3.0.3");
  assert.equal(spec.info.title, "Knowledge Source Service API");
  assert.ok(openApiSpecPath.replaceAll("\\", "/").endsWith("openapi/knowledge-source-service.openapi.yaml"));
  for (const path of [
    "/openapi.json",
    "/v1/runtime-index/latest",
    "/v1/runtime-index/diff",
    "/v1/artifacts",
    "/v1/artifacts/{artifactId}",
    "/v1/artifacts/{artifactId}/raw",
  ]) {
    assert.ok(spec.paths[path], `Expected OpenAPI path ${path}`);
  }
});

test("OpenAPI spec documents cache and trace headers on read responses", async () => {
  const spec = await loadOpenApiSpec();
  const latestHeaders = spec.paths["/v1/runtime-index/latest"].get.responses["200"].headers;
  const artifactHeaders = spec.paths["/v1/artifacts/{artifactId}"].get.responses["200"].headers;
  const rawHeaders = spec.paths["/v1/artifacts/{artifactId}/raw"].get.responses["200"].headers;

  for (const headers of [latestHeaders, artifactHeaders, rawHeaders]) {
    assert.ok(headers.ETag);
    assert.ok(headers["Cache-Control"]);
    assert.ok(headers["X-Knowledge-Source-Cache"]);
    assert.ok(headers["X-Artifact-ID"]);
    assert.ok(headers["X-Artifact-Checksum-SHA256"]);
    assert.ok(headers["X-Artifact-Publish-Status"]);
  }
  assert.ok(latestHeaders["X-Knowledge-Source-Trace-Mode"]);
  assert.ok(latestHeaders["X-Runtime-Index-Alias-ID"]);
  assert.ok(latestHeaders["X-Runtime-Index-Version-ID"]);
});

test("OpenAPI spec protects v1 demo read APIs and keeps the contract endpoint open", async () => {
  const spec = await loadOpenApiSpec();
  const protectedPaths = [
    "/v1/runtime-index/latest",
    "/v1/runtime-index/diff",
    "/v1/artifacts",
    "/v1/artifacts/{artifactId}",
    "/v1/artifacts/{artifactId}/raw",
  ];

  assert.deepEqual(spec.components.securitySchemes.bearerAuth, {
    type: "http",
    scheme: "bearer",
    description:
      "Optional local/demo service key. When KNOWLEDGE_SOURCE_KEY is configured, call protected endpoints with Authorization: Bearer <key>.",
  });
  for (const path of protectedPaths) {
    const operation = spec.paths[path].get;
    assert.deepEqual(operation.security, [{ bearerAuth: [] }], `Expected ${path} to require bearerAuth`);
    assert.ok(operation.responses["401"], `Expected ${path} to document 401`);
  }
  assert.equal(spec.paths["/openapi.json"].get.security, undefined);
});

test("OpenAPI spec passes structural validation", async () => {
  const result = await validateOpenApiSpec();

  assert.deepEqual(result, {
    status: "ok",
    path: openApiSpecPath,
  });
});
