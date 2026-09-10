# 资料库模块实施 Runbook

## Goal

按 `docs/library-module-design-2026-09.md`（v2：切分=代码不重试｜分析=AI 可重跑）把「资料」升格为一等管理对象：`/learn` 列表页（卡片）+ `/learn/doc/:docId` 详情页（4 Tab）+ 资料级 CRUD + 代码切分/AI 分析分离 + 重新切分同源保留掌握度。

## Context

- 方案：`docs/library-module-design-2026-09.md`（12 章，含伪代码与测试方案）
- 关联：`docs/knowledge-import-design-2026-09.md`（导入管道，**零改动**）；`docs/ui-workbench-plan-2026-09.md` §11/U5（收尾同步）
- 硬约束：Rust 零改动；导入管道零改动；`split-service` 不得 import `ai/*`；`analyze-service` 不得 import `splitter-engine`；UI 文案 zh/en 成对；组件不直碰 localStorage；校验走 typecheck + node 单测（禁浏览器）

## Tasks

### T1 — Domain + Storage 契约扩展
- **Status:** done
- **Outcome:** `domain/document.ts` 增加可选 `analysis`（chaptersAt/conceptsAt/model）；`storage/types.ts` 契约新增 `getDocument` / `deletePaper`；`memory.ts` 实现（deletePaper 级联清草稿+结果）；`local.ts` override `deletePaper` 落盘。

### T2 —
- **Status:** in_progress
- **Outcome:** overlapRatio（min 分母）/ matchResplit（0.6 贪心）/ remapLearnerStateOnResplit（max 分数、sum 计数、max 时间、Bloom 取高、误解并集 cap 8）已落地，纯函数无 IO
- **Notes:** overlapRatio / matchResplit（阈值 0.6 贪心）/ remapLearnerStateOnResplit（max/sum/max/并集）

### T3 —
- **Status:** done
- **Outcome:** splitDocumentNow 落地：先算后写；SplitServiceError no-body/no-chapters；签名无 provider、无重试
- **Notes:** splitDocumentNow；签名无 provider；先算后写；类型化错误 no-body / no-chapters

### T3b —
- **Status:** done
- **Outcome:** analyzeChaptersNow / analyzeConceptsNow 落地：抛错版管道；replaceChapterConcepts 按 oldUnitIds 签名适配；写 doc.analysis；TC-EDGE-12 已修正为「不 import splitDocument」
- **Notes:** analyzeChaptersNow / analyzeConceptsNow；抛错版管道；写 doc.analysis；不改 chapter.id/区间

### T5 —
- **Status:** done
- **Outcome:** deleteDocumentCascade / previewDeleteCascade / renameDocument / updateDocumentMeta / replaceDocumentBody（三阶段事件）/ appendDocumentBody（1.5M 护栏）落地，store 可注入
- **Notes:** deleteDocumentCascade / previewDeleteCascade / renameDocument / updateDocumentMeta / replaceDocumentBody / appendDocumentBody（替换/追加后清空 analysis）

### T6 —
- **Status:** done
- **Outcome:** ui/tabs.tsx + ui/dropdown-menu.tsx 落地（Base UI 底层，data-slot + 语义 token，destructive item）
- **Notes:** Base UI 底层，shadcn 同构

### T7 —
- **Status:** done
- **Outcome:** primitives.tsx 追加 SegmentedTabs（role=tablist，testIdPrefix 透传）

### T8 —
- **Status:** done
- **Outcome:** ArticleBody.tsx 抽取；ChapterReaderPage 改用共享组件；typecheck 0 error
- **Notes:** 阅读页行为不变

### T9 — DocumentCard.tsx + DocActionsMenu.tsx
- **Status:** done（a0a9ae4）
- **Outcome:** `library/DocumentCard.tsx`(74行)：类型徽标 + 标题 + 来源 + 导入时间 + 卡面统计 + 就绪 `Bar`（target=MASTERY_THRESHOLD）；整卡 `<Link to="/learn/doc/:id">`，testid `doc-card-${id}`；未切分且有正文时额外渲染「立即切分」按钮（testid `doc-card-split-${id}`）。`library/DocActionsMenu.tsx`(88行)：Base UI DropdownMenu 承载 7 动作（rename/meta/replace/append/split|resplit/delete），删除项 `destructive`，replace/append/split 依赖 `hasBody` 禁用，`split|resplit` 按 `unsplit` 切文案；导出 `DocActionKind` 作为列表页/详情页共用契约，弹窗编排归页面。
- **Notes:** 卡内菜单绝对定位 + `group-hover` 显隐；标题区留 6×6 占位避免压到菜单

### T10 — 弹窗组（rename / meta / replace / append / delete）
- **Status:** done（a0a9ae4）
- **Outcome:** `library/dialogs.tsx`(529行) 落地 5 个弹窗：`RenameDocDialog` / `DocumentMetaDialog`（format + source + tags）/ `UpdateDocModal`（三来源替换正文：本地文件 / GitHub / 粘贴，`ReplacePhaseKey` 三阶段进度）/ `AppendDocModal`（追加内容）/ `DeleteDocDialog`（`previewDeleteCascade` 预览影响面 + ConfirmDialog 二次确认）；全部只做「收输入 → 调 `library-actions` → `notifyDocsChanged()`」，列表刷新经 `DOCS_CHANGED_EVENT`；护栏复用导入管道 `LIMITS`。配套 `library/shared.ts`(21行) 提供 `formatLabel` / `shortDate`。
- **Notes:** 导入来源复用既有 `LocalFilePanel` / `GithubPanel` / `fileToUnit` / `buildGithubUnit`（导入管道零改动）

### T11 — LibraryPage.tsx 列表页
- **Status:** done（a0a9ae4）
- **Outcome:** `LibraryPage.tsx`(219行) 替代原 ChapterCatalogPage：筛选 `all/unsplit/active` + 排序 `newest/oldest/title`（均 `SegmentedTabs`，testid `library-filter-*` / `library-sort-*`）+ 关键词搜索（标题/来源/章标题/关键点，testid `library-search`）+ 统计副标题；三态渲染（全空引导卡 / 搜索过滤空态 / 卡片网格 `sm:grid-cols-2`，testid `library-grid`）；读时 `applyForgetting` 衰减视图（不写回）；监听 `DOCS_CHANGED_EVENT` 增量重载；导入复用全局 `ImportModal`（`openImportModal`）。
- **R1 已修复（2026-09-10）:** 原 `onCardAction` 对 `split` / `resplit` 直接 `return`（死按钮）。现接线为列表页就地切分：`split` → `runSplit`（复用 `splitDocumentNow`，纯代码零 AI）→ `notifyDocsChanged()` + 重载；`resplit` → `ConfirmDialog` 确认（复用 `learn.detail.split.confirm*` 文案）后执行。新增 inline notice 反馈（成功章数/掌握度保留，失败区分 `no-body` / `no-chapters`）、`splitBusy` 按钮态、`splitLock` ref 重入锁（防同帧连点并发 `saveChapters`）。`DocumentCard` 增加 `busy?` 透传。

### T12 — DocumentDetailPage.tsx 骨架
- **Status:** done（a0a9ae4）
- **Outcome:** `DocumentDetailPage.tsx`(138行)：`useParams` 取 docId → 并行拉 `getDocument` / `listChapters` / `getGraph` / `getLearnerState`；缺 doc 或异常 → `navigate('/learn')`；顶部返回按钮 + 标题 + 来源·日期；`Tabs` 包裹 4 个 `TabsPanel`，`handleRefresh` 供子 Tab 变更后重载。
- **Notes:** Tab 状态 URL 化 `?tab=` 已落地（默认 `content`，`onValueChange` → `setSearchParams`）
- **遗留（R2）:** 设计 §8.13 的 `DetailHeader ... onAction={setDialog}` 未实现——详情页无资料级操作入口（未挂 `DocActionsMenu` 与 dialog state），详情页无法重命名/替换/追加/删除。
- **遗留（R3）:** 未按设计并行拉取 `papers` / `results`（`DetailData` 6 类数据现为 4 类）。

### T13 — 4 个 Tab
- **Status:** done（a0a9ae4）
- **Outcome:** `detail/ContentTab.tsx`(72行) 正文/元信息预览 + ArticleBody 复用；`detail/SplitTab.tsx`(189行) 切分 + AI 分析双按钮（未切分=切分，已切分=重新切分并过 `ConfirmDialog` 确认；`analyzeOnly` 受 `aiReady` 门控，未配置 AI 给「去配置」链接），结果通知条复用 `split.result(n, carried, dropped, isAnalyze)`，章行 `ChapterRow`(48行)；`detail/KnowledgeTab.tsx`(178行) AI 概念批量抽取（`analyzeConceptsNow` + `onProgress` 逐章进度 + 成功/失败汇总）+ `subgraphOf` 子图 + `GraphView` 可视化；`detail/PapersTab.tsx`(37行) 按章列出试卷入口。
- **Notes:** SplitTab 切分+分析双行；KnowledgeTab AI 概念分析；PapersTab 试卷列表
- **遗留（R4）:** `PapersTab` 签名与设计 §8.13 不符——实现只收 `chapters` / `learner`，未接 `papers` / `results`，恒渲染 `noPapers` 占位，无真实试卷数据。

### T14 — 路由重构 + 旧链接重定向 + 9 处链接更新 + 删除 ChapterCatalogPage
- **Status:** in_progress（a0a9ae4 已提交主体；R5 已修复，仅剩 R6 链接收敛）
- **Outcome:** 路由三级分化落地（App.tsx）：`/learn`→LibraryPage、`/learn/doc/:docId`→详情页、`/learn/chapter/:chapterId`→阅读页、`/learn/chapter/:chapterId/graph`→章概念图谱；新增 `LegacyLearnRedirect.tsx`(42行)：`/learn/:legacyId`（+`/graph`）先 `getDocument` 判定为资料 → `/learn/doc/:id`（graph → `?tab=knowledge`），否则按章节 → `/learn/chapter/:id`（+`/graph`）。
- **Notes:** 一次提交完成；grep `/learn/` 无残留旧形态
- **R5 已修复（2026-09-10）:** `src/features/learn/ChapterCatalogPage.tsx` 已 `git rm`（删除前复核：源码内仅 `LibraryPage.tsx:4` 注释提及，无 import；设计 §8.17 明确要求删除；文件在 git 历史中可回溯）。
- **遗留（R6）:** 旧形态 `/learn/${id}` 链接仍残留 **14 处**（GoalDetailPage×5、ChapterGraphPage×2、CommandPalette×1、ReviewSession×1、ChapterReaderPage×1、LearnerPage×1、`plan/chapter-action.ts`×1、QuizReportPage×1、AppShell×1），当前靠 `LegacyLearnRedirect` 兜底可用，但未达 Notes「grep `/learn/` 无残留旧形态」的验收标准。

### T15 — i18n：learn.library.* / learn.detail.*（zh/en），清理 learn.catalog.*
- **Status:** in_progress（key 已随 a0a9ae4 落地，清理未做）
- **Outcome:** `learn.library.*`（zh.ts L577 / en.ts L591）与 `learn.detail.*`（zh.ts L645 / en.ts L659）双语 key 已完整落地，列表页/详情页/4 Tab/5 弹窗文案全覆盖；`npm run test:i18n` 8/8 通过（zh/en 递归结构一致、无空串）。
- **遗留:** `learn.catalog.*` 未清理（zh.ts L541 / en.ts L553 仍在，且 en 多处 `backToCatalog` / `goCatalog` 文案待统一）。

### T16 — 单测 4 件 + typecheck + test:i18n + test:import 回归
- **Status:** pending
- **Outcome:**
- **Notes:** library-resplit / library-split / library-analyze（假 provider）/ library-cascade

## 收尾

- [ ] 最小化更新 `docs/ui-workbench-plan-2026-09.md` §11/U5
- [ ] 方案状态改「已完成」（待 T14 / T15 / T16 收口后再改）
- [ ] 按 commit-conventions 分组提交

## 同步记录（2026-09-10）

代码先于文档提交：`a0a9ae4`（T1–T14）+ `520fa00`（收尾修复：useI18n 解构适配、概念抽取批量化、导入类型归位）+ `188efa2`（TabsRoot 包裹修复）已落地，本文档此前仍停留在 T9–T14 pending。本次按**代码现状**（非 commit message）逐条核对后回填状态与 Outcome。

校验基线（本次核对时执行）：

| 校验项 | 结果 |
|--------|------|
| `npm run typecheck` | 0 error |
| `npm run test:i18n` | 8/8 通过 |
| `npm run test:import` | 20/20 passed |

## 修复记录（2026-09-10）

### R1 — 列表页「立即切分」死按钮

`src/features/learn/LibraryPage.tsx` + `src/features/learn/library/DocumentCard.tsx`

| 改动 | 内容 |
|------|------|
| 接线 | `onCardAction`：`split` → `runSplit(doc)`；`resplit` → `ConfirmDialog` 确认后 `runSplit`；其余动作照旧进弹窗组 |
| 切分执行 | `runSplit` 复用 `splitDocumentNow(doc, { storage })`（纯代码、零 AI、与详情页 SplitTab 同源），成功后 `notifyDocsChanged()` + `load()` |
| 反馈 | 新增 inline notice 条（`data-testid="library-notice"`）：成功显示 `learn.detail.split.result(...)`，失败区分 `no-body` / `no-chapters` |
| 防重入 | `splitBusy`（按钮禁用 + 文案切 `splitting`）+ `splitLock` ref（state 异步，同帧连点需 ref 兜底，防并发 `saveChapters`） |
| i18n | **零新增 key**——全部复用既有 `learn.detail.split.*`（`result` / `noBody` / `noChapters` / `confirm*` / `splitting`） |

### R5 — 删除孤儿文件

`git rm src/features/learn/ChapterCatalogPage.tsx`（414 行）。

删除前复核：全仓 grep 仅 `LibraryPage.tsx:4` 注释提及（无 import）；设计 §8.17「`src/features/learn/ChapterCatalogPage.tsx`（删除）」；文件在 git 历史中存在，可 `git checkout` 回溯。**备注**：`learn.catalog.*` i18n 文案随之失去使用方，清理归 T15。

**归属说明**：该删除以 `git rm` 暂存后，被并行提交 `e93f4a5`（`feat(storage): RAG 迁移脚本与 TauriStorage 惰性自动迁移`）一并带入——故该 storage commit 内含一个 learn 文件删除，语义归属不理想但事实已入库；R1 修复单独提交为 `98ce413`。

## 遗留项清单（同步时发现）

| ID | 归属 | 问题 | 状态 |
|----|------|------|------|
| R1 | T11 | `LibraryPage.onCardAction` 对 `split`/`resplit` 直接 return，卡片「立即切分」为死按钮 | **已修复（2026-09-10）** |
| R5 | T14 | `ChapterCatalogPage.tsx` 未删除（孤儿文件） | **已修复（2026-09-10）**，已 `git rm` |
| R3 | T12 | 详情页未按设计拉取 `papers` / `results` | 由 `docs/library-detail-page-design-2026-09.md` 的 **T10（PapersTab 读库）** 覆盖，本单不再跟踪 |
| R4 | T13 | `PapersTab` 未接存储、恒显示 `noPapers` | 同上，由详情页方案 **T10（B4）** 覆盖 |
| R2 | T12 | 详情页无资料级操作入口（`DetailHeader onAction` 未实现） | **待决策**——详情页方案未包含该任务；如需要则挂 `DocActionsMenu` + dialog state 复用 `library/dialogs.tsx` |
| R6 | T14 | 旧形态 `/learn/${id}` 链接残留 14 处，靠 LegacyLearnRedirect 兜底 | **待处理**（T14 验收标准内）——逐处改 `/learn/chapter/${id}`；改动前先确认 id 归属（章节 or 资料） |

**说明**：R1/R5 已于 2026-09-10 修复（详见下方「修复记录」）；R3/R4 与并行推进的详情页优化方案重叠，已移交该方案跟踪，避免重复劳动；R2/R6 仍需决策。
