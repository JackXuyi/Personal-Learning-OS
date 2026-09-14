# 章内提问（Chapter Q&A）实施 runbook

## Goal

在章阅读页（`ChapterReaderPage`）新增「问这一章」面板：用户就**当前章**提问，答案只依据用户自己导入的原文（`doc.textPreview`）生成，且每条引用都经 `locateQuote` 锚定回原文、可点击跳回正文并高亮。**零伪造引文**：锚不上的 quote 一律丢弃；`found=true` 但零引用锚定时展示答案 + 显式警示。方案见 `docs/learn-chapter-qa-design-2026-09.md`。

## Context

- **包 / 路径**：`src/domain/qa.ts`、`src/ai/retrieval/{hybrid-search,chapter-context}.ts`、`src/ai/chapter-qa.ts`、`src/ai/pipeline-core.ts`、`src/features/learn/{chapter-qa-service.ts,ChapterReaderPage.tsx,reader/ChapterQaPanel.tsx,reader/qa-citations.ts,highlight.ts,detail/ContentTab.tsx}`、`src/i18n/messages/{zh,en}.ts`、`tests/chapter-qa.test.ts`、`package.json`
- **已读文档**：
  - `docs/learn-chapter-qa-design-2026-09.md`（12 章技术方案，D1–D6 已定）
  - `skills/docs-task-runbook/SKILL.md`（本 runbook 规范）
  - `rules/code-structure-and-dependencies`（≤700 行 / 依赖单向）、`rules/layer-import-boundaries`（`ai/` 不得 import `features/`）、`rules/no-headless-browser-validation`（校验走 typecheck + node 单测）、`rules/engineering-code-style`（文案一律 i18n）
- **验收命令**：`npm run typecheck`、`npm run test:qa`（新增）、`npm run test:retrieval`（T2 回归）、`npm run test:library`（含 `test:qa`）、`npm run test:rag`、`npm run test:i18n`

### 开工时的代码事实（已核实）

| 事实 | 值 / 位置 |
|---|---|
| `hybridSearch` 的 `scope` 只作用于 FTS 路 | `ai/retrieval/hybrid-search.ts:55-61` 注释自承；向量路 `listEmbeddingVectors(TARGET_TYPE)` 不带范围 |
| `listEmbeddingVectors(targetType, targetIds?)` 已支持按目标过滤 | `storage/types.ts:110-113`；`memory.ts:215-233` 用 `Set` 过滤 |
| `Chunk` **无字符偏移** | `domain/chunk.ts:17-31`（只有 `position`） |
| 锚定基准 = `doc.textPreview`（文档全文），非章切片 | `evidence-anchor.ts::locateQuote(body, quote)` |
| 章归属判定依据 | `Chapter.contentRef { start, end }`（`domain/chapter.ts:40-45,72`） |
| `HIGHLIGHT_WINDOW = 120` 现为私有 | `detail/ContentTab.tsx:21` |
| `useAiReady()` | `hooks/useAiReady.ts`，订阅 `useSettingsStore.providerReady` |
| `buildActiveProvider()` | `stores/useSettingsStore.ts:288` |
| `activeEmbeddingModel()` | `features/learn/index-service.ts:157` |
| `useI18n()` 形态 | `{ m, lang }`（`m` = messages） |
| 既有 `learn.reader.noSnapshot` | `zh.ts:1118`，已被 `ChapterReaderPage.tsx:196` 使用 |
| **内存后端 FTS 是整串子串匹配（未分词）** | `memory.ts:267`；生产 FTS5 走 trigram。→ 单测查询词必须取原文子串（开工后新增的认知） |

### 与方案的实现偏差（已在 runbook + 方案 §13 记录）

1. **错误信息改用 `errorKind` 而非 `errorText: string`（方案 §4.3.1 的 `errorText` 字段作废）**：`rules/engineering-code-style` 要求文案一律走 i18n、不硬编码；`src/i18n` 无 React 之外的消息访问器，`features` 服务层无法取到 `messages`。故 `ChapterAnswer` 改携带 `errorKind: "invalid-question" | "not-configured" | "parse" | "fetch" | "generic"`，由 `ChapterQaPanel` 映射到 `t.errParse` / `t.errNotConfigured` / `t.errFetch` / `t.errGeneric` / `t.tooLong`。
2. **常量真源收敛（方案 §8.4 与 §8.5 互相重复）**：方案两处分别要求 `PIPELINE_LIMITS.chapterQaMaxQuestionChars: 200` 与 `chapter-qa-service.MAX_QUESTION_CHARS = 200`。为避免两处口径漂移，真源只留 `chapter-qa-service.MAX_QUESTION_CHARS = 200`（UI 与 service 共用）；`PIPELINE_LIMITS` 只新增 `chapterQaMaxQuotes: 5` 与 `chapterQaQuoteMaxChars: 2000`。`MAX_CITATIONS` 取 `PIPELINE_LIMITS.chapterQaMaxQuotes`（不另立重复的 5）。
3. **`qa.noSnapshot` 不新增**：方案 §8.8 列了 `qa.noSnapshot`，但 `learn.reader.noSnapshot` 已存在且被阅读页使用；面板据 `doc.textPreview` 真假在 `t.emptyIndex` / `t.noSnapshot` 之间二选一，不新增重复键。
4. **`chapterQaQuoteMaxChars: 2000` 是 `evidence-anchor.MAX_QUOTE_CHARS` 的显式镜像**：分层约束不允许 `ai/` import `features/`，无法共享常量；两侧同值并各自注释来源，避免静默漂移。
5. **`QaCitation` 增 `chapterOrder`；提示词来源行改写**：线框要渲染「第 3 章」标签（`QaCitation` 原字段拿不到章序号）；方案 §8.4 的 `来源：第 ${b.index} 章` 把**片段序号**当**章序号**，实施改为 `来源：「${chapterTitle}」`。
6. **引用标记切分抽到 `reader/qa-citations.ts`（纯 `.ts`）**：node `--experimental-strip-types` 不支持 JSX，把 `splitCitationMarkers` 留在 `.tsx` 里就无法直跑 TC-EDGE-11。
7. **方案 §12 的 TC-UC06-02 样例不可修复（属设计本意，非 bug）**：截断点落在**首个数组元素中间**时（`"quotes":["b"`），`repairTruncatedJson` 按「绝不补齐半个字段」原则拒绝修复；单测改用截断点落在**完整元素之后**的样例（`"quotes":["b","c"],"reason":"x`）。

## Tasks

### T1 — `domain/qa.ts` 类型 + `domain/index.ts` 导出
- **Status:** done
- **Outcome:** 新增 `src/domain/qa.ts`（77 行）：`QaCitation`（含 `chapterOrder`，偏差 5）、`ChapterAnswerStatus` 六态、`ChapterQaErrorKind`（偏差 1）、`ChapterAnswer`。`domain/index.ts` 加 `export * from "./qa";`。
- **Notes:** `errorKind` 的取舍理由写进了文件头与 §4.3.1（T12 回写）。

### T2 — `hybrid-search.ts` 新增 `restrictChunkIds`（两路生效 + 空集合短路）
- **Status:** done
- **Outcome:** `HybridSearchOptions` 增 `restrictChunkIds?: readonly string[]`；空数组直接返回 `{ hits: [], mode: "fulltext" }`（**绝不退化成全库**）；向量候选改为 `listEmbeddingVectors(TARGET_TYPE, opts.restrictChunkIds)`（候选阶段限死，修复缺口 A）；融合前对 `ftsIds` 用 `allow` 集合再过滤一次，保证两路口径一致。文件 137 → 160 行。验收：`npm run test:retrieval` **21/21 通过且测试文件零改动**（既有调用方行为逐字段不变）。
- **Notes:** 这是全方案唯一触碰既有公共模块的改动，先隔离验证再往下走。

### T3 — `ai/retrieval/chapter-context.ts` 两段式检索 + 上下文拼装
- **Status:** done
- **Outcome:** 新增 126 行：`MIN_CHAPTER_HITS=2` / `CHAPTER_QA_LIMIT=6` / `CHAPTER_QA_CONTEXT_CHARS=6000` / `CONTEXT_BLOCK_CHARS=1200`；`retrieveChapterContext` 三段式（本章 → 不足则扩到同资料其他章并排除已命中 → 去重/编号/逐条截断/总量截断，超限即停不截半条）。本章无 chunk → `candidates: 0` 直接返回（不退化全库）。
- **Notes:** 零 React、零 `features/` 依赖。

### T4 — `ai/chapter-qa.ts` + `pipelines.ts` re-export + `PIPELINE_LIMITS` 补项
- **Status:** done
- **Outcome:** 新增 `src/ai/chapter-qa.ts`（117 行）：`CHAPTER_QA_SYSTEM`（严禁片段外知识 / 逐字复制 / 不足以回答必须 found=false）、`buildChapterQaMessages`、`parseChapterQaAnswer`（宽容取值 + 严判 found：必须显式 `true` 且 answer 非空且 quotes 非空）、`answerChapterQuestion`（`chatJson` + `TEMPERATURE.grade`）。`PIPELINE_LIMITS` 增 `chapterQaMaxQuotes: 5`、`chapterQaQuoteMaxChars: 2000`；`pipelines.ts` 追加 re-export（§0 兼容层）。
- **Notes:** 只 import `./pipeline-core` 与 `./types`，不 import `pipelines.ts` → 无环无 TDZ。提示词来源行按偏差 5 修正。

### T5 — `features/learn/chapter-qa-service.ts` 编排 + `anchorQuotes`
- **Status:** done
- **Outcome:** 新增 177 行：`MAX_QUESTION_CHARS=200`、`MAX_CITATIONS=PIPELINE_LIMITS.chapterQaMaxQuotes`；`askChapter` 六态编排（问题非法 → no-ai 早退 → 取资料/章 → 检索 → 调模型 → 锚定 → 组装），`anchorQuotes` 三条不变式（锚不上丢弃 / 必须落在某章 `contentRef` 内 / 输出文档绝对偏移），`classifyQaError` 只产出分类。
- **Notes:** 唯一 import `evidence-anchor.ts` 的问答模块；doc/chapter 读取也包在 try 内（方案伪代码把它们放在 try 外，会让 storage 异常变成未捕获 rejection）。

### T6 — `highlight.ts` 导出 `HIGHLIGHT_WINDOW`，`ContentTab.tsx` 改为 import
- **Status:** done
- **Outcome:** `HIGHLIGHT_WINDOW = 120` 从 `detail/ContentTab.tsx:21` 迁到 `features/learn/highlight.ts` 导出；`ContentTab` 改 import（行为零变化）。
- **Notes:** 「资料内容 Tab」与阅读页两处高亮窗口口径必须一致。

### T7 — `ChapterReaderPage.tsx`：`?at=` 高亮 + 正文 `ref` + 挂载面板
- **Status:** done
- **Outcome:** 新增 `useSearchParams` 解析 `?at=`（非法值当未提供）、`bodyRef`、`highlight` state；两个 effect —— ① 章切换 / `at` 变化时清掉旧章内高亮；② `requestAnimationFrame` 两帧后 `highlightRange`（`highlight` 优先，否则 `at - contentRef.start` + `HIGHLIGHT_WINDOW`）。正文卡加 `ref`；右栏在 Knowledge 与 Evidence 之间插入 `<ChapterQaPanel>`（Evidence 注释序号改 5）；文件头注释补第 4 区说明。
- **Notes:** 高亮偏移换算与 `ContentTab` 同口径（文档绝对 → 章内相对）。

### T8 — `features/learn/reader/ChapterQaPanel.tsx` UI + 全状态分支 + `data-testid`
- **Status:** done
- **Outcome:** 新增 365 行：输入框（`Enter` 提交 / `Shift+Enter` 换行）、超长红字、示例问题（取自 `chapter.keyPoints`，零编造）、加载行（`Spinner` + 「正在检索你的原文…」）、`QaAnswerBody` 六态分支（除 answered / unanchored 外不渲染任何模型文本）、`QaNotice`（info / muted / warn，warn 用 amber 语义色）、`renderWithCitations`（`[n]` → 可点按钮，越界当普通文本）、`CitationList`（一行一条，`第 n 章 · 标题` + 引文前 60 字）。`data-testid` 一次到位：`chapter-qa-root/-input/-submit/-answer/-warning/-citation-{n}/-suggestion-{n}/-inline-citation-{n}`。
- **Notes:** 面板内无弹层、无 Toast；`aliveRef` 丢弃迟到 setState。

### T9 — i18n `learn.reader.qa.*` 双语成对
- **Status:** done
- **Outcome:** `learn.reader.qa` 成对新增 **21 条**（zh/en 同构）：`eyebrow` `placeholder` `ask` `asking` `searching` `explainOf(n)` `tooLong(n)` `notReady` `goConfigure` `expanded` `notFound` `emptyIndex` `unanchored` `retry` `citationsTitle` `footnote` `fulltextOnly` `errParse` `errNotConfigured` `errFetch` `errGeneric`。验收：`npm run test:i18n` **8/8**。
- **Notes:** 相比方案 §8.8 少 2 条 —— `noSnapshot` 复用既有键（偏差 3）、`otherChapter` 改由 `m.chapter.ordinal` 承担（避免重复本地化「第 n 章」）。

### T10 — `tests/chapter-qa.test.ts` + `package.json` 脚本
- **Status:** done
- **Outcome:** 新增 `tests/chapter-qa.test.ts`（**27/27 通过**）：解析器宽容/严判（TC-EDGE-09/10）、引文标记切分（TC-EDGE-11/11b）、锚定三不变式（TC-UC01-02 折叠命中、TC-UC07-02 部分丢弃、TC-UC08-01/02 跨章与章外丢弃、TC-EDGE-01/02 上限与去重）、范围锁定（TC-EDGE-03 `restrictChunkIds` 锁向量路 + `targetIds` 断言、TC-EDGE-04 空集合短路且不发起 FTS/embedding）、上下文截断（TC-EDGE-06）、端到端六态（TC-UC01-01 / 02-01/02/03 / 03-01/02 / 04-01/02 / 05-01 / 06-01/02 / 07-01 / EDGE-07/08）。`package.json` 新增 `test:qa` 并串入 `test:library`。
- **Notes:** 首轮 24/27 —— 三处失败同因：**内存后端 FTS 是整串子串匹配**，问题里带「是什么？」必然 0 命中（改为原文子串后全绿）；TC-UC06-02 样例按偏差 7 换成「截断点落在完整元素之后」。测试**不 import 任何 `.tsx`**（strip-types 不支持 JSX）→ 偏差 6。

### T11 — `npm run typecheck` + 全量回归
- **Status:** done
- **Outcome:** `npm run typecheck` —— 本任务文件 **0 error**（首轮 1 条自伤：`QaAnswerBody` 的 `chapter` 入参未使用，已删；剩余 3 条在 `src/features/settings/AIModelsSection.tsx`，`git status` 确认工作树未触碰该文件 → HEAD 既存）。回归：`test:library`（8 组串联，含 `test:qa`）exit 0、`test:retrieval` 21/21、`test:rag` 10/10、`test:ai` 6/6、`test:chunk` 12/12、`test:prereq` ALL PASS、`test:i18n` 8/8。行数（`wc -l`）：qa.ts 77、chapter-qa.ts 117、chapter-context.ts 126、chapter-qa-service.ts 177、ChapterQaPanel.tsx 365、qa-citations.ts 45、ChapterReaderPage.tsx 422、hybrid-search.ts 160 —— 全部 ≤700。
- **Notes:** 未做浏览器级校验（遵守 `rules/no-headless-browser-validation`）。

### T12 — 回写文档（方案状态 + roadmap + README + 本 runbook）
- **Status:** done
- **Outcome:** `docs/learn-chapter-qa-design-2026-09.md`：状态「待确认」→「已完成」；§4.3.1 `errorText` → `errorKind` + `chapterOrder`；§8 加实施期修正提示，提示词来源行改写；§12 修正 TC-UC06-02 样例；新增 **§13 实施结果与偏差**（交付文件表 + 5 项偏差 + 验证结果 + 事实核查）；变更记录 +1 行。`docs/roadmap-next-features-plan-2026-09.md` F5 第 1 条「章内提问框」标注 ✅ 已落地（含方案/runbook/单测入口）。`README.md` / `README.zh-CN.md`：`In-chapter Q&A` / 「章内提问」由 `[ ]` 改 `[x]`，统计行同步 **22/20 → 23/19**（双版一致）。
- **Notes:** 未改 `test:*` 以外的任何脚本；无存储迁移，回滚 = `git revert`。

## 收尾核对

| 项 | 结论 |
|---|---|
| 零伪造引用（展示的引用 100% 锚定成功） | ✅ `anchorQuotes` 三条不变式 + 6 项单测；锚不上即丢弃 |
| 检索范围两路同时生效（缺口 A） | ✅ `restrictChunkIds` 传 `listEmbeddingVectors(targetIds)` 并在融合前二次过滤；`[]` 短路 |
| `ai/` 不依赖 `features/` | ✅ `grep` `src/ai` 下无 `features` import；锚定经 service 注入 |
| 不写任何存储（no evidence / mastery / 记录） | ✅ `chapter-qa-service.ts` 内 `save* / append* / delete*` 命中 0 |
| 锚定唯一入口 = `evidence-anchor.locateQuote` | ✅ 全仓唯一定义在 `evidence-anchor.ts`，无第二套匹配算法 |
| i18n 双语成对 | ✅ `learn.reader.qa.*` 21 条 × 2 语言；`test:i18n` 8/8 |
| `npm run typecheck` 0 error（本任务文件） | ✅ 余 3 条为 `AIModelsSection.tsx` 的 HEAD 既存问题 |
| 全量回归不回归 | ✅ library / retrieval / rag / ai / chunk / prereq / i18n 全绿 |
| 行为变更入文档 | ✅ 方案 §13 + roadmap F5 + README 双版 + 本 runbook |
| 文件行数 ≤700 | ✅ 最大 422（`ChapterReaderPage.tsx`） |

## 变更记录

| 日期 | 变更 | 作者 |
|------|------|------|
| 2026-09-14 | 建立 runbook（T1~T12），记录 4 处实现偏差 | Agent |
| 2026-09-14 | T1~T12 全部实施完成，回填 Outcome，补「收尾核对」；偏差累计 7 项 | Agent |
