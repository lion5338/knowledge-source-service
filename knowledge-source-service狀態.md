# knowledge-source-service 狀態

更新日期：2026-08-11

此文件是 `knowledge-source-service` 的單一主狀態文件，整合原本散落在下列文件中的設計、實作紀錄、階段性規劃與狀態盤點：

- `README.md`
- `20260803代辦事項.md`
- `slices-for-Demo MVP.md`
- `slices-for-Demo MVP.zh-TW.md`
- `完整版階段性規劃.md`
- `實作計畫.md`
- `由 knowledge-source-service 當唯一資料來源-實作方法.md`
- `knowledge-source-service唯一資料來源-vertical-slice階段性規劃.md`

保留但不併入本文件：

- `knowledge_source_pg_readme.md`：PostgreSQL / DB 操作與環境說明。
- `納入OpenWiki.md的階段性規劃.md`：OpenWiki 納入 Knowledge Source 的獨立後續規劃。

## 1. 目前總結

`knowledge-source-service` 目前已經完成「由 Knowledge Source 作為核心唯一資料來源」的 Source service 端主要能力。

已完成的主軸包含：

- Source Collection Registry
- K12-KGraph full / Marble / Learning Commons source collection 登錄
- raw snapshot ingestion
- normalized artifact build pipeline
- topic candidates artifact build/export
- runtime index publish/latest/diff
- retrieval API lexical MVP
- artifact list/detail/raw API
- service key auth
- tenant-aware Knowledge Access Resolver
- tenant entitlement DB schema and key hash store
- access-aware runtime index / retrieval / artifact / topic candidate / collection policy
- OpenAPI contract
- sole-source readiness smoke

尚未完成的主軸主要屬於「下一階段產品化」或「跨服務遷移」：

- tenant upload lifecycle 還沒有完整 API 與 build pipeline。
- retrieval 仍是 lexical MVP，尚未升級為 vector / hybrid / rerank。
- `profile=demo|mvp|prod` 已降為相容層，但尚未從所有下游與 contract 完全移除。
- `ai-workflow-service` 尚未完全改成只吃 Source/Synthesis 發布的 runtime contract。
- object storage、quota、tenant sharing、per-tenant index materialization、observability dashboard 尚未完整產品化。

## 2. 服務定位與邊界

### 2.1 knowledge-source-service 負責

`knowledge-source-service` 是所有知識來源進入系統的唯一入口，負責：

- 登錄知識集合：例如 `k12_kgraph_full`、`marble`、`learning_commons`、未來 tenant uploaded collections。
- 保存 source metadata：license、attribution、profile policy、visibility policy、checksum、artifact id、collection id。
- ingestion/build 階段讀 raw dataset。
- 將 raw dataset 轉成 normalized artifacts。
- 發布可被其他服務消費的 API / artifact。
- 根據 request key、環境變數與 DB entitlement 決定本次 request 可看到哪些 collection。
- 對所有 read API 回傳 artifact id、checksum、license、attribution、access trace。
- 提供 readiness smoke，確保 runtime path 不需要直接掃 raw dataset。

### 2.2 knowledge-source-service 不負責

下列事項不屬於本服務長期責任：

- 題目生成流程。
- prompt context review。
- topic registry 的人工審核狀態。
- alias review status。
- source mapping review status。
- wiki page authoring / synthesis。
- Taiwan curriculum mapping 的審核流程。
- AI workflow orchestration。

這些應由 `knowledge-synthesis-service` 或 `ai-workflow-service` 持有。Source service 僅提供可追溯、授權可控、normalized 的知識來源。

## 3. Production Access Model

目前的 production 方向已從 `demo|mvp|prod profile` 改為 Knowledge Access Resolver。

### 3.1 核心環境變數

```env
KNOWLEDGE_SOURCE_KEY=<service-level-read-key>
ENABLE_TENANT=false
ENABLE_K12=false
DEFAULT_KNOWLEDGE=marble;learning_commons
```

production 預設解讀：

- `KNOWLEDGE_SOURCE_KEY`：service-level API key，給 trusted internal services 使用。
- `ENABLE_TENANT=false`：不查 tenant DB，不啟用 tenant-specific scope。
- `ENABLE_K12=false`：即使 DB 或 request 嘗試要求 K12，也不對外暴露 K12。
- `DEFAULT_KNOWLEDGE=marble;learning_commons`：沒有 tenant entitlement 或 tenant 功能關閉時，只對外輸出 Marble / Learning Commons。

若 `ENABLE_K12=true`：

- resolver 可以把 `k12_kgraph_full` 加入可用 collection。
- 建議把預設知識範圍視為 `marble;learning_commons;k12_kgraph_full`。
- K12 仍需經過 license / attribution / policy trace。

若 `ENABLE_TENANT=true`：

- request key 會先用 bearer token 取得身份。
- tenant key 不保存明文，只保存 SHA-256 hash。
- resolver 會透過 DB 查 tenant/user/API key 可用的 collection entitlement。
- 若該 tenant/user 沒有任何 entitlement，fallback 到 `DEFAULT_KNOWLEDGE`。
- request query/body 傳入的 collection filter 只能縮小範圍，不能擴權。

### 3.2 API key 使用方式

所有受保護的 read/metadata API 使用同一種 header：

```http
Authorization: Bearer <key>
```

key 的角色由服務端判斷：

- 若符合 `.env` 的 `KNOWLEDGE_SOURCE_KEY`，視為 service-level caller。
- 若 `ENABLE_TENANT=true`，也可用 tenant API key；服務端用 hash 查 DB，不回傳 key 明文或 hash。
- 若兩者都不符合，回穩定 `401 Unauthorized`。

不要在文件、log、response 或測試 snapshot 中輸出真實 key。

## 4. 目前對外 API Surface

### 4.1 Health / Contract

- `GET /healthz`
- `GET /readyz`
- `GET /openapi.json`

### 4.2 Source Collection / Source Metadata

- `GET /v1/source-collections`
- `GET /v1/source-collections/:collectionId`
- `GET /v1/sources`
- `GET /v1/sources/:source/versions`

### 4.3 Artifact

- `GET /v1/artifacts`
- `GET /v1/artifacts/:artifactId`
- `GET /v1/artifacts/:artifactId/raw`

### 4.4 Runtime Index

- `GET /v1/runtime-index/latest`
- `GET /v1/runtime-index/diff`

`/v1/runtime-index/latest` 現在可以不帶 `profile`。服務會根據 request key、`ENABLE_TENANT`、`ENABLE_K12`、`DEFAULT_KNOWLEDGE` 與 tenant entitlement 決定可見 collection，並在 response 中帶 access trace。

### 4.5 Topic Candidates

- `GET /v1/topic-candidates/export`

`profile` 參數已變成 optional/deprecated。呼叫端應改以 request key + access resolver scope 取得授權後的 topic candidates。

### 4.6 Retrieval

- `POST /v1/retrieve`

retrieval 目前是 lexical MVP：

- 使用已發布 retrieval index。
- 根據 query 做文字相似度/關鍵字式檢索。
- 會用 `effective_collection_ids` 做 hard filter。
- 會排除不在 access scope 內或 stale 的 retrieval index。
- response 包含 artifact/checksum/license/access trace。

## 5. 原 Demo MVP 專案預計完成的功能

這一段保留早期 Demo MVP 專案的目標脈絡。它原本的重點不是完整的多租戶知識平台，而是先讓 demo 可以穩定地透過 `knowledge-source-service` 取得 runtime knowledge，並逐步替代 `ai-workflow-service` 直接讀本機 knowledge index 的方式。

原 Demo MVP 預計完成的功能如下：

| 功能名稱 | 原本目的 | 目前結果 |
|---|---|---|
| Runtime Index Latest Metadata Trace | 讓 `/v1/runtime-index/latest` 回傳 artifact、summary、index 與 trace，方便 AI Workflow 知道自己吃到哪個版本 | 已完成，並已升級為 access-aware runtime index |
| Import Summary and Rerun Trace | 匯入 AI Workflow knowledge 時記錄 run id、checksum、topic count、source count、artifact path，方便追蹤每次重跑差異 | 已完成 |
| Artifact Publish Status Query | 支援 `publish_status=imported|published`，避免 runtime 誤吃未正式發布的 artifact | 已完成 |
| Runtime Index Version History and Pinning | 建立 `runtime-index:latest` mutable alias 與 `runtime-index:sha256:<checksum>` immutable artifact | 已完成 |
| Latest Runtime Index Endpoint Polish | 補齊 `trace_mode`、alias、version、checksum、backward-compatible fields | 已完成，並已加上 license/access trace |
| Runtime Index Diff | 提供 `/v1/runtime-index/diff` 比較兩版 runtime index 的 topic/source 變化 | 已完成 |
| Read Observability and Cache Metadata | 支援 `ETag`、`Cache-Control`、`X-Artifact-ID`、checksum headers、optional Redis cache | 已完成 |
| OpenAPI Contract for Demo APIs | 用 OpenAPI 固定 demo API contract，方便下游服務對齊 | 已完成，並延伸到 Source-G access resolver contract |
| Optional Service Key Auth | 設定 `KNOWLEDGE_SOURCE_KEY` 時保護 read APIs；未設定時保留 local demo 開發便利性 | 已完成，後續升級為 service key + tenant key access context |
| Demo Profile K12 Topic Graph Runtime Index Builder | demo profile 可吃 K12 full topic graph runtime index，用來解 demo 卡關題型 | 已完成；後來 `profile` 已降為相容層，由 `ENABLE_K12` 與 access resolver 控制 |
| MVP Profile Taiwan Curriculum + Materials RAG | 原規劃在 MVP profile 中加入台灣課綱與教材 RAG，但不可過度宣稱官方完整覆蓋 | 尚未完成；已被後續 Source/Tenant/OpenWiki/RAG 規劃取代 |
| Prod Profile User / Tenant Overlay | 原規劃在 prod profile 中加入使用者/tenant overlay | 已由 Source-G 的 Knowledge Access Resolver 完成 resolver 與 DB schema；tenant upload lifecycle 尚未完成 |
| AI Workflow Demo Integration Contract | AI Workflow demo 端改讀 Source service 發布的 runtime index，而不是直接讀 raw/local index | Source 端 contract 已完成；AI Workflow 端完整 handoff 尚未完成 |

簡單說，Demo MVP 原本要完成的是「讓 demo 可以透過 Source service 穩定讀到可追溯版本的 runtime knowledge」。目前這條線已經大多完成，而且進一步升級成「Source service 可以根據 key/env/tenant entitlement 決定知識範圍」的 production 方向。

仍需注意的是：早期 Demo MVP 文件中的 `demo|mvp|prod profile` 現在不再是主要設計，只是下游尚未全部遷移前的相容層。新的主要判斷方式是 `Authorization: Bearer <key>` 加上 `ENABLE_TENANT`、`ENABLE_K12`、`DEFAULT_KNOWLEDGE` 與 DB entitlement。

## 6. DB Schema

現有 migration：

- `db/migrations/001_source_schema.sql`
- `db/migrations/002_artifact_publish_status.sql`
- `db/migrations/003_knowledge_access_resolver.sql`

主要資料表：

- `knowledge_sources`
- `knowledge_source_versions`
- `knowledge_source_artifacts`
- `knowledge_source_import_runs`
- `knowledge_source_tenants`
- `knowledge_source_users`
- `knowledge_source_api_keys`
- `knowledge_source_collection_entitlements`
- `knowledge_source_tenant_collections`
- `knowledge_source_access_audit_events`

DB 使用方式請以 `knowledge_source_pg_readme.md` 為準。

## 7. 完整版階段性規劃

本節把歷史文件中的 Demo MVP、唯一資料來源、vertical slices 與 tenant resolver plan 收斂成目前可延續的完整規劃。

### Phase 0：Baseline Service Skeleton

目標：建立 Next.js service skeleton、health/readiness endpoint、DB connection、artifact storage helper、test seam。

狀態：已完成。

驗證：

- `GET /healthz`
- `GET /readyz`
- `npm test`
- `npm run lint`

### Phase 1：PostgreSQL Metadata and Artifact Baseline

目標：建立 source/version/artifact/import run metadata schema，讓 service 不再只靠檔案路徑辨識版本。

狀態：已完成。

主要內容：

- source metadata tables
- artifact metadata
- artifact publish status
- import summary and rerun trace
- artifact list/detail/raw API
- path guard

### Phase 2：Demo MVP Runtime Index Foundation

目標：讓 AI Workflow 原本的 knowledge runtime index 可被 Source service 包裝、匯入、查詢與版本 pinning。

狀態：已完成。

主要內容：

- `import:ai-workflow-knowledge`
- `runtime-index:latest`
- immutable pinned artifact：`runtime-index:sha256:<checksum>`
- `GET /v1/runtime-index/latest`
- `GET /v1/runtime-index/diff`
- cache headers / ETag / Redis optional cache
- OpenAPI contract
- optional service key auth

### Phase Source-A：Source Collection Registry

目標：建立 source collection registry，讓 K12-KGraph full、Marble、Learning Commons 與未來 tenant collections 都以 collection 為治理單位。

狀態：已完成。

主要內容：

- collection id 採 canonical id，不用 display name 當主鍵。
- 登錄 K12-KGraph full、Marble、Learning Commons。
- collection metadata 包含 source type、license、attribution、policy、visibility、build status。
- read API 支援 access filtering。

### Phase Source-B：Normalized Artifact Builder

目標：raw dataset 只存在 ingestion/build 階段，runtime path 只讀 normalized artifact。

狀態：已完成 K12；Marble / Learning Commons 後續由 Source-F 補完。

主要內容：

- normalized graph / normalized document artifact schema。
- build script：`source-artifacts:build`。
- artifact checksum。
- validation gate。
- license / attribution propagation。

### Phase Source-C：Topic Candidate Export

目標：Source service 發布 topic candidates，讓 synthesis 不直接掃 raw dataset。

狀態：已完成。

主要內容：

- build script：`topic-candidates:build`。
- API：`GET /v1/topic-candidates/export`。
- response 包含 artifact id、checksum、license、attribution、access trace。
- `profile` 參數 optional/deprecated。

### Phase Source-D：Profile-Aware Runtime Index

目標：發布 runtime index，起初支援 `demo|mvp|prod profile`，後續改為 access-aware scope。

狀態：已完成，且已轉成 Knowledge Access Resolver 優先；profile 僅保留相容。

主要內容：

- build/publish script：`runtime-index:publish`。
- API：`GET /v1/runtime-index/latest`。
- API：`GET /v1/runtime-index/diff`。
- response 帶 artifact id/checksum/license/access trace。
- request 不必再帶 profile。

### Phase Source-E：Retrieval API

目標：Source service 提供 retrieval context，讓其他服務不直接讀 raw files。

狀態：已完成 lexical MVP。

主要內容：

- build script：`retrieval-index:build`。
- API：`POST /v1/retrieve`。
- lexical search。
- access-aware filtering。
- stale index filtering。
- license / attribution / artifact trace。

尚未完成：

- vector retrieval。
- hybrid retrieval。
- reranker。
- query expansion。

### Phase Source-F：Marble / Learning Commons Complete Normalized Adapter Pipeline

目標：讓 Marble / Learning Commons 和 K12 一樣有完整 adapter build pipeline，而不是只有 registry metadata 或局部 placeholder。

狀態：已完成。

主要內容：

- Marble normalized document adapter。
- Learning Commons normalized document adapter。
- adapter registry。
- pipeline tests。
- validation tests。
- normalized artifact build output。

### Phase Source-G：Knowledge Access Resolver and Tenant-Aware Knowledge Scope

目標：用 request key + env + DB entitlement 取代 caller 手動選 `demo|mvp|prod profile` 的模式。

狀態：已完成目前 scope。

主要內容：

- `ENABLE_TENANT`
- `ENABLE_K12`
- `DEFAULT_KNOWLEDGE`
- default knowledge parser。
- tenant entitlement DB schema。
- tenant API key SHA-256 hash store。
- pure resolver module。
- request access context wrapper。
- runtime-index/latest access integration。
- retrieve access integration。
- artifacts/topic-candidates/source-collections access integration。
- tenant collection skeleton。
- OpenAPI/readiness docs。

尚未完成：

- tenant upload API。
- tenant upload ingestion lifecycle。
- tenant collection publish workflow。
- quota / billing / abuse controls。
- cross-tenant sharing policy。

### Phase Source-H：OpenWiki Integration

目標：將 OpenWiki 也納入 Source service 治理，讓它和 K12 / Marble / Learning Commons 一樣透過 collection、artifact、runtime index、retrieval API 對外暴露。

狀態：尚未實作；獨立規劃保留於 `納入OpenWiki.md的階段性規劃.md`。

### Phase Source-I：Production Retrieval Upgrade

目標：從 lexical MVP 升級到 production-grade retrieval。

狀態：尚未實作。

建議 vertical slices：

1. 建立 embedding artifact schema 與 index metadata。
2. 對 normalized artifacts 建 embedding build pipeline。
3. Retrieval API 加入 lexical/vector/hybrid mode，但 default 保守維持 lexical。
4. 加入 reranker 與 citation-preserving context packer。
5. 加入 retrieval quality evaluation fixture。
6. 加入 per-tenant index materialization 或 filtered vector search policy。

### Phase Source-J：Tenant Upload Productization

目標：讓使用者上傳自己的教材，成為 tenant-scoped knowledge source。

狀態：尚未實作。

建議 vertical slices：

1. Tenant upload metadata schema。
2. Upload API with file type and size policy。
3. Malware / file validation gate。
4. Tenant raw snapshot storage。
5. Tenant normalized artifact builder。
6. Tenant retrieval index builder。
7. Tenant entitlement auto-grant。
8. Delete / revoke / retention lifecycle。
9. Tenant audit events and admin view。

### Phase Source-K：Downstream Service Handoff

目標：讓 `knowledge-synthesis-service` 與 `ai-workflow-service` 都只吃 Source service 發布的 API/artifact。

狀態：

- Source service handoff contract 已完成。
- `knowledge-synthesis-service` 的 raw dataset migration 已在另一個 service 規劃/實作線中推進。
- `ai-workflow-service` 尚未完成整體遷移。

建議下一步：

1. 移除 downstream 對 raw dataset path 的主路徑依賴。
2. downstream 只保存 review/status/rules/job/wiki 等自己的 domain data。
3. downstream 消費 `/v1/topic-candidates/export`、`/v1/retrieve`、`/v1/runtime-index/latest`。
4. downstream tests 加入「沒有 raw dataset path 也能運作」的 smoke。

## 8. 狀態盤點

| 功能名稱 | 功能說明 | 當前進度 | 尚未完成 |
|---|---|---|---|
| Service skeleton | Next.js service、health/readiness、DB helper、artifact storage helper | 已完成 | 無 |
| PostgreSQL metadata schema | 保存 source/version/artifact/import metadata | 已完成 | 依 production migration policy 補 rollback/online migration playbook |
| Artifact publish status | artifact 可區分 imported/published 等狀態 | 已完成 | 可再補 admin publish workflow |
| Import summary and rerun trace | 匯入時記錄 summary、checksum、rerun trace | 已完成 | deleted artifact detection 仍非第一版範圍 |
| Artifact list/detail/raw API | 提供 artifact metadata 與 raw payload 讀取 | 已完成 | object storage signed URL 尚未產品化 |
| Runtime index latest | 發布與讀取最新 runtime index | 已完成 | profile 完全移除需等下游完成遷移 |
| Runtime index pinning | mutable latest alias + immutable checksum artifact | 已完成 | 無 |
| Runtime index diff | 比較 runtime index 版本差異 | 已完成 | 可再補更完整 semantic diff |
| Read cache metadata | ETag、Cache-Control、cache headers、Redis optional cache | 已完成 | Redis observability dashboard 尚未完成 |
| OpenAPI contract | `openapi/knowledge-source-service.openapi.yaml` 與 `/openapi.json` | 已完成 | contract governance/versioning 可再強化 |
| Service key auth | protected APIs 使用 `Authorization: Bearer <key>` | 已完成 | key rotation/admin command 尚未完成 |
| Source Collection Registry | 以 collection id 管理 K12/Marble/Learning Commons/tenant source | 已完成 | tenant collection 完整 lifecycle 尚未完成 |
| License / attribution / policy trace | response 保留 license、attribution、access/profile trace | 已完成 | 對第三方授權的法律審核仍需人工確認 |
| K12 raw snapshot ingest | ingestion/build 階段讀 K12 raw dataset | 已完成 | K12 對外暴露仍受 `ENABLE_K12` 控制 |
| K12 normalized artifact | K12 raw 轉 normalized graph artifact | 已完成 | 可再補更豐富 curriculum semantic mapping |
| Marble normalized adapter | Marble raw 轉 normalized document artifact | 已完成 | 若來源格式擴充需新增 adapter fixture |
| Learning Commons normalized adapter | Learning Commons raw 轉 normalized document artifact | 已完成 | 若來源格式擴充需新增 adapter fixture |
| Adapter registry | 用 adapter registry 封裝不同 source 的 build 邏輯 | 已完成 | 未來 OpenWiki/tenant uploads 需新增 adapter |
| Normalized artifact validation | build output 進入 validation gate | 已完成 | 可再補 schema version compatibility policy |
| Topic candidates build | 從 normalized artifact 建 topic candidates artifact | 已完成 | Marble/LC 更進階 topic extraction 可後續強化 |
| Topic candidates export API | `/v1/topic-candidates/export` 對外輸出 topic candidates | 已完成 | `profile` 參數日後可正式移除 |
| Retrieval index build | 從 normalized artifacts 建 retrieval index | 已完成 | vector index build 尚未完成 |
| Retrieval API | `/v1/retrieve` 提供 retrieval context | 已完成 lexical MVP | hybrid/vector/rerank 尚未完成 |
| Profile policy compatibility | 支援舊 `demo|mvp|prod` caller | 已完成相容層 | 完全移除需等下游不再傳 profile |
| Knowledge Access Resolver | 根據 key/env/DB entitlement 解出 effective collections | 已完成 | quota、sharing、upload lifecycle 尚未完成 |
| Default knowledge policy | `DEFAULT_KNOWLEDGE=marble;learning_commons` 作為 fallback | 已完成 | production 需確認實際 collection id 命名一致 |
| K12 enable gate | `ENABLE_K12=false` 時 hard-block K12 | 已完成 | 無 |
| Tenant enable gate | `ENABLE_TENANT=false` 時不查 DB，只輸出 default knowledge | 已完成 | 無 |
| Tenant API key hash store | tenant key 只存 SHA-256 hash | 已完成 | key issue/revoke CLI 或 admin API 尚未完成 |
| Tenant entitlements | DB 保存 tenant/user 可用 collection scope | 已完成 resolver scope | 管理 API 尚未完成 |
| Tenant collection skeleton | 預留 tenant uploaded collections metadata | 已完成 skeleton | upload/build/publish/delete lifecycle 尚未完成 |
| Access-aware runtime index | runtime index 根據 effective collection scope 過濾 | 已完成 | per-tenant materialized runtime index 可後續做 |
| Access-aware retrieval | retrieval 根據 effective collection scope 過濾 | 已完成 | per-tenant vector index 尚未完成 |
| Access-aware artifacts | artifact list/detail/raw 不可繞過 access policy | 已完成 | 更細粒度 row-level license policy 可後續補 |
| Access-aware source collections | collection API 只回 caller 可見範圍 | 已完成 | admin management API 可後續補 |
| Sole-source readiness smoke | `source:sole-source:smoke` 驗證 Source 作為唯一資料來源的核心路徑 | 已完成 | 可接 CI/CD pipeline |
| OpenWiki integration | 把 OpenWiki 納入 collection/artifact/retrieval/runtime | 尚未實作 | 依 `納入OpenWiki.md的階段性規劃.md` 推進 |
| Taiwan curriculum/materials RAG | 官方課綱與教材 RAG 產品化 | 尚未實作 | source/adapter/license/review workflow 待定 |
| Tenant upload lifecycle | 使用者上傳教材成為 tenant knowledge source | 尚未實作 | upload API、validation、storage、build、entitlement、delete |
| Production retrieval upgrade | lexical MVP 升級 vector/hybrid/rerank | 尚未實作 | embedding schema、indexer、quality eval、cost control |
| Object storage productionization | artifact 從 local FS 遷移到 object storage | 尚未實作 | bucket layout、checksum verify、signed URL、retention |
| Observability and audit | access audit events 已有 schema，read headers 已有 trace | 部分完成 | metrics dashboard、alerting、audit query API |
| knowledge-synthesis-service handoff | synthesis 應只消費 Source API/artifact，不讀 raw dataset | Source 端已完成 contract | synthesis service 的最終狀態以該 service 文件為準 |
| ai-workflow-service handoff | AI workflow 只吃 Source/Synthesis runtime contract | 尚未完成 | 需另開 vertical slices |

## 9. 目前可用 scripts

常用開發與驗證：

```bash
npm run dev
npm run build
npm run build:isolated
npm test
npm run lint
npm run openapi:validate
```

DB / ingestion / build：

```bash
npm run db:migrate
npm run import:ai-workflow-knowledge
npm run source-collections:seed
npm run source-collections:ingest
npm run source-artifacts:build
npm run topic-candidates:build
npm run runtime-index:publish
npm run retrieval-index:build
npm run source:sole-source:smoke
```

最近一次文件盤點所依據的既有驗證紀錄：

- `node --experimental-default-type=module --test test`：201/201 passing。
- `npm run lint`：passing。
- `npm run openapi:validate`：passing。

## 10. 後續開發工作方式

後續在此 service 開發時，請繼續遵守 `Question_Generation/skills` 的工作方式：

1. 不要直接開始寫 code。
2. 先用 grill-me / grill-with-docs 釐清需求。
3. 需求清楚後先整理 spec。
4. 中大型功能拆成 vertical slice tickets，不按 DB/backend/frontend 水平拆。
5. 優先 TDD：先寫會失敗的測試，再寫實作。
6. 每個 slice 完成後跑測試、lint、OpenAPI/typecheck/build。
7. 完成後做 code review，檢查 spec 符合度、code smell、測試缺口。
8. 設計偏好 deep modules：小 interface，複雜度藏在模組內。

## 11. 建議下一輪優先順序

1. `ai-workflow-service` handoff：確認 AI Workflow 不再直接讀 Source raw dataset，只讀 Source/Synthesis runtime contract。
2. OpenWiki integration：依 `納入OpenWiki.md的階段性規劃.md` 新增 collection、adapter、artifact、retrieval/runtime integration。
3. Tenant upload lifecycle：把 `knowledge_source_tenant_collections` 從 skeleton 補成可用產品功能。
4. Retrieval upgrade：從 lexical MVP 漸進加入 vector/hybrid/rerank。
5. Production ops：object storage、key rotation、quota、observability、audit query API。
