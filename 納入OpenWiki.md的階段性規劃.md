# knowledge-source-service 納入 OpenWiki.md 的階段性規劃

## 目標

將 OpenWiki 納入 `knowledge-source-service`，建立資料來源、artifact、runtime index、pinning、cache、auth 與 OpenAPI contract 的維護型 wiki。

本服務是 Question Generation 系統中的資料來源邊界。它負責發布 source registry、source versions、artifacts 與 runtime index，讓 `ai-workflow-service` 與 `knowledge-synthesis-service` 透過 API 取得知識索引，而不是直接讀其他服務的 filesystem。

## Phase 0：Source Boundary 盤點

### Spec

- OpenWiki 必須明確說明本服務是 source/artifact API boundary。
- 文件要說明目前第一版仍是 compatibility bridge，會匯入 `ai-workflow-service/knowledge`。
- 文件要說明長期目標是讓 source sync/normalize/mapping jobs 移到本服務。

### OpenWiki 特別整理

- `README.md` 的 service boundary。
- `scripts/import/import-ai-workflow-knowledge.mjs` 的匯入流程。
- `scripts/import/runtime-index-pinning.mjs` 的 pinned artifact 規則。
- `src/lib/sources/sources.js` 的 source/artifact/runtime index service layer。
- `db/migrations/*` 的資料模型。

### 建議 `.openwikiignore`

```text
node_modules/
.next/
.env*
package-lock.json
storage/
```

### 驗收標準

- Wiki 能說明本服務是唯一資料來源 API 邊界。
- Wiki 能說明目前 import script 從 `ai-workflow-service/knowledge` 複製資料只是過渡做法。
- Wiki 能說明其他服務應呼叫 API，不應直接讀 storage。

## Phase 1：Artifact 與 Source Registry 文件化

### Spec

- 文件化 source registry、source versions、artifacts 的 DB schema 與 API 對應。
- 文件化 artifact status 與 content type。

### OpenWiki 特別整理

- API route：
  - `/v1/sources`
  - `/v1/sources/:source/versions`
  - `/v1/artifacts`
  - `/v1/artifacts/:artifactId`
  - `/v1/artifacts/:artifactId/raw`
- DB tables：
  - `knowledge_source_registry`
  - `knowledge_source_versions`
  - `knowledge_source_artifacts`
  - `knowledge_source_audit_events`
- Artifact metadata：
  - `artifact_id`
  - `artifact_type`
  - `source`
  - `source_version`
  - `storage_path`
  - `content_type`
  - `publish_status`
  - `checksum_sha256`
  - `metadata`

### 驗收標準

- Wiki 能說明 registry、version、artifact 三者差異。
- Wiki 能說明 artifact payload 可透過 parsed JSON 或 raw endpoint 取得。
- Wiki 能說明 `publish_status` 可為 `imported`、`published`、`validated`、`deprecated`。

## Phase 2：Runtime Index 與 Pinning 文件化

### Spec

- 文件化 `runtime-index:latest` alias 與 checksum pinned runtime index 的差異。
- 文件必須說明 consumer 如何取得 provenance 與 cache headers。

### OpenWiki 特別整理

- `/v1/runtime-index/latest`
- `/v1/runtime-index/diff`
- Runtime index response：
  - `trace_mode`
  - `alias`
  - `version`
  - `artifact`
  - `summary`
  - `index`
- Pinning artifact：
  - `runtime-index:latest`
  - `runtime-index:sha256:<checksum>`
  - `points_to_artifact_id`
  - `index_version`
  - `checksum_sha256`
- Diff behavior：
  - explicit `from` and `to`
  - latest vs previous published artifact
  - insufficient history

### 驗收標準

- Wiki 能說明 latest 是 mutable alias，sha256 artifact 是 content-addressed version。
- Wiki 能說明 AI workflow 可用 version/artifact/checksum pin 避免 index 漂移。
- Wiki 能說明 runtime index diff 可以用於 demo/readiness 或 release review。

## Phase 3：Auth、Cache、ETag 文件化

### Spec

- 文件化 service key auth 與 read response cache。
- 文件要說明 Redis 不可用時服務仍能 bypass cache。

### OpenWiki 特別整理

- `src/lib/http/service-key-auth.js`
  - `KNOWLEDGE_SOURCE_KEY`
  - Bearer token
  - constant-time compare
  - key 未設定時 auth disabled
- `src/lib/http/read-response-cache.js`
  - Redis response cache
  - cache hit/miss/bypass
  - ETag
  - If-None-Match
  - mutable vs immutable cache control
- Headers：
  - `ETag`
  - `Cache-Control`
  - `X-Knowledge-Source-Cache`
  - `X-Runtime-Index-Alias-ID`
  - `X-Runtime-Index-Version-ID`
  - `X-Artifact-ID`
  - `X-Artifact-Checksum-SHA256`
  - `X-Artifact-Publish-Status`

### 驗收標準

- Wiki 能說明哪些 endpoint 需要 service key，哪些公開。
- Wiki 能說明 Redis 只是 cache，不是資料來源。
- Wiki 能說明 immutable artifact 可以長 cache，latest alias 應是 mutable/no-cache。

## Phase 4：Import Pipeline 文件化

### Spec

- 文件化 `import:ai-workflow-knowledge` 的逐步行為。
- 文件要說明 import 後如何 invalidate mutable read cache。

### OpenWiki 特別整理

- 匯入來源：
  - `AI_WORKFLOW_KNOWLEDGE_DIR`
  - default `../ai-workflow-service/knowledge`
- 匯入目的：
  - `KNOWLEDGE_SOURCE_STORAGE_ROOT`
  - default `storage/knowledge`
- 匯入步驟：
  - copy source tree
  - read `sources.json`
  - upsert source registry
  - upsert source versions
  - upsert artifacts
  - build pinned runtime index artifact
  - write import summary
  - write audit event
  - invalidate cache

### 驗收標準

- Wiki 能說明 import summary 的 created/changed/unchanged 統計。
- Wiki 能說明 import script 如何產生 `runtime-index:latest` 與 pinned artifact。
- Wiki 能說明 artifact id 如何從 storage path 轉換而來。

## Phase 5：OpenAPI Contract 與 Consumer 整合

### Spec

- 文件化 OpenAPI contract 與 consumer 端期待。
- 文件要明確指出 `ai-workflow-service` 與 `knowledge-synthesis-service` 的 base URL 設定差異風險。

### OpenWiki 特別整理

- `openapi/knowledge-source-service.openapi.yaml`
- `src/app/openapi.json/route.js`
- Consumer expectations：
  - `ai-workflow-service` 可接受 `KNOWLEDGE_SOURCE_BASE=http://host:3200` 或 `http://host:3200/v1`，client 會嘗試兩種 endpoint。
  - `knowledge-synthesis-service` 目前 runtime index client 會呼叫 `${KNOWLEDGE_SOURCE_BASE}/runtime-index/latest`，因此整合時較適合設為 `http://host:3200/v1`。

### 驗收標準

- Wiki 能說明 OpenAPI contract 是 demo-facing runtime index/artifact read contract。
- Wiki 能說明 integration smoke 應確認 `/v1/runtime-index/latest` 回傳 `object=runtime_index`、summary、index topics。
- Wiki 能標示 base URL 設定錯誤會導致 Synthesis runtime index provenance unavailable。

## Phase 6：持續更新規範

### Spec

- 修改 artifact schema、runtime index response、cache headers、auth、import pipeline、OpenAPI contract 時必須更新 OpenWiki。

### 驗收標準

- OpenWiki 能回答「某個 artifact 從哪個 source/version 來」。
- OpenWiki 能回答「latest runtime index 指向哪個 pinned artifact」。
- OpenWiki 能回答「consumer 應如何設定 base URL 與 service key」。
- OpenWiki 能回答「runtime index 變更如何被 diff 與追蹤」。

