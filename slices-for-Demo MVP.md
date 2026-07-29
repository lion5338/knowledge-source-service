# Knowledge Source Service Demo MVP Slices

Source scope: `完整版階段性規劃.md` section **12.1 Demo MVP 確認市場**.

Working rules:

- Build by vertical slices, not DB/backend/frontend horizontal layers.
- Before each slice, use grill / grill-with-docs to confirm behavior and tradeoffs.
- Turn clarified requirements into a small spec before implementation.
- Prefer TDD: write failing tests first, then implementation.
- After each slice, run `npm test`, `npm run lint`, and build/typecheck. Use `npm run build:isolated` while `dev:host` owns `.next`.
- Prefer deep modules: small interfaces, implementation complexity hidden inside focused modules.

## Current Progress

| Slice | Name | Status | Notes |
| --- | --- | --- | --- |
| Baseline | Runtime Index Latest Metadata Trace | Completed | Latest endpoint returns artifact/index/summary and first-pass publish status. |
| 01 | Import Summary and Rerun Trace | Completed | Import summary is written to stdout, audit event payload, and `reports/latest-import-summary.json`. |
| 02 | Artifact Publish Status Query | Completed | `/v1/artifacts` supports `publish_status`; artifact detail includes `publish_status`. |
| 03 | Runtime Index Version History and Pinning | Completed | `runtime-index:latest` points to immutable `runtime-index:sha256:<checksum>` artifacts. |
| 04 | Latest Runtime Index Metadata Endpoint Polish | Completed | Latest response exposes alias/version/trace metadata with backward-compatible fields. |
| 05 | Runtime Index Diff | Completed | `/v1/runtime-index/diff` supports default and explicit artifact comparisons. |
| 06 | Read Observability and Cache Metadata | Completed | ETag, Cache-Control, trace headers, optional Redis response cache, and import cache invalidation. |
| 07 | OpenAPI Contract for Demo APIs | Completed | Static YAML contract, `/openapi.json`, and `npm run openapi:validate`. |
| 08 | Optional Service Key Auth | Completed | Optional Bearer service key auth for v1 demo read APIs. |

## Completed Baseline - Runtime Index Latest Metadata Trace

**Status:** Completed

**Delivers:** `GET /v1/runtime-index/latest` exposes runtime index metadata enough for a demo trace: artifact id, checksum, publish status, summary, and index payload.

**Implemented:**

- `getLatestRuntimeIndex()` returns `artifact`, `summary`, and `index`.
- Artifact rows include `publish_status`.
- Test seam introduced through `createSources()`.
- `src/lib/storage/artifacts.js` is part of source code instead of being hidden by the old `storage/` gitignore rule.

**Verified:**

- `npm test`
- `npm run lint`
- `npm run db:migrate`
- `npm run import:ai-workflow-knowledge`
- Later regular `npm run build` was verified after stopping/restarting the dev server.

## 01 - Import Summary and Rerun Trace

**Status:** Completed

**Blocked by:** Baseline

**Delivers:** Every compatibility import produces a reproducible summary: number of sources, number of artifacts, runtime index artifact id, checksum, and which artifacts were created, changed, or unchanged. The same summary is persisted for demo auditability.

**Implemented:**

- Added `scripts/import/import-summary.mjs`.
- Import output includes:
  - `source_count`
  - `artifact_count`
  - `created_count`
  - `changed_count`
  - `unchanged_count`
  - `runtime_index.artifact_id`
  - `runtime_index.checksum_sha256`
  - `runtime_index.publish_status`
- Summary is stored in:
  - stdout
  - `storage/knowledge/reports/latest-import-summary.json`
  - artifact registry as `import-summary:latest`
  - audit event payload as `import_summary`
- Deleted artifact detection remains out of scope for first pass.

**Tests:**

- `test/import-summary.test.mjs`

**Verified:**

- `npm test`
- `npm run lint`
- `npm run import:ai-workflow-knowledge`
- User verified `npm run build`.

## 02 - Artifact Publish Status Query

**Status:** Completed

**Blocked by:** Baseline

**Delivers:** `/v1/artifacts` can filter by `publish_status`, and artifact detail consistently returns `publish_status`.

**Implemented:**

- Added allowed publish statuses:
  - `imported`
  - `published`
  - `validated`
  - `deprecated`
- `GET /v1/artifacts?publish_status=published` returns only published artifacts.
- `GET /v1/artifacts?publish_status=imported` returns only imported artifacts.
- Invalid `publish_status` returns stable `400 bad_request`.
- Existing `artifact_type`, `source`, and `limit` filters continue to work.

**Tests:**

- `test/artifacts.test.mjs`

**Verified:**

- `npm test`
- `npm run lint`
- `npm run build`
- HTTP smoke through the running dev server.

## 03 - Runtime Index Version History and Pinning

**Status:** Completed

**Blocked by:** 01, 02

**Delivers:** Each import/runtime publish preserves an immutable runtime index version artifact instead of only overwriting `runtime-index:latest`. Consumers can read a pinned runtime index by artifact id.

**Implemented production-ish naming:**

- Mutable alias artifact id: `runtime-index:latest`
- Immutable pinned artifact id: `runtime-index:sha256:<full_sha256>`
- Immutable storage path: `index/versions/sha256/<full_sha256>.json`
- Latest alias metadata includes:
  - `points_to_artifact_id`
  - `index_version`
  - `source_artifact_path`
- Pinned artifact metadata includes:
  - `alias_artifact_id`
  - `index_version`
  - `source_artifact_path`

**Tests:**

- `test/runtime-index-pinning.test.mjs`
- `test/sources.test.mjs`

**Verified:**

- `npm test`
- `npm run lint`
- `npm run import:ai-workflow-knowledge`
- User verified `npm run build`.
- HTTP smoke verified pinned artifact detail and raw payload.

## 04 - Latest Runtime Index Metadata Endpoint Polish

**Status:** Completed

**Blocked by:** 03

**Delivers:** Latest runtime index response clearly distinguishes mutable alias metadata from immutable pinned artifact metadata. Consumers do not need to infer whether they are reading an alias or a pinned version.

**Implemented response shape:**

- `trace_mode`
  - `content_addressed_version`
  - `legacy_alias_only`
- `alias`
- `version`
- Backward-compatible fields:
  - `artifact`
  - `summary`
  - `index`

**Tests:**

- `test/sources.test.mjs`

**Verified:**

- `npm test`
- `npm run lint`
- User verified `npm run build`.
- HTTP smoke verified `/v1/runtime-index/latest`.

## 05 - Runtime Index Diff

**Status:** Completed

**Blocked by:** 03

**Delivers:** API can compare runtime index artifacts and return a compact summary of added, removed, and changed sources/topics/source refs. Demo operators can see what changed before a run.

**Implemented:**

- New endpoint: `GET /v1/runtime-index/diff`
- Explicit comparison:
  - `?from=<artifact_id>&to=<artifact_id>`
- Default comparison:
  - latest alias pointer vs previous published pinned runtime index
- If insufficient history exists, returns `status: "insufficient_history"` instead of an error.
- Topic identity uses `topic_key`.
- Topic `changed` detects stable subset changes:
  - `topic_label`
  - `mapping_status`
  - `aliases`
  - `keywords`
  - selected `retrieved_sources` fields
- Sources added/removed are reported by `source`.

**Tests:**

- `test/runtime-index-diff.test.mjs`
- `test/sources.test.mjs`

**Verified:**

- `npm test`
- `npm run lint`
- DB seam checks.

## 06 - Read Observability and Cache Metadata

**Status:** Completed

**Blocked by:** 04

**Delivers:** Runtime index and artifact reads expose cache and trace metadata. Redis is optional and caches API response body plus header metadata when `REDIS_URL` is configured. Without Redis, reads preserve the original DB/storage behavior.

**Implemented endpoints:**

- `GET /v1/runtime-index/latest`
- `GET /v1/artifacts/:artifactId`
- `GET /v1/artifacts/:artifactId/raw`

**Implemented response headers:**

- `ETag: "sha256:<checksum>"`
- `Cache-Control`
  - immutable content-addressed runtime index: `public, max-age=31536000, immutable`
  - mutable alias/imported/report reads: `no-cache`
- `X-Knowledge-Source-Cache`
  - `hit`
  - `miss`
  - `bypass`
- `X-Knowledge-Source-Trace-Mode`
- `X-Artifact-ID`
- `X-Artifact-Checksum-SHA256`
- `X-Artifact-Publish-Status`
- Runtime index latest also includes:
  - `X-Runtime-Index-Alias-ID`
  - `X-Runtime-Index-Version-ID`

**Implemented Redis behavior:**

- Enabled only when `REDIS_URL` is configured.
- Caches API response body plus headers metadata.
- Redis key prefix: `knowledge-source:v1:*`
- Mutable TTL: `30` seconds.
- Immutable TTL: `31536000` seconds.
- Redis failures fall back to origin reads.
- `If-None-Match` supports `304 Not Modified`.
- Import/publish success invalidates mutable read cache keys after DB commit.
- Read observability remains response/header based; no read audit DB events were added.

**Tests:**

- `test/read-response-cache.test.mjs`
- `test/import-cache-invalidation.test.mjs`

**Verified:**

- `npm test`: 26 passed
- `npm run lint`
- `npm run build:isolated`
- HTTP smoke:
  - first read: `miss`
  - second read: `hit`
  - `If-None-Match`: `304`
  - after `npm run import:ai-workflow-knowledge`: latest read becomes `miss`, confirming invalidation.

## 07 - OpenAPI Contract for Demo APIs

**Status:** Completed

**Blocked by:** 04, 06

**Delivers:** A documented OpenAPI contract for demo-facing runtime index and artifact APIs, so AI Workflow can align against a stable service contract later.

**Covers:**

- OpenAPI contract
- Consumer alignment

**Acceptance criteria:**

- OpenAPI spec describes runtime index latest.
- OpenAPI spec describes pinned runtime index retrieval.
- OpenAPI spec describes artifact list/detail/raw.
- OpenAPI spec describes runtime index diff.
- Spec documents cache headers and optional Redis behavior as implementation details.
- Spec documents auth behavior as optional until Slice 08 is implemented.

**Implemented:**

- Added `openapi/knowledge-source-service.openapi.yaml`.
- Added `GET /openapi.json`.
- Added `npm run openapi:validate`.
- Contract documents:
  - `/v1/runtime-index/latest`
  - `/v1/runtime-index/diff`
  - `/v1/artifacts`
  - `/v1/artifacts/{artifactId}`
  - `/v1/artifacts/{artifactId}/raw`
  - cache and trace response headers
- Redis remains an implementation detail; the contract documents visible cache headers only.

**Tests:**

- `test/openapi-spec.test.mjs`

**Verified:**

- `npm test`
- `npm run openapi:validate`
- `npm run lint`
- `npm run build:isolated`
- HTTP smoke against `GET /openapi.json`

## 08 - Optional Service Key Auth

**Status:** Completed

**Blocked by:** 07

**Delivers:** If `KNOWLEDGE_SOURCE_KEY` is configured, consumers must provide a matching service key. If it is not configured, local demo behavior remains open. This does not implement tenant or user policy.

**Covers:**

- Demo optional API auth
- Production-readiness first step

**Acceptance criteria:**

- Without `KNOWLEDGE_SOURCE_KEY`, existing local demo requests continue to work.
- With `KNOWLEDGE_SOURCE_KEY`, missing, malformed, or wrong credentials receive a stable `401 Unauthorized` auth error.
- With `KNOWLEDGE_SOURCE_KEY`, correct credentials can read runtime index and artifacts.
- Auth is service-level only; tenant filtering remains out of scope.

**Implemented:**

- Auth is enabled only when `KNOWLEDGE_SOURCE_KEY` is configured.
- Protected endpoints require `Authorization: Bearer <key>`.
- Protected endpoints:
  - `/v1/runtime-index/latest`
  - `/v1/runtime-index/diff`
  - `/v1/artifacts`
  - `/v1/artifacts/{artifactId}`
  - `/v1/artifacts/{artifactId}/raw`
- Unprotected endpoints:
  - `/openapi.json`
  - `/healthz`
  - `/readyz`
- Missing, malformed, and wrong credentials all return the same stable error:
  - status: `401`
  - message: `Unauthorized.`
  - type: `auth_error`
  - code: `unauthorized`
- Service key comparison uses constant-time compare.
- OpenAPI contract includes `bearerAuth` and `401` responses for protected endpoints.

**Tests:**

- `test/service-key-auth.test.mjs`
- `test/openapi-spec.test.mjs`

**Verified:**

- `npm test`
- `npm run openapi:validate`
- `npm run lint`
- `npm run build:isolated`
- HTTP smoke with auth disabled on port `3200`
- Temporary production server smoke with `KNOWLEDGE_SOURCE_KEY=demo-secret` on port `3201`:
  - `/openapi.json`: `200`
  - missing credential: `401`
  - malformed credential: `401`
  - wrong credential: `401`
  - correct Bearer token: `200`
  - `/openapi.json`, `/healthz`, `/readyz`: `200`

## Suggested Implementation Order

```text
completed baseline
  -> completed 01 Import Summary and Rerun Trace
  -> completed 02 Artifact Publish Status Query
  -> completed 03 Runtime Index Version History and Pinning
  -> completed 04 Latest Runtime Index Metadata Endpoint Polish
  -> completed 05 Runtime Index Diff
  -> completed 06 Read Observability and Cache Metadata
  -> completed 07 OpenAPI Contract for Demo APIs
  -> completed 08 Optional Service Key Auth
```
