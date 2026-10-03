# knowledge-source-service Node 24、Docker 與 Docker Compose 階段性升級規劃

更新日期：2026-08-14

## 0. 文件目的

本文件規劃 `knowledge-source-service` 從 Node.js 18 執行基線升級到 Node.js 24 LTS，並將 Next.js API、PostgreSQL metadata、Redis optional read cache、artifact filesystem與批次建置腳本納入可重現的 Docker / Docker Compose 執行方式。

本次升級的完成標準不是「container可以啟動」，而是：

- Source API可在Node 24 production image穩定運作。
- migration、artifact storage、runtime index、retrieval與access resolver都可在container環境重現。
- secret不進image，tenant/access隔離不因cache或volume設計而失效。
- Synthesis與AI Workflow可以透過container network消費已驗證的Source contract。
- image具備health/readiness、非root、固定版本、SBOM、scan與rollback能力。

## 1. 當前基線與邊界

### 1.1 技術基線

- Next.js 15.5.x、React 19、JavaScript-only。
- package engine目前為 `node >=18.19.1`。
- npm lockfile v3。
- PostgreSQL透過`pg`存放source、version、artifact、tenant、key與entitlement metadata。
- artifact payload寫入本機filesystem，預設`storage/knowledge`。
- Redis為optional read-response cache。
- service預設port為`3200`。
- 現有測試基線：201/201通過、ESLint通過、OpenAPI structural validation通過。

### 1.2 Domain責任

```text
source collection
  -> raw snapshot ingestion
  -> normalized artifact
  -> topic candidates / retrieval documents
  -> content-addressed runtime/retrieval index
  -> access-aware API
```

Docker化不能破壞下列安全性質：

- raw dataset只在ingestion/build階段被讀取。
- API輸出不能暴露private raw path。
- request collection filter只能縮小access scope。
- `ENABLE_K12=false`必須hard block K12，即使entitlement存在。
- immutable artifact ID、checksum與payload必須一致。
- Redis cache key必須包含knowledge access scope。
- service key與tenant key不可出現在log、image layer或response。

### 1.3 升級前已知缺口

以下問題應先列為baseline，並在跨服務驗收中明確處理：

1. `/v1/runtime-index/latest`實際response沒有Synthesis client所要求的`license_scope`位置，兩服務目前只有mock-based contract tests。
2. `/v1/sources`與`/v1/sources/:source/versions`未套auth，且沒有列入OpenAPI；versions可能回傳`raw_root`與`snapshot_path`。
3. artifact storage containment使用`startsWith(root)`，需要更嚴格的path boundary。
4. `buildNormalizedArtifact()`有重複且不可達的collection/type判斷。
5. 狀態文件中的部分資料表名稱與migration不一致。

Node 24升級不得隱藏上述問題；其中第1項必須成為Compose跨服務上線前的阻斷gate。

## 2. 目標部署拓撲

### 2.1 Production image

```text
reverse proxy / internal gateway
             |
             v
knowledge-source-service:3200
       |               |
       v               v
 PostgreSQL        Redis(optional)
       |
       v
 named volume / object-storage adapter
 for normalized and published artifacts
```

### 2.2 Compose本機整合

```text
source-db
  -> source-migrate (one-shot)
  -> knowledge-source-service

source-redis (optional profile)
  -> knowledge-source-service

source-artifact-volume
  -> service + explicit ingestion/build jobs
```

raw dataset volume只允許mount到一次性ingestion/build job；正式API container不應mount raw dataset。

## 3. 版本與映像政策

- Node.js使用`24.x` LTS，`package.json`限制`>=核准patch <25`。
- production Dockerfile固定完整tag及OCI digest，例如：

  ```text
  node:24.18.1-bookworm-slim@sha256:<approved-digest>
  ```

- 不使用`node:latest`或浮動`node:lts`部署。
- 本階段使用Debian slim，不同時切換Alpine/musl。
- PostgreSQL與Redis major版本不和Node升級綁在同一次變更；Compose須固定既有核准major/minor或digest。
- 每次Node 24 patch/digest更新都重新執行完整test、build、integration、SBOM與scan。

## 4. Phase KS-N24-0：建立升級前證據

### 工作項目

1. 記錄Node、npm、Next.js、PostgreSQL、Redis與OS版本。
2. 在乾淨checkout執行：

   ```bash
   npm ci
   npm test
   npm run lint
   npm run openapi:validate
   npm run build:isolated
   ```

3. 使用fixture或測試資料完成下列pipeline：
   - source collection seed。
   - snapshot ingest。
   - normalized artifact build。
   - topic candidate build/export。
   - runtime index publish/latest/diff。
   - retrieval index build與retrieve。
   - sole-source readiness smoke。
4. 保存201個test結果、OpenAPI path清單與artifact checksum範例。
5. 記錄預設access matrix：tenant off/on、K12 off/on、default knowledge、tenant overlay。

### 驗收標準

- baseline的test、lint、OpenAPI、isolated build全部成功。
- pipeline產出的content-addressed artifact可重跑得到相同checksum。
- access matrix有可回放fixture與預期結果。
- 沒有使用developer machine的absolute raw path作為驗收依據。

## 5. Phase KS-N24-1：Node 24 metadata與dependency安裝

### 工作項目

1. 更新`package.json.engines.node`至核准Node 24範圍。
2. 新增`.nvmrc`或`.node-version`，並視政策加入`packageManager`。
3. 使用Node 24的npm執行`npm ci`；若lockfile需要變更，獨立review dependency tree。
4. 執行`npm ls --all`。
5. 檢查Node 24下：
   - Next.js build與server runtime。
   - `pg`連線、transaction、array/jsonb serialization。
   - Redis dynamic import、connect timeout與error fallback。
   - `AbortSignal.timeout`、Web Fetch API、`Response`與`Headers`。
   - `crypto.timingSafeEqual`與SHA-256結果。
   - ESM `.mjs` scripts。
6. 不在同一phase升級Next major、PostgreSQL major或Redis major。

### 驗收標準

- Node 24下`npm ci`、201 tests、lint、OpenAPI、build全部通過。
- `npm ls --all`無invalid/extraneous dependency。
- Node 18與Node 24產生的stable checksum fixture一致。
- service key constant-time比較與tenant key hash結果一致。

## 6. Phase KS-CTR-0：修正與固定跨服務contract

此phase必須在完整Compose整合之前完成。

### 工作項目

1. 統一`/v1/runtime-index/latest`的provenance schema：
   - artifact ID。
   - immutable version artifact ID。
   - checksum SHA-256。
   - license scope或明確的per-source license collection。
   - access trace。
2. Source implementation、OpenAPI與Synthesis client必須讀同一schema，禁止各自猜測fallback path。
3. 決定是否保留`artifact.storage_path`在公開response；若不需要，從API DTO移除。
4. 將`/v1/sources`與versions endpoint納入auth與OpenAPI，或明確標為internal-only並停止輸出raw paths。
5. 新增跨package contract fixture，不只測mock object。
6. 建立真實HTTP integration test，由Synthesis client呼叫Source container。

### 驗收標準

- Synthesis `KnowledgeSourceClient.getLatestRuntimeIndex()`可讀取真實Source response。
- 缺少provenance時兩端都fail closed，且不洩漏key。
- OpenAPI validate通過且涵蓋所有保留的v1 routes。
- unauthenticated request不能取得source version/private path資訊。
- contract fixture同時被Source producer與Synthesis consumer測試使用。

## 7. Phase KS-DKR-0：Production multi-stage Dockerfile

### 建議產物

```text
core/knowledge-source-service/Dockerfile.node24
core/knowledge-source-service/.dockerignore
```

### Next.js設定

在`next.config.mjs`加入production `output: "standalone"`；若只在container build啟用，必須確保local build與container build都有測試。保留`NEXT_DIST_DIR`能力時，要避免copy stage硬編碼錯誤路徑。

### 建議stage

```text
base
  Node 24 Debian slim、固定digest

deps
  COPY package.json/package-lock.json
  npm ci

builder
  COPY source/openapi/scripts/db
  next build

runner
  僅copy standalone、static、必要openapi與runtime assets
  non-root user
  port 3200
```

### Runtime要求

- `NODE_ENV=production`。
- `NEXT_TELEMETRY_DISABLED=1`。
- `HOSTNAME=0.0.0.0`、`PORT=3200`。
- 使用`node`或專用numeric UID/GID非root執行。
- artifact volume mount目錄必須可由該UID寫入。
- image內不包含`.env.local`、raw datasets、test fixtures、host `node_modules`。
- migration scripts若不在runner image，建立獨立migration target/image；不可要求API startup自動migration。
- 使用`init: true`或等效init處理signal與zombie process。

### 驗收標準

- `docker build --no-cache`成功。
- runner執行`node --version`為核准24.x。
- image以非root啟動，SIGTERM可在grace period內結束。
- `/healthz`回200；依賴正常時`/readyz`回200，DB或storage不可用時回503。
- image scan沒有超過團隊門檻的未豁免漏洞。
- image layer與`docker save`內容不含`.env.local`、password、API key或raw dataset。

## 8. Phase KS-DKR-1：Migration與批次job images

### 工作項目

將長時間或一次性操作與API process分離：

- `source-migrate`：`npm run db:migrate`。
- `source-seed`：source collection seed。
- `source-ingest`：mount raw dataset read-only，輸出managed snapshot。
- `source-artifact-build`。
- `topic-candidate-build`。
- `runtime-index-publish`。
- `retrieval-index-build`。
- `source-readiness-smoke`。

可以共用同一image、覆寫command；正式環境由release job執行，不在每個API replica startup時重跑。

### 驗收標準

- migration可重跑且migration順序deterministic。
- migration失敗時API不啟動為ready。
- ingestion job的raw mount為read-only，API service沒有raw mount。
- build job只在validation成功後發布artifact metadata。
- job失敗保留可追蹤exit code與audit evidence，不留下published alias指向不完整artifact。

## 9. Phase KS-CMP-0：本機Docker Compose

### 建議產物

```text
core/knowledge-source-service/docker-compose.node24.yml
core/knowledge-source-service/.env.compose.example
```

`.env.compose.example`只能放變數名稱與安全placeholder，不可複製`.env.local`值。

### 建議services

```text
source-db
source-redis              profile: cache
source-migrate            one-shot
knowledge-source-service
source-readiness          profile: tools
source-ingest/build jobs  profile: ingestion
```

### Compose設計要求

- DB使用named volume，禁止放入repository。
- artifact storage使用獨立named volume或明確host development path。
- private network供DB/Redis，只有Source API映射host port `3200`。
- API依賴DB healthy及migration successful，不只依賴container started。
- Redis是optional；未啟用時service必須cache bypass且功能正常。
- secrets透過Compose secrets、CI secret store或未提交env file注入。
- healthcheck使用Node內建`fetch`，避免為curl額外擴大image。
- 所有services設定合理`stop_grace_period`與log rotation。
- container間DB host使用service name，不使用`localhost`或`host.docker.internal`。

### 驗收標準

- `docker compose config`成功且輸出不含真實secret。
- 全新volumes執行`up --build`後，DB healthy、migration成功、Source ready。
- restart API container後artifact與DB資料仍存在。
- 關閉Redis profile後API仍可讀取資料，response cache標為bypass。
- 刪除API container不會刪除DB/artifact volume。
- `docker compose down`不會預設刪除named volumes；資料刪除需明確`down -v`並記錄為破壞性操作。

## 10. Phase KS-CMP-1：Access與cache隔離驗證

### 測試矩陣

| ENABLE_TENANT | ENABLE_K12 | Caller | 預期範圍 |
|---|---|---|---|
| false | false | service/no auth依設定 | Marble + Learning Commons |
| false | true | service | defaults + K12 |
| true | false | tenant key | defaults + tenant entitlement，K12 blocked |
| true | true | tenant key | defaults + allowed tenant/K12 entitlement |
| true | any | invalid key | 401 |

### 驗收標準

- 每一列都由真實HTTP測試驗證。
- request collection IDs不能擴大effective scope。
- 兩個tenant對同一mutable endpoint不會共用錯誤Redis entry。
- K12 disabled時，stale retrieval index也不能漏回K12 document。
- response包含可追蹤但不含secret的access decision與artifact provenance。

## 11. Phase KS-CMP-2：三服務整合Compose

### 工作項目

1. 將Source加入repository-level Compose network。
2. Synthesis設定：

   ```text
   KNOWLEDGE_SOURCE_BASE_URL=http://knowledge-source-service:3200/v1
   ```

3. AI Workflow亦使用container DNS，不用`host.docker.internal`作正式整合路徑。
4. 加入Source → Synthesis runtime-index、topic-candidate、retrieve contract tests。
5. 加入Source sole-source smoke，驗證下游不直接讀raw dataset。
6. startup dependency以health/readiness及one-shot migration完成為準。

### 驗收標準

- Synthesis可成功讀Source runtime index，不發生`license_scope` contract error。
- topic candidate import保存artifact ID、checksum、license與access trace。
- retrieval context只接受source policy允許的結果。
- Source停止時Synthesis fail closed，不靜默改讀local raw/index，除非明確dev fallback。
- 重新發布runtime index後，下游可觀察新version並保存provenance。

## 12. Phase KS-CI-0：CI、映像與供應鏈

### Required gates

```text
Node 24 npm ci
201 unit/contract tests
ESLint
OpenAPI validation
Next isolated build
Docker build
container health/readiness smoke
PostgreSQL migration smoke
Source -> Synthesis HTTP contract test
SBOM
image vulnerability scan
```

### 驗收標準

- 所有required gates在乾淨Linux runner通過。
- image以git revision與不可變digest識別。
- SBOM與scan report可對應相同digest。
- dependency/image更新不會繞過integration gate。
- multi-architecture若宣告`amd64`/`arm64`，兩者都必須實際build與smoke；否則只宣告已驗證architecture。

## 13. Phase KS-ROL-0：部署、觀察與回滾

### 部署順序

1. 備份DB與artifact metadata。
2. 執行migration job。
3. 部署單一canary API instance。
4. 驗證health、ready、auth、runtime index、retrieval與cache。
5. 驗證Synthesis consumer。
6. 擴大replica或切換流量。

### 監控指標

- request count、latency、4xx/5xx。
- DB pool waiting/error。
- Redis hit/miss/bypass/error。
- artifact read failure/checksum mismatch。
- access denial reason code。
- runtime/retrieval index alias與version。
- readiness failure原因。

### 回滾

- 保存上一個Node image digest與Compose release設定。
- additive migration不得阻止舊image讀取；破壞性schema變更另案處理。
- image rollback不刪除DB volume或artifact volume。
- rollback後執行runtime latest、retrieve、access matrix與Synthesis contract smoke。

### 驗收標準

- canary與rollback命令有文件化且演練過。
- rollback不需還原raw dataset或重新build全部artifact。
- 舊image可在新migration後安全啟動，或已有明確DB rollback程序。

## 14. 最終完成定義

以下全部成立才算升級完成：

- package、CI、Docker均正式使用Node 24。
- 201 tests、lint、OpenAPI、Next build與sole-source smoke通過。
- production image為multi-stage、固定digest、非root、不含secret/raw dataset。
- DB migration為獨立one-shot job。
- artifact storage有持久volume及正確UID權限。
- Redis optional模式與access-scoped cache均通過驗證。
- Source與Synthesis真實HTTP contract測試通過。
- `/sources` metadata曝光、runtime license contract與storage containment已處理。
- 有SBOM、scan、observability、canary及rollback evidence。

## 15. 官方參考

- Node.js release資訊：https://nodejs.org/en/about/previous-releases
- Node.js Official Docker Image：https://github.com/nodejs/docker-node
- Next.js self-hosting：https://nextjs.org/docs/app/guides/self-hosting
- Docker Compose specification：https://docs.docker.com/compose/compose-file/

