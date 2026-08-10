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
    "/v1/source-collections",
    "/v1/source-collections/{collectionId}",
    "/v1/topic-candidates/export",
    "/v1/retrieve",
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
  assert.ok(latestHeaders["X-Knowledge-Access-Mode"]);
  assert.ok(latestHeaders["X-Knowledge-Effective-Collections"]);
  assert.ok(artifactHeaders["X-Knowledge-Access-Mode"]);
  assert.ok(rawHeaders["X-Knowledge-Effective-Collections"]);
});

test("OpenAPI spec protects v1 demo read APIs and keeps the contract endpoint open", async () => {
  const spec = await loadOpenApiSpec();
  const protectedPaths = [
    "/v1/runtime-index/latest",
    "/v1/runtime-index/diff",
    "/v1/source-collections",
    "/v1/source-collections/{collectionId}",
    "/v1/topic-candidates/export",
    "/v1/retrieve",
    "/v1/artifacts",
    "/v1/artifacts/{artifactId}",
    "/v1/artifacts/{artifactId}/raw",
  ];

  assert.deepEqual(spec.components.securitySchemes.bearerAuth, {
    type: "http",
    scheme: "bearer",
    description:
      "Use Authorization: Bearer <key>. The key may be KNOWLEDGE_SOURCE_KEY service/admin key, or an active tenant/user key when ENABLE_TENANT=true.",
  });
  for (const path of protectedPaths) {
    const operation = spec.paths[path].get ?? spec.paths[path].post;
    assert.deepEqual(operation.security, [{ bearerAuth: [] }], `Expected ${path} to require bearerAuth`);
    assert.ok(operation.responses["401"], `Expected ${path} to document 401`);
  }
  assert.equal(spec.paths["/openapi.json"].get.security, undefined);
});

test("OpenAPI spec documents source collection detail response and 404", async () => {
  const spec = await loadOpenApiSpec();
  const operation = spec.paths["/v1/source-collections/{collectionId}"].get;

  assert.equal(operation.operationId, "getSourceCollection");
  assert.deepEqual(operation.responses["200"].content["application/json"].schema, {
    $ref: "#/components/schemas/SourceCollectionDetailResponse",
  });
  assert.ok(operation.responses["404"]);
  assert.ok(spec.components.schemas.SourceCollectionDetailResponse);
});

test("OpenAPI spec documents topic candidate export", async () => {
  const spec = await loadOpenApiSpec();
  const operation = spec.paths["/v1/topic-candidates/export"].get;

  assert.equal(operation.operationId, "exportTopicCandidates");
  assert.deepEqual(operation.responses["200"].content["application/json"].schema, {
    $ref: "#/components/schemas/TopicCandidateExportResponse",
  });
  const profileParameter = operation.parameters.find((parameter) => parameter.name === "profile");
  assert.equal(profileParameter.required, false);
  assert.equal(profileParameter.deprecated, true);
  assert.ok(operation.parameters.some((parameter) => parameter.name === "collection_id" && parameter.required));
  assert.ok(spec.components.schemas.TopicCandidateExportTrace.properties.access);
});

test("OpenAPI spec documents runtime index profile query and trace response", async () => {
  const spec = await loadOpenApiSpec();
  const operation = spec.paths["/v1/runtime-index/latest"].get;

  assert.ok(operation.parameters.some((parameter) => parameter.name === "profile"));
  assert.equal(operation.parameters.find((parameter) => parameter.name === "profile").deprecated, true);
  assert.ok(spec.components.headers.KnowledgeSourceProfile);
  assert.ok(spec.components.headers.KnowledgeAccessMode);
  assert.ok(spec.components.headers.KnowledgeEffectiveCollections);
  assert.ok(operation.responses["200"].headers["X-Knowledge-Source-Profile"]);
  assert.ok(spec.components.schemas.RuntimeIndexLatestResponse.properties.profile);
  assert.ok(spec.components.schemas.RuntimeIndexLatestResponse.properties.profile_trace);
  assert.ok(spec.components.schemas.RuntimeIndexLatestResponse.properties.access_trace);
  assert.ok(spec.components.schemas.KnowledgeAccessTrace);
});

test("OpenAPI spec documents retrieval request and response", async () => {
  const spec = await loadOpenApiSpec();
  const operation = spec.paths["/v1/retrieve"].post;

  assert.equal(operation.operationId, "retrieveKnowledge");
  assert.deepEqual(operation.requestBody.content["application/json"].schema, {
    $ref: "#/components/schemas/RetrievalRequest",
  });
  assert.deepEqual(spec.components.schemas.RetrievalRequest.required, ["query"]);
  assert.equal(spec.components.schemas.RetrievalRequest.properties.profile.deprecated, true);
  assert.deepEqual(operation.responses["200"].content["application/json"].schema, {
    $ref: "#/components/schemas/RetrievalResponse",
  });
  assert.ok(spec.components.schemas.RetrievalTrace.properties.access);
});

test("OpenAPI spec passes structural validation", async () => {
  const result = await validateOpenApiSpec();

  assert.deepEqual(result, {
    status: "ok",
    path: openApiSpecPath,
  });
});
