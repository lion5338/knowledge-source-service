# Knowledge Source Service PostgreSQL Schema 說明

本文說明 `knowledge-source-service` 目前建立的 PostgreSQL schema、每個 table 的用途，以及 table 之間的關聯。

目前 schema 來源：

```text
db/migrations/001_source_schema.sql
```

## 整體定位

`knowledge-source-service` 的 DB 是 knowledge source 的 metadata/control plane。

它不把大型 raw 檔案全文直接塞進 DB，而是採用：

```text
PostgreSQL
= source metadata / version metadata / artifact metadata / audit log

storage/knowledge
= 實際 raw、normalized、mapping、report、runtime index 檔案
```

也就是：

```text
DB 管「這個檔案是什麼、來源是誰、版本是什麼、放在哪、checksum 是什麼」
Storage 管「檔案內容本身」
```

## Table 關係總覽

```text
knowledge_source_registry
  1 ── * knowledge_source_versions

knowledge_source_artifacts
  可選擇性指向 source/source_version
  目前沒有 DB foreign key 強制綁定，方便存放跨 source artifact，例如 runtime index。

knowledge_source_audit_events
  記錄 registry / version / artifact / import job 等操作事件。
```

## knowledge_source_registry

### 作用

這張表是 source registry，記錄每個外部知識來源的基本資料。

例如目前會有：

```text
marble
learning_commons
k12_dataset
```

它回答的問題是：

```text
這個 source 是誰？
來源 repo 在哪？
授權是什麼？
 attribution 要怎麼寫？
是否有 non-commercial 或 demo-only 限制？
```

### 重要欄位

```text
id
內部 uuid primary key。

source
服務內部使用的 source id，例如 marble、learning_commons、k12_dataset。
此欄位 unique，並被 knowledge_source_versions.source 參照。

display_name
原始或顯示用名稱，例如 learning-commons。

repo_url
上游來源網址。

license
授權資訊，例如 CC BY-4.0、CC BY-NC-SA 4.0。

license_scope
授權使用範圍補充，例如 non_commercial_demo_only。

attribution
對外使用或報告時應保留的 attribution 文字。

config
原始 source config JSON。第一版從 ai-workflow-service/knowledge/sources.json 匯入。

created_at / updated_at
建立與更新時間。
```

### 關聯

```text
knowledge_source_registry.source
  -> knowledge_source_versions.source
```

如果 source 被刪除，對應 versions 會因 `ON DELETE CASCADE` 一起刪除。

## knowledge_source_versions

### 作用

這張表記錄每個 source 的版本與 snapshot metadata。

例如：

```text
marble / v1
learning_commons / v1.11.0
k12_dataset / demo-main-6c629a5f
```

它回答的問題是：

```text
目前某個 source 匯入了哪個版本？
raw snapshot 放在哪？
snapshot manifest 是什麼？
總下載大小是多少？
```

### 重要欄位

```text
id
內部 uuid primary key。

source
對應 knowledge_source_registry.source。

source_version
source 的版本字串。

snapshot_status
snapshot 狀態。第一版預設 available。

storage_driver
儲存後端。第一版是 local，未來可擴充 object_storage、s3、gcs 等。

raw_root
此 source/version 的 raw 檔案根路徑。

snapshot_path
snapshot.json 的 storage path。

manifest
snapshot manifest JSON。第一版會放 snapshot.json 內容或空物件。

total_bytes
snapshot 記錄的檔案大小總和。

imported_at / updated_at
匯入與更新時間。
```

### Unique Constraint

```text
UNIQUE (source, source_version)
```

同一個 source/version 只會有一筆版本紀錄。

### 關聯

```text
knowledge_source_versions.source
  references knowledge_source_registry(source)
```

## knowledge_source_artifacts

### 作用

這張表是 artifact registry，記錄 service storage 中每個知識 artifact 的 metadata。

artifact 可以是：

```text
raw_snapshot_file
normalized_artifact
mapping_artifact
runtime_index
report_artifact
source_registry_config
knowledge_artifact
```

例如：

```text
runtime-index:latest
normalized:marble-topics
mappings:topic-mappings
raw:k12-dataset:demo-main-6c629a5f:kg:math_7a_rjb
```

它回答的問題是：

```text
這個 artifact 是什麼類型？
它屬於哪個 source/version？
實際檔案放在哪？
content type 是什麼？
checksum 是什麼？
```

### 重要欄位

```text
id
內部 uuid primary key。

artifact_id
對外 API 使用的 artifact id，例如 runtime-index:latest。
此欄位 unique。

artifact_type
artifact 類型，例如 runtime_index、normalized_artifact。

source
可選。若 artifact 屬於特定 source，會填 source id。
跨 source artifact，例如 runtime-index:latest，source 可以是 null。

source_version
可選。若 artifact 屬於特定 source/version，會填版本。

storage_path
相對於 KNOWLEDGE_SOURCE_STORAGE_ROOT 的檔案路徑。

content_type
回傳 raw artifact 時使用的 content type。

record_count
預留欄位。未來 normalized JSONL 或大型 dataset 可記錄筆數。

checksum_sha256
檔案 SHA-256 checksum，用於驗證 artifact 是否變動。

metadata
額外 metadata。第一版會記錄 imported_from。

created_at / updated_at
建立與更新時間。
```

### 關聯

目前 `source` / `source_version` 沒有加 foreign key 到 `knowledge_source_versions`。

原因是 artifact 有幾種情況：

```text
1. 屬於單一 source/version
   例如 raw/marble/v1/topics.json

2. 屬於多個 source 合成結果
   例如 mappings/topic-mappings.json

3. 是 runtime aggregate artifact
   例如 index/knowledge-index.json
```

因此第一版保留彈性，用欄位標示來源，但不強制 FK。

## knowledge_source_audit_events

### 作用

這張表記錄 service 內的操作事件，用於追蹤誰在什麼時間做了什麼。

第一版 importer 會寫入：

```text
knowledge_source.imported_ai_workflow_knowledge
```

它回答的問題是：

```text
什麼時間匯入了哪些 knowledge artifact？
誰觸發了 import？
目標是什麼？
相關 payload 是什麼？
```

### 重要欄位

```text
id
內部 uuid primary key。

event_type
事件類型，例如 knowledge_source.imported_ai_workflow_knowledge。

actor
操作者。script、api、system、reviewer 等。

target_type
事件目標類型，例如 knowledge_source_storage、artifact。

target_id
事件目標 id。

payload
事件內容 JSON，例如 source_root、storage_root、file_count。

created_at
事件建立時間。
```

### 關聯

這張表沒有 foreign key，因為 audit log 應保留歷史事實。

即使某個 artifact 或 source 之後被刪除，audit event 仍應保留。

## 目前資料流

第一版流程：

```text
ai-workflow-service/knowledge
  -> npm run import:ai-workflow-knowledge
  -> knowledge-source-service/storage/knowledge
  -> PostgreSQL metadata
```

匯入後：

```text
ai-workflow-service
  -> KNOWLEDGE_SOURCE_BASE=http://127.0.0.1:3200/v1
  -> GET /v1/runtime-index/latest
  -> 使用 knowledge-source-service 回傳的 runtime index
  -> 如果 API 失敗，fallback 到本地 knowledge/index/knowledge-index.json
```

## 常用查詢

查看所有 source：

```sql
SELECT source, display_name, license, license_scope
FROM knowledge_source_registry
ORDER BY source;
```

查看 source versions：

```sql
SELECT source, source_version, snapshot_status, raw_root, snapshot_path
FROM knowledge_source_versions
ORDER BY source, imported_at DESC;
```

查看 runtime index artifact：

```sql
SELECT artifact_id, artifact_type, storage_path, checksum_sha256
FROM knowledge_source_artifacts
WHERE artifact_type = 'runtime_index';
```

查看最近 import 事件：

```sql
SELECT event_type, actor, target_type, target_id, payload, created_at
FROM knowledge_source_audit_events
ORDER BY created_at DESC
LIMIT 20;
```

## 後續建議

目前這個 schema 是第一版 microservice boundary，重點是把 knowledge artifact 從 `ai-workflow-service` 封裝出來。

下一階段可以補：

```text
ingestion_jobs
normalization_jobs
artifact_versions
source_license_policy
artifact_lineage
artifact_publish_status
```

到那時候，`knowledge-source-service` 就可以真正負責：

```text
source sync
raw snapshot
normalization
mapping artifact export
runtime index publish
license policy enforcement
```

