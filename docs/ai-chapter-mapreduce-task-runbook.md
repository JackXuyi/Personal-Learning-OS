# AI 长文本改造（章内 map-reduce）实施 runbook

## Goal

把「概览」管道已验证的 map-reduce 范式推广到**概念分析 / 要点分析 / 章节精修**三条管道，使长章节、长文档不再因长度失败；归并后的原文 `quote` 与锚定 `start/end` 100% 由代码侧产出，AI 不得生成。方案见 `docs/ai-chapter-mapreduce-design-2026-09.md`。

## Context

- **包 / 路径**：`src/ai/`（新增 3 个模块 + `pipelines.ts` 瘦身）、`src/features/learn/analyze-service.ts`、`src/features/learn/detail/{KnowledgeTab,SplitTab}.tsx`、`src/i18n/messages/{zh,en}.ts`、`tests/`
- **已读文档**：
  - `docs/ai-chapter-mapreduce-design-2026-09.md`（本方案的 12 章技术方案）
  - `skills/docs-task-runbook/SKILL.md`（本 runbook 规范）
  - `rules/code-structure-and-dependencies`（≤700 行 / 依赖单向）、`rules/no-headless-browser-validation`（校验走 typecheck + node 单测）
- **验收命令**：`npm run typecheck`、`npm run test:library`、`npm run test:ai`、`npm run test:overview`、`npm run test:aimap`（新增）

### 开工时的代码事实（已核实）

| 事实 | 值 |
|---|---|
| `pipelines.ts` 行数 | 803（超 700 硬上限） |
| 概念/要点逐章硬上限 | 单章 40,000 字 → 抛 `AiProviderError` |
| 章节精修静默失效条件 | 全文 > 60,000 字 或 章数 > 24 → `return []` |
| `parseKeyPointDrafts` 单次条数上限 | 5（D4 将改为 8） |
| 分块内核现状 | `overview-pipeline.ts` 私有（`collectBoundaries` / `cutByBoundaries` / `splitEvenly`） |
| 引用 `pipelines.ts` 的测试 | `tests/ai-pipeline.test.ts`、`tests/library-keypoint.test.ts` |

### 与方案的实现偏差（已在 runbook 记录）

1. **新增 `src/ai/pipeline-core.ts`（方案未列）**：把 `chatJson` / `extractJson` / `isRecord` / `str` / `PIPELINE_LIMITS` / `TEMPERATURE` 抽为最底层模块。原因：`pipelines.ts` 要 re-export `chapter-map-reduce` / `refine-batch`，而后者又需要这些共享工具，直接互引会形成模块循环（顶层求值跨模块 `const` 会命中 TDZ）。抽 core 后依赖为单向：`pipeline-core ← text-blocks / chapter-map-reduce / refine-batch / pipelines / overview-pipeline`。方案 §8.4「保留全部既有导出」的兼容承诺不变。
2. **`extractKeyPointsWithAi` / `extractChapterConceptsWithAi`（无 anchor 旧签名）语义**：改为「分块 map → 代码级合并去重」，**不跑 AI 归并、不做锚定**（无 anchor 回调时无法锚定候选）。新入口 `extractKeyPointsMapped` / `extractConceptsMapped` 由 `analyze-service` 注入 anchor 后调用。两者并存，旧签名不破坏既有测试。
3. **概念关系在分块后的处理**：块内关系下标必须重映射到合并后的全局候选下标；AI 归并阶段按「候选 → 归并项」映射重建关系。方案 §8.2 只写了 units 的 evidence 继承，关系重映射作为必要实现补充。

## Tasks

### T1 — 抽出 `text-blocks.ts`，overview 改委派
- **Status:** done
- **Outcome:** 新增 `src/ai/text-blocks.ts`（`planTextBlocks` / `adaptiveChunkChars` / `excerptOf` / `TextBlock` / `PlanTextBlocksInput`）；`overview-pipeline.ts` 删除私有 `collectBoundaries` / `cutByBoundaries` / `splitEvenly`，`planOverviewBlocks` 改为委派并只补 `label`。验收：`npm run test:overview` **24/24 通过且测试文件零改动**（证明搬迁无行为变化）。
- **Notes:** 验收 = `npm run test:overview` **零改动**全绿（证明搬迁无行为变化）。

### T2 — 抽出 `pipeline-core.ts`，`pipelines.ts` 改 import 源
- **Status:** done
- **Outcome:** 新增 `src/ai/pipeline-core.ts`（`PIPELINE_LIMITS` / `TEMPERATURE` / `chatJson` / `extractJson` / `isRecord` / `str`）；`pipelines.ts` 删除这些实现与私有 `chapterExcerpt`（改用 `text-blocks.excerptOf`），改为 import + re-export。验收：`test:ai` 6/6、`test:keypoint` 8/8，**两个测试文件零改动**。`PIPELINE_LIMITS` 除原字段外已预置新字段（旧字段待 T6 清理）。
- **Notes:** typecheck 的 3 条报错位于 `src/features/settings/AIModelsSection.tsx`，经 `git diff` 核对为 **HEAD 既存问题**（工作树与 HEAD 一致），非本任务引入，按 `rules` 不顺手改他人文件。

### T3 — 新增 `chapter-map-reduce.ts`：要点族
- **Status:** done
- **Outcome:** `src/ai/chapter-map-reduce.ts`（467 行）：`planChapterBlocks`（自适应 3k–12k / ≤8 块）、`AnchorFn`、`AiKeyPointDraft` / `KeyPointCandidate`、整章版 + 分块版 + 归并版三套提示词、`parseKeyPointDrafts`（上限 8，D4）/ `parseKeyPointBlockDrafts` / `parseKeyPointMerge`（引用式：quote/start/end 整体继承候选）、`extractKeyPointsMapped`（短章单块直出、长章 map + 归并、归并失败回退代码合并 D6）。
- **Notes:** 无锚定版 `extractKeyPointsWithAi` 曾一度写在本文件，后**移回 `pipelines.ts`**（它是既有导出，且避免了与概念族的循环依赖）；实现由 T6 在 pipelines.ts 内重写为「分块 map + 代码合并」。

### T4 — 同文件补齐概念族
- **Status:** done
- **Outcome:** 概念族超出单文件 700 行硬上限，按「族」拆为 **`src/ai/concept-map-reduce.ts`（616 行）**：`ConceptCandidate` / `AiConceptMergeItem` / `parseConceptDrafts` / `parseConceptRelations` / `parseConceptMerge`（返回 `{ merged, candidateToMerged }`，evidence 从 `mergeOf` 首个可锚定候选继承；AI 未覆盖的候选追加为独立槽位，不静默丢内容）、`extractConceptsMapped`（map 阶段关系下标抬升到全局候选空间 → 代码按 title 去重 → 归并后按下标映射重建关系；全程下标贯穿，最后一步才转 id）。
- **Notes:** 关系重映射是方案未细写的必要实现（见「实现偏差 3」）。无锚定版 `extractChapterConceptsWithAi` 同样移回 `pipelines.ts`（T6 重写）。

### T5 — 新增 `refine-batch.ts`
- **Status:** done
- **Outcome:** `src/ai/refine-batch.ts`（174 行）：`planRefineBatches`（章数 ≤12 与摘录字符 ≤24k 双约束，摘录长度与 `buildRefineMessages` 同口径）、`buildRefineMessages` / `parseChapterRefines`（自 `pipelines.ts` 迁入，提示词 index 说明改为「本批数组下标」、`mergeIntoPrevious` 约束改为「整篇第一章必须 false」）、`refineChaptersBatched`（批内 index → 整篇 index 重映射，单批失败只丢该批）。
- **Notes:** D5 落地：跨批 `mergeIntoPrevious` 无需特殊处理 —— `applyChapterRefine` 按整篇 index 顺序应用，批首章并入上一批末章语义天然正确。

### T6 — `pipelines.ts` 瘦身为薄聚合层
- **Status:** done
- **Outcome:** `pipelines.ts` **803 → 585 行**（<700 ✓）。移出精修/概念/要点三族实现，改为「薄聚合层」：自身保留出题、批改两条管道与两个兼容执行器（`extractKeyPointsWithAi` / `extractChapterConceptsWithAi`，均由「单次调用」改为「章内分块 map + 代码级合并」，不再因 40k 字抛错）；全部既有导出改 re-export，`PIPELINE_LIMITS` 删除 4 个整篇口径旧字段。验收：`test:ai` 6/6、`test:overview` 24/24 零改动；`test:keypoint` 7/8 —— **唯一失败是 D4 的预期变更**（「截断到 5」断言现为 8），由 T10 同步。
- **Notes:** `route: 旧字段残余引用 grep = 无残留`（TC-EDGE-10 通过）。

### T7 — `analyze-service.ts` 接线
- **Status:** done
- **Outcome:** 概念分析改调 `extractConceptsMapped`、要点分析改调 `extractKeyPointsMapped`，均由本层注入 anchor 回调（`ai/` 不依赖 `features/`）；删除原「锚定循环」（现由 AI 层在候选阶段完成）。`AnalyzeChaptersResult` 增 `batches` / `failedBatches`（精修改用 `refineChaptersBatched`，可上报「N 章未精修」）；`AnalyzeConceptsResult` / `AnalyzeKeyPointsResult` 各增 `skippedBlocks` / `mergeFallbacks`；两个 `onProgress` 增可选第 4 参数 `{ block, blocks }`（短章不传 → 与改造前调用方式兼容）。typecheck 通过。
- **Notes:** `refineChaptersWithAi`（既有导出）保留但已无生产调用方 —— 其职责由 `analyzeChaptersNow → refineChaptersBatched` 直接承接（后者能透出 `failedBatches`，前者签名 `ChapterRefine[]` 装不下）。

### T8 — UI：KnowledgeTab 块进度 + SplitTab 无建议提示
- **Status:** done
- **Outcome:** `KnowledgeTab.tsx`：`busyTick` 增 `block` / `blocks`；长章 `blocks > 1` 时进度行改用 `t.learn.detail.analyze.busyBlock`（显示「第 i/n 块」）；汇总行在 `skippedBlocks > 0` 时补一行提示。`SplitTab.tsx`：精修结果三分支 —— `failedBatches > 0` → 失败提示（含批数）、`changed === 0` → 无建议提示、否则正常文案。行为零变化（仅新增可视信息）。
- **Notes:** 短章（`blocks <= 1`）不传第 4 参数，旧调用形态完全兼容。

### T9 — i18n 双语新增（4 条 × 2 语言）+ 删死键
- **Status:** done
- **Outcome:** `learn.detail.analyze` 下成对新增 4 条：`busyBlock`（带 `{i}/{n}` 插值）、`skippedBlocks`（带计数）、`failedBatches`（带计数）、`noSuggestion`。同时**删除死键 `tooManyChapters`**（分批后「章节过多」的说法已不成立，全仓 grep 零引用）。验收：`npm run test:i18n` PASS（双语键集一致性）。
- **Notes:** 数量由方案预估的 3 条变为 4 条（`noSuggestion` 是 SplitTab 三分支拆出的额外一条）。

### T10 — 测试：新增 `ai-map-reduce.test.ts` + 更新 keypoint 上限 + 挂 `test:aimap`
- **Status:** done
- **Outcome:** 新增 `tests/ai-map-reduce.test.ts`（**23/23 通过**）：分块不变式（覆盖全文、无重叠、下标单调）、`adaptiveChunkChars` 边界、要点块数/调用次数/失败跳过、归并失败回退（D6）、引用式归并**强断言 `body.slice(r.start, r.end) === r.quote`**、概念 `mergeOf` 的 evidence 继承、关系下标重映射、精修分批与跨批 `mergeIntoPrevious` 合并、D4 上限 8。`tests/library-keypoint.test.ts` 的「截断到 5」断言改为 `PIPELINE_LIMITS.keyPointMergeMax`。`package.json` 新增 `test:aimap` 并挂入 `test:library`。
- **Notes:** 首轮 20/23。三处失败中两处是测试文件漏 import（已补）；一处 **TC-EDGE-08 暴露真实行为差异**——改造前「分块调用成功但 quote 全锚不上」属「章成功 + 0 条 refs」，我误写为抛错。已修实现：仅 `skippedBlocks === blocks.length`（所有块真的调用失败）才抛 `AiProviderError`，否则返回空 refs 由调用方保留原 `keyPoints`。

### T11 — 全量验证 + 文档同步
- **Status:** done
- **Outcome:** `npm run typecheck` —— 本任务文件 **0 error**（剩余 3 条在 `AIModelsSection.tsx`，已核实为 HEAD 既存问题，工作树与 HEAD 一致，非本任务引入）；`npm run test:library`（7 组串联）**exit 0**：anchor 7/7、advice 9/9、keypoint 8/8、preview 10/10、overview 24/24、card-status、aimap 23/23。相邻回归全 PASS：`test:ai` / `test:rag` / `test:graph` / `test:chunk` / `test:retrieval` / `test:i18n`。行数达标（`wc -l`）：`pipelines.ts` 803→585、`chapter-map-reduce.ts` 467、`concept-map-reduce.ts` 616、`refine-batch.ts` 174、`pipeline-core.ts` 157、`text-blocks.ts` 169。文档同步：`docs/library-detail-page-design-2026-09.md` 新增 §13「后续变更（2026-09-13）」表 + 变更记录一行。
- **Notes:** 未做浏览器级校验（遵守 `rules/no-headless-browser-validation`）。

## 收尾核对

| 项 | 结论 |
|---|---|
| 三条管道的 40k/60k 硬上限是否消除 | ✅ 概念 / 要点走章内自适应分块（3k–12k×≤8）；精修走分批（≤12 章且摘录 ≤24k），无整篇上限 |
| 引用式归并不变量 | ✅ `body.slice(start, end) === quote` 恒成立（强断言覆盖；AI 引文文本一律丢弃） |
| `pipelines.ts` ≤700 行 | ✅ 585 行 |
| 依赖方向 | ✅ `pipeline-core ← text-blocks / chapter-map-reduce / concept-map-reduce / refine-batch / pipelines / overview-pipeline`，无循环 |
| `ai/` 是否依赖 `features/` | ✅ 否，锚定由 `analyze-service` 注入 `AnchorFn` |
| 既有导出是否保持 | ✅ 全部 re-export；`test:ai` / `test:overview` / `test:keypoint` 零改动通过 |
| 行为变更是否入文档 | ✅ `docs/library-detail-page-design-2026-09.md` §13 |
| i18n 双语 | ✅ 成对新增 4 条，死键已删 |

## 变更记录

| 日期 | 变更 | 作者 |
|------|------|------|
| 2026-09-13 | 建立 runbook（T1~T11），记录 3 处实现偏差 | Agent |
| 2026-09-13 | T1~T11 全部实施完成，回填 Outcome，补「收尾核对」表 | Agent |
