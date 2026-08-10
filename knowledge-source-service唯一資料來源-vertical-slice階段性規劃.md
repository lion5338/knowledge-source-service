# knowledge-source-service 唯一資料來源 vertical slice 階段性規劃

日期：2026-08-10

來源文件：

- `core/knowledge-source-service/由 knowledge-source-service 當唯一資料來源-實作方法.md`

本文件把來源文件中的 Source-A 到 Source-E 重新整理成更適合 Claude Code 按部就班執行的 vertical slices。每個 slice 都要能單獨測試、單獨驗證，且完成後維持系統可用。

## 0. 工作方式

### 執行規則

1. 不要一次做整個 Batch。一次只做一個 slice。
2. 每個 slice 先讀本文件對應段落，再讀現有程式碼與測試。
3. 每個 slice 實作前先確認 test seam。
4. 優先 TDD：先寫會失敗的測試，再寫最小實作讓測試通過。
5. 每個 slice 完成後跑該 service 的驗證：
   - `npm test`
   - `npm run lint`
   - 若修改 OpenAPI：`npm run openapi:validate`
   - 若修改 build/import script：跑對應 focused test 或 smoke script
6. 完成每個 slice 後做 code-review：
   - 是否符合本 slice acceptance criteria
   - 是否誤把 raw path 暴露給 consumer
   - 是否缺 artifact id / checksum / license / profile trace
   - 是否造成 synthesis 或 ai-workflow 需要直接讀 raw dataset
7. 設計偏好 deep modules：小 interface，複雜度藏在 module implementation 裡。

### Vertical slice 定義

本文件的 slice 不是「先 DB、再 API、再測試」的水平拆法。每個 slice 都要穿過必要層次，至少包含：

```text
contract/schema
  -> library module
  -> API route or build/import script
  -> tests
  -> trace/provenance
```

完成一個 slice 後，應該可以示範一條窄而完整的能力。

### 主要 domain vocabulary

**Source collection**  
Knowledge Source 擁有的一組來源資料，例如 `k12_kgraph_full`、`marble`、`learning_commons`。它描述來源、license、attribution、允許 profile、ingestion 狀態，以及 snapshot 指標。

**Source snapshot**  
一次 raw source ingest 的 immutable metadata。snapshot id 必須能回到 checksum。raw content 只屬於 ingestion/build 階段，不應出現在 consumer-facing response。

**Normalized artifact**  
由 raw snapshot 轉出的可發布 artifact，例如 normalized graph、normalized documents、topic candidate artifact、retrieval index。runtime 與 consumer service 應吃 artifact/API，而不是 raw files。

**Runtime profile**  
`demo | mvp | prod`。profile 決定哪些 source collection 可以進 runtime、哪些只能作為 candidate 或 review input。

**Profile trace**  
每個 response 必須說清楚本次使用哪個 profile、哪些 collection 被使用或阻擋，以及 artifact id / checksum / license scope。

**Demo-only source**  
目前主要是 K12-KGraph full。允許 demo runtime 使用，但 mvp/prod 不可誤吃作為 production prompt context 或 commercial runtime source。

## 1. 目標與非目標

### 目標

1. `knowledge-source-service` 成為 source data 的唯一入口。
2. `knowledge-source-service` 擁有 source collection registry、license / attribution / profile policy。
3. raw dataset 只存在 ingestion/build 階段。
4. normalized artifact、topic candidates、runtime index、retrieval result 都由 Source service 發布。
5. consumer-facing API response 都帶 artifact id、checksum、license、profile trace。
6. 後續 `knowledge-synthesis-service` 能透過 Source API 匯入 topic candidates / retrieval context，不再直接讀 raw dataset。
7. 後續 `ai-workflow-service` 能只吃 Source/Synthesis 發布的 runtime contract，不誤吃 demo-only source。

### 非目標

1. 不在本階段建 teacher-facing question bank。
2. 不在本階段把 `knowledge-synthesis-service` 的 prompt context review workflow 重寫。
3. 不在本階段讓 K12-KGraph 變成 production commercial source。
4. 不在本階段完成完整 tenant/user source overlay，只建立 retrieval policy seam 與 trace。
5. 不要求一開始就有 vector retrieval；可先 lexical retrieval，再讓 retrieval index interface 保留替換空間。

## 2. 建議 deep module seams

以下 module names 是建議，不要求完全照命名，但 interface 要維持小而穩定。

### `SourceCollectionRegistry`

Interface:

```text
listCollections({ profile?, collectionType?, sourceFamily? })
getCollection(collectionId)
upsertCollectionManifest(manifest)
```

Implementation hides:

- DB schema / artifact fallback
- manifest normalization
- license / attribution defaults
- collection id validation

Test seam:

- library contract test
- API route test for list/detail

### `SourceArtifactPublisher`

Interface:

```text
publishArtifact({ artifactType, profile?, collectionId?, payload, metadata })
getArtifact(artifactId)
readArtifactPayload(artifactId)
```

Implementation hides:

- storage path layout
- checksum calculation
- content-addressed artifact id
- latest alias updates
- audit event writes

Test seam:

- deterministic artifact id / checksum
- mutable alias points to immutable version

### `RuntimeProfilePolicy`

Interface:

```text
resolveRuntimeProfile(inputProfile)
assertCollectionAllowedForProfile(collection, profile, usage)
summarizeProfileDecision({ profile, included, blocked })
```

Implementation hides:

- `demo | mvp | prod` normalization
- source license policy
- demo-only guardrails
- future tenant overlay hooks

Test seam:

- pure function tests
- route validation tests

### `NormalizedArtifactBuilder`

Interface:

```text
buildNormalizedArtifact({ collectionId, snapshotId })
validateNormalizedArtifact(artifact)
```

Implementation hides:

- per-source adapters
- raw path layout
- source-specific parsing
- summary calculation

Test seam:

- fixture raw source -> normalized artifact
- invalid artifact -> validation failure

### `TopicCandidateExporter`

Interface:

```text
buildTopicCandidateArtifact({ collectionId, profile, sourceArtifactId })
exportTopicCandidates({ profile, collectionId, filters, pagination })
```

Implementation hides:

- graph/document to candidate mapping
- alias normalization
- large artifact pagination
- download vs inline response decisions

Test seam:

- candidate fixture contract
- export API filters

### `KnowledgeRetriever`

Interface:

```text
retrieve({ profile, query, subject, learningStage, tenantId, allowedSourceScopes, limit })
```

Implementation hides:

- lexical vs vector vs hybrid retrieval
- profile source filtering
- retrieval index artifact layout
- future tenant filtering

Test seam:

- request -> stable result set
- blocked source trace

## 3. Batch dependency map

```text
Source-A: Source Collection Registry
  A1 -> A2 -> A3

Source-B: Normalized Artifact Builder
  A2 -> B1 -> B2 -> B4
  A2 -> B3 -> B4

Source-C: Topic Candidate Export
  B2 -> C1 -> C2 -> C3

Source-D: Profile-Aware Runtime Index
  A2 -> D1
  B4 + D1 -> D2 -> D3 -> D4

Source-E: Retrieval API
  B4 + D1 -> E1 -> E2
  E1 -> E3
  E2 -> E4
```

Recommended implementation order:

```text
A1, A2, A3,
B1, B2, B3, B4,
C1, C2, C3,
D1, D2, D3, D4,
E1, E2, E3, E4
```

## 4. Batch Source-A：Source Collection Registry

### Source-A 目標

建立 first-class source collection registry，讓 `knowledge-source-service` 能用統一 contract 描述 K12-KGraph full、Marble、Learning Commons 的 ownership、license、attribution、publish profile 與 snapshot metadata。

現有 `knowledge_source_registry` / `knowledge_source_versions` 可以先擴充承載，不必一開始新增完全獨立 schema。對外 contract 使用 `source_collections` vocabulary，內部儲存可逐步演進。

### Slice A1：Source collection manifest contract + list API

**Blocked by:** None

**What it delivers:**  
Consumer 可以呼叫 `GET /v1/source-collections`，看到 `k12_kgraph_full`、`marble`、`learning_commons` 的 collection manifest summary。每筆 summary 都帶 license、attribution、profile policy，不暴露 raw filesystem path。

**Public interface:**

```text
GET /v1/source-collections
```

Response shape:

```json
{
  "object": "list",
  "data": [
    {
      "collection_id": "k12_kgraph_full",
      "collection_type": "knowledge_graph",
      "source_family": "k12",
      "display_name": "K12-KGraph Full",
      "license": "CC BY-NC-SA 4.0",
      "license_scope": "non_commercial_demo_only",
      "attribution": "...",
      "locale": "zh-CN",
      "curriculum_region": "mainland_china",
      "official_curriculum_verified": false,
      "publish_profiles": ["demo"],
      "ingest_status": "planned",
      "snapshot_id": null,
      "trace": {
        "source": "knowledge_source_registry",
        "raw_path_exposed": false
      }
    }
  ]
}
```

**TDD seam:** `SourceCollectionRegistry.listCollections()`

**Red tests first:**

1. `listCollections returns default seeded collections with policy metadata`
2. `listCollections does not expose raw filesystem paths`
3. `OpenAPI documents GET /v1/source-collections`
4. `K12 collection is demo-only and not official curriculum verified`

**Implementation steps:**

1. Add a manifest normalization module for source collections.
2. Seed or derive three default manifests:
   - `k12_kgraph_full`
   - `marble`
   - `learning_commons`
3. Add library method for listing collection summaries.
4. Add route `GET /v1/source-collections`.
5. Add OpenAPI path.
6. Ensure existing source registry API remains backward compatible.

**Acceptance criteria:**

- `GET /v1/source-collections` returns the three required collections.
- K12 collection has `license_scope=non_commercial_demo_only`.
- K12 collection has `publish_profiles=["demo"]`.
- Marble and Learning Commons are not marked demo-only unless their manifest says so.
- No returned field contains an absolute or private raw path.

**Verification:**

```bash
npm test
npm run lint
npm run openapi:validate
```

**Code-review checklist:**

- The collection contract does not leak implementation storage details.
- License policy is not duplicated in route code.
- Default manifests are testable without hitting Postgres.

### Slice A2：Source collection detail API with stable errors

**Blocked by:** A1

**What it delivers:**  
Consumer 可以查單一 collection 詳細資訊，包括 source URI、allowed profiles、current snapshot pointer、artifact summary。未知 collection 回穩定 404。

**Public interface:**

```text
GET /v1/source-collections/:collection_id
```

Response shape:

```json
{
  "object": "source_collection",
  "collection_id": "k12_kgraph_full",
  "collection_type": "knowledge_graph",
  "source_family": "k12",
  "display_name": "K12-KGraph Full",
  "source_uri": "datasets/K12-KGraph-HF/K12-KGraph",
  "license": "CC BY-NC-SA 4.0",
  "license_scope": "non_commercial_demo_only",
  "attribution": "...",
  "locale": "zh-CN",
  "curriculum_region": "mainland_china",
  "official_curriculum_verified": false,
  "publish_profiles": ["demo"],
  "ingest_status": "planned",
  "snapshot": null,
  "artifacts": [],
  "trace": {
    "source": "knowledge_source_registry",
    "profile_policy": {
      "allowed_profiles": ["demo"],
      "blocked_profiles": ["mvp", "prod"]
    }
  }
}
```

**TDD seam:** `SourceCollectionRegistry.getCollection(collectionId)`

**Red tests first:**

1. `getCollection returns K12 detail with profile policy`
2. `getCollection returns stable not_found for unknown collection`
3. `detail route protects private raw path`
4. `OpenAPI documents collection detail response and 404`

**Implementation steps:**

1. Add `getCollection` library method.
2. Add route `GET /v1/source-collections/[collectionId]`.
3. Add stable error handling through existing route error helper.
4. Add artifact summary lookup when artifacts exist.
5. Update OpenAPI.

**Acceptance criteria:**

- Unknown collection returns `{ error: { code/type } }` with 404.
- Existing collection detail includes profile policy.
- Detail response is sufficient for later build/import scripts to validate source policy.

**Verification:**

```bash
npm test
npm run lint
npm run openapi:validate
```

**Code-review checklist:**

- Route code is a thin adapter over registry module.
- Profile policy is produced by a reusable module, not hard-coded in the route.

### Slice A3：Collection registry audit and import summary

**Blocked by:** A1

**What it delivers:**  
When default or configured collections are seeded/imported, Source service writes an audit event and emits a summary artifact. Operators can prove which collections are active and what profile/license policy they carry.

**Public interface:**

```text
script: npm run source-collections:seed
artifact: source-collections:summary:latest
GET /v1/artifacts/source-collections%3Asummary%3Alatest
```

**TDD seam:** `buildSourceCollectionImportSummary()`

**Red tests first:**

1. `buildSourceCollectionImportSummary includes collection count and license summary`
2. `seed writes audit event for source_collection.seeded`
3. `summary artifact is readable through artifact API`
4. `summary artifact checksum changes when manifest changes`

**Implementation steps:**

1. Add summary builder pure module.
2. Add script for seeding default collection manifests.
3. Upsert collection metadata into existing registry tables or new collection table if chosen.
4. Publish `source-collections:summary:latest`.
5. Insert audit event.

**Acceptance criteria:**

- Summary reports all active collection ids.
- Summary includes license_scope counts.
- Summary includes profile coverage, e.g. demo/mvp/prod collection counts.
- Audit event includes actor, target, manifest checksum.

**Verification:**

```bash
npm test
npm run lint
npm run source-collections:seed
```

**Code-review checklist:**

- Script is idempotent.
- Re-running script does not create duplicate active collections.
- No consumer-facing output includes raw path.

## 5. Batch Source-B：Normalized Artifact Builder

### Source-B 目標

Source service 從 raw dataset 建 normalized artifacts。raw 只在 ingestion/build 階段使用，runtime path 和 consumer service 不直接掃 raw files。

### Slice B1：K12 raw snapshot ingest with immutable provenance

**Blocked by:** A2

**What it delivers:**  
Source service 可以 ingest K12-KGraph full raw dataset，建立 immutable source snapshot metadata。此 slice 不要求完整 normalization，只要能檢查 raw layout、計算 checksum、登錄 snapshot。

**Public interface:**

```text
script: npm run source-collections:ingest -- k12_kgraph_full
artifact or DB record: source-snapshot:k12_kgraph_full:<checksum>
```

Snapshot metadata shape:

```json
{
  "snapshot_id": "source-snapshot:k12_kgraph_full:<checksum>",
  "collection_id": "k12_kgraph_full",
  "source_uri": "datasets/K12-KGraph-HF/K12-KGraph",
  "checksum_sha256": "<checksum>",
  "raw_manifest": {
    "file_count": 0,
    "total_bytes": 0,
    "detected_files": []
  },
  "license_scope": "non_commercial_demo_only",
  "created_at": "<ISO datetime>"
}
```

**TDD seam:** `inspectSourceCollectionSnapshot({ collectionId, sourceRoot })`

**Red tests first:**

1. `inspect K12 fixture creates deterministic snapshot id`
2. `snapshot metadata includes license_scope from collection`
3. `missing K12 raw files fails with actionable error`
4. `snapshot response never exposes absolute private path`

**Implementation steps:**

1. Add snapshot inspection module.
2. Add K12 fixture with minimal graph shape for tests.
3. Add ingest script.
4. Persist snapshot metadata in existing `knowledge_source_versions` or a source snapshot artifact.
5. Update collection detail to show current snapshot pointer.

**Acceptance criteria:**

- K12 raw dataset can be inspected without reading from synthesis/workflow.
- Snapshot id is checksum-derived.
- K12 snapshot inherits demo-only license policy.
- Failure message names missing manifest/files.

**Verification:**

```bash
npm test
npm run lint
npm run source-collections:ingest -- k12_kgraph_full
```

**Code-review checklist:**

- Raw filesystem logic is isolated inside ingest/inspection module.
- No API route accepts arbitrary raw file path from caller.

### Slice B2：K12 normalized knowledge graph artifact

**Blocked by:** B1

**What it delivers:**  
K12 raw snapshot can build a `normalized_knowledge_graph` artifact with nodes, edges, source refs, summary, license and provenance.

**Public interface:**

```text
script: npm run source-artifacts:build -- k12_kgraph_full --type normalized_knowledge_graph
artifact: source-artifact:k12_kgraph_full:normalized_knowledge_graph:<checksum>
```

Artifact shape:

```json
{
  "artifact_id": "source-artifact:k12_kgraph_full:normalized_knowledge_graph:<checksum>",
  "collection_id": "k12_kgraph_full",
  "artifact_type": "normalized_knowledge_graph",
  "schema_version": "source_graph.v1",
  "source_snapshot_id": "source-snapshot:k12_kgraph_full:<checksum>",
  "license_scope": "non_commercial_demo_only",
  "attribution": "...",
  "nodes": [
    {
      "id": "math_7a_rjb_cpt41",
      "label": "linear equation in one unknown",
      "subject": "mathematics",
      "learning_stage": "junior_high",
      "node_type": "Concept",
      "source_ref": {
        "collection_id": "k12_kgraph_full",
        "source": "k12_dataset",
        "source_topic_id": "math_7a_rjb_cpt41"
      },
      "license_scope": "non_commercial_demo_only"
    }
  ],
  "edges": [],
  "summary": {
    "node_count": 1,
    "edge_count": 0,
    "subjects": ["mathematics"]
  }
}
```

**TDD seam:** `buildNormalizedArtifact({ collectionId, snapshot })`

**Red tests first:**

1. `K12 adapter converts fixture graph into normalized graph artifact`
2. `normalized graph artifact id is deterministic`
3. `each K12 node includes source_ref and license_scope`
4. `demo-critical K12 topic appears in normalized graph`
5. `invalid K12 source shape returns validation error`

**Implementation steps:**

1. Add normalized artifact schema validator.
2. Add K12 graph adapter.
3. Add build script entry for normalized artifact.
4. Publish artifact through existing artifact storage/metadata path.
5. Add artifact summary to collection detail.

**Acceptance criteria:**

- Artifact is valid JSON and can be read through `/v1/artifacts/:artifactId`.
- Every node has collection/source provenance.
- Artifact metadata includes source snapshot id.
- Checksum changes only when normalized payload changes.

**Verification:**

```bash
npm test
npm run lint
npm run source-artifacts:build -- k12_kgraph_full --type normalized_knowledge_graph
```

**Code-review checklist:**

- Adapter-specific parsing stays behind normalized builder interface.
- Tests assert known-good literal fixture output, not recomputed values.

### Slice B3：Marble and Learning Commons normalized artifacts

**Blocked by:** A2

**What it delivers:**  
Marble and Learning Commons also produce normalized artifacts under the same envelope. This ensures K12 is not a special one-off path.

**Public interface:**

```text
script: npm run source-artifacts:build -- marble --type normalized_documents
script: npm run source-artifacts:build -- learning_commons --type normalized_documents
```

Normalized document shape:

```json
{
  "artifact_id": "source-artifact:marble:normalized_documents:<checksum>",
  "collection_id": "marble",
  "artifact_type": "normalized_documents",
  "schema_version": "source_documents.v1",
  "source_snapshot_id": "source-snapshot:marble:<checksum>",
  "license_scope": "open_or_configured",
  "attribution": "...",
  "records": [
    {
      "id": "marble_fraction_equivalence",
      "title": "Fraction equivalence",
      "subject": "mathematics",
      "learning_stage": "elementary",
      "text": "...",
      "source_ref": {
        "collection_id": "marble",
        "source": "marble",
        "topic_id": "marble_fraction_equivalence"
      }
    }
  ],
  "summary": {
    "record_count": 1,
    "subjects": ["mathematics"]
  }
}
```

**TDD seam:** same `buildNormalizedArtifact` interface with different adapters.

**Red tests first:**

1. `Marble adapter emits normalized_documents artifact envelope`
2. `Learning Commons adapter emits normalized_documents artifact envelope`
3. `normalized documents preserve attribution`
4. `all normalized records include source_ref`

**Implementation steps:**

1. Add adapter registry keyed by collection id.
2. Implement Marble adapter using existing knowledge artifacts as first source.
3. Implement Learning Commons adapter using existing knowledge artifacts as first source.
4. Reuse artifact publisher.
5. Add tests proving shared envelope.

**Acceptance criteria:**

- Marble and Learning Commons artifacts use same provenance envelope.
- No consumer-facing code needs to know raw layout.
- Artifact summary is visible via collection detail.

**Verification:**

```bash
npm test
npm run lint
npm run source-artifacts:build -- marble --type normalized_documents
npm run source-artifacts:build -- learning_commons --type normalized_documents
```

**Code-review checklist:**

- No adapter-specific fields leak into common contract unless namespaced in metadata.
- Future source adapters can be added without changing route handlers.

### Slice B4：Normalized artifact validation and publish gate

**Blocked by:** B2, B3

**What it delivers:**  
All normalized artifacts pass a shared validation gate before publish. Bad artifacts fail fast and are not marked published/validated.

**Public interface:**

```text
module: validateNormalizedArtifact(artifact)
script behavior: build fails before publish when validation fails
artifact publish_status: validated
```

**TDD seam:** `validateNormalizedArtifact`

**Red tests first:**

1. `valid K12 normalized graph passes`
2. `valid normalized documents pass`
3. `missing source_ref fails`
4. `missing license_scope fails`
5. `record with absolute raw path fails`
6. `build script does not publish invalid artifact`

**Implementation steps:**

1. Add shared validators for source graph and source documents.
2. Add validation result to build summary.
3. Ensure invalid artifacts do not update latest alias.
4. Add audit event for validation failure/success.

**Acceptance criteria:**

- Invalid artifact returns stable error codes.
- Valid artifact moves to `publish_status=validated` or equivalent.
- Validation summary includes record counts and failure counts.

**Verification:**

```bash
npm test
npm run lint
```

**Code-review checklist:**

- Validation is not route-only; scripts and API paths reuse the same module.
- Error codes are deterministic and testable.

## 6. Batch Source-C：Topic Candidate Export

### Source-C 目標

`knowledge-synthesis-service` 不再讀 K12 raw dataset，而是從 Source service 匯入 topic candidates。Source service 負責從 normalized artifact 產生 candidate artifact，並用 API 發布。

### Slice C1：Build K12 topic candidate artifact from normalized graph

**Blocked by:** B2

**What it delivers:**  
K12 normalized graph 可轉成 topic candidate artifact。這個 artifact 是 synthesis topic registry importer 後續唯一應讀的 K12 topic source。

**Public interface:**

```text
script: npm run topic-candidates:build -- --profile demo --collection_id k12_kgraph_full
artifact: topic-candidates:k12_kgraph_full:demo:<checksum>
```

Candidate shape:

```json
{
  "topic_key": "k12_math_7a_rjb_cpt41",
  "canonical_label": "linear equation in one unknown",
  "aliases": [
    "linear equation in one unknown",
    "one-variable linear equation"
  ],
  "subject": "mathematics",
  "learning_stage": "junior_high",
  "topic_family": "concept",
  "source": "k12_dataset",
  "source_topic_id": "math_7a_rjb_cpt41",
  "source_node_type": "Concept",
  "parent_topic_key": "k12_math_7a_rjb_ch3_s1",
  "source_refs": [
    {
      "source": "k12_dataset",
      "topic_id": "math_7a_rjb_cpt41"
    }
  ],
  "metadata": {
    "collection_id": "k12_kgraph_full",
    "source_artifact_id": "source-artifact:k12_kgraph_full:normalized_knowledge_graph:<checksum>",
    "official_curriculum_verified": false,
    "license_scope": "non_commercial_demo_only"
  }
}
```

**TDD seam:** `buildTopicCandidateArtifact`

**Red tests first:**

1. `K12 normalized graph builds topic candidate artifact`
2. `candidate topic_key is deterministic`
3. `candidate includes source_artifact_id and license_scope`
4. `candidate includes parent topic when graph has parent relation`
5. `candidate artifact rejects prod profile for K12 full`

**Implementation steps:**

1. Add topic candidate schema.
2. Add graph-to-candidate mapper.
3. Add profile policy check for candidate build.
4. Publish candidate artifact through artifact publisher.
5. Record source artifact id and checksum.

**Acceptance criteria:**

- Candidate artifact can be JSON parsed.
- Candidate artifact has artifact id and source artifact id.
- K12 candidates are profile `demo` only.
- No raw path appears in candidate metadata.

**Verification:**

```bash
npm test
npm run lint
npm run topic-candidates:build -- --profile demo --collection_id k12_kgraph_full
```

**Code-review checklist:**

- Candidate mapping is deterministic.
- Profile policy is enforced before artifact publish.

### Slice C2：Topic candidates export API

**Blocked by:** C1

**What it delivers:**  
`knowledge-synthesis-service` can call `GET /v1/topic-candidates/export?profile=demo&collection_id=k12_kgraph_full` and receive candidates with provenance.

**Public interface:**

```text
GET /v1/topic-candidates/export?profile=demo&collection_id=k12_kgraph_full
GET /v1/topic-candidates/export?profile=demo&collection_id=k12_kgraph_full&subject=mathematics
GET /v1/topic-candidates/export?profile=demo&collection_id=k12_kgraph_full&learning_stage=junior_high
GET /v1/topic-candidates/export?profile=demo&collection_id=k12_kgraph_full&node_type=Concept
```

Response shape:

```json
{
  "object": "topic_candidate_export",
  "profile": "demo",
  "collection_id": "k12_kgraph_full",
  "artifact_id": "topic-candidates:k12_kgraph_full:demo:<checksum>",
  "checksum_sha256": "<checksum>",
  "source_artifact_id": "source-artifact:k12_kgraph_full:normalized_knowledge_graph:<checksum>",
  "license_scope": "non_commercial_demo_only",
  "data": [],
  "trace": {
    "profile": "demo",
    "filters": {
      "subject": "mathematics",
      "learning_stage": null,
      "node_type": null
    },
    "candidate_count": 0,
    "returned_count": 0,
    "raw_path_exposed": false
  }
}
```

**TDD seam:** `exportTopicCandidates`

**Red tests first:**

1. `exportTopicCandidates returns candidates from artifact`
2. `export filters by subject`
3. `export filters by learning_stage`
4. `export filters by node_type`
5. `export rejects invalid profile`
6. `export rejects K12 full with mvp/prod profile`
7. `OpenAPI documents topic candidate export`

**Implementation steps:**

1. Add export library that reads candidate artifact by profile/collection id.
2. Add filter support.
3. Add route.
4. Add service key auth if v1 read APIs are configured to be protected.
5. Add OpenAPI contract.

**Acceptance criteria:**

- API can serve K12 candidate export without reading raw dataset.
- API response includes artifact id, checksum, source artifact id, license scope.
- Filtering is deterministic.
- Invalid profile fails fast with 400.

**Verification:**

```bash
npm test
npm run lint
npm run openapi:validate
```

**Code-review checklist:**

- Route reads topic candidate artifact, not raw graph.
- Error response follows existing `routeError` style.
- Artifact metadata is visible to caller.

### Slice C3：Large export pagination and artifact download reference

**Blocked by:** C2

**What it delivers:**  
K12 full graph may contain many candidates. Export API supports pagination or a download reference so consumers do not need one giant response.

**Public interface:**

```text
GET /v1/topic-candidates/export?profile=demo&collection_id=k12_kgraph_full&limit=100&cursor=<cursor>
GET /v1/topic-candidates/export?profile=demo&collection_id=k12_kgraph_full&download=true
```

Response pagination shape:

```json
{
  "object": "topic_candidate_export",
  "data": [],
  "pagination": {
    "limit": 100,
    "next_cursor": "opaque-or-null",
    "has_more": false
  },
  "artifact": {
    "artifact_id": "topic-candidates:k12_kgraph_full:demo:<checksum>",
    "download_url": "/v1/artifacts/topic-candidates%3Ak12_kgraph_full%3Ademo%3A..."
  }
}
```

**TDD seam:** `paginateTopicCandidates`

**Red tests first:**

1. `pagination returns stable first page`
2. `cursor returns next page without duplicates`
3. `limit is clamped to safe maximum`
4. `download mode returns artifact reference`
5. `pagination preserves same artifact id and checksum across pages`

**Implementation steps:**

1. Choose cursor strategy. Prefer opaque offset cursor if artifact order is deterministic.
2. Add limit clamp.
3. Add download reference pointing to existing artifact endpoint.
4. Extend OpenAPI.

**Acceptance criteria:**

- Full export can be consumed page by page.
- Every page includes same artifact id/checksum.
- Cursor cannot be used to read arbitrary file/path.

**Verification:**

```bash
npm test
npm run lint
npm run openapi:validate
```

**Code-review checklist:**

- Cursor is opaque or safely parsed.
- Pagination is over artifact content, not raw source.

## 7. Batch Source-D：Profile-Aware Runtime Index

### Source-D 目標

Runtime index 發布要支援 `demo | mvp | prod`，且 profile 不能互相 fallback。demo 可以包含 K12 full topic graph；mvp/prod 不可誤吃 demo-only K12 full source。

### Slice D1：Runtime profile policy module

**Blocked by:** A2

**What it delivers:**  
集中 module 處理 runtime profile：解析 profile、檢查 collection 是否可用於某 profile、產生 policy decision trace。

**Public interface:**

```text
resolveRuntimeProfile(inputProfile)
assertCollectionAllowedForProfile(collection, profile, usage)
summarizeProfileDecision(decisions)
```

**TDD seam:** `RuntimeProfilePolicy`

**Red tests first:**

1. `resolveRuntimeProfile accepts demo mvp prod`
2. `resolveRuntimeProfile rejects invalid profile`
3. `K12 full is allowed for demo runtime`
4. `K12 full is blocked for mvp/prod runtime`
5. `policy decision includes license_scope and reason_code`

**Implementation steps:**

1. Add `src/lib/runtime-profile.js` or equivalent.
2. Encode allowed profile rules using collection manifest, not route hard-coding.
3. Add structured reason codes:
   - `profile_allowed`
   - `demo_only_source_blocked`
   - `profile_not_allowed_by_collection`
   - `invalid_runtime_profile`
4. Add tests.

**Acceptance criteria:**

- All profile decisions are deterministic.
- Policy module can be used by runtime index, topic candidates, retrieve.
- No profile logic is duplicated in route handlers.

**Verification:**

```bash
npm test
npm run lint
```

**Code-review checklist:**

- Profile policy is data-driven from collection metadata.
- Future tenant policy can plug in without rewriting callers.

### Slice D2：Profile-specific runtime index aliases and publisher

**Blocked by:** B4, D1

**What it delivers:**  
Source service can publish profile-specific runtime index artifacts:

```text
runtime-index:demo:latest
runtime-index:mvp:latest
runtime-index:prod:latest
runtime-index:<profile>:sha256:<checksum>
```

**Public interface:**

```text
script: npm run runtime-index:publish -- --profile demo
script: npm run runtime-index:publish -- --profile mvp
script: npm run runtime-index:publish -- --profile prod
```

Runtime artifact metadata:

```json
{
  "profile": "demo",
  "points_to_artifact_id": "runtime-index:demo:sha256:<checksum>",
  "source_collection_ids": ["k12_kgraph_full", "marble", "learning_commons"],
  "blocked_collection_ids": [],
  "checksum_sha256": "<checksum>"
}
```

**TDD seam:** `publishRuntimeIndexForProfile`

**Red tests first:**

1. `publish demo runtime index creates profile latest alias`
2. `publish mvp runtime index does not include K12 full demo-only collection`
3. `publish prod runtime index does not fallback to demo alias`
4. `published profile alias points to immutable content-addressed artifact`
5. `publish summary includes blocked collections`

**Implementation steps:**

1. Extend existing runtime index pinning to include profile in alias/id.
2. Add profile-aware publisher script.
3. Use runtime profile policy to include/block source collections.
4. Preserve existing `runtime-index:latest` behavior as compatibility alias if needed.
5. Add audit event for profile publish.

**Acceptance criteria:**

- Profile-specific aliases exist and point to immutable artifacts.
- Demo and mvp/prod aliases are separate.
- mvp/prod publish trace clearly shows demo-only K12 blocked.

**Verification:**

```bash
npm test
npm run lint
npm run runtime-index:publish -- --profile demo
```

**Code-review checklist:**

- Compatibility alias does not silently hide profile selection.
- Profile alias id format is stable and documented.

### Slice D3：Profile-aware runtime index API

**Blocked by:** D2

**What it delivers:**  
`GET /v1/runtime-index/latest?profile=demo|mvp|prod` returns the selected profile runtime index with artifact id, checksum, license and source collection trace.

**Public interface:**

```text
GET /v1/runtime-index/latest?profile=demo
GET /v1/runtime-index/latest?profile=mvp
GET /v1/runtime-index/latest?profile=prod
```

Response shape:

```json
{
  "object": "runtime_index",
  "profile": "demo",
  "trace_mode": "content_addressed_version",
  "alias": {
    "artifact_id": "runtime-index:demo:latest",
    "points_to_artifact_id": "runtime-index:demo:sha256:<checksum>",
    "checksum_sha256": "<checksum>",
    "publish_status": "published"
  },
  "version": {
    "artifact_id": "runtime-index:demo:sha256:<checksum>",
    "checksum_sha256": "<checksum>",
    "publish_status": "published"
  },
  "summary": {
    "source_count": 0,
    "topic_count": 0,
    "source_ref_count": 0
  },
  "profile_trace": {
    "profile": "demo",
    "source_collection_ids": [],
    "blocked_collection_ids": [],
    "policy_decisions": []
  },
  "index": {}
}
```

**TDD seam:** `getLatestRuntimeIndex({ profile })`

**Red tests first:**

1. `getLatestRuntimeIndex selects demo alias when profile=demo`
2. `getLatestRuntimeIndex selects mvp alias when profile=mvp`
3. `invalid profile returns bad_request`
4. `response headers include profile and checksum`
5. `cache keys include profile to avoid cross-profile cache pollution`
6. `OpenAPI documents profile query parameter`

**Implementation steps:**

1. Update source library method to accept profile.
2. Update route to parse profile query.
3. Update response headers:
   - `X-Knowledge-Source-Profile`
   - existing artifact/checksum headers
4. Update cache keys to include profile.
5. Update OpenAPI.

**Acceptance criteria:**

- Different profiles cannot share cached response accidentally.
- Invalid profile fails fast.
- Existing no-profile behavior is documented and deterministic.

**Verification:**

```bash
npm test
npm run lint
npm run openapi:validate
```

**Code-review checklist:**

- No route-level fallback from missing profile artifact to another profile.
- Cache invalidation includes profile-specific latest aliases.

### Slice D4：Demo runtime index includes K12 full topic graph; mvp/prod exclude it

**Blocked by:** C1, D3

**What it delivers:**  
Demo profile runtime can resolve K12 full topics; mvp/prod runtime cannot accidentally include K12 full demo-only refs.

**Public interface:**

```text
GET /v1/runtime-index/latest?profile=demo
GET /v1/runtime-index/latest?profile=mvp
GET /v1/runtime-index/latest?profile=prod
```

**TDD seam:** profile runtime index builder with K12 candidate fixture.

**Red tests first:**

1. `demo runtime index includes K12 full demo topic refs`
2. `demo K12 topic refs include demo-only license metadata`
3. `mvp runtime index excludes K12 full demo-only refs`
4. `prod runtime index excludes K12 full demo-only refs`
5. `profile trace records blocked demo-only collection for mvp/prod`

**Implementation steps:**

1. Teach runtime index builder to include topic candidates by profile.
2. Include K12 candidates only for demo.
3. Mark K12 retrieved sources as demo-only/non-commercial.
4. Add fixture for one demo-critical topic.
5. Add tests for all three profiles.

**Acceptance criteria:**

- Demo profile can expose K12 topic graph.
- mvp/prod output contains no K12 full source refs.
- Profile trace makes inclusion/blocking auditable.

**Verification:**

```bash
npm test
npm run lint
npm run runtime-index:publish -- --profile demo
npm run runtime-index:publish -- --profile mvp
npm run runtime-index:publish -- --profile prod
```

**Code-review checklist:**

- K12 is not globally normalized into every runtime profile.
- Tests check negative case for mvp/prod explicitly.

## 8. Batch Source-E：Retrieval API

### Source-E 目標

Source service 提供 retrieval API，讓 AI Workflow / Synthesis 不再讀 Marble、Learning Commons、K12 raw or local artifact files。Retrieval result 必須帶 source_ref、license_scope、artifact_version 與 profile policy trace。

### Slice E1：Lexical retrieval over normalized artifacts

**Blocked by:** B4, D1

**What it delivers:**  
`POST /v1/retrieve` 可以依 profile/query/subject/stage 從 normalized artifacts 回傳簡單 lexical retrieval results。先不用 vector search。

**Public interface:**

```text
POST /v1/retrieve
```

Request:

```json
{
  "profile": "mvp",
  "query": "fraction equivalence",
  "subject": "mathematics",
  "learning_stage": "elementary",
  "tenant_id": null,
  "allowed_source_scopes": ["official_curriculum", "approved_materials"],
  "limit": 8
}
```

Response:

```json
{
  "object": "retrieval_result",
  "profile": "mvp",
  "results": [
    {
      "result_id": "retrieval:marble:marble_fraction_equivalence",
      "collection_id": "marble",
      "source": "marble",
      "source_ref": {
        "source": "marble",
        "topic_id": "marble_fraction_equivalence"
      },
      "title": "Fraction equivalence",
      "text": "...",
      "score": 1,
      "license_scope": "open_or_configured",
      "artifact_id": "source-artifact:marble:normalized_documents:<checksum>",
      "checksum_sha256": "<checksum>"
    }
  ],
  "trace": {
    "profile": "mvp",
    "source_collections": ["marble", "learning_commons"],
    "blocked_collections": [],
    "policy_decisions": []
  }
}
```

**TDD seam:** `KnowledgeRetriever.retrieve`

**Red tests first:**

1. `retrieve returns lexical matches from normalized documents`
2. `retrieve filters by subject`
3. `retrieve filters by learning_stage`
4. `retrieve clamps limit`
5. `retrieve returns empty result with ok trace for no match`
6. `route validates missing query`
7. `OpenAPI documents POST /v1/retrieve`

**Implementation steps:**

1. Add retrieval request parser/validator.
2. Add lexical retrieval over normalized documents/graph records.
3. Add route `POST /v1/retrieve`.
4. Add response provenance envelope.
5. Add OpenAPI.

**Acceptance criteria:**

- Retrieval can work without consumer reading source files.
- Results include source refs and artifact provenance.
- No match is not an error.

**Verification:**

```bash
npm test
npm run lint
npm run openapi:validate
```

**Code-review checklist:**

- Retrieval implementation reads normalized/retrieval artifacts only.
- Query parsing is small and testable.

### Slice E2：Profile and license policy filtering for retrieval

**Blocked by:** E1

**What it delivers:**  
Retrieval API blocks demo-only sources for mvp/prod and records policy decisions in trace. Demo may include K12 but must label non-commercial/demo-only status.

**Public interface:** same `POST /v1/retrieve`

**TDD seam:** `KnowledgeRetriever.retrieve` + `RuntimeProfilePolicy`

**Red tests first:**

1. `mvp retrieve does not return K12 demo-only results`
2. `prod retrieve does not return K12 demo-only results`
3. `demo retrieve may return K12 result with non_commercial_demo_only license`
4. `trace includes blocked_collections for mvp/prod`
5. `trace includes policy_decisions with reason_code`

**Implementation steps:**

1. Apply runtime profile policy before scoring or before returning results.
2. Add blocked collection trace.
3. Add license scope trace for returned results.
4. Add tests with mixed Marble/Learning Commons/K12 fixtures.

**Acceptance criteria:**

- mvp/prod never return demo-only K12 result.
- Demo returns K12 only with license/profile trace.
- Trace is sufficient for workflow persistence later.

**Verification:**

```bash
npm test
npm run lint
```

**Code-review checklist:**

- Policy filtering is centralized.
- Tests include both allowed and blocked examples.

### Slice E3：Retrieval index artifact

**Blocked by:** E1

**What it delivers:**  
Retrieval no longer scans every normalized artifact at request time. It can build and read a retrieval index artifact with checksum/provenance.

**Public interface:**

```text
script: npm run retrieval-index:build -- --profile mvp
POST /v1/retrieve
artifact: retrieval-index:<profile>:sha256:<checksum>
alias: retrieval-index:<profile>:latest
```

Retrieval index shape:

```json
{
  "artifact_id": "retrieval-index:mvp:sha256:<checksum>",
  "artifact_type": "retrieval_index",
  "profile": "mvp",
  "schema_version": "retrieval_index.v1",
  "source_artifact_ids": [],
  "documents": [
    {
      "document_id": "marble:marble_fraction_equivalence",
      "collection_id": "marble",
      "source_ref": {
        "source": "marble",
        "topic_id": "marble_fraction_equivalence"
      },
      "subject": "mathematics",
      "learning_stage": "elementary",
      "text": "..."
    }
  ],
  "summary": {
    "document_count": 1
  }
}
```

**TDD seam:** `buildRetrievalIndex` and `retrieveFromIndex`

**Red tests first:**

1. `buildRetrievalIndex creates deterministic profile artifact`
2. `retrieveFromIndex returns same result as lexical normalized scan for fixture`
3. `retrieve response includes retrieval index artifact id`
4. `retrieval index excludes blocked profile sources`
5. `latest alias points to content-addressed retrieval index`

**Implementation steps:**

1. Add retrieval index builder.
2. Publish profile-specific retrieval index artifact.
3. Modify retrieve to prefer retrieval index artifact.
4. Keep normalized scan fallback only for development or explicit mode if needed.
5. Add trace showing retrieval index artifact id.

**Acceptance criteria:**

- Retrieval response can be traced to retrieval index artifact.
- Same query/profile over same index is deterministic.
- mvp/prod retrieval index excludes K12 demo-only documents.

**Verification:**

```bash
npm test
npm run lint
npm run retrieval-index:build -- --profile mvp
```

**Code-review checklist:**

- Runtime path reads retrieval index, not raw/normalized scan unless explicitly allowed.
- Index artifact records all source artifact ids.

### Slice E4：Tenant-aware retrieval policy seam

**Blocked by:** E2

**What it delivers:**  
Retrieval request accepts `tenant_id` and policy trace includes tenant decision. This is a seam for future prod tenant overlay, not full tenant source implementation.

**Public interface:** same `POST /v1/retrieve`

Trace extension:

```json
{
  "trace": {
    "tenant": {
      "tenant_id": "tenant_a",
      "policy_status": "default_policy",
      "allowed_collection_ids": [],
      "blocked_collection_ids": []
    }
  }
}
```

**TDD seam:** `resolveTenantSourcePolicy`

**Red tests first:**

1. `retrieve accepts tenant_id and records tenant trace`
2. `default tenant policy does not grant extra sources`
3. `tenant policy blocks unknown tenant source by default`
4. `tenant trace is present for prod profile`

**Implementation steps:**

1. Add tenant policy resolver with default no-extra-access behavior.
2. Add tenant trace to retrieval response.
3. Ensure tenant_id cannot bypass profile/license policy.

**Acceptance criteria:**

- Tenant seam exists and is testable.
- Tenant policy cannot enable K12 demo-only in prod.
- Future tenant adapters can plug into this seam.

**Verification:**

```bash
npm test
npm run lint
```

**Code-review checklist:**

- Tenant policy is layered under profile/license policy, not above it.
- No speculative tenant DB schema unless needed by tests.

## 9. Cross-batch readiness gate

After Source-A to Source-E are complete, add one final readiness gate before moving to `knowledge-synthesis-service`.

### Final Slice：Knowledge Source as sole source readiness smoke

**Blocked by:** A1-A3, B1-B4, C1-C3, D1-D4, E1-E4

**What it delivers:**  
One command proves Source service can act as the sole source data provider for downstream work.

**Public interface:**

```text
npm run source:sole-source:smoke
```

Expected compact JSON:

```json
{
  "status": "ok",
  "checks": {
    "source_collections": "passed",
    "normalized_artifacts": "passed",
    "topic_candidates_export": "passed",
    "runtime_index_demo": "passed",
    "runtime_index_mvp": "passed",
    "runtime_index_prod": "passed",
    "retrieve_demo": "passed",
    "retrieve_mvp": "passed",
    "profile_policy": "passed"
  }
}
```

**TDD seam:** smoke runner with mocked fetch/library adapters where possible.

**Red tests first:**

1. `sole source smoke reports failed_check on source collection failure`
2. `sole source smoke rejects mvp runtime containing demo-only K12`
3. `sole source smoke verifies topic candidates do not expose raw path`
4. `sole source smoke verifies retrieve response has artifact/checksum/license/profile trace`

**Acceptance criteria:**

- Smoke fails on first broken capability with `failed_check`.
- Smoke proves no consumer needs raw dataset path.
- Smoke proves demo/mvp/prod profile separation.

**Verification:**

```bash
npm test
npm run lint
npm run openapi:validate
npm run source:sole-source:smoke
```

## 10. Suggested Claude Code execution template per slice

Claude Code should use this checklist for every slice:

```text
1. Read this slice.
2. Read current related code and tests.
3. Identify the public seam under test.
4. Write one failing test at that seam.
5. Run the focused test and confirm it fails for the expected reason.
6. Implement the smallest module/route/script change.
7. Run the focused test until green.
8. Add any missing contract/OpenAPI tests for the same slice.
9. Run npm test, npm run lint, and openapi validation if applicable.
10. Review:
    - Does response include artifact id/checksum/license/profile trace?
    - Does code avoid raw path exposure?
    - Is profile policy centralized?
    - Is the module interface small?
    - Did we avoid speculative future tenant/vector work?
11. Update documentation only if the slice changed public contract.
```

## 11. Handoff to next phase

Only start adjusting `knowledge-synthesis-service` after these Source service capabilities are available and verified:

1. `GET /v1/source-collections`
2. `GET /v1/source-collections/:collection_id`
3. normalized artifacts for K12, Marble, Learning Commons
4. `GET /v1/topic-candidates/export`
5. `GET /v1/runtime-index/latest?profile=demo|mvp|prod`
6. `POST /v1/retrieve`
7. sole-source readiness smoke

The next phase should then change synthesis so it imports topic candidates and retrieval context from Source APIs, and treats its own database/wiki only as review status, alias, prompt context and runtime rule control plane.

## 12. Current Implementation Status Inventory

This table records the implementation state after Source-A through Source-G G1-G9, including the final Source-G closeout for optional profile compatibility, OpenAPI docs, and readiness smoke checks. It is intentionally written as a handoff checkpoint before deciding whether to move to `knowledge-synthesis-service`.

| Area | Status | Evidence / Current Capability | Remaining Gap |
| --- | --- | --- | --- |
| Source collection registry | Done | `GET /v1/source-collections`; `GET /v1/source-collections/:collection_id`; K12 / Marble / Learning Commons manifests include license, attribution, profile policy, and no raw path exposure. | None for current scope. |
| Management/read API auth | Done | Protected v1 read/admin-style APIs support `Authorization: Bearer <key>`; `KNOWLEDGE_SOURCE_KEY` still works as service/admin key; tenant/user DB keys resolve only when `ENABLE_TENANT=true`. | Future production may replace local service key with platform auth or gateway auth. |
| K12 raw snapshot ingest | Done | `npm run source-collections:ingest -- k12_kgraph_full`; deterministic snapshot id; private raw path not exposed in public responses. | K12 source data encoding quality should be revisited separately if displayed labels are garbled. |
| K12 normalized graph artifact | Done | `npm run source-artifacts:build -- k12_kgraph_full --type normalized_knowledge_graph`; shared validation; source refs and license metadata. | None for current K12 normalized graph scope. |
| Marble normalized artifact pipeline | Done | Adapter registry, fixture adapter tests, managed snapshot inspection, `source-artifacts:build -- marble --type normalized_documents`, retrieval-index/retrieve integration. | Future graph-aware use of `dependencies.json` can be split into a later batch if needed. |
| Learning Commons normalized artifact pipeline | Done | Adapter registry, JSONL fixture adapter tests, managed snapshot inspection, `source-artifacts:build -- learning_commons --type normalized_documents`, retrieval-index/retrieve integration. | Future graph-aware use of `relationships.jsonl` can be split into a later batch if needed. |
| Normalized artifact validation gate | Done | `validateNormalizedArtifact`; invalid artifacts fail before publish; raw path leakage is rejected; LaTeX-style backslashes are not treated as raw paths. | None for current normalized artifact validation scope. |
| Topic candidate artifact build/export | Done for K12 demo + profile optional | `npm run topic-candidates:build -- --profile demo --collection_id k12_kgraph_full`; `/v1/topic-candidates/export`; pagination/download mode; `profile` is now optional for export and remains accepted as deprecated compatibility input; K12 blocked for mvp/prod. | Marble / Learning Commons topic candidate generation is not required yet unless synthesis later needs topic registries from those collections. |
| Profile-aware runtime index | Done + access-aware | `runtime-index:demo|mvp|prod:latest`; `GET /v1/runtime-index/latest?profile=...`; profile query remains compatible and documented as deprecated; without profile, route derives runtime visibility from key/env access scope and filters returned payload. | None for Source-G current scope. Full profile removal should wait until downstream consumers migrate. |
| Retrieval API | MVP done + access-aware | `POST /v1/retrieve`; `profile` is now optional; resolver `effective_collection_ids` is authoritative; stale retrieval indexes are hard-filtered by access scope; trace includes `trace.access`. | Search algorithm is lexical MVP; vector/hybrid retrieval remains future work. |
| Tenant policy | G1-G8 done | Env defaults, key hash store, pure resolver, request auth wrapper, retrieval/runtime/artifact/topic/collection policy integration, tenant fallback, tenant overlay, and tenant collection skeleton are implemented. | Quota, upload lifecycle, per-tenant index materialization, and cross-tenant sharing remain future batches. |
| Knowledge Access Resolver | Done + documented | Resolves effective collection ids from request identity + `ENABLE_TENANT` + `ENABLE_K12` + `DEFAULT_KNOWLEDGE` + tenant DB entitlements; request-supplied collection ids can only narrow access; OpenAPI now documents `KnowledgeAccessTrace`. | None for Source-G current scope. |
| Tenant knowledge entitlement DB | Done for resolver scope | Migration adds tenant, user, API key, entitlement, tenant collection, and access audit tables; key lookup uses SHA-256 hash and never returns plaintext/hash. | Future upload APIs and operational key-management commands are not implemented. |
| Request-facing profile removal | Migration compatibility complete | Existing `profile=demo|mvp|prod` remains accepted as deprecated compatibility input; `/v1/retrieve`, `/v1/runtime-index/latest`, and `/v1/topic-candidates/export` can operate without caller-chosen profile where applicable. | Full profile removal should wait until `knowledge-synthesis-service` and `ai-workflow-service` migrate. |
| Cross-batch readiness gate | Done | `npm run source:sole-source:smoke` returns compact JSON; once approved Marble / Learning Commons normalized docs exist, empty mvp/prod retrieval becomes a failed check. | Future retrieval quality improvements can add vector/hybrid checks in a separate batch. |
| Source-G final closeout | Done | Topic candidate export no longer requires `profile`; OpenAPI documents `KnowledgeAccessTrace`, access headers, Bearer service/tenant key behavior, optional/deprecated `profile`; readiness smoke checks default-only, K12-disabled, tenant fallback, and tenant overlay; final verification is `201/201` tests passing plus lint/OpenAPI validation. | Future docs can add operational examples for creating tenant keys and uploaded教材 once upload/key-management commands exist. |
| `knowledge-synthesis-service` migration | Not started | Source service APIs are ready enough to begin integration. | Remove raw dataset as primary path; import topic candidates/retrieval context from Source API. |
| `ai-workflow-service` migration | Not started | Source/Synthesis contracts are being prepared. | Consume Source/Synthesis runtime contract only; prevent demo-only source from reaching mvp/prod workflow. |

Recommended interpretation:

```text
Source service core sole-source provider capability: ready enough to hand off for Source/Synthesis integration.
Complete original sole-source initiative across all services: not done yet.
Marble / Learning Commons normalized adapter completeness: completed by Source-F.
Knowledge Access Resolver / tenant-aware knowledge access: Source-G G1-G9 completed for the current scope.
```

Latest verification after Source-G G9:

```bash
node --experimental-default-type=module --test test
# 201/201 passing

npm run lint
# passing

npm run openapi:validate
# passing
```

## 13. Batch Source-F：Marble / Learning Commons Complete Normalized Adapter Pipeline

### Source-F Goal

Complete the missing normalized artifact pipeline for `marble` and `learning_commons` so they are not merely registered collections or test fixtures. After Source-F, both collections should be ingestible/buildable through the same Source service path as K12:

```text
source collection manifest
  -> source snapshot inspection / ingest
  -> normalized_documents adapter
  -> shared validation
  -> artifact publish
  -> artifact API / collection detail
  -> retrieval index build
  -> sole-source readiness smoke
```

Design preference:

- Use deep modules: expose a small adapter registry and keep source-specific parsing inside adapters.
- Use expand-contract: add Marble / Learning Commons adapters beside the existing K12 code first; only consolidate K12 behind the adapter registry after tests prove no behavior changed.
- Keep runtime/public paths free of raw dataset reads. Raw reads are allowed only in ingest/build scripts.
- Use fixtures first, then real local data paths. Tests should not require a full external dataset.
- Do not add vector retrieval in this batch. This batch is about normalized source completeness, not retrieval ranking quality.

### Source-F Dependency Map

```text
F1 adapter contract expansion
  -> F2 Marble fixture adapter
  -> F3 Marble publish + retrieval smoke

F1 adapter contract expansion
  -> F4 Learning Commons fixture adapter
  -> F5 Learning Commons publish + retrieval smoke

F3 + F5
  -> F6 readiness gate tightening
  -> F7 adapter consolidation review
```

Recommended implementation order:

```text
F1, F2, F3, F4, F5, F6, F7
```

### Slice F1：Normalized document adapter contract and registry

**Blocked by:** B4

**What it delivers:**  
A Source service internal adapter contract for normalized document builders. This is an expand step: add the registry without breaking the existing K12 normalized graph builder.

**Public interface:**

```text
module: getNormalizedArtifactAdapter({ collectionId, artifactType })
script behavior: existing source-artifacts:build still works for K12
```

Adapter interface:

```js
{
  collection_id: "marble",
  artifact_type: "normalized_documents",
  inspectSource({ collection, sourceRoot }),
  buildArtifact({ collection, snapshot, sourceRoot })
}
```

**TDD seam:** adapter registry pure module.

**Red tests first:**

1. `adapter registry resolves marble normalized_documents adapter`
2. `adapter registry resolves learning_commons normalized_documents adapter`
3. `adapter registry preserves k12 normalized_knowledge_graph behavior`
4. `unsupported collection/type returns source_collection_not_supported`

**Implementation steps:**

1. Add `src/lib/source-artifacts/adapters/registry.js`.
2. Define the small adapter shape and supported `(collection_id, artifact_type)` pairs.
3. Keep existing K12 build path working; wrap it only if low-risk.
4. Ensure errors are structured `HttpError` with stable code.

**Acceptance criteria:**

- No route or script contains Marble / Learning Commons parsing logic.
- Existing K12 tests and build script keep passing.
- Adding a new adapter requires adding one registry entry, not changing route handlers.

**Verification:**

```bash
npm test
npm run lint
npm run source-artifacts:build -- k12_kgraph_full --type normalized_knowledge_graph
```

**Code-review checklist:**

- Adapter interface is small.
- Registry does not expose raw path details to API modules.
- No speculative vector/topic-candidate logic is added.

### Slice F2：Marble normalized_documents adapter over fixture source

**Blocked by:** F1

**What it delivers:**  
Marble can produce a deterministic `normalized_documents` artifact from a small fixture that represents the real Marble taxonomy shape.

**Public interface:**

```text
module: buildNormalizedArtifact({ collection, snapshot, sourceRoot, artifactType: "normalized_documents" })
collection: marble
```

Expected artifact envelope:

```json
{
  "artifact_id": "source-artifact:marble:normalized_documents:sha256:<checksum>",
  "collection_id": "marble",
  "artifact_type": "normalized_documents",
  "schema_version": "source_documents.v1",
  "source_snapshot_id": "source-snapshot:marble:sha256:<checksum>",
  "license_scope": "open_educational_source",
  "attribution": "...",
  "records": [
    {
      "id": "marble_fraction_equivalence",
      "title": "Fraction equivalence",
      "subject": "mathematics",
      "learning_stage": "elementary",
      "text": "...",
      "source_ref": {
        "collection_id": "marble",
        "source": "marble",
        "topic_id": "marble_fraction_equivalence"
      },
      "license_scope": "open_educational_source"
    }
  ],
  "summary": {
    "record_count": 1,
    "subjects": ["mathematics"]
  }
}
```

**TDD seam:** Marble adapter fixture test.

**Red tests first:**

1. `Marble adapter converts fixture taxonomy into normalized_documents artifact`
2. `Marble normalized artifact id is deterministic`
3. `Marble records include source_ref and license_scope`
4. `Marble adapter preserves attribution from collection manifest`
5. `Marble adapter rejects invalid fixture shape with actionable error`

**Implementation steps:**

1. Add a minimal Marble fixture under `test/fixtures/marble/`.
2. Implement Marble adapter parsing behind the adapter interface.
3. Map source ids and labels into normalized document `records`.
4. Reuse shared checksum/envelope logic where possible.
5. Run shared `validateNormalizedArtifact` against adapter output.

**Acceptance criteria:**

- Marble output passes `validateNormalizedArtifact`.
- No absolute/raw source path appears in artifact records.
- Every record has `source_ref`, `license_scope`, and stable `id`.

**Verification:**

```bash
node --experimental-default-type=module --test test/marble-normalized-adapter.test.mjs
npm test
npm run lint
```

**Code-review checklist:**

- Marble-specific parsing stays in the adapter.
- Field mapping is explicit and tested with literal expected output.
- Adapter errors name the missing required Marble fixture file/field.

### Slice F3：Marble snapshot/build/publish pipeline and retrieval integration

**Blocked by:** F2

**What it delivers:**  
`npm run source-artifacts:build -- marble --type normalized_documents` publishes a validated Marble artifact and retrieval index build can include Marble documents for mvp/prod.

**Public interface:**

```text
npm run source-collections:ingest -- marble
npm run source-artifacts:build -- marble --type normalized_documents
npm run retrieval-index:build -- --profile mvp
POST /v1/retrieve { "profile": "mvp", "query": "fraction equivalence" }
```

**TDD seam:** build script seam with mocked `getCollection`, `resolveSourceRoot`, `writeArtifact`, and `withClient`.

**Red tests first:**

1. `Marble build script publishes validated normalized_documents metadata`
2. `Marble artifact summary appears in source collection detail`
3. `retrieval index includes Marble normalized document for mvp`
4. `mvp retrieve returns Marble result with open_educational_source license`
5. `Marble build output does not expose raw filesystem path`

**Implementation steps:**

1. Teach source snapshot inspection/ingest to support managed Marble source layout.
2. Route `source-artifacts:build -- marble --type normalized_documents` through the Marble adapter.
3. Publish artifact metadata with `collection_id=marble`, checksum, source snapshot id, license, and attribution.
4. Ensure retrieval index builder reads the published Marble normalized artifact.
5. Add smoke commands to developer handoff notes.

**Acceptance criteria:**

- Marble normalized artifact is persisted under `storage/knowledge/source-artifacts/marble/normalized_documents/...`.
- Collection detail shows the Marble artifact summary.
- mvp/prod retrieval can use Marble documents without K12.
- Source runtime/API path does not read Marble raw files directly.

**Verification:**

```bash
npm test
npm run lint
npm run source-collections:ingest -- marble
npm run source-artifacts:build -- marble --type normalized_documents
npm run retrieval-index:build -- --profile mvp
npm run source:sole-source:smoke
```

**Code-review checklist:**

- Build script is idempotent.
- Runtime retrieval reads artifact/index, not Marble raw source.
- Artifact metadata is sufficient for checksum/license/profile trace.

### Slice F4：Learning Commons normalized_documents adapter over fixture source

**Blocked by:** F1

**What it delivers:**  
Learning Commons can produce a deterministic `normalized_documents` artifact from a small fixture that represents the real Learning Commons graph/resource shape.

**Public interface:**

```text
module: buildNormalizedArtifact({ collection, snapshot, sourceRoot, artifactType: "normalized_documents" })
collection: learning_commons
```

Expected artifact envelope:

```json
{
  "artifact_id": "source-artifact:learning_commons:normalized_documents:sha256:<checksum>",
  "collection_id": "learning_commons",
  "artifact_type": "normalized_documents",
  "schema_version": "source_documents.v1",
  "source_snapshot_id": "source-snapshot:learning_commons:sha256:<checksum>",
  "license_scope": "open_educational_source",
  "attribution": "...",
  "records": [
    {
      "id": "learning_commons_area_model",
      "title": "Area model",
      "subject": "mathematics",
      "learning_stage": "elementary",
      "text": "...",
      "source_ref": {
        "collection_id": "learning_commons",
        "source": "learning_commons",
        "topic_id": "learning_commons_area_model"
      },
      "license_scope": "open_educational_source"
    }
  ],
  "summary": {
    "record_count": 1,
    "subjects": ["mathematics"]
  }
}
```

**TDD seam:** Learning Commons adapter fixture test.

**Red tests first:**

1. `Learning Commons adapter converts fixture graph into normalized_documents artifact`
2. `Learning Commons normalized artifact id is deterministic`
3. `Learning Commons records include source_ref and license_scope`
4. `Learning Commons adapter preserves attribution from collection manifest`
5. `Learning Commons adapter rejects invalid fixture shape with actionable error`

**Implementation steps:**

1. Add a minimal Learning Commons fixture under `test/fixtures/learning-commons/`.
2. Implement Learning Commons adapter parsing behind the adapter interface.
3. Normalize graph/resource nodes into document `records`.
4. Use the same normalized document envelope as Marble.
5. Run shared validation against adapter output.

**Acceptance criteria:**

- Learning Commons output passes `validateNormalizedArtifact`.
- No raw path appears in artifact records.
- Record ids, source refs, subjects, stages, and license fields are deterministic.

**Verification:**

```bash
node --experimental-default-type=module --test test/learning-commons-normalized-adapter.test.mjs
npm test
npm run lint
```

**Code-review checklist:**

- Learning Commons parsing is isolated.
- Normalized contract is shared with Marble.
- Errors are actionable and stable.

### Slice F5：Learning Commons snapshot/build/publish pipeline and retrieval integration

**Blocked by:** F4

**What it delivers:**  
`npm run source-artifacts:build -- learning_commons --type normalized_documents` publishes a validated Learning Commons artifact and retrieval index build can include it for mvp/prod.

**Public interface:**

```text
npm run source-collections:ingest -- learning_commons
npm run source-artifacts:build -- learning_commons --type normalized_documents
npm run retrieval-index:build -- --profile prod
POST /v1/retrieve { "profile": "prod", "query": "area model" }
```

**TDD seam:** build script seam with mocked persistence plus retrieval index fixture.

**Red tests first:**

1. `Learning Commons build script publishes validated normalized_documents metadata`
2. `Learning Commons artifact summary appears in source collection detail`
3. `retrieval index includes Learning Commons normalized document for prod`
4. `prod retrieve returns Learning Commons result with open_educational_source license`
5. `Learning Commons build output does not expose raw filesystem path`

**Implementation steps:**

1. Teach source snapshot inspection/ingest to support managed Learning Commons source layout.
2. Route `source-artifacts:build -- learning_commons --type normalized_documents` through the adapter.
3. Publish artifact metadata with collection id, checksum, snapshot id, license, and attribution.
4. Ensure retrieval index builder reads the published Learning Commons normalized artifact.
5. Validate prod retrieval remains free of K12 demo-only sources.

**Acceptance criteria:**

- Learning Commons normalized artifact is persisted under `storage/knowledge/source-artifacts/learning_commons/normalized_documents/...`.
- Collection detail shows the Learning Commons artifact summary.
- prod retrieval can use Learning Commons documents without K12.
- Runtime path does not read Learning Commons raw files directly.

**Verification:**

```bash
npm test
npm run lint
npm run source-collections:ingest -- learning_commons
npm run source-artifacts:build -- learning_commons --type normalized_documents
npm run retrieval-index:build -- --profile prod
npm run source:sole-source:smoke
```

**Code-review checklist:**

- Build script is idempotent.
- Retrieval index provenance includes Learning Commons source artifact id/checksum.
- Profile policy remains centralized.

### Slice F6：Readiness gate tightening after Marble / Learning Commons artifacts

**Blocked by:** F3, F5

**What it delivers:**  
The sole-source readiness gate no longer accepts empty mvp/prod retrieval as a normal warning once Marble and Learning Commons normalized artifacts exist. It proves mvp/prod have at least one approved non-K12 retrieval source.

**Public interface:**

```text
npm run source:sole-source:smoke
```

Expected compact JSON after F6:

```json
{
  "status": "ok",
  "checks": {
    "source_collections": "passed",
    "normalized_artifacts": "passed",
    "topic_candidates_export": "passed",
    "runtime_index_demo": "passed",
    "runtime_index_mvp": "passed",
    "runtime_index_prod": "passed",
    "retrieve_demo": "passed",
    "retrieve_mvp": "passed",
    "retrieve_prod": "passed",
    "profile_policy": "passed"
  },
  "warnings": []
}
```

**TDD seam:** `createSoleSourceReadinessSmoke`.

**Red tests first:**

1. `sole source smoke requires mvp retrieval result when approved normalized docs exist`
2. `sole source smoke requires prod retrieval result when approved normalized docs exist`
3. `sole source smoke accepts Marble result for mvp`
4. `sole source smoke accepts Learning Commons result for prod`
5. `sole source smoke still rejects K12 demo-only result for mvp/prod`

**Implementation steps:**

1. Teach readiness smoke to detect whether approved mvp/prod normalized documents exist.
2. Convert empty mvp/prod retrieval from warning to failed only when approved artifacts are present.
3. Keep warning behavior for environments where Marble / Learning Commons have not been ingested yet.
4. Update expected smoke output docs.

**Acceptance criteria:**

- Once approved Marble / Learning Commons artifacts exist, mvp/prod retrieval cannot stay empty.
- Demo-only K12 remains hard-failed for mvp/prod.
- Local incomplete data environments still get actionable warnings instead of confusing failures.

**Verification:**

```bash
npm test
npm run lint
npm run source:sole-source:smoke
```

**Code-review checklist:**

- The gate remains read-only.
- Gate logic distinguishes missing data from policy/security failures.
- Smoke JSON stays compact and machine-readable.

### Slice F7：Adapter consolidation and Source-B status closure

**Blocked by:** F2, F3, F4, F5, F6

**What it delivers:**  
Source-B can be marked complete for K12, Marble, and Learning Commons. The older B3 broad plan is closed by concrete adapter pipelines.

**Public interface:** no new API; documentation and review closure.

**TDD seam:** existing adapter, build, retrieval, and readiness tests.

**Red tests first:**

1. `all supported normalized artifact adapters are registered`
2. `source-artifacts build rejects unsupported collection/type without raw path leakage`
3. `readiness status inventory marks Marble and Learning Commons normalized pipeline complete`

**Implementation steps:**

1. Review adapter registry for duplication and deepen only if it removes real complexity.
2. Ensure K12, Marble, and Learning Commons share publisher/validation code.
3. Update this status inventory table.
4. Update handoff checklist to allow `knowledge-synthesis-service` migration without caveat.

**Acceptance criteria:**

- `source-artifacts:build` supports:
  - `k12_kgraph_full --type normalized_knowledge_graph`
  - `marble --type normalized_documents`
  - `learning_commons --type normalized_documents`
- `source:sole-source:smoke` passes without mvp/prod retrieval warnings when approved artifacts are present.
- The source service no longer has a known gap for Marble / Learning Commons normalized source ownership.

**Verification:**

```bash
npm test
npm run lint
npm run openapi:validate
npm run source-collections:ingest -- marble
npm run source-artifacts:build -- marble --type normalized_documents
npm run source-collections:ingest -- learning_commons
npm run source-artifacts:build -- learning_commons --type normalized_documents
npm run retrieval-index:build -- --profile mvp
npm run retrieval-index:build -- --profile prod
npm run source:sole-source:smoke
```

**Code-review checklist:**

- Spec/status table matches implementation.
- No public response leaks raw dataset paths.
- Artifact ids/checksums/licenses/profile traces are present end-to-end.
- Route handlers stay thin; parsing complexity remains inside adapters.

## 14. Batch Source-G：Knowledge Access Resolver and Tenant-Aware Knowledge Scope

### Source-G Goal

Replace request-facing `demo | mvp | prod` as the primary access selector with a server-side Knowledge Access Resolver.

After Source-G, request callers should not decide which source collections are allowed by passing `profile`. Instead, `knowledge-source-service` resolves the effective knowledge scope from:

```text
Authorization: Bearer <request key>
ENABLE_TENANT
ENABLE_K12
DEFAULT_KNOWLEDGE
tenant DB entitlements
collection license / safety policy
```

The resolver returns a small, stable policy contract:

```json
{
  "access_mode": "default_only | tenant_overlay | service_key",
  "tenant_enabled": true,
  "tenant_id": "tenant_123",
  "user_id": "user_456",
  "default_collection_ids": ["marble", "learning_commons"],
  "tenant_collection_ids": ["tenant:tenant_123:uploaded_textbook_abc"],
  "effective_collection_ids": ["marble", "learning_commons", "tenant:tenant_123:uploaded_textbook_abc"],
  "blocked_collection_ids": ["k12_kgraph_full"],
  "policy_decisions": [
    {
      "collection_id": "k12_kgraph_full",
      "allowed": false,
      "reason_code": "k12_disabled_by_env",
      "license_scope": "non_commercial_demo_only"
    }
  ],
  "trace": {
    "default_knowledge": "marble;learning_commons",
    "enable_tenant": true,
    "enable_k12": false,
    "fallback_used": false
  }
}
```

### Source-G Production Defaults

Use conservative production defaults:

```env
ENABLE_TENANT=false
ENABLE_K12=false
DEFAULT_KNOWLEDGE=marble;learning_commons
```

Rules:

1. `DEFAULT_KNOWLEDGE` uses collection ids, not display names.
   - Prefer: `marble;learning_commons`
   - Avoid: `Marble;Learning Commons`
2. If `ENABLE_K12=true`, the resolver may add `k12_kgraph_full` to the default set.
3. `ENABLE_K12=false` hard-blocks K12 even if a tenant entitlement row accidentally grants it.
4. `ENABLE_TENANT=false` means no tenant DB lookup and no tenant-uploaded sources in public results.
5. `ENABLE_TENANT=true` means request key is resolved through DB.
6. If tenant lookup has no entitlement rows, fall back to `DEFAULT_KNOWLEDGE`.
7. Request body/query may ask for filters, but cannot grant itself extra collections.
8. All public responses must include access trace, artifact ids, checksums, and license scope.
9. Keep current `profile` APIs compatible during Source-G. Deprecate after consumers migrate.

### Source-G Scope

In scope:

- Add `KnowledgeAccessResolver` deep module.
- Add env parsing for `ENABLE_TENANT`, `ENABLE_K12`, `DEFAULT_KNOWLEDGE`.
- Add DB tables for tenant API keys and collection entitlements.
- Resolve request Bearer key to service/default access or tenant access.
- Integrate resolver into retrieval, runtime index latest, topic candidate export, artifact reads, and collection listing.
- Add access trace to responses.
- Preserve existing service-key auth behavior while introducing tenant keys.
- Keep raw dataset paths hidden.

Out of scope:

- Actual file upload UI.
- Uploaded教材 ingestion UI.
- Vector/hybrid search.
- Billing/quota enforcement beyond schema placeholders.
- Removing profile parameters completely in the first batch.
- Multi-region key management or external auth provider integration.

### Source-G Dependency Map

```text
G1 env config
  -> G2 DB schema
  -> G3 key resolution
  -> G4 KnowledgeAccessResolver pure module
  -> G5 retrieval integration
  -> G6 runtime/topic/artifact/collection API integration
  -> G7 tenant-owned collection skeleton
  -> G8 compatibility, smoke, docs, review
```

### DB Tables / Migrations Needed

Add migrations under:

```text
scripts/db/migrations/<timestamp>_knowledge_access_resolver.sql
```

If the project migration convention is different, follow the local `scripts/db/migrate.mjs` pattern.

#### Table: `knowledge_source_tenants`

Purpose: stable tenant account root.

```sql
CREATE TABLE knowledge_source_tenants (
  tenant_id text PRIMARY KEY,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

Status values:

```text
active
suspended
deleted
```

#### Table: `knowledge_source_users`

Purpose: optional user identity under tenant. This can stay minimal until real app auth exists.

```sql
CREATE TABLE knowledge_source_users (
  user_id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES knowledge_source_tenants(tenant_id),
  external_subject text,
  display_name text,
  status text NOT NULL DEFAULT 'active',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

#### Table: `knowledge_source_api_keys`

Purpose: map incoming Bearer key to tenant/user without storing plaintext key.

```sql
CREATE TABLE knowledge_source_api_keys (
  key_id text PRIMARY KEY,
  key_hash_sha256 text NOT NULL UNIQUE,
  key_prefix text,
  tenant_id text REFERENCES knowledge_source_tenants(tenant_id),
  user_id text REFERENCES knowledge_source_users(user_id),
  key_type text NOT NULL DEFAULT 'tenant',
  status text NOT NULL DEFAULT 'active',
  scopes text[] NOT NULL DEFAULT ARRAY[]::text[],
  expires_at timestamptz,
  last_used_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

Key type values:

```text
service
tenant
user
```

Important:

- Store `sha256(plaintext_key)` only.
- Never store or log the plaintext key.
- Use constant-time comparison only where plaintext comparison is unavoidable.
- `key_prefix` may store a short non-secret prefix for debugging, e.g. first 6 chars.

#### Table: `knowledge_source_collection_entitlements`

Purpose: tenant/user access to default or uploaded collections.

```sql
CREATE TABLE knowledge_source_collection_entitlements (
  entitlement_id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES knowledge_source_tenants(tenant_id),
  user_id text REFERENCES knowledge_source_users(user_id),
  collection_id text NOT NULL,
  access_level text NOT NULL DEFAULT 'read',
  enabled boolean NOT NULL DEFAULT true,
  source_type text NOT NULL DEFAULT 'shared',
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, collection_id)
);
```

Source type values:

```text
shared
tenant_uploaded
system_default
```

#### Table: `knowledge_source_tenant_collections`

Purpose: future user-uploaded教材 collection registration. Source-G can add table and tests without implementing upload.

```sql
CREATE TABLE knowledge_source_tenant_collections (
  collection_id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES knowledge_source_tenants(tenant_id),
  owner_user_id text REFERENCES knowledge_source_users(user_id),
  display_name text NOT NULL,
  collection_type text NOT NULL DEFAULT 'tenant_documents',
  source_family text NOT NULL DEFAULT 'tenant_upload',
  license_scope text NOT NULL DEFAULT 'tenant_private',
  visibility text NOT NULL DEFAULT 'tenant_only',
  ingest_status text NOT NULL DEFAULT 'planned',
  snapshot_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

Visibility values:

```text
tenant_only
user_only
shared_with_tenant
```

#### Table: `knowledge_source_access_audit_events`

Purpose: optional audit for access decisions. Keep payload compact.

```sql
CREATE TABLE knowledge_source_access_audit_events (
  event_id bigserial PRIMARY KEY,
  event_type text NOT NULL,
  tenant_id text,
  user_id text,
  key_id text,
  request_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

Recommended event types:

```text
knowledge_access.resolved
knowledge_access.denied
tenant_key.used
tenant_key.rejected
```

### Files Expected To Change

Configuration:

```text
src/lib/config.js
.env.example or project env docs if present
```

Auth and key resolution:

```text
src/lib/http/service-key-auth.js
src/lib/http/request-key.js                 (new)
src/lib/knowledge-access/key-hashing.js     (new)
src/lib/knowledge-access/key-store.js       (new)
```

Knowledge Access Resolver:

```text
src/lib/knowledge-access/knowledge-access-resolver.js  (new)
src/lib/knowledge-access/default-knowledge.js          (new)
src/lib/knowledge-access/access-policy.js              (new)
src/lib/knowledge-access/access-trace.js               (new)
```

Existing policy modules:

```text
src/lib/runtime-profile/runtime-profile-policy.js
src/lib/retrieval/retrieval.js
src/lib/runtime-index/profile-runtime-index.js
src/lib/topic-candidates/topic-candidate-export.js
src/lib/sources/sources.js
src/lib/source-collections/source-collections.js
```

API routes:

```text
src/app/v1/retrieve/route.js
src/app/v1/runtime-index/latest/route.js
src/app/v1/topic-candidates/export/route.js
src/app/v1/source-collections/route.js
src/app/v1/source-collections/[collectionId]/route.js
src/app/v1/artifacts/route.js
src/app/v1/artifacts/[artifactId]/route.js
src/app/v1/artifacts/[artifactId]/raw/route.js
```

Scripts / smoke:

```text
scripts/readiness/source-sole-source-smoke.mjs
scripts/db/migrate.mjs                      (only if migration discovery needs adjustment)
scripts/db/migrations/*.sql                 (new migration)
```

OpenAPI:

```text
openapi/knowledge-source-service.openapi.yaml
test/openapi-spec.test.mjs
```

Tests:

```text
test/knowledge-access-defaults.test.mjs                         (new)
test/knowledge-access-key-store.test.mjs                        (new)
test/knowledge-access-resolver.test.mjs                         (new)
test/knowledge-access-retrieval-integration.test.mjs            (new)
test/knowledge-access-runtime-index-integration.test.mjs        (new)
test/knowledge-access-topic-candidates-integration.test.mjs     (new)
test/knowledge-access-artifact-policy.test.mjs                  (new)
test/sole-source-readiness-smoke.test.mjs
test/retrieval.test.mjs
test/runtime-profile-policy.test.mjs
```

### Compatibility Strategy

Source-G should avoid a breaking API switch.

Phase 1 compatibility:

- Keep `profile` query/body accepted.
- Add resolver output to trace.
- If `ENABLE_TENANT=false`, resolver uses `DEFAULT_KNOWLEDGE` and optional K12.
- Existing `demo|mvp|prod` behavior can still be exercised by tests.

Phase 2 compatibility:

- Make `profile` optional for `/v1/retrieve`.
- Prefer resolver effective collections over profile.
- Add deprecation trace:

```json
{
  "profile_deprecated": true,
  "access_resolver_used": true
}
```

Phase 3 future:

- Remove request-facing profile from internal consumers after `knowledge-synthesis-service` and `ai-workflow-service` migrate.
- Keep compatibility endpoint only if needed for old clients.

### Slice G1：Env-Driven Default Knowledge Config

**What it delivers:**  
Parse and validate `ENABLE_TENANT`, `ENABLE_K12`, and `DEFAULT_KNOWLEDGE` without touching DB or routes yet.

**Public interface:**

```text
getKnowledgeAccessConfig()
parseDefaultKnowledge("marble;learning_commons")
resolveDefaultCollectionIds({ enableK12, defaultKnowledge })
```

**Red tests first:**

1. `DEFAULT_KNOWLEDGE parses semicolon separated collection ids`
2. `DEFAULT_KNOWLEDGE rejects display names that are not collection ids`
3. `ENABLE_K12=false does not include k12_kgraph_full`
4. `ENABLE_K12=true appends k12_kgraph_full once`
5. `empty DEFAULT_KNOWLEDGE falls back to marble and learning_commons`

**Implementation steps:**

1. Extend `src/lib/config.js` with typed boolean parsing.
2. Add `src/lib/knowledge-access/default-knowledge.js`.
3. Normalize accepted aliases only if necessary:
   - `Marble` -> reject or explicitly map to `marble`
   - `Learning Commons` -> reject or explicitly map to `learning_commons`
   - Production preference: reject display names and document collection ids.
4. Add tests with injected env/config values.

**Acceptance criteria:**

- Defaults are deterministic.
- K12 is disabled unless explicitly enabled.
- Config parsing is independent from HTTP and DB.

**Verification:**

```bash
node --experimental-default-type=module --test test/knowledge-access-defaults.test.mjs
npm test
npm run lint
```

**Code-review checklist:**

- No env parsing scattered across routes.
- No plaintext key appears in config output.
- K12 default behavior is conservative.

### Slice G2：Tenant Access DB Schema and Key Hash Store

**Blocked by:** G1

**What it delivers:**  
Add DB tables and a small key-store module that can look up a Bearer key by hash.

**Public interface:**

```text
hashAccessKey(plaintextKey)
findAccessKeyIdentity({ bearerToken })
```

**Red tests first:**

1. `hashAccessKey returns deterministic sha256 without exposing plaintext`
2. `key store looks up active key by sha256 hash`
3. `key store rejects suspended key`
4. `key store rejects expired key`
5. `key store returns null when key is unknown`

**Implementation steps:**

1. Add SQL migration for the tables listed above.
2. Add `src/lib/knowledge-access/key-hashing.js`.
3. Add `src/lib/knowledge-access/key-store.js`.
4. Add tests using mocked `withClient`.
5. Do not wire into routes yet.

**Acceptance criteria:**

- DB schema supports service, tenant, and user keys.
- No plaintext key is persisted or returned.
- Suspended/expired keys cannot resolve tenant access.

**Verification:**

```bash
npm run db:migrate
node --experimental-default-type=module --test test/knowledge-access-key-store.test.mjs
npm test
npm run lint
```

**Code-review checklist:**

- Migration is additive and safe.
- Tables have clear ids and timestamps.
- Key hash lookup has no accidental logging.

### Slice G3：KnowledgeAccessResolver Pure Module

**Blocked by:** G1, G2

**What it delivers:**  
Create the deep module that returns effective collection ids and policy decisions.

**Public interface:**

```text
resolveKnowledgeAccess({
  requestKey,
  serviceKeyIdentity?,
  config?,
  collections?,
  tenantEntitlements?,
  keyIdentity?
})
```

**Red tests first:**

1. `ENABLE_TENANT=false returns default collections only`
2. `ENABLE_TENANT=false ignores tenant key lookup`
3. `ENABLE_TENANT=true overlays tenant entitlements on defaults`
4. `tenant with no entitlements falls back to DEFAULT_KNOWLEDGE`
5. `ENABLE_K12=false blocks K12 even when entitlement grants K12`
6. `ENABLE_K12=true allows K12 and marks non_commercial_demo_only in trace`
7. `unknown requested collection never becomes allowed`
8. `resolver output is deterministic and sorted`

**Implementation steps:**

1. Add `src/lib/knowledge-access/knowledge-access-resolver.js`.
2. Add `src/lib/knowledge-access/access-policy.js`.
3. Reuse collection registry as the source of valid collection ids and license scopes.
4. Keep policy reasoning in one module:
   - `default_allowed`
   - `tenant_entitled`
   - `fallback_default_used`
   - `k12_disabled_by_env`
   - `collection_unknown`
   - `tenant_disabled`
5. Return one trace shape for all APIs.

**Acceptance criteria:**

- The resolver is pure-testable without HTTP routes.
- Routes do not manually inspect env variables.
- License and collection provenance remain present in decisions.

**Verification:**

```bash
node --experimental-default-type=module --test test/knowledge-access-resolver.test.mjs
npm test
npm run lint
```

**Code-review checklist:**

- Interface is small.
- DB shape is hidden behind injected lookups.
- Policy complexity does not leak into route handlers.

### Slice G4：Request Key Extraction and Auth Compatibility

**Blocked by:** G2, G3

**What it delivers:**  
Separate "is caller authenticated" from "what knowledge can caller access".

**Public interface:**

```text
extractBearerToken(request)
requireServiceOrTenantKeyAuth(request)
resolveRequestKnowledgeAccess(request)
```

**Red tests first:**

1. `existing KNOWLEDGE_SOURCE_KEY still authorizes protected endpoints`
2. `tenant key can resolve identity when ENABLE_TENANT=true`
3. `tenant key is rejected when disabled or suspended`
4. `missing key still returns 401 when service key or tenant mode requires auth`
5. `auth response never exposes expected key`

**Implementation steps:**

1. Extract Bearer parsing from `service-key-auth.js` into `src/lib/http/request-key.js`.
2. Keep `requireServiceKeyAuth` behavior for existing service key tests.
3. Add a new wrapper for route use:
   - service key identity if plaintext matches `KNOWLEDGE_SOURCE_KEY`
   - tenant/user identity if DB key hash matches and tenant mode is enabled
4. Keep route updates minimal.

**Acceptance criteria:**

- Existing service key tests still pass.
- Tenant key path can be tested without real DB.
- Missing/wrong key errors stay unified.

**Verification:**

```bash
node --experimental-default-type=module --test test/service-key-auth.test.mjs test/knowledge-access-key-store.test.mjs
npm test
npm run lint
```

**Code-review checklist:**

- No secret in logs or errors.
- Constant-time service key comparison remains.
- Tenant key hash lookup does not downgrade service key auth.

### Slice G5：Retrieval Uses Effective Knowledge Scope

**Blocked by:** G3, G4

**What it delivers:**  
`POST /v1/retrieve` can work without `profile` as the primary selector. It uses Knowledge Access Resolver effective collection ids.

**Public interface:**

```http
POST /v1/retrieve
Authorization: Bearer <key>
Content-Type: application/json

{
  "query": "area",
  "limit": 3
}
```

Expected trace:

```json
{
  "trace": {
    "access": {
      "effective_collection_ids": ["marble", "learning_commons"],
      "blocked_collection_ids": ["k12_kgraph_full"],
      "access_mode": "default_only"
    },
    "retrieval_mode": "retrieval_index"
  }
}
```

**Red tests first:**

1. `retrieve without profile uses DEFAULT_KNOWLEDGE when tenant disabled`
2. `retrieve without profile excludes K12 when ENABLE_K12=false`
3. `retrieve includes K12 only when ENABLE_K12=true`
4. `tenant entitlement adds tenant collection to retrieval scope`
5. `tenant with no entitlement falls back to DEFAULT_KNOWLEDGE`
6. `request cannot override effective collections`
7. `retrieval trace includes access resolver decisions`

**Implementation steps:**

1. Inject `resolveKnowledgeAccess` into `createKnowledgeRetriever`.
2. Replace profile-only filtering with `effective_collection_ids`.
3. Keep old profile tests by mapping profile to compatibility mode or by preserving current branch when profile is supplied.
4. Ensure retrieval index lookup can use access scope:
   - Option A: build per-access-scope ephemeral normalized scan when no exact index exists.
   - Option B: use broad allowed indexes and hard-filter by effective collection ids.
   - Production recommendation for Source-G: B, because it avoids generating unbounded per-tenant indexes in the first slice.
5. Add access trace to response.

**Acceptance criteria:**

- Retrieval no longer needs caller-provided profile for default use.
- K12 cannot appear unless env explicitly allows it.
- Tenant entitlement can add collections without modifying route body.

**Verification:**

```bash
node --experimental-default-type=module --test test/knowledge-access-retrieval-integration.test.mjs test/retrieval.test.mjs
npm test
npm run lint
```

**Code-review checklist:**

- Retrieval still returns artifact id and checksum.
- Scope filtering happens after loading an index too, protecting against stale broad indexes.
- Lexical MVP remains unchanged.

### Slice G6：Runtime Index Latest With Access Resolver

**Blocked by:** G5

**What it delivers:**  
`GET /v1/runtime-index/latest` can return an access-filtered runtime contract derived from the request key.

**Public interface:**

```http
GET /v1/runtime-index/latest
Authorization: Bearer <key>
```

Compatibility still allowed:

```http
GET /v1/runtime-index/latest?profile=demo
```

**Red tests first:**

1. `latest runtime index without profile uses access resolver`
2. `latest runtime index excludes K12 when ENABLE_K12=false`
3. `latest runtime index includes K12 when ENABLE_K12=true and artifact exists`
4. `latest runtime index includes access trace headers/body`
5. `profile query remains backward compatible`

**Implementation steps:**

1. Add resolver injection to `getLatestRuntimeIndex` or a new wrapper.
2. For first implementation, use existing published profile index as source material, then hard-filter by effective collection ids.
3. Add headers:
   - `X-Knowledge-Access-Mode`
   - `X-Knowledge-Effective-Collections`
4. Keep existing cache keys profile-compatible.
5. If caching access-resolved runtime indexes, include a stable access-scope checksum in the cache key.

**Acceptance criteria:**

- Request key controls runtime index source visibility.
- Existing consumers using profile are not broken.
- Cache cannot leak one tenant's runtime index to another tenant.

**Verification:**

```bash
node --experimental-default-type=module --test test/knowledge-access-runtime-index-integration.test.mjs
npm test
npm run lint
npm run openapi:validate
```

**Code-review checklist:**

- Cache key includes tenant/access scope when tenant mode is enabled.
- Runtime index body and headers agree.
- K12 env gate is enforced even for stale profile aliases.

### Slice G7：Topic Candidates, Artifact Reads, and Collection Listing Policy

**Blocked by:** G3, G4

**What it delivers:**  
All public read APIs apply the same effective knowledge scope.

**Public interfaces:**

```http
GET /v1/source-collections
GET /v1/source-collections/{collectionId}
GET /v1/topic-candidates/export?collection_id=k12_kgraph_full
GET /v1/artifacts?source=marble
GET /v1/artifacts/{artifactId}
GET /v1/artifacts/{artifactId}/raw
```

**Red tests first:**

1. `source collections list hides K12 when ENABLE_K12=false`
2. `source collection detail returns 404 or access_denied for blocked collection`
3. `topic candidates export rejects collection outside effective scope`
4. `artifact list hides artifacts outside effective scope`
5. `artifact payload read rejects artifact outside effective scope`
6. `artifact raw read rejects artifact outside effective scope`
7. `download_url never points to unauthorized artifact`

**Implementation steps:**

1. Add helper:

```text
assertArtifactAllowedByAccess({ artifact, access })
assertCollectionAllowedByAccess({ collectionId, access })
```

2. Update collection routes to filter list/detail.
3. Update topic candidate export to check access before finding candidate artifact.
4. Update artifact list/detail/raw to inspect artifact metadata collection id/profile/source before returning.
5. Add access trace to responses where useful.

**Acceptance criteria:**

- A blocked collection cannot be discovered through artifact APIs.
- `download_url` from topic candidates cannot bypass resolver.
- Filtering logic is shared, not duplicated per route.

**Verification:**

```bash
node --experimental-default-type=module --test test/knowledge-access-topic-candidates-integration.test.mjs test/knowledge-access-artifact-policy.test.mjs
npm test
npm run lint
npm run openapi:validate
```

**Code-review checklist:**

- No route has ad hoc `if collection_id === ...` policy.
- Artifact metadata contains enough collection information to enforce policy.
- Raw artifact endpoint is not a bypass.

### Slice G8：Tenant-Owned Collection Skeleton for Future Uploads

**Blocked by:** G2, G3, G7

**What it delivers:**  
Prepare the Source service data model for future user-uploaded教材 without implementing file upload yet.

**Public interface:** no public upload API in this slice.

Internal contract:

```text
collection_id: tenant:<tenant_id>:<source_id>
license_scope: tenant_private
visibility: tenant_only | user_only | shared_with_tenant
publish_profiles: replaced by access entitlements
```

**Red tests first:**

1. `tenant collection id is namespaced and deterministic`
2. `tenant private collection is visible only to entitled tenant`
3. `other tenant cannot retrieve tenant private collection`
4. `tenant uploaded collection can be included in effective collection ids`
5. `tenant collection preserves artifact id/checksum/license trace`

**Implementation steps:**

1. Add tenant collection normalizer helper.
2. Extend collection registry to merge:
   - default source collections
   - registry DB rows
   - tenant-owned collection rows visible to the current access context
3. Do not build upload/ingest API yet.
4. Add fixture tenant collection artifact for retrieval tests.

**Acceptance criteria:**

- Future upload work has a stable collection id model.
- Tenant data cannot appear in other tenants' access scope.
- Shared source collections still behave normally.

**Verification:**

```bash
node --experimental-default-type=module --test test/knowledge-access-resolver.test.mjs test/knowledge-access-retrieval-integration.test.mjs
npm test
npm run lint
```

**Code-review checklist:**

- Tenant collection id format is not ambiguous with shared collection ids.
- Tenant private license scope is explicit.
- No upload implementation sneaks into this slice.

### Slice G9：OpenAPI, Readiness Smoke, and Migration Documentation

**Blocked by:** G5, G6, G7

**What it delivers:**  
Document the new key-derived access model and add a smoke gate proving default-only and tenant-overlay behavior.

**Public interface:**

```text
npm run source:sole-source:smoke
GET /openapi.json
```

**Red tests first:**

1. `OpenAPI documents key-derived access trace`
2. `OpenAPI marks profile as compatibility/deprecated where applicable`
3. `readiness smoke passes with ENABLE_TENANT=false and DEFAULT_KNOWLEDGE`
4. `readiness smoke proves K12 excluded when ENABLE_K12=false`
5. `readiness smoke proves tenant fallback uses DEFAULT_KNOWLEDGE`
6. `readiness smoke proves tenant entitlement overlay when fixtures are present`

**Implementation steps:**

1. Update OpenAPI schemas:
   - `KnowledgeAccessTrace`
   - `PolicyDecision`
   - retrieval request with optional `profile`
   - runtime index latest response access trace
2. Update smoke script to run:
   - default-only mode
   - K12-disabled gate
   - tenant fallback fixture
   - tenant overlay fixture if DB fixtures exist
3. Add migration notes in this planning file.
4. Add deprecation note for direct profile selection.

**Acceptance criteria:**

- New behavior is documented in the API contract.
- Smoke proves K12 does not leak when disabled.
- Smoke proves tenant mode does not remove default fallback.

**Verification:**

```bash
npm test
npm run lint
npm run openapi:validate
npm run source:sole-source:smoke
```

**Code-review checklist:**

- OpenAPI examples do not include real secrets.
- Access trace fields are stable and not overfit to tests.
- Smoke remains compact and machine-readable.

### Source-G Final Acceptance Criteria

Source-G is complete when:

1. `ENABLE_TENANT=false`, `ENABLE_K12=false`, `DEFAULT_KNOWLEDGE=marble;learning_commons` exposes only Marble and Learning Commons through all public read APIs.
2. `ENABLE_K12=true` allows K12 only through the resolver and trace clearly marks `non_commercial_demo_only`.
3. `ENABLE_TENANT=true` resolves Bearer key through DB hash lookup.
4. Tenant entitlements overlay default knowledge.
5. Tenant with no entitlement falls back to default knowledge.
6. Request body/query cannot grant additional collections.
7. Artifact detail/raw endpoints cannot bypass access policy.
8. Existing service key auth still works.
9. Existing profile-based calls remain compatible during migration.
10. All responses that expose source data include artifact id/checksum/license/access trace.

### Source-G Verification Bundle

Run after each completed slice:

```bash
npm test
npm run lint
```

Run after API contract changes:

```bash
npm run openapi:validate
```

Run after DB changes:

```bash
npm run db:migrate
```

Run after G5/G6/G7/G9:

```bash
npm run source:sole-source:smoke
```

If a production build/typecheck script is available:

```bash
npm run build
```

If `npm run build` is blocked by local `.next` dev-server state, report it explicitly and do not claim build passed.

### Source-G Code-Review Checklist

- The resolver is a deep module with a small interface.
- Env parsing is centralized.
- Key hashing never stores or logs plaintext keys.
- K12 is disabled by default.
- Tenant entitlements only add access through DB-backed policy decisions.
- Default fallback is visible in trace.
- Artifact APIs cannot leak blocked collections.
- Cache keys include access scope when access-filtered payloads are cached.
- Tests cover default-only, K12-enabled, tenant fallback, tenant overlay, and blocked collection behavior.
- OpenAPI examples never contain real keys.
- No raw dataset path appears in public responses.
