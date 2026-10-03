# Environment entrypoint

The Node 24 runner and builder/tool image load configuration before executing the supplied command. The normal runner command remains `node server.js`; migration and seed commands still use the same image entrypoint. Existing Source Compose project and volume identities are preserved; the bundled PostgreSQL image now uses the shared configuration parser during startup.

## Configuration contract

- `NODE_ENV=development`: load only `ENV_FILE` (default `.env.local`), ignoring remote selectors.
- Other modes: select exactly one of `SSM_PATH`, `SECRETS_ARN`, `VAULT_SECRET_PATH`, or `SECRET_JSON`. Multiple nonempty selectors fail. Without a selector, use the local file fallback.
- Original process values win, including empty strings. Loaded values do not override image `ENV` or explicit container environment. Do not inject empty placeholders for keys expected from a secret.
- A missing default `.env.local` is allowed for an externally configured process. A missing explicitly selected `ENV_FILE`, or another file error, fails. Remote failures, malformed payloads, ambiguous sources, and invalid keys fail before the application starts; there is no local fallback after a selected remote source fails.
- Multiline and Unicode values remain ordinary environment values. No runtime dotenv file or `_PATH` replacement is created. Payloads cannot alter launcher/control variables.
- Loader markers prevent the guarded CLI dotenv path and Next from merging additional local env files. Direct `npm run dev` retains its existing framework behavior; use the launcher when the strict contract is required.

## Remote sources

SSM uses AWS SDK v3 `GetParametersByPath` with decryption and pagination. Grant scoped `ssm:GetParametersByPath` and, for customer-managed encrypted parameters, appropriate `kms:Decrypt`. Parameter final path components become variable names; duplicate names fail.

Secrets Manager uses `SECRETS_ARN`, `secretsmanager:GetSecretValue`, and applicable KMS access. Store a JSON object of environment values: strings are preserved, numbers/booleans become strings, and null becomes an empty string; nested objects/arrays fail. Double-encoded JSON objects are accepted for compatibility. AWS uses its standard credential provider chain and `AWS_REGION`/`AWS_DEFAULT_REGION`; prefer workload identity over long-lived keys.

Vault uses `VAULT_ADDR`, `VAULT_TOKEN`, optional `VAULT_NAMESPACE`, and `VAULT_SECRET_PATH`. The secret path is the complete API path after `/v1/`: KV v2 includes `/data/`, for example `secret/data/source`. `VAULT_KV_VERSION` defaults to `2`; use `1` for KV v1. Grant read capability to that exact path. HTTP errors, timeout, invalid version/payload, and redirects are rejected. Bootstrap credentials and selectors must exist before launching, outside the payload.

## Running

Install the separate launcher dependencies after a host checkout:

```sh
npm ci --prefix scripts/runtime --omit=dev
node scripts/runtime/launch.mjs node scripts/db/migrate.mjs
```

Build without providing secrets:

```sh
docker build -f Dockerfile.node24 -t question-generation/knowledge-source-service:node24 .
```

For a read-only local env mount, create `.env.local` privately, then run from this project directory (POSIX shell example):

```sh
docker run --rm --mount "type=bind,source=$(pwd)/.env.local,target=/app/.env.local,readonly" -e NODE_ENV=development question-generation/knowledge-source-service:node24
```

For SSM, export selectors and AWS workload credentials through your deployment platform and pass them at runtime. For example, `docker run --rm -e SSM_PATH -e AWS_REGION` followed by the image name uses already exported values. Credentials also need to be available to the container's credential chain. Container-side credential/token files require explicit read-only mounts; host file paths alone do not transfer files.

The validated baseline is Docker Compose v5.1.4; older versions have not been validated for this fallback configuration. Compose automatically mounts this project directory read-only at `/run/project-config` and optionally reads its `.env.local` at startup. No shell variables, renaming, or `--env-file` are needed. The mount is a directory so an absent optional file does not create a host file. Private env files remain excluded from image builds. Before the first startup, run the separate Compose build below to prepare the app and PostgreSQL image containing the pinned Node parser. Repeat that build after image-source changes. The validated lifecycle uses this build preparation; fresh-image creation ordering with a single `up --build` command has not been validated. `config --quiet`, `logs` and `down` do not require a password.


Optional `.env.local` example for this project (fake values only; choose a private password before use):

```dotenv
PGUSER=knowledge_source_user
PGDATABASE=knowledge_source
PGPASSWORD=replace-with-your-private-password
```

The user and database keys may be omitted to use the local defaults. Keep the password consistent with an existing volume; editing this file does not change its database role password.
Run from this project directory in PowerShell:

```powershell
docker compose -f docker-compose.node24.yml build
docker compose -f docker-compose.node24.yml up -d --wait
docker compose -f docker-compose.node24.yml logs --tail 100
docker compose -f docker-compose.node24.yml down
```

The build is one-time preparation for the current image sources. Startup then runs the bundled DB, migration, seed and API in dependency order. Normal `down` preserves the named data volumes.

For each PG key, precedence is explicit `SOURCE_*`, explicit `PG*`, payload `SOURCE_*`, payload `PG*`, then local defaults. Presence includes empty strings: empty required keys fail with their names. Normal Compose shell, `.env`, and explicit CLI inputs are all explicit container configuration; `.env.local` is the separate optional fallback. Bootstrap controls come only from explicit configuration. `ENV_FILE` remains an explicit container path and a missing selected file fails. Relative paths resolve from each process working directory: the app uses `/app`, while the PostgreSQL image does not share that directory. For a Compose override, use an absolute mounted path such as `/run/project-config/custom.env` so app and DB select the same file; `ENTRYPOINT_LOCAL_ENV` is the optional mounted path set by Compose.

Local DB defaults are `PGUSER=knowledge_source_user` and `PGDATABASE=knowledge_source`; provide `PGPASSWORD` privately (the older `SOURCE_PGPASSWORD` remains supported). Local app and DB resolve identical credentials; local app host/port become `source-db:5432`. Storage becomes `/app/storage/knowledge`. The local feature defaults remain tenant/K12 disabled and `DEFAULT_KNOWLEDGE=marble;learning_commons`; `SOURCE_REDIS_URL` aliases `REDIS_URL` with the same precedence. Changing a configured password does not modify a role in an existing volume; coordinate any credential change separately.

Compose forwards supported remote selectors and credentials without empty placeholders. A selected remote app source loads no local payload or local defaults and retains remote PG coordinates; required remote PG keys must be present. The bundled DB independently reads local initialization settings and never calls remote providers. Standard `up` still starts that bundled DB and therefore still requires its local password even for a remote app. An intentionally isolated `run --no-deps` app command can use only remote configuration. Validate with `config --quiet`; never print rendered secret configuration or point verification migrations at an existing database.

The API needs PostgreSQL and writable artifact storage for `/readyz`; `/healthz` is only liveness. Redis remains optional. Entrypoint integration does not change Source access policy or enable K12/tenant scope.

## Verification boundary

Runtime tests use local files and injected provider fixtures; they do not prove access to a real AWS account or Vault deployment. Live remote integration needs deployment-specific identity, policies, endpoint access, and disposable test secrets. Docker build/lifecycle results must be recorded separately from these instructions. This change does not establish the complete production upgrade roadmap.

## Launcher snapshot and tests

The launcher freezes configuration for the lifetime of the launched process tree. A scoped Node preload (`scripts/runtime/next-env.cjs`) prevents Next's development watcher and forced dotenv reloads from merging additional files; restart through the entrypoint after changing configuration. Direct `npm run dev` keeps normal Next behavior. Existing `NODE_OPTIONS` are preserved; secret payloads cannot supply them. The preload is inert when Next is not installed. Re-run the Next integration tests after upgrading Next or Node because this guard uses the CommonJS module cache and Next environment API.

Bootstrap settings (`AWS_*`, `VAULT_*`, source selectors, `ENV_FILE`, `ENTRYPOINT_*`) and process loader controls belong in the original process environment, not the loaded payload. `ENTRYPOINT_TIMEOUT_MS` defaults to 15000 and accepts integers from 1 to 300000. `SECRET_JSON` is an optional inline JSON source with the same validation as remote JSON.

For a host checkout, install both application and runtime dependencies before verification:

```sh
npm ci
npm ci --prefix scripts/runtime --omit=dev
npm run test:entrypoint
```

AWS tests use the real locked SDK, dummy credentials and loopback HTTP fixtures for request signing/serialization, pagination, access denial and timeout. Vault tests use loopback HTTP fixtures for KV1/KV2. These are local integration tests, not live AWS/Vault deployments. The earlier entrypoint verification dated 2026-09-10 built all three images, checked six container development/fallback cases, checked both Next services' liveness/readiness against disposable PostgreSQL, applied migrations there, and verified graceful shutdown. Those checks predate automatic Compose mounting and the Source DB bootstrap. The separate [Compose fallback verification report](../../../.codex-autopilot/COMPOSE-FALLBACK-VERIFICATION-2026-09-11.md) records this feature's acceptance results and verification boundaries. No existing database/Redis deployment or live secret store was changed.
# 2026-10-01 local Redis host mapping

For the local `ENTRYPOINT_COMPOSE_PROJECT=source` application with no selected remote secret source, a Redis URL using `localhost`, `127.0.0.1` or `::1` now addresses `host.docker.internal`. The URL's scheme, credentials, port, database and query remain intact. `SOURCE_REDIS_HOST` is an explicit host override. Non-loopback URLs, native execution, selected remote sources, the source-db entrypoint and an empty optional Redis URL keep their previous behavior. Private env files need no edits.

Evidence: source-redis-1001-red-valid.log (2 pass/4 fail), green-elevated.log (14 pass/1 existing optional skip), source-redis-live-1001.json (`PING=PONG`). Only the Source application was rebuilt/recreated with `--no-deps --no-build`; no seed, migration, database or Redis recreation. A working cache does not provide missing published Source artifacts: the current runtime-index alias request returns HTTP404 and retrieval returns zero results.
