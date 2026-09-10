# RAG 存储系统实施 Runbook

| 字段 | 内容 |
|------|------|
| 方案文档 | `docs/storage-architecture-rag-2026-09.md` |
| 执行开始 | 2026-09-10 13:22 UTC+8 |
| 执行者 | WorkBuddy |
| 状态 | ✅ 已完成（T1–T10 全部落地） |
| 收尾时间 | 2026-09-10 16:23 UTC+8 |

---

## 任务清单（10 Tasks）

| ID | 任务 | 状态 | 完成时间 | 备注 |
|----|------|------|----------|------|
| T1 | 新增域类型：Section / Chunk / Embedding | ✅ 完成 | 2026-09-10 13:27 | section.ts / chunk.ts / embedding.ts + index.ts 导出 |
| T2 | 扩展 StorageAdapter 接口 | ✅ 完成 | 2026-09-10 | types.ts 新增 6 组方法 + `RetrievalScope` |
| T3 | InMemoryStorage 实现新方法 | ✅ 完成 | 2026-09-10 | memory.ts，Map + 过滤 + 排序 |
| T4 | localStorage 适配器扩展 | ✅ 完成 | 2026-09-10 | local.ts，5 个新 key + 写操作 override |
| T5 | SQLite DDL SQL | ✅ 完成 | 2026-09-10 14:22 | `src-tauri/src/db/schema.sql` |
| T6 | Tauri SQLite 初始化与 CRUD 命令 | ✅ 完成 | 2026-09-10 14:22 | 24 个 `db_*` 命令已注册 |
| T7 | Tauri 侧工厂函数与后端选择 | ✅ 完成 | 2026-09-10 | storage/index.ts `isTauri()` 分支 + TauriStorage 降级 |
| T8 | 单测：StorageAdapter 新方法 | ✅ 完成 | 2026-09-10 16:00 | `tests/storage-adapter.test.ts`，28/28 通过 |
| T9 | 迁移脚本与启动时自动迁移 | ✅ 完成 | 2026-09-10 16:20 | 脚本 + `TauriStorage.migrateLegacyRagData()` |
| T10 | 文档补充 | ✅ 完成 | 2026-09-10 16:23 | 双 README + schema 字段注释 |

**交付物一览**

| 类型 | 路径 |
|------|------|
| 域类型 | `src/domain/section.ts` · `chunk.ts` · `embedding.ts` |
| 存储层 | `src/storage/types.ts` · `memory.ts` · `local.ts` · `tauri.ts` |
| Rust 侧 | `src-tauri/src/db/{schema.sql,mod.rs,models.rs,commands.rs}` · `lib.rs` |
| 迁移脚本 | `scripts/migrate-rag-to-sqlite.mjs` |
| 单测 | `tests/storage-adapter.test.ts`（`npm run test:storage`） |
| 文档 | `README.md` · `README.zh-CN.md` · `src-tauri/src/db/schema.sql` |

---

## T1 · 新增域类型（Section / Chunk / Embedding）

**状态**：✅ 完成

新建 `src/domain/section.ts`（28 行）、`chunk.ts`（46 行）、`embedding.ts`（41 行），并在 `src/domain/index.ts` 追加导出。

- `Section`：`id / chapterId / documentId / title / level / index / contentRef / createdAt`，配套 `sortSectionsByIndex()`；
- `Chunk`：`id / documentId / chapterId / sectionId? / content / position / tokenCount? / knowledgeIds / metadata? / createdAt`，配套 `sortChunksByPosition()` 与 `estimateTokenCount()`（中文 1.5 字、英文 4 字符 / token）；
- `Embedding`：`id / targetType / targetId / model / vectorDim / createdAt`，配套 `embeddingKey(type, id, model?)`。

---

## T2 · 扩展 StorageAdapter 接口

**状态**：✅ 完成

`src/storage/types.ts` 新增 `RetrievalScope`（documentId / chapterId / sectionId / knowledgeId / goalId）与 6 组方法签名：Section（6）、Chunk（7）、KnowledgeUnit（5）、KnowledgeRelation（7）、Embedding（6）、Evidence 扩展（1）+ `fullTextSearch()`。

---

## T3 · InMemoryStorage 实现新方法

**状态**：✅ 完成

`src/storage/memory.ts` 用 5 个 `Map` 承载新实体。注意点：

- `listSections` / `sectionsByRange` 按 `index` 升序；`listChunks` / `listChunksByDocument` / `fullTextSearch` 按 `position` 升序；
- `prerequisitesOf(unitId)` 只取 `toId === unitId && type === "prerequisite"` 的边，再回表取单元；
- `fullTextSearch` 为**降级实现**：大小写不敏感子串匹配，生产由 FTS5 承担。

---

## T4 · localStorage 适配器扩展

**状态**：✅ 完成

`src/storage/local.ts` 新增 5 个 key（`plos.sections` / `plos.chunks` / `plos.knowledge-units` / `plos.knowledge-relations` / `plos.embeddings`），构造时载入、写操作 override 后 `persist()`。读方法直接继承基类。

---

## T5 · SQLite DDL

**状态**：✅ 完成 → `src-tauri/src/db/schema.sql`

7 张实体/关联表（sections / chunks / chunk_knowledge / knowledge_units / knowledge_relations / embeddings / chunks_fts）+ `_schema_version`。要点：

- 列名避开保留字：`idx`（index）、`rel_type`（type）；
- `created_at` 由调用方传入 epoch ms，不用 SQL 函数作 DEFAULT；
- FTS5 **不用触发器**同步（部分 SQLite 版本在 defensive 配置下报 `unsafe use of virtual table`），改由 Rust 命令显式维护。

---

## T6 · Tauri SQLite 初始化与 CRUD 命令

**状态**：✅ 完成

`src-tauri/src/db/`（mod.rs 82 行 / models.rs 309 行 / commands.rs 640 行），`lib.rs` 注册 24 个 `db_*` 命令；`init_db()` 在 `setup()` 中执行，`create_if_missing(true)` + 逐条跑 schema.sql，失败只打印日志、不阻塞启动。

---

## T7 · 工厂函数与后端选择

**状态**：✅ 完成

`src/storage/index.ts` 的 `detectBestBackend()`：`isTauri()` → `"tauri"`，否则探测 localStorage → `"local"` / `"memory"`。`TauriStorage extends LocalStorageAdapter`，RAG 五类实体走 `db_*` 命令、其余沿用 localStorage；任一命令失败即静默回退父类同名方法（只告警一次）。

---

## T8 · 单测：StorageAdapter 新方法

**状态**：✅ 完成（28/28 通过）

### 涉及文件
- `tests/storage-adapter.test.ts`（新建）
- `package.json`（新增 `test:storage` 脚本）

### 运行

```bash
npm run test:storage
# storage-adapter: 28/28 passed
```

### 覆盖矩阵

| 组 | 内容 | 断言数 |
|----|------|--------|
| A | domain 辅助函数（T1）：`sortSectionsByIndex` / `sortChunksByPosition` / `estimateTokenCount` / `embeddingKey` | 4 |
| B | Section：往返、按 index 升序、批量覆盖、删除、`sectionsByRange` 区间过滤 | 5 |
| C | Chunk：按章/按文档聚合、`get` / `delete`、`chunksByKnowledge` 多值命中 | 4 |
| D | KnowledgeUnit：全量/按文档过滤、`get` / `delete`、批量覆盖 | 3 |
| E | KnowledgeRelation：`relationsOf` 双向、`listRelations` 过滤、`prerequisitesOf` 语义、`delete` | 4 |
| F | Embedding：按类型过滤、`get` / `delete`、`deleteEmbeddingsByTarget` 跨 model | 3 |
| G | Evidence：`listEvidenceBySubject` 按 `at` 倒序 | 1 |
| H | `fullTextSearch`：大小写不敏感、scope 四维过滤、limit、空查询 | 4 |

### 实施中修正的认知

- **E3 断言写错了，不是代码错**：我最初断言 `prerequisitesOf("k1")` 为 0，理由是「r3 是 outgoing」。实际 `r3` 是 `k3 → k1`，对 k1 而言是**入边**，k3 确实是 k1 的前置。修正断言为 `["k3"]`，并补 `prerequisitesOf("k2") === 0`（k2 只有出边）来覆盖「无前置」分支。

---

## T9 · 迁移脚本与启动时自动迁移

**状态**：✅ 完成

分两部分：独立导入脚本（Dev 验证 / 数据抢救）+ 桌面端启动自动迁移（生产路径）。

### 9.1 独立迁移脚本

**新增**：`scripts/migrate-rag-to-sqlite.mjs`

设计文档 §6.2 的伪代码用的是 Python，但本仓库无 Python 依赖、Node 是唯一必装运行时，故改用 Node 实现；不引 sqlite npm 包，生成 SQL 文本后交给系统自带 `sqlite3` CLI 执行。

```bash
# 只生成 SQL
node scripts/migrate-rag-to-sqlite.mjs --in export.json --out migrate.sql
# 直接灌库
node scripts/migrate-rag-to-sqlite.mjs --in export.json --db /path/to/plos.db
# 只看统计
node scripts/migrate-rag-to-sqlite.mjs --in export.json --stats
```

- 输入支持两种形态：对象 `{ "plos.sections": [...] }` 或数组 `[{ key, value }]`；未识别 key 忽略并提示。
- 写语句用 `INSERT OR REPLACE`（对应 Rust 侧 `ON CONFLICT DO UPDATE`）；`chunk_knowledge` 与 `chunks_fts` 先删后插，与 `db_save_chunks` 同策略。
- 全部包在一个事务里。

**实测验证**（临时库 + 示例导出）：

| 检查项 | 结果 |
|--------|------|
| schema 建表 | ✅ 20 条语句执行通过 |
| 行数（sections/chunks/units/relations/embeddings） | ✅ 2 / 2 / 2 / 1 / 1 |
| `chunk_knowledge` + `chunks_fts` | ✅ 各 2 行 |
| 英文 FTS（`MATCH 'attention'`） | ✅ 命中 c1，snippet 正常 |
| 重复执行幂等 | ✅ 行数不翻倍 |

### 9.2 启动时自动迁移

**修改**：`src/storage/tauri.ts`

新增 `TauriStorage.migrateLegacyRagData()`：

- **触发时机**：惰性——`trySqlite()` 或 `probe()` 首次握手成功时（构造函数不做异步副作用）。用 `private migration: Promise<number> | null` 做并发去重。
- **数据来源**：直接读父类内存镜像（`this.sections` 等 `protected` Map）。理由：`LocalStorageAdapter` 构造时已全量载入，而接口层没有 `listAllSections` 之类的全量方法，逐章遍历既低效又会漏掉文档删除后残留的孤儿 Section。
- **写入顺序**：sections → units → relations → chunks → embeddings（无外键约束，仅为排障日志可读）。
- **幂等**：① localStorage 标记 `plos.rag.migrated.v1`；② 写入全为 upsert；③ 无遗留数据立即返回。
- **失败处理**：catch 后返回 `-1` 且**不写标记**，下个启动周期重试；不影响本次读取结果。
- **保留 localStorage 副本**：SQLite 后续若故障会回退读 localStorage，留着等于免费灾备。

### 已知边界

降级态（SQLite 不可用）期间新写入 localStorage 的 RAG 数据，在标记已置位后**不会**再被自动搬迁。当前降级属异常路径，若后续需要支持，改为记录「上次迁移时间戳」按增量搬迁即可。

---

## T10 · 文档补充

**状态**：✅ 完成

| 文件 | 变更 |
|------|------|
| `README.md` | 新增「🗄️ Storage Layer (RAG)」章节（三档后端对照表 + 数据层级 + 降级/迁移说明）；质量门禁补 `npm run test:storage`；仓库结构补 `scripts/` 与 `src-tauri/db/` |
| `README.zh-CN.md` | 同上中文版「🗄️ 存储层（RAG）」 |
| `src-tauri/src/db/schema.sql` | 全表字段级注释（含义 / 取值 / 单位 / 命名避坑），并标注 FTS5 中文限制 |

**schema.sql 注释实施后校验**：复刻 Rust `split_statements()` 逻辑用 Node 跑了一遍——20 条语句、无纯注释片段误留、无被注释内分号截断的情况；`sqlite3 < schema.sql` 实际执行通过。注释统一使用全角分号，避免踩 `split(';')`。

---

## 遗留问题

| ID | 问题 | 等级 | 根因 | 建议修法 |
|----|------|------|------|----------|
| F1 | **FTS5 中文子串检索失效** | 高（中文优先产品） | 默认 `unicode61` 分词器把连续中文整段当成**一个** token。实测："编码器由六层堆叠而成" 里 `MATCH '编码器'` 命中 0 条；`MATCH '编码器*'`（前缀）与整句才命中 | schema 改 `tokenize = 'trigram'`（SQLite ≥ 3.34，本机 3.43 支持）；代价：索引体积增大、查询词需 ≥ 3 字符，存量库要 DROP + 重建 + 全量重灌（需 `_schema_version` 升到 2 并加迁移步骤） |
| F2 | 降级态新写入的 RAG 数据不回迁 | 低 | 迁移是一次性标记制，见 T9「已知边界」 | 改为记录迁移时间戳做增量搬迁 |
| F3 | Documents / Chapters 仍在 localStorage | 中 | T5 刻意不为这两张表建表，避免迁移期双写 | 待 F1 一起做，届时把两张表纳入 SQLite 并升 schema v2 |

**当前影响面**：F1 不影响功能可用性——桌面端 FTS 查不到中文时，前端会降级到内存子串匹配，用户感知为「能搜到但走的是内存路径」。数据量小的时候无感，量大后才有性能问题。

---

## 执行日志

| 时间 | 事件 | 备注 |
|------|------|------|
| 2026-09-10 13:22 | Runbook 创建 | 准备开工 T1 |
| 2026-09-10 13:27 | T1 完成 | 三个域类型文件 |
| 2026-09-10 14:22 | T5 + T6 完成 | schema.sql + 24 个 db_* 命令 |
| 2026-09-10 15:45 | 续跑：核对现状 | T1–T7 均已落地，`npm run typecheck` 0 error |
| 2026-09-10 16:00 | T8 完成 | 28 项断言全绿；修正 E3 断言（非代码缺陷） |
| 2026-09-10 16:15 | T9.1 完成 | 迁移脚本 + sqlite3 实测（英文 FTS 命中、幂等） |
| 2026-09-10 16:20 | T9.2 完成 | `migrateLegacyRagData()` 惰性一次性迁移 |
| 2026-09-10 16:23 | T10 完成 | 双 README + schema 字段注释 |

---

## 变更记录

| 日期 | 变更 | 作者 |
|------|------|------|
| 2026-09-10 | 初稿 Runbook（T1–T4 详细步骤 + T5–T10 占位） | WorkBuddy |
| 2026-09-10 | 收尾：T1–T10 状态校准，补 T8/T9/T10 实施记录、交付物一览、遗留问题 F1–F3 | WorkBuddy |
