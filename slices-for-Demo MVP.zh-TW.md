# Knowledge Source Service Demo MVP 垂直切片

來源範圍：`完整版階段性規劃.md` 的 **12.1 Demo MVP 確認市場**。

工作方式：

- 以 vertical slice 推進，不用資料庫、後端、前端這種水平切法。
- 每個 slice 開始前，先用 grill / grill-with-docs 釐清行為與取捨。
- 需求清楚後先整理小型 spec，再開始實作。
- 優先採 TDD：先寫會失敗的測試，再補實作。
- 每個 slice 完成後跑 `npm test`、`npm run lint`、build/typecheck。若 `dev:host` 正在占用 `.next`，使用 `npm run build:isolated`。
- 設計偏好 deep modules：對外介面小，複雜度收進模組內。

## 目前進度

| Slice | 名稱 | 狀態 | 備註 |
| --- | --- | --- | --- |
| Baseline | Runtime Index Latest Metadata Trace | 已完成 | latest endpoint 回 artifact/index/summary 與第一版 publish status。 |
| 01 | Import Summary and Rerun Trace | 已完成 | import summary 會寫到 stdout、audit event payload、`reports/latest-import-summary.json`。 |
| 02 | Artifact Publish Status Query | 已完成 | `/v1/artifacts` 支援 `publish_status` filter；artifact detail 回 `publish_status`。 |
| 03 | Runtime Index Version History and Pinning | 已完成 | `runtime-index:latest` 指向 immutable `runtime-index:sha256:<checksum>` artifact。 |
| 04 | Latest Runtime Index Metadata Endpoint Polish | 已完成 | latest response 明確回 alias/version/trace metadata，並保留相容欄位。 |
| 05 | Runtime Index Diff | 已完成 | `/v1/runtime-index/diff` 支援預設比較與 explicit artifact 比較。 |
| 06 | Read Observability and Cache Metadata | 已完成 | ETag、Cache-Control、trace headers、optional Redis response cache、import 後 cache invalidation。 |
| 07 | OpenAPI Contract for Demo APIs | 已完成 | Static YAML contract、`/openapi.json`、`npm run openapi:validate`。 |
| 08 | Optional Service Key Auth | 已完成 | v1 demo read APIs 支援 optional Bearer service key auth。 |

## 已完成 Baseline - Runtime Index Latest Metadata Trace

**狀態：**已完成

**交付：**`GET /v1/runtime-index/latest` 回傳 demo trace 所需的 runtime index metadata：artifact id、checksum、publish status、summary 與 index payload。

**已實作：**

- `getLatestRuntimeIndex()` 回傳 `artifact`、`summary`、`index`。
- artifact row 加入 `publish_status`。
- 透過 `createSources()` 建立可測試 seam。
- 修正 `.gitignore`，讓 `src/lib/storage/artifacts.js` 成為可追蹤 source code。

**已驗證：**

- `npm test`
- `npm run lint`
- `npm run db:migrate`
- `npm run import:ai-workflow-knowledge`
- 後續在停止/重啟 dev server 後，由使用者驗證 `npm run build`。

## 01 - Import Summary and Rerun Trace

**狀態：**已完成

**Blocked by：**Baseline

**交付：**每次 compatibility import 都會產生可重現摘要：sources 數量、artifacts 數量、runtime index artifact id、checksum，以及哪些 artifacts 是 created、changed、unchanged。同一份 summary 也會保存，方便 demo 後追溯。

**已實作：**

- 新增 `scripts/import/import-summary.mjs`。
- import output 包含：
  - `source_count`
  - `artifact_count`
  - `created_count`
  - `changed_count`
  - `unchanged_count`
  - `runtime_index.artifact_id`
  - `runtime_index.checksum_sha256`
  - `runtime_index.publish_status`
- summary 保存到：
  - stdout
  - `storage/knowledge/reports/latest-import-summary.json`
  - artifact registry，artifact id 為 `import-summary:latest`
  - audit event payload 的 `import_summary`
- 第一版不處理 deleted artifact detection。

**測試：**

- `test/import-summary.test.mjs`

**已驗證：**

- `npm test`
- `npm run lint`
- `npm run import:ai-workflow-knowledge`
- 使用者後續驗證 `npm run build`。

## 02 - Artifact Publish Status Query

**狀態：**已完成

**Blocked by：**Baseline

**交付：**`/v1/artifacts` 可以用 `publish_status` 查詢，artifact detail 也穩定回傳 `publish_status`。

**已實作：**

- 支援 publish statuses：
  - `imported`
  - `published`
  - `validated`
  - `deprecated`
- `GET /v1/artifacts?publish_status=published` 只回 published artifacts。
- `GET /v1/artifacts?publish_status=imported` 只回 imported artifacts。
- 不支援的 `publish_status` 回穩定 `400 bad_request`。
- 既有 `artifact_type`、`source`、`limit` filters 持續可用。

**測試：**

- `test/artifacts.test.mjs`

**已驗證：**

- `npm test`
- `npm run lint`
- `npm run build`
- dev server HTTP smoke。

## 03 - Runtime Index Version History and Pinning

**狀態：**已完成

**Blocked by：**01、02

**交付：**每次 import/runtime publish 都保留 immutable runtime index version artifact，不只覆蓋 `runtime-index:latest`。Consumer 可用 artifact id 讀取 pinned runtime index。

**已採用 production-ish 命名：**

- Mutable alias artifact id：`runtime-index:latest`
- Immutable pinned artifact id：`runtime-index:sha256:<full_sha256>`
- Immutable storage path：`index/versions/sha256/<full_sha256>.json`
- Latest alias metadata 包含：
  - `points_to_artifact_id`
  - `index_version`
  - `source_artifact_path`
- Pinned artifact metadata 包含：
  - `alias_artifact_id`
  - `index_version`
  - `source_artifact_path`

**測試：**

- `test/runtime-index-pinning.test.mjs`
- `test/sources.test.mjs`

**已驗證：**

- `npm test`
- `npm run lint`
- `npm run import:ai-workflow-knowledge`
- 使用者驗證 `npm run build`
- HTTP smoke 驗證 pinned artifact detail 與 raw payload。

## 04 - Latest Runtime Index Metadata Endpoint Polish

**狀態：**已完成

**Blocked by：**03

**交付：**latest runtime index response 明確區分 mutable alias metadata 與 immutable pinned artifact metadata。Consumer 不需要猜目前讀的是 alias 還是 pinned version。

**已實作 response shape：**

- `trace_mode`
  - `content_addressed_version`
  - `legacy_alias_only`
- `alias`
- `version`
- 保留相容欄位：
  - `artifact`
  - `summary`
  - `index`

**測試：**

- `test/sources.test.mjs`

**已驗證：**

- `npm test`
- `npm run lint`
- 使用者驗證 `npm run build`
- HTTP smoke 驗證 `/v1/runtime-index/latest`。

## 05 - Runtime Index Diff

**狀態：**已完成

**Blocked by：**03

**交付：**API 可比較 runtime index artifacts，並回傳 compact summary：新增、移除、變更的 sources/topics/source refs。Demo 前可快速確認這次 knowledge index 有哪些變動。

**已實作：**

- 新 endpoint：`GET /v1/runtime-index/diff`
- Explicit comparison：
  - `?from=<artifact_id>&to=<artifact_id>`
- Default comparison：
  - latest alias pointer vs previous published pinned runtime index
- 若歷史版本不足，回 `status: "insufficient_history"`，不視為 API error。
- Topic identity 使用 `topic_key`。
- Topic `changed` 偵測穩定 subset：
  - `topic_label`
  - `mapping_status`
  - `aliases`
  - `keywords`
  - selected `retrieved_sources` fields
- Sources added/removed 以 `source` 回報。

**測試：**

- `test/runtime-index-diff.test.mjs`
- `test/sources.test.mjs`

**已驗證：**

- `npm test`
- `npm run lint`
- DB seam checks。

## 06 - Read Observability and Cache Metadata

**狀態：**已完成

**Blocked by：**04

**交付：**runtime index 與 artifact reads 會提供 cache 與 trace metadata。當 `.env.local` 設定 `REDIS_URL` 時，Redis 會快取 API response body 與 headers metadata；未設定 Redis 時，完全維持原本 DB/storage 讀取模式。

**已接上 endpoints：**

- `GET /v1/runtime-index/latest`
- `GET /v1/artifacts/:artifactId`
- `GET /v1/artifacts/:artifactId/raw`

**已實作 response headers：**

- `ETag: "sha256:<checksum>"`
- `Cache-Control`
  - immutable content-addressed runtime index：`public, max-age=31536000, immutable`
  - mutable alias/imported/report reads：`no-cache`
- `X-Knowledge-Source-Cache`
  - `hit`
  - `miss`
  - `bypass`
- `X-Knowledge-Source-Trace-Mode`
- `X-Artifact-ID`
- `X-Artifact-Checksum-SHA256`
- `X-Artifact-Publish-Status`
- Runtime index latest 額外包含：
  - `X-Runtime-Index-Alias-ID`
  - `X-Runtime-Index-Version-ID`

**已實作 Redis 行為：**

- 只有設定 `REDIS_URL` 時啟用。
- 快取 API response body 與 headers metadata。
- Redis key prefix：`knowledge-source:v1:*`
- Mutable TTL：`30` 秒。
- Immutable TTL：`31536000` 秒。
- Redis 失敗時 fallback origin read，不中斷 API。
- 支援 `If-None-Match -> 304 Not Modified`。
- import/publish 成功並 DB commit 後，主動 invalidation mutable read cache keys。
- Read observability 維持在 response/header 層，不新增 read audit DB event。

**測試：**

- `test/read-response-cache.test.mjs`
- `test/import-cache-invalidation.test.mjs`

**已驗證：**

- `npm test`：26 passed
- `npm run lint`
- `npm run build:isolated`
- HTTP smoke：
  - 第一次 read：`miss`
  - 第二次 read：`hit`
  - `If-None-Match`：`304`
  - 跑 `npm run import:ai-workflow-knowledge` 後，latest read 變回 `miss`，確認 invalidation 生效。

## 07 - OpenAPI Contract for Demo APIs

**狀態：**已完成

**Blocked by：**04、06

**交付：**為 demo-facing runtime index 與 artifact APIs 建立 OpenAPI contract，讓後續 AI Workflow 可以依照穩定契約串接。

**涵蓋：**

- OpenAPI contract
- Consumer alignment

**驗收條件：**

- OpenAPI spec 描述 runtime index latest。
- OpenAPI spec 描述 pinned runtime index retrieval。
- OpenAPI spec 描述 artifact list/detail/raw。
- OpenAPI spec 描述 runtime index diff。
- Spec 文件化 cache headers 與 optional Redis 行為，但 Redis 仍屬 implementation detail。
- Spec 文件化 auth 在 Slice 08 前仍為 optional。

**已實作：**

- 新增 `openapi/knowledge-source-service.openapi.yaml`。
- 新增 `GET /openapi.json`。
- 新增 `npm run openapi:validate`。
- Contract 描述：
  - `/v1/runtime-index/latest`
  - `/v1/runtime-index/diff`
  - `/v1/artifacts`
  - `/v1/artifacts/{artifactId}`
  - `/v1/artifacts/{artifactId}/raw`
  - cache 與 trace response headers
- Redis 維持 implementation detail；contract 只描述 consumer 可見的 cache headers。

**測試：**

- `test/openapi-spec.test.mjs`

**已驗證：**

- `npm test`
- `npm run openapi:validate`
- `npm run lint`
- `npm run build:isolated`
- HTTP smoke against `GET /openapi.json`

## 08 - Optional Service Key Auth

**狀態：**已完成

**Blocked by：**07

**交付：**若設定 `KNOWLEDGE_SOURCE_KEY`，consumer 必須提供正確 service key；未設定時，local demo 維持開放。此 slice 不做 tenant/user policy。

**涵蓋：**

- Demo optional API auth
- Production-readiness first step

**驗收條件：**

- 未設定 `KNOWLEDGE_SOURCE_KEY` 時，現有 local demo requests 持續可用。
- 設定 `KNOWLEDGE_SOURCE_KEY` 時，缺少、格式錯誤、或錯誤 credential 都會收到穩定 `401 Unauthorized` auth error。
- 設定 `KNOWLEDGE_SOURCE_KEY` 時，正確 credential 可讀 runtime index 與 artifacts。
- Auth 僅為 service-level；tenant filtering 不在範圍內。

**已實作：**

- 只有設定 `KNOWLEDGE_SOURCE_KEY` 時啟用 auth。
- Protected endpoints 需要 `Authorization: Bearer <key>`。
- Protected endpoints：
  - `/v1/runtime-index/latest`
  - `/v1/runtime-index/diff`
  - `/v1/artifacts`
  - `/v1/artifacts/{artifactId}`
  - `/v1/artifacts/{artifactId}/raw`
- Unprotected endpoints：
  - `/openapi.json`
  - `/healthz`
  - `/readyz`
- 缺少、格式錯誤、錯誤 credentials 全部回同一個穩定錯誤：
  - status：`401`
  - message：`Unauthorized.`
  - type：`auth_error`
  - code：`unauthorized`
- Service key 使用 constant-time compare。
- OpenAPI contract 為 protected endpoints 補上 `bearerAuth` 與 `401` responses。

**測試：**

- `test/service-key-auth.test.mjs`
- `test/openapi-spec.test.mjs`

**已驗證：**

- `npm test`
- `npm run openapi:validate`
- `npm run lint`
- `npm run build:isolated`
- Auth disabled HTTP smoke on port `3200`
- Temporary production server smoke with `KNOWLEDGE_SOURCE_KEY=demo-secret` on port `3201`：
  - `/openapi.json`：`200`
  - missing credential：`401`
  - malformed credential：`401`
  - wrong credential：`401`
  - correct Bearer token：`200`
  - `/openapi.json`、`/healthz`、`/readyz`：`200`

## 建議實作順序

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
