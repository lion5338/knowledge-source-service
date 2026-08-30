# Knowledge Source Node 24 and Docker Compose Design

**Date:** 2026-08-30  
**Status:** Approved in chat  
**Scope:** `knowledge-source-service` host runtime, production image, and local Compose stack

## Goal

Make `knowledge-source-service` run reproducibly after the developer machine moves from Node.js 18 to Node.js 24, both directly on the host and through Docker Compose. Preserve the existing API and data model while adding a deterministic PostgreSQL migration and source-collection seed path, persistent artifact storage, and optional Redis caching.

## Baseline Evidence

- The host is running Node.js `24.18.1` and npm `11.16.0`.
- `npm ci` succeeds when Windows lifecycle-process sandboxing is not blocking child processes.
- The current `npm test` exits before loading tests because Node 24 rejects `--experimental-default-type=module`.
- A directly invoked `.mjs` test passes but emits `MODULE_TYPELESS_PACKAGE_JSON`, confirming that the project should explicitly declare ESM.
- ESLint and OpenAPI validation pass on the pre-change tree.
- The isolated Next.js build reaches compilation but its worker is blocked by the managed Windows process sandbox; this is an execution-environment condition to recheck outside that sandbox.
- The existing upgrade document records a 201-test green baseline before the Node 24 flag removal.

## Selected Approach

Use a phased, local-runtime upgrade rather than attempting the complete production roadmap in one change.

1. Establish a supported Node 24/ESM host baseline.
2. Produce a pinned, non-root, multi-stage standalone image.
3. Provide a local Compose stack with PostgreSQL, one-shot migration and seed jobs, the API, persistent artifact storage, a readiness verifier, and optional Redis.
4. Verify fresh-volume startup, API readiness, seeded source data, cache-off operation, cache-on operation, and persistence across API restart.

This is preferred over metadata-only changes because the user explicitly needs Docker Compose. It is preferred over the full roadmap because cross-service contract repair, raw ingestion, SBOM policy, and production rollout are independent bodies of work.

## Host Runtime

`package.json` will:

- declare `"type": "module"`;
- require Node `>=24.18.1 <25`;
- declare `npm@11.16.0` as the package manager;
- remove every `--experimental-default-type=module` occurrence;
- run tests with `node --test "test/*.test.mjs"` so Node 24 receives files rather than a directory.

`.nvmrc` will contain `24.18.1`.

Dependency versions and lockfile resolutions remain unchanged. This change does not combine the Node migration with a Next.js, PostgreSQL, Redis client, or application dependency upgrade.

`next.config.mjs` will retain `NEXT_DIST_DIR`, enable standalone output, and set `outputFileTracingRoot` to the current checkout directory. The explicit tracing root prevents a linked worktree from being mistaken for a nested monorepo checkout.

## Storage Readiness

The existing readiness check only proves that the artifact root exists. Docker Compose uses readiness as a startup gate, so the check must also require write and directory-search permissions.

A small filesystem readiness module will:

- create the configured root recursively;
- call `fs.access` with `W_OK | X_OK`;
- return the existing `{ status: "ok" }` or `{ status: "error", message }` shape.

Unit tests will verify the required access mode and the error response before the production module is added. `/readyz` retains its current HTTP response contract.

The known `resolveStoragePath()` prefix-containment weakness is not changed here because it is an independent security correction with separate edge cases and review requirements.

## Production Image

The build uses:

`node:24.18.1-bookworm-slim@sha256:235600a8101ab264e117b1768e925532262668dc9b581ef1dd7d96ced463b8e7`

Stages:

- `deps`: clean development dependency install.
- `builder`: exact Node/npm assertions followed by lint, OpenAPI validation, and Next.js production build. Database-backed tests run from this stage through the Compose `source-test` tool after PostgreSQL is healthy.
- `runtime-deps`: production-only dependency install.
- `runner`: standalone server, static assets, OpenAPI, migrations, scripts needed by migration/seed jobs, source modules needed by the seed job, and production dependencies.

The runner will:

- use the image-provided `node` user;
- listen on `0.0.0.0:3200`;
- store artifacts under `/app/storage/knowledge`;
- expose `/healthz` as the image healthcheck;
- omit `.git`, `.env*`, `.npmrc`, tests, documentation, host build outputs, local storage, raw datasets, and host `node_modules`.

The API container never receives a raw dataset mount.

## Compose Topology

The default stack uses:

`postgres:17.6-bookworm@sha256:f3bd19c606e442c3d7bdfa8002e03fe260a1023351e0ea4598032022b68dd6e3`

Startup order:

```text
source-db healthy
  -> source-migrate completed successfully
    -> source-seed completed successfully
      -> knowledge-source-service ready
```

`source-seed` shares the artifact volume with the API and writes the deterministic source-collection summary after migrations. Its registry and artifact records are upserts; an additional audit record per explicit Compose startup is acceptable for local development.

Only the API maps a host port, bound to `127.0.0.1:${SOURCE_PORT:-3200}`. PostgreSQL stays private. Named volumes store PostgreSQL data and `/app/storage/knowledge` artifacts.

The database password is mandatory through `SOURCE_PGPASSWORD`; no working password is committed. Compose validation is documented with `config --quiet` so the rendered password is not printed.

## Optional Redis

Redis uses the `cache` profile and the pinned image:

`redis:8.2.1-bookworm@sha256:5fa2edb1e408fa8235e6db8fab01d1afaaae96c9403ba67b70feceb8661e8621`

The API receives `REDIS_URL` from `SOURCE_REDIS_URL`, which is empty by default. Therefore:

- default Compose startup has no Redis dependency and reports cache bypass;
- cache verification starts the `cache` profile and sets `SOURCE_REDIS_URL=redis://source-redis:6379`;
- Redis connection errors continue to fall back to origin behavior through the existing cache implementation;
- Redis is not part of `/readyz`, because it is explicitly optional.

## Verification

Host gates:

- exact Node and npm versions;
- `npm ci`;
- `npm ls --all`;
- the focused readiness unit test without external services;
- ESLint;
- OpenAPI validation;
- isolated standalone build and required artifact checks.

Compose gates include the full 201-test baseline plus the two readiness tests through `source-test`, for 203 total tests against the private PostgreSQL service.

Image gates:

- no-cache Linux build;
- build-stage quality gates;
- runner UID, Node/npm versions, exposed port, and healthcheck;
- absence of local environment files and raw data;
- standalone `/healthz`, OpenAPI, and expected `/readyz` failure without dependencies.

Compose gates:

- silent config validation;
- fresh named volumes;
- three migrations and seed job completion;
- `/healthz`, `/readyz`, OpenAPI, and seeded source-collection response;
- readiness tool profile;
- Redis-disabled cache bypass;
- Redis-enabled cache behavior without access-scope regression;
- API restart followed by DB and artifact persistence checks;
- project-scoped test resources removed after verification.

## Documentation

README documentation will cover:

- Node 24 host setup;
- default Compose startup;
- optional Redis profile startup;
- status, log, readiness, and shutdown commands;
- the difference between `down` and destructive `down -v`;
- the fact that this stack is a local reproducible runtime, not proof of full production readiness.

## Explicit Non-Goals

This change does not claim or implement:

- Source-to-Synthesis real HTTP contract repair;
- authentication changes for source metadata endpoints;
- raw-path response hardening;
- artifact path-containment repair;
- ingestion/build raw dataset mounts;
- SBOM, vulnerability-policy remediation, observability, canary, rollback, or multi-architecture release evidence;
- deployment to any external environment.

Existing npm audit findings will be reported, not force-fixed as part of the Node runtime migration.

## Completion Boundary

The feature is complete when the host Node 24 workflow, standalone image, default Compose stack, seed path, persistent artifact storage, cache-off mode, and optional cache-on mode have fresh passing evidence. Broader items remain explicitly pending in `node24&docker階段性升級規劃.md`.
