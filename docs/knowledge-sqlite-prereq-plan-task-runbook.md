# 概念层落 SQLite + 前置关系参与规划 —— 执行 runbook

## Goal

按 `docs/knowledge-sqlite-prereq-plan-design-2026-09.md`（D1 适配器聚合 / D2 章级软排序 / D3 惰性迁移不清源）实施 T1–T8：
概念层（KnowledgeUnit/KnowledgeRelation）真实落 SQLite（两表有数据、重启不丢、evidence 不丢），章级计划感知概念前置关系（软排序 + 理由标注），业务层读写路径零改动。

## Context

- Package / paths：`src/storage/`、`src/domain/knowledge.ts`、`src/engine/learning-planner.ts`、`src/engine/loop.ts`、`src/features/quiz/QuizReportPage.tsx`、`src-tauri/src/db/`、`tests/`
- Docs read：`docs/knowledge-sqlite-prereq-plan-design-2026-09.md`、`docs/rag-wiring-design-2026-09.md`、`skills/docs-task-runbook`、`rules/no-headless-browser-validation`

## Tasks

### T1 — `graph-split.ts` 纯函数 + DTO/evidence 映射
- **Status:** done
- **Outcome:** 新增 `src/storage/graph-split.ts`：`toUnitDto`/`fromUnitDto`/`toRelationDto`/`fromRelationDto`（自 tauri.ts 迁入，补 evidence 四字段映射 + 「四列不全 = 整体缺省」）+ `splitGraph` / `mergeGraph`（悬空 relation 丢弃）/ `diffIds`。`KnowledgeUnitDto`/`KnowledgeRelationDto` 定义落此文件，tauri.ts 反向 import。
- **Notes:** 只依赖 `domain` 类型，node 可直跑。

### T2 — `TauriStorage` getGraph/saveGraph override（拆分/聚合/diff-delete/降级/双写）
- **Status:** done
- **Outcome:** `src/storage/tauri.ts` 新增「知识图谱」区段：`getGraph` = `ensureMigration()` → `db_list_knowledge_units`/`db_list_relations` → `mergeGraph`，两表任一失败整体回退父类 blob；`saveGraph` = 拆行 upsert → diff-delete（`db_list_*` 算差集后 `db_delete_*` 逐条删，传播级联删除语义）→ 失败整体回退 → 成功仍 `super.saveGraph` 双写 blob。
- **Notes:** 业务侧 13 处读写零改动（接口签名未变）。

### T3 — Rust v4：schema.sql + migrate_v4 + models.rs + commands.rs（evidence 四列）
- **Status:** done
- **Outcome:** `schema.sql` knowledge_units 加 `evidence_document_id/start/end/quote`（版本注释升 4）；`mod.rs` 新增 `migrate_v4`（逐列 PRAGMA 探测 + ALTER，幂等，串入 `migrate()`）；`models.rs` 的 `KnowledgeUnitInput/Row/Out` 三处加 4 个 Option 字段 + From impl 透传；`commands.rs` INSERT 列/ON CONFLICT/绑定补 4 列（SELECT 走 `SELECT *` 自动带上）。新增 2 条 serde 契约测试。
- **Notes:** 验证 `cargo test --lib` → 43 passed（含新增 2 条）；编译警告 2 条为既有（llm/models.rs、logging.rs），非本次引入。

### T4 — `migrateLegacyGraph` + `plos.graph.migrated.v2` + ensureMigration 串接
- **Status:** done
- **Outcome:** `migrateLegacyGraph()` 读父类内存镜像 `this.graph` → 空图短路写 flag → 否则 `invoke` 两表 upsert → 写 `GRAPH_MIGRATION_FLAG = "plos.graph.migrated.v2"`；失败返回 -1 且不写 flag（下次重试）。`ensureMigration()` 改为串行 `migrateLegacyRagData()` + `migrateLegacyGraph()`，沿用 `this.migration` 并发去重。
- **Notes:** 迁移方法刻意用**裸 `invoke`**——用 `trySqlite` 会在首次成功时回头 `await ensureMigration()` 造成自等待死锁。

### T5 — `chapterPrerequisiteIds`（domain 纯函数）
- **Status:** done
- **Outcome:** `src/domain/knowledge.ts` 新增 `chapterPrerequisiteIds(graph, chapters)`：unit → 所属章索引，遍历 `type === "prerequisite"` 边，同章自环与范围外单元剔除，返回 `Map<toChapterId, fromChapterId[]>`。新增 `import type { Chapter } from "./chapter"`。
- **Notes:** 只映射入参 `chapters` 范围内的单元 → 跨文档前置自动忽略。

### T6 — `buildChapterPlan` blocked 软排序 + reasons + i18n 双语
- **Status:** done
- **Outcome:** `ChapterPlanInput` 加可选 `graph?`；`ChapterActionSpec` 加 `blocked?: string[]`；`buildChapterPlan` 计算 `prereqMap`，对非 cls=4 的 spec 标注「前置章未达标（mastery < MASTERY_THRESHOLD）」并 push `m.engine.prereqPending(...)`；排序键插入 `blocked 有无`（cls → blocked → dueAt → mastery → order）。i18n zh/en `engine.prereqPending` 成对新增。
- **Notes:** 不跨类、不丢弃；无图/空图与不传等价（向后兼容）。

### T7 — 调用方接线（loop.ts / QuizReportPage.tsx）
- **Status:** done
- **Outcome:** `runChapterLoop` 的 `Promise.all` 增加 `storage.getGraph()` 并传入 `buildChapterPlan`；`QuizReportPage.togglePlan` 由同步改异步，先 `await storage.getGraph()` 再算计划（失败回退 blob，无需新错误分支）。
- **Notes:** `tests/i18n-alignment.test.ts` 的两处调用不传 graph，天然覆盖向后兼容分支。

### T8 — 测试：graph-split / planner-prereq / package.json scripts / Rust 契约 / 全量回归
- **Status:** done
- **Outcome:** 新增 `tests/graph-split.test.ts`（6 项：往返/evidence 拆平/悬空边/部分 evidence/id 稳定/删除集）与 `tests/planner-prereq.test.ts`（6 项：UC03-01..05 + EDGE-02）；`package.json` 加 `test:graph`、`test:prereq`；Rust 契约测试 +2。回归：`tsc --noEmit` 仅剩 `AIModelsSection.tsx` 3 条既有报错；23 组 node 单测全绿；`cargo test --lib` 43 passed。
- **Notes:** 手工冒烟（`npm run tauri dev` 抽取概念 → `db_status` 计数 > 0 → 重启验证图与 evidence → 计划页看前置标注）按仓库 `no-headless-browser-validation` 约定留待用户显式要求时执行。
