# RAG 全链路接线 实施 runbook

## Goal

把 RAG 存储底座从「空转」接成真正有数据流的链路：导入 / 重切分后 Chunk 自动落库，
向量可生成可重建，`/learn` 搜索框消费 FTS + 向量的混合检索结果。完成后
`chunks` 表首次有数据、`chunks_fts` 同步、搜索能命中正文（此前只能命中标题与要点）。

**状态：T1–T20 全部 done。** 门禁结果见文末「验证汇总」。

## Context

- 方案：`docs/rag-wiring-design-2026-09.md`（12 章；D1–D4 已按推荐采纳：
  D1-A 向量只存 SQLite BLOB / D2-A 切分后自动入队后台串行 / D3-A 复用 active 端点、
  模型名单独配置 / D4-A `/learn` 搜索框升级为元信息 + 内容双段，RRF 融合）
- 前置文档：`docs/storage-architecture-rag-2026-09.md`（存储底座）、
  `docs/storage-architecture-rag-task-runbook.md`（T1–T10 已落地）、
  `docs/storage-architecture-rag-fts-fix-design-2026-09.md`（F1 trigram 修复）
- 门禁：`npm run typecheck` 0 error；`test:chunk` / `test:retrieval` / `test:rag` /
  `test:storage` 全绿；`cargo test --lib` 全绿
- 约束：禁止起浏览器校验（`rules/no-headless-browser-validation`）；
  提交只落本地不 push

## 实施中对方案的 4 处有意偏差（均已落地并在此记录）

| # | 偏差 | 原因 |
|---|------|------|
| 1 | **schema v3 的 `ALTER TABLE` 不进 `schema.sql`，改由 `migrate_v3` + `PRAGMA` 探测承担**（`CREATE TABLE` 里直接写 `vector` 列，覆盖新库） | `apply_schema()` 每次启动都跑 `schema.sql`，把 `ALTER` 写在里面第二次启动必报 `duplicate column name` 并中断 `init_pool` |
| 2 | **`rebuildChunks` 清理顺序改为「先查旧 chunk → 清向量 → 删 chunk → 写新 chunk」** | 方案 §8.2 伪代码先删后查，删完再查必然是空数组，旧向量清理形同虚设 |
| 3 | **索引编排（`rebuildIndex` / `autoIndexAfterImport`）放在 `features/learn/index-service`，`stores/useIndexStore` 只存状态** | 方案 §8.13 把 `rebuild` 放在 store 里会让 `stores → features` 反向依赖，违反 `rules/code-structure-and-dependencies` 的单向依赖；改为 features 驱动 store 的状态迁移 |
| 4 | **Embedding 模型名用 `Input`（自由填写）而非 `Select`** | 模型名是厂商私有的开放字符串，硬编码下拉会在换厂商时变成错误的「建议」；只保留 1–2 个有把握的快捷建议 |

## Tasks

### T1 — schema.sql v3：`embeddings` 加 `vector BLOB`
- **Status:** done
- **Outcome:** `src-tauri/src/db/schema.sql` 的 `embeddings` CREATE 语句新增 `vector BLOB`
  （注释说明 float32 LE 编码与「NULL = 元数据在、向量未生成」语义）；表头与 schema 版本注释同步为 v3。

### T2 — `db/mod.rs` migrate v2→v3（PRAGMA 探测 + ALTER，幂等）
- **Status:** done
- **Outcome:** `migrate()` 拆为 `migrate_v2`（trigram 重建，逻辑不变）+ `migrate_v3`
  （`SELECT COUNT(*) FROM pragma_table_info(?) WHERE name = ?` 探列 → 缺则 `ALTER` → 写版本 3），
  两步各自独立判版本，v1 存量库可一次跳到 v3。
- **Notes:** 用表值函数 `pragma_table_info` 而非裸 `PRAGMA`，便于 bind 参数与 WHERE。

### T3 — Rust：`EmbeddingInput.vector` + `EmbeddingVectorOut` + 契约单测
- **Status:** done
- **Outcome:** `models.rs` 增 `EmbeddingInput.vector: Option<Vec<f32>>`（`#[serde(default)]`）、
  `EmbeddingVectorOut { target_id, model, dim, vector }`、`f32_to_blob` / `blob_to_f32` LE 编解码；
  `tests` 模块增 3 条单测（input camelCase 含 vector 与缺省、VectorOut camelCase、blob 往返无损 + 字节序 + 残字节）。

### T4 — Rust：`db_delete_chunks_by_document`（事务清理 3 表）
- **Status:** done
- **Outcome:** `commands.rs` 新增命令，单事务内按 `document_id` 清 `chunk_knowledge` → `chunks_fts` → `chunks`；
  命令注释明确「不清理 embeddings，调用方须先取旧 chunk id 再清向量」。

### T5 — Rust：`db_list_embedding_vectors`（BLOB→Vec&lt;f32&gt;，按 targetIds 过滤）
- **Status:** done
- **Outcome:** 新增命令：`target_type` 必填、`target_ids` 可选、`vector IS NOT NULL` 过滤；
  动态 `IN (?,?,…)` 只拼占位符（值全走 bind）；逐行手工解码 BLOB（`sqlx::Row::try_get`），
  空向量剔除。`dim` 以解码后长度为准。

### T6 — `db_save_embeddings` 扩展写入 vector；`lib.rs` 注册 2 命令
- **Status:** done
- **Outcome:** INSERT 增 `vector` 列（`Option<Vec<f32>>` → `Option<Vec<u8>>`），
  `ON CONFLICT(id)` 同步更新 `vector` / `vector_dim` / `created_at`；未带 vector 时显式写 NULL；
  `lib.rs` 注册 `db_delete_chunks_by_document`、`db_list_embedding_vectors`。

### T7 — 域类型：`Embedding.vector?` + `EmbeddingVector`
- **Status:** done
- **Outcome:** `src/domain/embedding.ts` 增可选 `vector?: number[]`（注明「读路径不返回，读向量走
  `listEmbeddingVectors`」）与 `EmbeddingVector { targetId, model, dim, vector }`。

### T8 — 契约扩展：`deleteChunksByDocument` + `listEmbeddingVectors`
- **Status:** done
- **Outcome:** `src/storage/types.ts` 两方法 + 中文注释（含「未持有向量的后端返回空数组 →
  调用方降级 FTS-only」与「重切分前必须先取旧 chunk 再清向量」两条语义约束）。

### T9 — memory 后端实现（含向量持有）
- **Status:** done
- **Outcome:** `InMemoryStorage.deleteChunksByDocument`（按 documentId 删 chunk）与
  `listEmbeddingVectors`（按 targetType 过滤 + 只返回 vector 非空 + targetIds 可选过滤）。

### T10 — local 后端实现（向量内存态，不持久化 + 注释说明）
- **Status:** done
- **Outcome:** `LocalStorageAdapter` override `deleteChunksByDocument` 触发 `persist()`；
  新增私有 `embeddingsForPersist()` 在写 `plos.embeddings` 前剥离 `vector`。
- **Notes:** 关键理由写在注释里——若不剥离，一份 1000 chunk × 768 维的向量会让**整个
  `persist()` 因配额超限抛错**，连带资料 / 章节 / 学习进度都写不进去。

### T11 — tauri 后端实现（DTO 编解码 + 降级）
- **Status:** done
- **Outcome:** `EmbeddingDto` 增 `vector?`（仅写入时带）、新增 `EmbeddingVectorDto`；
  `toEmbeddingDto` 用条件展开避免把 `undefined` 写进 JSON；两方法走 `trySqlite` + 失败回退父类。

### T12 — `chunk-engine.ts`（段落聚合 / 硬切 / 全局 position）
- **Status:** done
- **Outcome:** 新增 `src/engine/chunk-engine.ts`（266 行）：`chunkChapter` / `chunkDocument` /
  `chapterBodyOf` + `splitParagraphs` / `maxPrefixByTokens`（二分）/ `lastSentenceBreak` / `hardSplit`。
  target 400 / hardMax 512 token；句末标点断开需落在候选前缀 60% 之后（否则硬截断）；
  续块折叠块首空白；`position` 跨章全局连续；`metadata.heading` 仅在章标题非空时写。
- **验证:** `npm run test:chunk` 12/12。

### T13 — `index-chunks.ts` + pipeline link 阶段 + split-service 接线
- **Status:** done
- **Outcome:** 新增 `src/features/learn/index-chunks.ts` 的 `rebuildChunks`（返回
  `{ chunks, staleVectors }`）；`pipeline.ts` 的 `link` 阶段由 `async () => {}` 改为调用它；
  `split-service.ts` 在 `saveChapters` + 掌握度迁移之后追加调用。
- **Notes:** 顺带把 `SplitServiceError` 的 TS 参数属性改成显式字段——参数属性属于
  strip-only 模式不支持的语法，会让 `split-service` 无法被 node 直跑的单测导入（行为等价）。
- **验证:** `npm run test:rag` 8/8（含「导入后 chunks 落库」「两次重建不翻倍」）。

### T14 — `library-actions` 级联清理 + 预览计数
- **Status:** done
- **Outcome:** `DeleteReport` 增 `chunks`；`previewDeleteCascade` 统计 chunk 数；
  `deleteDocumentCascade` 新增「步骤 0」先清 chunk 与其向量；`DeleteDocDialog` 改用
  `DeleteReport` 类型并传第 4 个参数；i18n `del.desc` 增 `chunks` 形参（zh/en 成对，
  仅在 chunks > 0 时追加文案）。

### T15 — `AIProvider.embed?` + openai-compatible `/embeddings` + builtin 不实现
- **Status:** done
- **Outcome:** `ai/types.ts` 增可选 `embed?`（注释写明「调用方必须先做 `typeof` 能力检查」）
  与 `ProviderConfig.embeddingModel?`；`openai-compatible.ts` **在构造期按 `embeddingModel`
  是否存在决定是否挂载 `embed`**（未配置 → 能力不存在 → 调用方自然降级，不靠异常兜底）；
  `requestEmbeddings` 按 `index` 还原顺序、校验条数与维度一致；
  `builtin.ts` 与 `active.ts::NoActiveProvider` 均不实现（无需改动，接口本就是可选）。

### T16 — `useSettingsStore.embedding` + 设置页向量索引卡
- **Status:** done
- **Outcome:** `SavedSettings` 增 `embedding`（`normalizeEmbedding` 归一化旧数据）、
  `setEmbeddingModel`、`partialize` 同步；`buildActiveProvider()` 注入 `embeddingModel`
  （未选模型时仍走 `providerFromActive(null)` 的离线兜底）；新增
  `src/features/settings/VectorIndexCard.tsx`（模型名输入 + 快捷建议 + 端点继承展示 +
  覆盖率 + 重建 / 仅补齐缺失 + 非桌面端禁用与原因说明），挂到 `AIModelsSection` 的 Tab 卡之下。

### T17 — `ai/retrieval/{vector-search,rrf,hybrid-search}.ts`
- **Status:** done
- **Outcome:** `vector-search.ts`（`cosineSimilarity` 零向量/非有限值返回 0；
  `cosineTopK` 维度不一致跳过并计数、分数并列按 targetId 定序）；`rrf.ts`（`fuseRankings`，
  k 默认 60、同路重复只计首次、并列按字典序）；`hybrid-search.ts`（FTS 20 + 向量 top-20 →
  RRF → 按 documentId 去重批量补 `docTitle` / `chapterTitle` / `semantic`，返回 `mode`）；
  `ai/index.ts` 增三处 barrel 导出。
- **验证:** `npm run test:retrieval` 21/21。

### T18 — `index-service.ts` + `useIndexStore`（批量 / 进度 / 幂等 / 可续算）
- **Status:** done
- **Outcome:** `index-service.ts`：`buildIndex`（32 条 / 批、单批失败计 `failed` 不中断、
  embedding id = `embeddingKey(targetType, targetId, model)` 保证幂等 upsert、
  `onlyMissing` 增量补齐）、`embeddingCoverage`、`activeEmbeddingModel`、`rebuildIndex`（门闩 +
  状态机 + 失败落 `error` 并抛回）、`autoIndexAfterImport`（静默，能力不足直接跳过）。
  `useIndexStore` 为纯状态（`running/progress/error/coverage` + `begin/setProgress/finish/fail/
  refreshCoverage`）+ `coveragePercent` 派生函数；`refreshCoverage` 用 `await import` 打断
  store↔features 的 ESM 循环。`ImportModal` 单份 / 批量导入成功后各调一次 `autoIndexAfterImport()`。
- **Notes:** 见「偏差 3」。

### T19 — `LibraryPage` 检索段 + i18n 双语 + 降级徽标
- **Status:** done
- **Outcome:** `LibraryPage` 新增「正文命中」段：300ms 防抖（<2 字符不检索）→ `hybridSearch`；
  命中项显示「资料 · 章 + ≤120 字片段」，语义命中带 `语义命中` 徽标，点击跳
  `/learn/chapter/:chapterId`；右上角按状态显示 `索引中 done/total` 或 `仅全文检索 ⓘ`；
  无命中 / 未搜索整段隐藏。既有元信息过滤与卡片网格**未改动**。
  i18n 新增 `learn.search.*`（7 键）与 `settings.embedding.*`（18 键），zh/en 成对。
- **Notes:** 见「偏差 4」。

### T20 — 单测 3 件套 + `typecheck` + 文档回写
- **Status:** done
- **Outcome:** 新增 `tests/chunk-engine.test.ts`（12 例）、`tests/retrieval.test.ts`（21 例）、
  `tests/rag-wiring.test.ts`（8 例）；`package.json` 增 `test:chunk` / `test:retrieval` / `test:rag`
  三个脚本（只插本任务 3 行，未动他人新增的 `test:overview`）；
  `docs/storage-architecture-rag-2026-09.md` §11 标注 N1 已实施并记录两处能力边界。

## 验证汇总（2026-09-10）

| 门禁 | 结果 |
|------|------|
| `npm run typecheck` | 0 error |
| `npm run test:storage` | 28/28 |
| `npm run test:chunk` | 12/12（新增） |
| `npm run test:retrieval` | 21/21（新增） |
| `npm run test:rag` | 8/8（新增） |
| `npm run test:i18n` | 8/8 |
| `npm run test:import` / `test:goal` / `test:scope` / `test:eta` / `test:library` | 20/20 · 7/7 · 3/3 · ALL PASS · 24/24（回归无破坏） |
| `cargo test --lib` | 全绿（含 7 条 db::models 契约单测，新增 3 条） |

未做（按 `rules/no-headless-browser-validation`）：浏览器 / E2E / 截图级校验。
桌面端真机走查 UC-01/02/04（SQLite 落库、向量生成、搜索体验）需用户在 Tauri 环境自行验证。

## 变更记录

| 日期 | 变更 |
|------|------|
| 2026-09-10 | 初稿：按 `docs/rag-wiring-design-2026-09.md` T1–T20 建 runbook |
| 2026-09-10 | T1–T20 全部完成，补「有意偏差」表与验证汇总 |
