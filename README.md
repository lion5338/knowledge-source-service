# knowledge-source-service

Knowledge source API running on Node.js 24 with PostgreSQL-backed metadata and filesystem-backed artifacts.

## Node 24 host workflow

PostgreSQL must be available for the database-backed test cases.

```powershell
nvm use 24.18.1
npm ci
npm test
npm run lint
npm run openapi:validate
npm run build:isolated
```

## Docker Compose workflow

Set a local-only database password; do not commit it. You can also copy `.env.compose.example` to the ignored `.env.compose` and add `--env-file .env.compose` to each Compose command.

```powershell
$env:SOURCE_PGPASSWORD='choose-a-local-password'
docker compose -f docker-compose.node24.yml config --quiet
docker compose -f docker-compose.node24.yml up -d --build --wait
docker compose -f docker-compose.node24.yml --profile tools run --rm source-test
docker compose -f docker-compose.node24.yml --profile tools run --rm --no-deps source-readiness
docker compose -f docker-compose.node24.yml logs source-migrate source-seed
docker compose -f docker-compose.node24.yml down --remove-orphans
```

The API listens only on `127.0.0.1:3200` by default. The normal stack bypasses response caching. To verify the optional Redis cache:

```powershell
$env:SOURCE_REDIS_URL='redis://source-redis:6379'
docker compose -f docker-compose.node24.yml --profile cache up -d --build --wait
```

`docker compose down` preserves the named PostgreSQL and artifact volumes. `docker compose down -v` permanently deletes both sets of local data.

This Compose stack is a reproducible local runtime and verification target. It is not, by itself, evidence of production readiness.
