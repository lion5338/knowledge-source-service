# Knowledge Source Service

Deployable source-ingestion and artifact service for the Question Generation system.

This service owns source registry metadata, raw snapshots, normalized artifacts, mappings, reports, and the exported runtime knowledge index. `ai-workflow-service` should call this service through API instead of reading another service's filesystem.

## Development

```bash
npm install
npm run db:migrate
npm run import:ai-workflow-knowledge
npm run dev:host
```

Default URL:

```text
http://127.0.0.1:3200
```

## APIs

```text
GET /healthz
GET /readyz

GET /v1/sources
GET /v1/sources/:source/versions

GET /v1/artifacts
GET /v1/artifacts/:artifact_id
GET /v1/artifacts/:artifact_id/raw

GET /v1/runtime-index/latest
```

## First Boundary

The first implementation imports the existing `ai-workflow-service/knowledge` folder into this service's private `storage/knowledge` directory and records metadata in PostgreSQL.

This is intentionally a compatibility bridge. Later phases should move sync, normalization, and mapping jobs here permanently.

## Runtime Contract

`ai-workflow-service` can be configured with:

```text
KNOWLEDGE_SOURCE_BASE=http://127.0.0.1:3200/v1
KNOWLEDGE_SOURCE_KEY=
```

When the API is reachable, it can fetch `/v1/runtime-index/latest`; if unreachable, current code falls back to the local `knowledge/index/knowledge-index.json` bootstrap artifact.
