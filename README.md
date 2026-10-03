# knowledge-source-service

Knowledge source API running on Node.js 24 with PostgreSQL-backed metadata and filesystem-backed artifacts.

## Node 24 host workflow

Some existing tests retain the production `withClient` wrapper even when query helpers are mocked, so `npm test` requires a reachable PostgreSQL instance. Use the Compose `source-test` command below when PostgreSQL is not installed on the host.

```powershell
nvm use 24.18.1
npm ci
npm test
npm run lint
npm run openapi:validate
npm run build:isolated
```

## Docker Compose workflow

Keep a local database password in this project's private `.env.local` using `PGPASSWORD`. Compose loads that file automatically at startup. Optional `PGUSER` and `PGDATABASE` default to `knowledge_source_user` and `knowledge_source`; existing `SOURCE_*` aliases and explicit shell overrides remain supported. No env file renaming or `--env-file` flag is needed. Before the first startup, run the separate build command below to prepare both the app and bundled PostgreSQL image; repeat it after image-source changes. Lifecycle verification uses this preparation and does not establish fresh-image ordering for a single `up --build` command.

```powershell
docker compose -f docker-compose.node24.yml config --quiet
docker compose -f docker-compose.node24.yml build
docker compose -f docker-compose.node24.yml up -d --wait
docker compose -f docker-compose.node24.yml ps
docker compose -f docker-compose.node24.yml --profile tools run --rm --no-deps source-test
docker compose -f docker-compose.node24.yml --profile tools run --rm --no-deps source-readiness
docker compose -f docker-compose.node24.yml logs --tail 100
docker compose -f docker-compose.node24.yml down --remove-orphans
```

The API listens only on `127.0.0.1:3200` by default. The normal stack bypasses response caching. To verify the optional Redis cache:

```powershell
$env:SOURCE_REDIS_URL='redis://source-redis:6379'
docker compose -f docker-compose.node24.yml --profile cache build
docker compose -f docker-compose.node24.yml --profile cache up -d --wait
$uri='http://127.0.0.1:3200/v1/artifacts/source-collections%3Asummary%3Alatest'
curl.exe -sS -D - -o NUL $uri
curl.exe -sS -D - -o NUL $uri
```

The first response should contain `x-knowledge-source-cache: miss`; the second should contain `x-knowledge-source-cache: hit`.

`docker compose down` preserves the named PostgreSQL and artifact volumes. `docker compose down -v` permanently deletes both sets of local data.

Keep `PGPASSWORD` (or its `SOURCE_PGPASSWORD` override) consistent while reusing an existing PostgreSQL volume. Changing configuration does not change the password stored inside that database; coordinate a database credential change separately. Missing required settings fail at startup with key names, while `config`, `logs`, and `down` remain available. See [the entrypoint contract](docs/ENVIRONMENT-ENTRYPOINT.md) for remote configuration and alias precedence.

This Compose stack is a reproducible local runtime and verification target. It is not, by itself, evidence of production readiness.
