# Knowledge Source Node 24 and Docker Compose Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `knowledge-source-service` run on host Node.js 24.18.1 and in a reproducible Docker Compose stack with PostgreSQL, migrations, seeded source metadata, persistent artifact storage, and optional Redis caching.

**Architecture:** Convert the package to explicit ESM and remove the Node 18-era runtime flag, then build the existing Next.js API as a pinned standalone image. Compose starts PostgreSQL, runs migrations and the deterministic source seed as one-shot jobs, and only then starts the API; Redis remains an optional profile and the default path uses the existing cache-bypass behavior.

**Tech Stack:** Node.js 24.18.1, npm 11.16.0, Next.js 15.5.x standalone output, PostgreSQL 17.6, Redis 8.2.1, Docker Compose, Node test runner.

**Spec:** `docs/superpowers/specs/2026-08-30-knowledge-source-node24-docker-compose-design.md`

## Global Constraints

- Host and container Node version is exactly `24.18.1`; `package.json` permits `>=24.18.1 <25`.
- Package manager metadata is exactly `npm@11.16.0`.
- Do not change dependency resolution versions or combine this work with a Next.js, PostgreSQL, Redis client, or application dependency upgrade.
- Node image is `node:24.18.1-bookworm-slim@sha256:235600a8101ab264e117b1768e925532262668dc9b581ef1dd7d96ced463b8e7`.
- PostgreSQL image is `postgres:17.6-bookworm@sha256:f3bd19c606e442c3d7bdfa8002e03fe260a1023351e0ea4598032022b68dd6e3`.
- Redis image is `redis:8.2.1-bookworm@sha256:5fa2edb1e408fa8235e6db8fab01d1afaaae96c9403ba67b70feceb8661e8621` and is optional.
- No `.env*`, `.npmrc`, raw datasets, host `node_modules`, test fixtures, or local storage may enter an image.
- Only the API maps a host port, and it binds to loopback.
- The API container never mounts a raw dataset.
- PostgreSQL and artifact storage use separate named volumes.
- A failed migration or seed prevents API startup.
- Redis-disabled operation must remain functional and report cache bypass.
- The implementation does not repair cross-service contracts, metadata endpoint authentication, raw-path exposure, or artifact path containment.
- Use `apply_patch` for all source and documentation edits.

---

### Task 1: Establish the Node 24 and Explicit ESM Host Baseline

**Files:**
- Create: `.nvmrc`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `next.config.mjs`

**Interfaces:**
- Consumes: the existing npm scripts and `NEXT_DIST_DIR` build override.
- Produces: an explicit ESM package, `npm test` over `test/*.test.mjs`, and standalone output rooted to the active worktree.

- [ ] **Step 1: Record the failing Node 24 acceptance test**

Run:

```powershell
node --version
npm --version
npm test
```

Expected: Node `v24.18.1`, npm `11.16.0`, then exit 1 with `node: bad option: --experimental-default-type=module`.

- [ ] **Step 2: Update package runtime metadata and scripts**

Add the package-level fields and replace scripts exactly as follows:

```json
{
  "type": "module",
  "engines": {
    "node": ">=24.18.1 <25"
  },
  "packageManager": "npm@11.16.0",
  "scripts": {
    "test": "node --test \"test/*.test.mjs\"",
    "source-collections:seed": "node scripts/source-collections/seed-source-collections.mjs",
    "source-collections:ingest": "node scripts/source-collections/ingest-source-collection.mjs",
    "source-artifacts:build": "node scripts/source-artifacts/build-source-artifact.mjs",
    "topic-candidates:build": "node scripts/topic-candidates/build-topic-candidates.mjs",
    "runtime-index:publish": "node scripts/runtime-index/publish-runtime-index.mjs",
    "retrieval-index:build": "node scripts/retrieval-index/build-retrieval-index.mjs",
    "source:sole-source:smoke": "node scripts/readiness/source-sole-source-smoke.mjs"
  }
}
```

Preserve every script not listed above. Update only the root package metadata in `package-lock.json`; dependency package versions and integrity values must remain unchanged.

Create `.nvmrc`:

```text
24.18.1
```

- [ ] **Step 3: Configure worktree-safe standalone output**

Replace `next.config.mjs` with:

```js
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  output: "standalone",
  outputFileTracingRoot: projectRoot,
};

export default nextConfig;
```

- [ ] **Step 4: Verify the supported host workflow**

Run:

```powershell
npm ci
npm ls --all
npm test
npm run lint
npm run openapi:validate
npm run build:isolated
Test-Path .next-build\standalone\server.js
Test-Path .next-build\standalone\openapi\knowledge-source-service.openapi.yaml
```

Expected: clean install and dependency tree exit 0; 201 tests pass; lint, OpenAPI, and build exit 0; both artifact checks print `True`; no multiple-lockfile tracing warning appears.

- [ ] **Step 5: Commit the host baseline**

```powershell
git add .nvmrc package.json package-lock.json next.config.mjs
git commit -m "build: require Node 24 for knowledge source"
```

---

### Task 2: Require Writable Artifact Storage in Readiness

**Files:**
- Create: `test/storage-readiness.test.mjs`
- Create: `src/lib/storage/storage-readiness.mjs`
- Modify: `src/lib/storage/artifacts.js`

**Interfaces:**
- Consumes: a filesystem object implementing `mkdir(path, options)` and `access(path, mode)`.
- Produces: `checkWritableDirectoryReady(root, fileSystem?) -> Promise<{status: "ok"} | {status: "error", message: string}>`.

- [ ] **Step 1: Write the failing readiness tests**

Create `test/storage-readiness.test.mjs`:

```js
import assert from "node:assert/strict";
import { constants } from "node:fs";
import test from "node:test";

import { checkWritableDirectoryReady } from "../src/lib/storage/storage-readiness.mjs";

test("checkWritableDirectoryReady requires write and search permissions", async () => {
  const calls = [];
  const result = await checkWritableDirectoryReady("/artifacts", {
    async mkdir(root, options) {
      calls.push(["mkdir", root, options]);
    },
    async access(root, mode) {
      calls.push(["access", root, mode]);
    },
  });

  assert.deepEqual(result, { status: "ok" });
  assert.deepEqual(calls, [
    ["mkdir", "/artifacts", { recursive: true }],
    ["access", "/artifacts", constants.W_OK | constants.X_OK],
  ]);
});

test("checkWritableDirectoryReady reports a non-writable artifact directory", async () => {
  const result = await checkWritableDirectoryReady("/artifacts", {
    async mkdir() {},
    async access() {
      throw new Error("permission denied");
    },
  });

  assert.deepEqual(result, { status: "error", message: "permission denied" });
});
```

- [ ] **Step 2: Run the focused test to verify RED**

Run:

```powershell
node --test test/storage-readiness.test.mjs
```

Expected: exit 1 with `ERR_MODULE_NOT_FOUND` for `src/lib/storage/storage-readiness.mjs`.

- [ ] **Step 3: Add the minimal filesystem readiness implementation**

Create `src/lib/storage/storage-readiness.mjs`:

```js
import { constants } from "node:fs";
import fs from "node:fs/promises";

export async function checkWritableDirectoryReady(root, fileSystem = fs) {
  try {
    await fileSystem.mkdir(root, { recursive: true });
    await fileSystem.access(root, constants.W_OK | constants.X_OK);
    return { status: "ok" };
  } catch (error) {
    return { status: "error", message: error.message };
  }
}
```

Update `checkStorage()` in `src/lib/storage/artifacts.js` to call the new function and preserve the endpoint shape:

```js
export async function checkStorage() {
  const root = storageRoot();
  const result = await checkWritableDirectoryReady(root);
  return {
    ...result,
    root: getServiceConfig().storageRoot,
  };
}
```

- [ ] **Step 4: Verify GREEN and regressions**

Run:

```powershell
node --test test/storage-readiness.test.mjs
npm test
npm run lint
```

Expected: 2 focused tests pass; full suite reports 203 tests, 0 failures; lint exits 0.

- [ ] **Step 5: Commit writable readiness**

```powershell
git add test/storage-readiness.test.mjs src/lib/storage/storage-readiness.mjs src/lib/storage/artifacts.js
git commit -m "fix: require writable artifact storage readiness"
```

---

### Task 3: Build the Pinned Node 24 Standalone Image

**Files:**
- Create: `Dockerfile.node24`
- Create: `.dockerignore`

**Interfaces:**
- Consumes: `.next/standalone`, `.next/static`, OpenAPI, migrations, seed script, source libraries, and production dependencies.
- Produces: `knowledge-source-service:node24-verification`, whose default command is `node server.js` as non-root UID 1000.

- [ ] **Step 1: Verify the image target is absent**

Run:

```powershell
docker build -f Dockerfile.node24 -t knowledge-source-service:node24-verification .
```

Expected: non-zero exit because `Dockerfile.node24` does not exist.

- [ ] **Step 2: Create the multi-stage Dockerfile**

Create `Dockerfile.node24`:

```dockerfile
ARG NODE_IMAGE=node:24.18.1-bookworm-slim@sha256:235600a8101ab264e117b1768e925532262668dc9b581ef1dd7d96ced463b8e7
FROM ${NODE_IMAGE} AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS builder
COPY . .
RUN node --version \
    && npm --version \
    && test "$(node --version)" = "v24.18.1" \
    && test "$(npm --version)" = "11.16.0"
RUN npm run lint
RUN npm test
RUN npm run openapi:validate
RUN npm run build

FROM base AS runtime-deps
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && npm cache clean --force

FROM base AS runner
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3200 \
    KNOWLEDGE_SOURCE_STORAGE_ROOT=/app/storage/knowledge

COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=runtime-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/openapi ./openapi
COPY --from=builder --chown=node:node /app/db ./db
COPY --from=builder --chown=node:node /app/scripts/db ./scripts/db
COPY --from=builder --chown=node:node /app/scripts/lib ./scripts/lib
COPY --from=builder --chown=node:node /app/scripts/source-collections ./scripts/source-collections
COPY --from=builder --chown=node:node /app/src/lib ./src/lib
COPY --from=builder --chown=node:node /app/package.json ./package.json

RUN mkdir -p /app/storage/knowledge \
    && chown -R node:node /app/storage

USER node
EXPOSE 3200
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3200/healthz').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"]
CMD ["node", "server.js"]
```

- [ ] **Step 3: Restrict the build context**

Create `.dockerignore`:

```text
.git
.gitignore
.worktrees
.env*
.npmrc
node_modules
.next
.next-build
out
build
coverage
storage
docs
*.log
npm-debug.log*
```

- [ ] **Step 4: Verify the image from a fresh Linux build**

Run:

```powershell
docker build --no-cache -f Dockerfile.node24 -t knowledge-source-service:node24-verification .
docker run --rm --entrypoint sh knowledge-source-service:node24-verification -c 'id -u; node --version; npm --version; test ! -e /app/.git; test ! -e /app/.env.local; test ! -e /app/.npmrc; test -f /app/server.js; test -f /app/openapi/knowledge-source-service.openapi.yaml'
docker image inspect knowledge-source-service:node24-verification --format 'user={{.Config.User}} ports={{json .Config.ExposedPorts}} health={{json .Config.Healthcheck}}'
```

Expected: build-stage lint, 203 tests, OpenAPI, and Next build pass; UID `1000`; Node/npm versions match; filesystem checks exit 0; image metadata says `user=node`, port `3200/tcp`, and a healthcheck exists.

- [ ] **Step 5: Commit the image**

```powershell
git add Dockerfile.node24 .dockerignore
git commit -m "build: add Node 24 standalone source image"
```

---

### Task 4: Add the Default PostgreSQL, Seed, and API Compose Stack

**Files:**
- Create: `.env.compose.example`
- Create: `docker-compose.node24.yml`
- Modify: `.gitignore`
- Modify: `README.md` if present; otherwise create `README.md`

**Interfaces:**
- Consumes: the Task 3 image, `node scripts/db/migrate.mjs`, `node scripts/source-collections/seed-source-collections.mjs`, `/healthz`, `/readyz`, and `/openapi.json`.
- Produces: Compose services `source-db`, `source-migrate`, `source-seed`, `knowledge-source-service`, `source-readiness`, and optional `source-redis`.

- [ ] **Step 1: Verify Compose configuration is absent**

Run:

```powershell
$env:SOURCE_PGPASSWORD='compose-verification-only'
docker compose -f docker-compose.node24.yml config --quiet
```

Expected: non-zero exit because `docker-compose.node24.yml` does not exist.

- [ ] **Step 2: Add safe local environment metadata**

Create `.env.compose.example`:

```dotenv
# Copy to the ignored .env.compose file or export these values in your shell.
SOURCE_PGDATABASE=knowledge_source
SOURCE_PGUSER=knowledge_source_user
SOURCE_PGPASSWORD=
SOURCE_PORT=3200
SOURCE_REDIS_URL=
ENABLE_TENANT=false
ENABLE_K12=false
DEFAULT_KNOWLEDGE=marble;learning_commons
```

Add this exact ignore rule to `.gitignore`:

```text
/.env.compose
```

- [ ] **Step 3: Create the Compose topology**

Create `docker-compose.node24.yml`:

```yaml
name: knowledge-source-node24

x-source-environment: &source-environment
  PGHOST: source-db
  PGPORT: 5432
  PGDATABASE: ${SOURCE_PGDATABASE:-knowledge_source}
  PGUSER: ${SOURCE_PGUSER:-knowledge_source_user}
  PGPASSWORD: ${SOURCE_PGPASSWORD:?Set SOURCE_PGPASSWORD or use --env-file .env.compose}
  KNOWLEDGE_SOURCE_STORAGE_ROOT: /app/storage/knowledge
  ENABLE_TENANT: ${ENABLE_TENANT:-false}
  ENABLE_K12: ${ENABLE_K12:-false}
  DEFAULT_KNOWLEDGE: ${DEFAULT_KNOWLEDGE:-marble;learning_commons}
  REDIS_URL: ${SOURCE_REDIS_URL:-}

x-app-image: &app-image
  image: question-generation/knowledge-source-service:node24

services:
  source-db:
    image: postgres:17.6-bookworm@sha256:f3bd19c606e442c3d7bdfa8002e03fe260a1023351e0ea4598032022b68dd6e3
    environment:
      POSTGRES_DB: ${SOURCE_PGDATABASE:-knowledge_source}
      POSTGRES_USER: ${SOURCE_PGUSER:-knowledge_source_user}
      POSTGRES_PASSWORD: ${SOURCE_PGPASSWORD:?Set SOURCE_PGPASSWORD or use --env-file .env.compose}
    volumes:
      - source-db-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
      interval: 5s
      timeout: 5s
      retries: 20
    restart: unless-stopped
    stop_grace_period: 30s
    logging:
      options:
        max-size: 10m
        max-file: "3"

  source-redis:
    image: redis:8.2.1-bookworm@sha256:5fa2edb1e408fa8235e6db8fab01d1afaaae96c9403ba67b70feceb8661e8621
    profiles: [cache]
    command: ["redis-server", "--save", "", "--appendonly", "no"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 20
    restart: unless-stopped
    stop_grace_period: 10s
    logging:
      options:
        max-size: 10m
        max-file: "3"

  source-migrate:
    <<: *app-image
    pull_policy: never
    environment: *source-environment
    command: ["node", "scripts/db/migrate.mjs"]
    depends_on:
      source-db:
        condition: service_healthy
    init: true
    restart: "no"

  source-seed:
    <<: *app-image
    pull_policy: never
    environment: *source-environment
    command: ["node", "scripts/source-collections/seed-source-collections.mjs"]
    depends_on:
      source-migrate:
        condition: service_completed_successfully
    volumes:
      - source-artifact-data:/app/storage/knowledge
    init: true
    restart: "no"

  knowledge-source-service:
    <<: *app-image
    pull_policy: build
    build:
      context: .
      dockerfile: Dockerfile.node24
    environment: *source-environment
    depends_on:
      source-db:
        condition: service_healthy
      source-seed:
        condition: service_completed_successfully
    ports:
      - "127.0.0.1:${SOURCE_PORT:-3200}:3200"
    volumes:
      - source-artifact-data:/app/storage/knowledge
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3200/readyz').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"]
      interval: 5s
      timeout: 5s
      start_period: 10s
      retries: 20
    init: true
    restart: unless-stopped
    stop_grace_period: 20s
    logging:
      options:
        max-size: 10m
        max-file: "3"

  source-readiness:
    <<: *app-image
    pull_policy: never
    profiles: [tools]
    depends_on:
      knowledge-source-service:
        condition: service_healthy
    command:
      - node
      - -e
      - |
        const base = 'http://knowledge-source-service:3200';
        Promise.all(['/healthz', '/readyz', '/openapi.json', '/v1/source-collections'].map(async (path) => {
          const response = await fetch(base + path);
          if (!response.ok) throw new Error(path + ' returned ' + response.status);
          return [path, response.status];
        })).then((checks) => console.log(JSON.stringify(Object.fromEntries(checks)))).catch((error) => {
          console.error(error.message);
          process.exit(1);
        });
    init: true
    restart: "no"

volumes:
  source-db-data:
  source-artifact-data:
```

- [ ] **Step 4: Document host and Compose workflows**

The README must include these exact safe command patterns:

```powershell
nvm use 24.18.1
npm ci
npm test
npm run lint
npm run openapi:validate
npm run build:isolated

$env:SOURCE_PGPASSWORD='choose-a-local-password'
docker compose -f docker-compose.node24.yml config --quiet
docker compose -f docker-compose.node24.yml up -d --build --wait
docker compose -f docker-compose.node24.yml --profile tools run --rm --no-deps source-readiness
docker compose -f docker-compose.node24.yml logs source-migrate source-seed
docker compose -f docker-compose.node24.yml down --remove-orphans
```

Document the optional cache path:

```powershell
$env:SOURCE_REDIS_URL='redis://source-redis:6379'
docker compose -f docker-compose.node24.yml --profile cache up -d --build --wait
```

State explicitly that `down` preserves named volumes, while `down -v` permanently deletes the local database and artifact data. State that the stack is a local reproducible runtime, not full production-readiness evidence.

- [ ] **Step 5: Validate default Compose startup and seed output**

Run with a non-secret test-only password:

```powershell
$env:SOURCE_PGPASSWORD='compose-verification-only'
$env:SOURCE_REDIS_URL=''
docker compose -f docker-compose.node24.yml config --quiet
docker compose -f docker-compose.node24.yml up -d --build --wait
docker compose -f docker-compose.node24.yml ps
docker compose -f docker-compose.node24.yml logs --no-color source-migrate source-seed
Invoke-RestMethod http://127.0.0.1:3200/healthz
Invoke-RestMethod http://127.0.0.1:3200/readyz
Invoke-RestMethod http://127.0.0.1:3200/openapi.json
Invoke-RestMethod http://127.0.0.1:3200/v1/source-collections
docker compose -f docker-compose.node24.yml --profile tools run --rm --no-deps source-readiness
```

Expected: three migrations are logged, seed reports three configured collections, API and dependency checks return `ok`, OpenAPI is returned, source collections are non-empty, and the tool exits 0 without recreating the API container.

- [ ] **Step 6: Verify cache bypass, cache profile, and persistence**

With Redis disabled, request the seeded artifact:

```powershell
$uri='http://127.0.0.1:3200/v1/artifacts/source-collections%3Asummary%3Alatest'
(Invoke-WebRequest $uri).Headers['X-Knowledge-Source-Cache']
```

Expected: `bypass`.

Restart with Redis enabled:

```powershell
docker compose -f docker-compose.node24.yml down --remove-orphans
$env:SOURCE_REDIS_URL='redis://source-redis:6379'
docker compose -f docker-compose.node24.yml --profile cache up -d --build --wait
(Invoke-WebRequest $uri).Headers['X-Knowledge-Source-Cache']
(Invoke-WebRequest $uri).Headers['X-Knowledge-Source-Cache']
```

Expected: first response is `miss`, second is `hit`.

Restart only the API and verify the seeded artifact remains readable:

```powershell
docker compose -f docker-compose.node24.yml restart knowledge-source-service
$ready=$false
for ($attempt=1; $attempt -le 30; $attempt++) {
  try {
    if ((Invoke-RestMethod http://127.0.0.1:3200/readyz).status -eq 'ok') {
      $ready=$true
      break
    }
  } catch {}
  Start-Sleep -Seconds 1
}
if (-not $ready) { throw 'API did not become ready after restart.' }
Invoke-RestMethod $uri
```

Expected: the source-collection summary remains available from PostgreSQL metadata plus the artifact volume.

- [ ] **Step 7: Stop the test stack and commit Compose**

Stop containers without deleting volumes, verify the exact project-scoped volume names, then delete only the two smoke-test volumes after confirming they are labeled for `knowledge-source-node24`.

```powershell
docker compose -f docker-compose.node24.yml --profile cache down --remove-orphans
$volumes=@(docker volume ls --filter label=com.docker.compose.project=knowledge-source-node24 --format '{{.Name}}' | Sort-Object)
$expected=@('knowledge-source-node24_source-artifact-data','knowledge-source-node24_source-db-data') | Sort-Object
if ((Compare-Object $volumes $expected).Count -ne 0) { throw 'Unexpected project volume set.' }
docker volume rm knowledge-source-node24_source-artifact-data knowledge-source-node24_source-db-data
```

Commit:

```powershell
git add .env.compose.example .gitignore docker-compose.node24.yml README.md
git commit -m "build: add knowledge source Compose runtime"
```

---

### Task 5: Final Verification and Review

**Files:**
- Verify all changed files from Tasks 1-4.

**Interfaces:**
- Consumes: feature branch diff from base commit `844d1e9` through current HEAD.
- Produces: fresh host, image, Compose, security-boundary, and independent-review evidence.

- [ ] **Step 1: Run fresh host gates**

```powershell
node --version
npm --version
npm ci
npm ls --all
npm run lint
npm test
npm run openapi:validate
npm run build:isolated
```

Expected: Node/npm exact versions; all commands exit 0; full suite reports 203 tests and 0 failures.

- [ ] **Step 2: Run fresh image gates**

```powershell
docker build --no-cache -f Dockerfile.node24 -t knowledge-source-service:node24-verification .
docker run --rm --entrypoint sh knowledge-source-service:node24-verification -c 'id -u; node --version; npm --version; test ! -e /app/.git; test ! -e /app/.env.local; test ! -e /app/.npmrc; test ! -e /app/test'
docker image inspect knowledge-source-service:node24-verification
docker history --no-trunc knowledge-source-service:node24-verification
```

Expected: all image checks exit 0; history has no password, API key, bearer token, `.env.local`, or raw dataset value.

- [ ] **Step 3: Run a fresh-volume Compose verification**

Run the complete lifecycle from an empty project volume set:

```powershell
$env:SOURCE_PGPASSWORD='compose-final-verification-only'
$env:SOURCE_REDIS_URL=''
$before=@(docker volume ls --filter label=com.docker.compose.project=knowledge-source-node24 --format '{{.Name}}')
if ($before.Count -ne 0) { throw 'Final verification requires empty project volumes.' }
docker compose -f docker-compose.node24.yml config --quiet
docker compose -f docker-compose.node24.yml up -d --build --wait
docker compose -f docker-compose.node24.yml logs --no-color source-migrate source-seed
Invoke-RestMethod http://127.0.0.1:3200/healthz
Invoke-RestMethod http://127.0.0.1:3200/readyz
Invoke-RestMethod http://127.0.0.1:3200/openapi.json
Invoke-RestMethod http://127.0.0.1:3200/v1/source-collections
docker compose -f docker-compose.node24.yml --profile tools run --rm --no-deps source-readiness
$uri='http://127.0.0.1:3200/v1/artifacts/source-collections%3Asummary%3Alatest'
if ((Invoke-WebRequest $uri).Headers['X-Knowledge-Source-Cache'] -ne 'bypass') { throw 'Expected cache bypass.' }
docker compose -f docker-compose.node24.yml down --remove-orphans
$env:SOURCE_REDIS_URL='redis://source-redis:6379'
docker compose -f docker-compose.node24.yml --profile cache up -d --build --wait
if ((Invoke-WebRequest $uri).Headers['X-Knowledge-Source-Cache'] -ne 'miss') { throw 'Expected first Redis request to miss.' }
if ((Invoke-WebRequest $uri).Headers['X-Knowledge-Source-Cache'] -ne 'hit') { throw 'Expected second Redis request to hit.' }
docker compose -f docker-compose.node24.yml restart knowledge-source-service
$ready=$false
for ($attempt=1; $attempt -le 30; $attempt++) {
  try {
    if ((Invoke-RestMethod http://127.0.0.1:3200/readyz).status -eq 'ok') {
      $ready=$true
      break
    }
  } catch {}
  Start-Sleep -Seconds 1
}
if (-not $ready) { throw 'API did not become ready after restart.' }
Invoke-RestMethod $uri
docker compose -f docker-compose.node24.yml --profile cache down --remove-orphans
$volumes=@(docker volume ls --filter label=com.docker.compose.project=knowledge-source-node24 --format '{{.Name}}' | Sort-Object)
$expected=@('knowledge-source-node24_source-artifact-data','knowledge-source-node24_source-db-data') | Sort-Object
if ((Compare-Object $volumes $expected).Count -ne 0) { throw 'Unexpected project volume set.' }
docker volume rm knowledge-source-node24_source-artifact-data knowledge-source-node24_source-db-data
```

Expected: migrations, seed, default readiness, cache bypass, Redis miss/hit, and post-restart artifact persistence all pass; only the two verified smoke-test volumes are removed.

- [ ] **Step 4: Request independent code review**

Review range:

```powershell
git diff --stat 844d1e9..HEAD
git diff 844d1e9..HEAD
```

The reviewer must check plan alignment, ESM behavior, Docker/Compose correctness, secret handling, non-root volume permissions, optional Redis semantics, migration/seed ordering, documentation accuracy, and test adequacy. Fix every Critical and Important issue, then request a focused follow-up review.

- [ ] **Step 5: Verify repository integrity**

```powershell
git status --short
git diff --check
git log --oneline 844d1e9..HEAD
git -C C:\Question_Generation\core\knowledge-source-service status --short
```

Expected: feature worktree is clean; the original checkout still contains only the user's untracked `node24&docker階段性升級規劃.md`; no `.env.local` or test data is committed.

- [ ] **Step 6: Present branch integration choices**

Use `superpowers:finishing-a-development-branch`. Do not merge, push, remove the worktree, or delete the feature branch until the user selects an integration option.
