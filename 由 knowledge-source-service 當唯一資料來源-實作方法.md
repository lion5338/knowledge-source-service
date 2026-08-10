# 由 knowledge-source-service 當唯一資料來源：實作方法

日期：2026-08-03

## 1. 目標

長期把 K12-KGraph full data、marble、learning_commons、台灣課綱、教材與未來 tenant/user 上傳資料都收斂到 `knowledge-source-service` 作為唯一資料來源。

`knowledge-source-service` 負責：

```text
raw/source collection ownership
source manifest
license and attribution metadata
normalization
artifact build and publish
runtime index / retrieval API
profile-aware source governance
```

其他服務不再各自維護 raw dataset copy。它們只能透過 `knowledge-source-service` 發布的 artifact 或 API 消費資料。

## 2. 非目標

```text
不在 knowledge-source-service 裡處理題目生成流程。
不在 knowledge-source-service 裡維護人工審核後的 prompt context。
不在 knowledge-source-service 裡做 teacher-facing question bank。
不宣稱 K12-KGraph 是台灣官方課綱。
不把 CC BY-NC-SA 類資料預設放進 production commercial runtime。
```

## 3. Canonical Source Collection

新增一個 source collection 抽象，讓所有外部資料都用同一套生命週期管理。

### Spec

每個 collection 至少包含：

```json
{
  "collection_id": "k12_kgraph_full",
  "collection_type": "knowledge_graph",
  "source_family": "k12",
  "display_name": "K12-KGraph Full",
  "source_uri": "datasets/K12-KGraph-HF/K12-KGraph",
  "license": "CC BY-NC-SA 4.0",
  "license_scope": "non_commercial_demo_only",
  "locale": "zh-CN",
  "curriculum_region": "mainland_china",
  "official_curriculum_verified": false,
  "publish_profiles": ["demo"],
  "ingest_status": "ready",
  "snapshot_id": "source-snapshot:k12_kgraph_full:<checksum>",
  "created_at": "<ISO datetime>",
  "updated_at": "<ISO datetime>"
}
```

建議 collection id：

```text
k12_kgraph_full
marble
learning_commons
taiwan_official_curriculum
taiwan_materials
tenant:<tenant_id>:uploaded_sources
```

### 如何做

1. 建立 `source_collections` 儲存層，先可用 JSON artifact，之後再遷移到 DB。
2. 每個 collection 建立 `manifest.json`，保存來源、授權、語系、課綱區域、可發布 profile。
3. raw dataset 只允許由 collection manifest 指向，不讓其他服務硬編路徑。
4. 每次 ingest 產生 immutable snapshot，snapshot id 使用 checksum。

### 驗收門檻

```text
GET /v1/source-collections 可列出 k12_kgraph_full / marble / learning_commons。
每個 collection 都有 license_scope 與 allowed profile。
K12-KGraph full collection 標示 official_curriculum_verified=false。
同一份 raw dataset 不需要複製到 synthesis 或 ai-workflow 專案底下。
```

## 4. Normalized Source Artifact

Source service 應該把 raw dataset 轉成穩定、可跨服務消費的 normalized artifact。

### Spec

K12-KGraph normalized artifact：

```json
{
  "artifact_id": "source-artifact:k12_kgraph_full:<checksum>",
  "collection_id": "k12_kgraph_full",
  "artifact_type": "normalized_knowledge_graph",
  "schema_version": "source_graph.v1",
  "source_snapshot_id": "source-snapshot:k12_kgraph_full:<checksum>",
  "license_scope": "non_commercial_demo_only",
  "nodes": [],
  "edges": [],
  "summary": {
    "node_count": 10685,
    "edge_count": 22471,
    "subjects": ["biology", "chemistry", "math", "physics"]
  }
}
```

marble / learning_commons 也應轉成各自 normalized artifact，但共同欄位要一致：

```text
artifact_id
collection_id
artifact_type
schema_version
source_snapshot_id
license_scope
attribution
records / nodes / documents
summary
```

### 如何做

1. 新增 `scripts/source-collections/inspect-*.mjs`，輸出資料品質報告。
2. 新增 `scripts/source-collections/build-normalized-artifact.mjs`。
3. 對不同資料型態使用 adapter：
   - `k12_kgraph_full` -> graph adapter
   - `marble` -> document/problem/source adapter
   - `learning_commons` -> open educational resource adapter
4. artifact 內容保存 source id、原始屬性、授權、attribution、checksum。
5. 所有 artifact 寫入 `storage/knowledge/source-artifacts/`。

### 驗收門檻

```text
normalized artifact 可 JSON.parse。
artifact_id deterministic。
同一份 raw source 重新 build 會得到相同 checksum。
每筆 record/node 都保留 source_ref 與 license metadata。
K12 demo-critical topic 一元一次方程式可在 normalized graph 中找到。
```

## 5. Profile-Aware Runtime Artifact

`knowledge-source-service` 應負責依 profile 發布 runtime artifact。

### Spec

```env
KNOWLEDGE_SOURCE_RUNTIME_PROFILE=demo
```

允許值：

```text
demo
mvp
prod
```

Profile 語意：

```text
demo:
  可發布 K12-KGraph full topic graph 成 runtime 可解析 topic。
  所有 K12-KGraph 來源標記 demo_only / non_commercial_demo_only。

mvp:
  只發布台灣官方課綱與已審核教材 RAG artifact。
  K12-KGraph 可當 mapping candidate，但不得當正式 prompt context。

prod:
  以 mvp base source 為底，加上 tenant/user source overlay。
  必須通過 auth、quota、tenant policy、license policy。
```

Runtime alias：

```text
runtime-index:demo:latest
runtime-index:mvp:latest
runtime-index:prod:latest
runtime-index:<profile>:sha256:<checksum>
```

### 如何做

1. 新增 `src/lib/runtime-profile.js`，集中解析 profile。
2. 修改 `/v1/runtime-index/latest`，依 active profile 讀對應 alias。
3. 新增 `GET /v1/runtime-index/latest?profile=demo|mvp|prod`，內部或 service credential 可明確指定 profile。
4. 建立 publish script：
   - `publish-runtime-index --profile demo`
   - `publish-runtime-index --profile mvp`
   - `publish-runtime-index --profile prod`
5. response trace 永遠回傳 profile、artifact id、checksum、source collection ids。

### 驗收門檻

```text
demo profile 不會讀到 mvp/prod artifact。
mvp/prod profile 不會 fallback 到 demo K12 full artifact。
runtime response 含 profile 與 checksum。
invalid profile fail fast。
AI Workflow 可從 demo runtime index resolve 一元一次方程式。
```

## 6. Topic Candidate Export API

`knowledge-synthesis-service` 不應再讀 raw dataset，而是透過 source artifact 匯入 topic candidates。

### Spec

新增 API：

```text
GET /v1/topic-candidates/export?profile=demo&collection_id=k12_kgraph_full
```

Response：

```json
{
  "profile": "demo",
  "collection_id": "k12_kgraph_full",
  "artifact_id": "topic-candidates:k12_kgraph_full:demo:<checksum>",
  "source_artifact_id": "source-artifact:k12_kgraph_full:<checksum>",
  "license_scope": "non_commercial_demo_only",
  "candidates": []
}
```

Candidate contract：

```json
{
  "topic_key": "k12_math_7a_rjb_cpt41",
  "canonical_label": "一元一次方程",
  "aliases": ["一元一次方程", "一元一次方程式", "linear equation in one unknown"],
  "subject": "mathematics",
  "learning_stage": "junior_high",
  "topic_family": "concept",
  "source": "k12_dataset",
  "source_topic_id": "math_7a_rjb_cpt41",
  "source_node_type": "Concept",
  "parent_topic_key": "k12_math_7a_rjb_ch3_s1",
  "source_refs": [],
  "metadata": {
    "collection_id": "k12_kgraph_full",
    "source_artifact_id": "source-artifact:k12_kgraph_full:<checksum>",
    "official_curriculum_verified": false,
    "license_scope": "non_commercial_demo_only"
  }
}
```

### 如何做

1. 從 normalized source artifact build topic candidate artifact。
2. 用 adapter 控制不同 collection 的 candidate mapping。
3. API 支援 `profile`、`collection_id`、`subject`、`learning_stage`、`node_type` filter。
4. 回傳 checksum 與 source artifact provenance。
5. 大資料量時支援 pagination 或 artifact download URL。

### 驗收門檻

```text
synthesis service 可只靠 topic-candidates/export 匯入 K12 topic registry。
API 不暴露 raw private path。
每個 candidate 都有 source_artifact_id 與 license_scope。
一元一次方程式 candidate 可被匯出，且含 zh-TW alias。
```

## 7. Retrieval API

長期 RAG 不應由各服務自己讀資料夾。Source service 提供 retrieval API。

### Spec

```text
POST /v1/retrieve
```

Request：

```json
{
  "profile": "mvp",
  "query": "一元一次方程式應用題",
  "subject": "mathematics",
  "learning_stage": "junior_high",
  "tenant_id": null,
  "allowed_source_scopes": ["official_curriculum", "approved_materials"],
  "limit": 8
}
```

Response：

```json
{
  "profile": "mvp",
  "results": [],
  "trace": {
    "source_collections": [],
    "blocked_collections": [],
    "policy_decisions": []
  }
}
```

### 如何做

1. Demo 階段可先提供 lexical retrieval。
2. MVP 階段接 vector / hybrid retrieval。
3. Prod 階段加入 tenant-aware filtering。
4. 每個 result 必須含 source_ref、license_scope、artifact_version。

### 驗收門檻

```text
AI Workflow / Synthesis 不需要知道 marble 或 learning_commons 實體檔案位置。
prod profile 查詢不會回傳 demo-only source。
tenant A 查詢不會回傳 tenant B 私有資料。
```

## 8. 遷移順序

### Batch Source-A：Source Collection Registry

```text
建立 collection manifest schema。
登錄 k12_kgraph_full / marble / learning_commons。
補上 license / attribution / profile policy。
```

驗收：

```text
GET /v1/source-collections 回傳三個 collection。
每個 collection 都能指出 raw source 與 license_scope。
```

### Batch Source-B：Normalized Artifact Builder

```text
把 K12-KGraph full data build 成 normalized source artifact。
marble / learning_commons 先建立 manifest 與 inspection report。
```

驗收：

```text
K12 normalized artifact 可重建且 checksum 穩定。
一元一次方程式存在於 artifact。
```

### Batch Source-C：Topic Candidate Export

```text
由 normalized artifact 產生 topic candidate artifact。
提供 /v1/topic-candidates/export。
```

驗收：

```text
synthesis service 可不用 raw path 匯入 K12 candidates。
```

### Batch Source-D：Profile-Aware Runtime Index

```text
demo/mvp/prod runtime-index alias。
/v1/runtime-index/latest 支援 profile。
```

驗收：

```text
demo 可發布 K12 full topic graph。
mvp/prod 不會誤用 demo-only K12。
```

### Batch Source-E：Retrieval API

```text
新增 /v1/retrieve。
先支援 demo/mvp source policy，再擴充 prod tenant overlay。
```

驗收：

```text
AI Workflow 和 Synthesis 只靠 API 消費 source data。
```

## 9. 長期完成定義

```text
K12-KGraph full data 只維護一份。
marble 只維護一份。
learning_commons 只維護一份。
Synthesis 不再直接讀 raw dataset。
AI Workflow 不再讀各服務私有資料夾。
所有 cross-service 消費都有 artifact id、checksum、license、profile trace。
demo/mvp/prod 不會互相 fallback 到錯誤 source。
```
