# 资料详情页优化 实施 Runbook

## Goal

按 `docs/library-detail-page-design-2026-09.md`（已确认）消灭 5 个可用性缺陷并落地 5 项优化：

| # | 缺陷 | 级别 | 对应任务 |
|---|------|------|----------|
| B1 | 无章节时「立即切分」按钮不渲染 → 首次切分死锁 | P0 | T8 |
| B2 | `ai/active.buildActiveProvider()` 恒返回 null → AI 按钮永远禁用 | P0 | T5 |
| B3 | Markdown 只做行级渲染（`ArticleBody` 仅识别 `#`） | P1 | T6/T7 |
| B4 | 试卷 Tab 完全没读 storage，恒显示「暂无试卷」 | P1 | T10 |
| B5 | Tab 为 4 等分网格 + 实底，与 Workbench 线性视觉不一致 | P2 | T12 |

优化目标：章节列表化 / 按 `format` 分派渲染 / 知识点带原文引用 / 试卷按掌握度推荐（只展示） / Tab 下划线式。

## Context

- 方案：`docs/library-detail-page-design-2026-09.md`（12 章，含伪代码、UC、TC）
- 前置：资料库模块 T1–T14 已合入（`a0a9ae4`…`188efa2`），路由已三级化
- 关联：`docs/library-module-design-2026-09.md`（切分=代码｜分析=AI 的硬契约）

## 硬约束

| 约束 | 内容 |
|------|------|
| 依赖方向 | domain → engine/ai/storage → stores → features；UI 不直碰 localStorage |
| 导入风格 | 相对导入为主（`@/*` 仅豁免 `components/ui`、`lib/utils`） |
| i18n | zh/en 成对；`useI18n()` 返回 `{ lang, m }`，组件内 `const { m: t } = useI18n()` |
| 状态色 | 仅用于 dot / 徽标，不用于正文（`rules/react.mdc`） |
| 分析契约 | `split-service` 不得 import `ai/*`；`analyze-service` 不得 import 切分函数 |
| 新增字段 | 全部可选，老数据零迁移 |
| AI 入口 | **唯一**构造入口为 `stores/useSettingsStore.buildActiveProvider()`；`ai/active` 的 stub 必须删除 |
| 校验 | typecheck + node 单测；**禁止**启浏览器验证（`rules/no-headless-browser-validation.mdc`） |
| 文件规模 | 单文件 ≤700 行 |

## 批次计划（用户指定执行顺序）

```
批次一  T5  T12  T1  T2  T9   ← 底座：全局 AI 配置 / Tab 样式 / domain / 纯函数
批次二  T3  T4                ← AI 链路：要点抽取 + 原文锚定写回
批次三  T6  T7                ← 渲染层：三渲染器 + 注册表 + ?at= 高亮
批次四  T8  T10 T11           ← 章节列表 / 试卷 Tab / 出卷预填
批次五  T13 T14               ← i18n 收口 + 单测 + typecheck 归零 + 提交
```

---

## Tasks

### T5 — 全局 AI 配置（B2 · P0）
- **批次：** 一
- **Status:** done
- **改动：**
  - `src/ai/active.ts`：删除 `buildActiveProvider()` 导出（恒 null 的 stub），文件头补注释指明唯一入口
  - `src/hooks/useAiReady.ts`（新增）：`useSettingsStore((s) => s.providerReady)`
  - `SplitTab` / `KnowledgeTab`：`buildActiveProvider()?.isConfigured()` → `useAiReady()`
- **验收：** typecheck 0；全局 `grep -rn "buildActiveProvider" src/features` 仅命中 useSettingsStore 侧
- **Notes:** 未配置时按钮禁用 + 「去配置 AI 模型 →」（既有 `goConfigure` 文案）

### T12 — Tab 下划线式 + Indicator
- **批次：** 一
- **Status:** done
- **改动：** `src/components/ui/tabs.tsx`：
  - `TabsList` → `relative flex w-fit items-center gap-6 border-b border-line bg-transparent p-0`
  - `TabsTab` → `-mb-px border-b-2 border-transparent pb-2 pt-1` + `text-ink-3 hover:text-ink-2 data-selected:text-ink-1`
  - 新增 `TabsIndicator` → `absolute bottom-0 h-0.5 rounded-full bg-primary transition-all`
  - `DocumentDetailPage`：`TabsList` 内挂 `TabsIndicator`，去掉 `grid-cols-4`
- **验收：** 选中态为下划线，无边框容器；无 `TabsRootContext is missing` 报错

### T1 — Domain：KeyPointRef / ConceptEvidence
- **批次：** 一
- **Status:** done
- **改动：**
  - `src/domain/chapter.ts`：新增 `KeyPointRef{point,quote,start,end}`；`Chapter.keyPointRefs?`
  - `src/domain/knowledge.ts`：新增 `ConceptEvidence{documentId,start,end,quote}`；`KnowledgeUnit.evidence?`
- **验收：** 全部可选；typecheck 0；无迁移脚本

### T2 — evidence-anchor.ts（纯函数）
- **批次：** 一
- **Status:** done
- **改动：** `src/features/learn/evidence-anchor.ts`（新增）
  - `foldWhitespace(s) → { folded, map }`
  - `locateQuote(body, quote) → {start,end} | undefined`（两档：精确 → 折叠空白；空/超 2000 字直接 undefined）
  - `anchorToDocument(body, quote, base)`（叠加章起始偏移）
- **验收：** `tests/library-anchor.test.ts` 通过

### T9 — paper-advice.ts（纯函数）
- **批次：** 一
- **Status:** done
- **改动：** `src/features/learn/paper-advice.ts`（新增）
  - `recommendPaper({chapter, learner})` → `{mode, band, reasonKey}`
  - `recommendDocPaper({chapters, learner})` → 全章达标给 `final-test`，否则 `undefined`
  - 阈值同源 `MASTERY_FLOOR=0.6` / `MASTERY_THRESHOLD=0.8`；band 复用 `bandOfMastery`
- **验收：** `tests/library-paper-advice.test.ts` 六分支通过

### T3 — AI 管道：要点抽取 + 概念 quote
- **批次：** 二
- **Status:** done
- **改动：** `src/ai/pipelines.ts`
  - 新增 `KEYPOINT_SYSTEM` / `buildKeyPointMessages` / `parseKeyPointDrafts` / `extractKeyPointsWithAi`
  - `AiConceptDraft` 增加可选 `quote`；`parseConceptDrafts` 解析并裁剪 ≤200 字
  - `extractChapterConceptsWithAi` 把 quote 透传（`KnowledgeUnit.evidence` 由 analyze-service 锚定）
  - `PIPELINE_LIMITS` 增 `keyPointMaxTextChars`
- **验收：** `tests/library-keypoint.test.ts` 通过（校验 / 去重 / 裁剪）

### T4 — analyze-service：analyzeKeyPointsNow + evidence 写回
- **批次：** 二
- **Status:** done
- **改动：** `src/features/learn/analyze-service.ts`
  - 新增 `analyzeKeyPointsNow(doc, chapters, opts)`：逐章抽取 → `anchorToDocument` 定位 → 一次性 `saveChapters`（同步 `keyPoints` 保证单一真源）→ 写 `doc.analysis.keyPointsAt`
  - `analyzeConceptsNow`：概念 quote 定位后写 `KnowledgeUnit.evidence`，未命中的省略（诚实降级）
- **验收：** 代码自审：失败路径上抛不静默；不 import 切分函数

### T6 — 渲染层（依赖已装：react-markdown 10 / remark-gfm 4）
- **批次：** 三
- **Status:** done
- **改动：** `src/features/learn/render/`（新增）
  - `renderer-registry.ts`：`pickRenderer(format) → DocumentRenderer`
  - `MarkdownRenderer.tsx`：`remarkGfm`；`urlTransform` 白名单 http/https/mailto；**不引入 rehype-raw**；`img: () => null`
  - `PlainTextRenderer.tsx` / `CodeRenderer.tsx` / `ImageNoticeRenderer`
- **验收：** typecheck 0；`pickRenderer` 分派单测

### T7 — ContentTab 接渲染器 + ?at= 高亮
- **批次：** 三
- **Status:** done
- **改动：**
  - `src/features/learn/highlight.ts`（新增）：`highlightRange(root, start, end)` — TreeWalker 累偏移 → `surroundContents(<mark>)` → `scrollIntoView`
  - `detail/ContentTab.tsx`：`pickRenderer(doc.format)` + `bodyRef` + `useEffect` 消费 `at`
  - `DocumentDetailPage`：解析 `?at=`，传 `ContentTab`；切 Tab 时清除 `at`
- **验收：** `at` 越界不报错；Markdown 渲染后仍能高亮

### T8 — 章节列表（B1 · P0）
- **批次：** 四
- **Status:** done
- **改动：**
  - `detail/SplitTab.tsx`：工具条**常显**（移除 `firstChapter` 门禁）；空态卡内也放「立即切分」；`useAiReady()`
  - `detail/ChapterRow.tsx`：i18n 化状态文案（删硬编码中文）、字数、掌握度 Bar、状态徽标、要点数
- **验收：** `chapters=[]` 时按钮可见（TC-UC01-01）；切 en 无中文残留（TC-UC02-02）

### T10 — PapersTab 读库 + 推荐（B4 · P1）
- **批次：** 四
- **Status:** done
- **改动：** `detail/PapersTab.tsx`
  - mount 时 `storage.listPapers()` + `storage.listPaperResults()`（**只读，零写入**）
  - 按 `paper.scope.chapterIds` 反查章；过滤已删章 → 「范围已失效」徽标
  - 已出卷：模式徽标 / 题数 / 状态 / 得分（done → `/report/:paperId`，open → `/quiz/:paperId`）
  - 未出卷：`recommendPaper` 推荐卷型 + 难度带 + 时长 + 「去出卷 →」
  - 资料级：`recommendDocPaper` 全达标 → 顶部「综合测」
- **验收：** 自审无 save/delete 调用（TC-EDGE-07）

### T11 — NewQuizPage 预填
- **批次：** 四
- **Status:** done
- **改动：** `src/features/quiz/NewQuizPage.tsx`：读 `?doc=&chapters=&mode=`，初始化写入向导 state（可改）
- **验收：** typecheck 0；未带参数时行为不变

### T13 — i18n zh/en 补齐
- **批次：** 五
- **Status:** done
- **改动：** `src/i18n/messages/{zh,en}.ts`
  - `tabs.split` → 「章节列表 / Chapters」
  - `chapters.{emptyTitle,emptyDesc,chars,keyPoints,status:{notStarted,learning,ready,mastered,retake},resplit,split,refine,stats}`
  - `content.{renderFallbackNotice,showFull,imageNoText}`
  - `knowledge.{extractPoints,reExtractPoints,refLabel,noRef,goSource,pointsDone}`
  - `papers.{docAdvice,advice,goNew,generated,score,duration,difficulty,reason:{never,failed,weak,near,mastered,allMastered}}`
- **验收：** `npm run test:i18n` 通过（key 一一对应）

### T14 — 收尾
- **批次：** 五
- **Status:** done
- **改动：**
  - 单测 3 件套：`tests/library-anchor.test.ts` / `library-paper-advice.test.ts` / `library-keypoint.test.ts`
  - `package.json` 挂 `test:library`（若缺）
  - `npm run typecheck` 归零
- **验收：** typecheck 0 error；3 个单测全绿；`test:i18n` 通过

---

## 收尾清单

- [x] `npm run typecheck` 0 error
- [x] `npm run test:i18n` 通过（8/8）
- [x] 新增 3 个单测通过（`npm run test:library`：7 + 9 + 8）
- [x] 代码自审：`PapersTab` 仅 list；`analyze-service` 不 import 切分函数
- [x] 方案状态改「已完成」
- [x] 按 commit-conventions 分组提交（本地 commit，不 push）
- [x] 追加 `.workbuddy/memory/2026-09-10.md` 日志

## 实施记录（2026-09-10）

| 项 | 结果 |
|----|------|
| typecheck | 0 error |
| `npm run test:library` | 24 项断言全绿（anchor 7 / advice 9 / keypoint 8） |
| `npm run test:i18n` | 8/8 通过（zh/en 结构递归一致） |
| 静态边界 | `split-service` 无 `ai/*` 导入；`analyze-service` 只 import `applyChapterRefine`（无切分函数）；`PapersTab` 零写入 |

### 与方案的两处偏差（已确认无行为损失）

1. **T11 无需新写**：`NewQuizPage` 早已支持 `?doc=&chapters=&mode=` 预填（第 86–103 行）。
   本次只加了一道 mode **白名单校验**（原实现只排除 `retake`，非法字符串会流入 `createPaper`）。
2. **`?at=` 读后不从 URL 移除**：方案 §4.4 原计划「读后即从 URL 移除」。
   实际保留 `?at=`，使锚点可分享 / 刷新可复原；重复高亮的成本仅是 effect 再跑一次。
   `highlightRange` 每次调用前先 `clearHighlights`，不会叠加多层 `<mark>`。

### 复用而非新造

- `ChapterRow` 的状态徽标直接复用既有 `features/learn/chapter-badge.ts`（内含
  状态机 + 掌握度派生规则与 i18n 文案），未另造一套状态推导。
- `PapersTab` 的卷型 / 状态文案复用既有 `m.quiz.mode` / `m.quiz.status`，未新增字典。

