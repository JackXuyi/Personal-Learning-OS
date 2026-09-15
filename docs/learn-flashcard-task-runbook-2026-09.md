# 由要点卡一键生成自测卡（Flashcards from Key Points）实施 runbook

方案：`docs/learn-flashcard-design-2026-09.md`（状态 **已实施**；2026-09-15 定案 **D1–D6 全部取推荐 A**，含子决策 D2-b 取 A）。

> **T1–T14 已全部 done（2026-09-15）**，逐任务 Outcome 已回填；8 处实现偏差与 2 处实现期缺陷登记在下方「实施偏差与修正」，并已回写方案 §14.3 / §14.4。

## Goal

把章要点（带原文出处者）**一键**收进自测队列，接入**卡级间隔重复**：每张卡按四档自评（忘记/困难/记得/轻松）独立推进 `nextReviewAt`（1/2/4/7 天），到期队列先到期、后新卡，单次会话上限 20 张。**零 AI 依赖**，**不碰掌握度**。

三条硬约束（§13 定案）：

1. **零伪造引用（D2-b=A）**：成卡充要条件 = 要点有原文出处（`quote` 非空且 `end > start`）。无出处的要点**不成卡**，UI 如实提示去跑「AI 分析要点」；绝不生成「正面=要点、背面=同句」的空卡。
2. **零 AI 依赖（D2=A）**：不调用 `provider.chat`、不 import `src/ai/*`。卡面 100% 从既有 `Chapter.keyPoints` / `keyPointRefs` 派生；无模型时全链路可用。
3. **不碰掌握度（D1/D6=A）**：mastery 唯一写方仍是卷面 `applyPaperResult`。卡片评分走独立 `applyCardRating`（只写 `CardState`），**绝不经过 `useLoopStore.submitAnswer`**（其 `applyRating` 会移动 mastery）；`useLoopStore.ts` 在本次 diff 中保持**零改动**（`TC-REG-01`）。

## Context

- **新增**：`src/domain/flashcard.ts`、`src/engine/flashcard-engine.ts`、`src/features/learn/flashcard-service.ts`、`src/features/study/session-mode.ts`、`tests/flashcard.test.ts`
- **修改**：`src/domain/index.ts`、`src/domain/evidence.ts`、`src/storage/{types,memory,local}.ts`、`src/features/evidence-label.ts`、`src/features/study/ReviewSession.tsx`、`src/features/learn/ChapterReaderPage.tsx`、`src/features/learn/detail/KnowledgeTab.tsx`、`src/i18n/messages/{zh,en}.ts`、`package.json`
- **不动**（已核实）：`src/engine/learner-model.ts`（只读 `nextReviewInDays`）、`src/engine/learning-planner.ts`（D5-A：不纳入卡到期）、`src/stores/useLoopStore.ts`（D6-A：零改动）、`src/storage/tauri.ts`（继承自动获得新方法）、`src/ai/**`（零 AI）、`reader/ChapterQaPanel.tsx` / `reader/ChapterRestatementPanel.tsx`（不动已在线面板）
- **已读文档**：方案本体、`docs/learn-feynman-restatement-design-2026-09.md`（决策点体例 +「只落调度状态」先例 `plos.restatements`）、`docs/roadmap-next-features-plan-2026-09.md` §F5、`docs/ui-workbench-plan-2026-09.md`（右栏分区）
- **适用规范**：`rules/pre-task-technical-design`、`rules/layer-import-boundaries`、`rules/commit-conventions`、`rules/no-headless-browser-validation`（`data-testid` 写齐但不跑 Playwright）、`rules/docs-task-runbook`
- **验收命令**：`npm run typecheck`、`npm run test:flashcard`（新增）、`npm run test:library`（13 组）、`npm run test:qa`、`npm run test:restatement`、`npm run test:i18n`

### 开工时的代码事实（已核实 2026-09-15）

| 事实 | 值 / 位置 |
|---|---|
| 章要点唯一真源 | `src/domain/chapter.ts:74` `keyPoints: string[]`；`:55-62` `KeyPointRef { point; quote; start; end }`，`quote` 空串 = 定位失败；`start/end` 为 `doc.textPreview` 绝对偏移 |
| 四档间隔（只读复用） | `src/engine/learner-model.ts:28-33` `RATING_INTERVAL_DAYS = { forget:1, hard:2, good:4, easy:7 }`；`:43` `nextReviewInDays(rating)` **已导出** |
| 只调度不改掌握度的先例 / 禁用入口 | `learner-model.ts:219` `applyKeyPointRating`（只写 confidence/lastReviewedAt/nextReviewAt）；`:248` `applyRating`（**会移动 mastery，本方案禁用**） |
| ⚠️ `chapterId` 参数已被概念模式占用 | `src/features/study/ReviewSession.tsx:40-41` `chapterParam = params.get("chapterId"); const conceptMode = chapterParam !== null;` → **卡片 URL 带 `chapterId` 会误入概念分支**；解法 = 模式判定优先级（§4.4）：`cardMode = mode==="cards" && documentId≠null` **优先**，`conceptMode = !cardMode && chapterId≠null`；判定抽为 `src/features/study/session-mode.ts` 纯函数（JSX 进不了单测） |
| `/study/session` 既有入口（零回归对照） | `ChapterGraphPage.tsx:186` `?chapterId=&unit=`、`GraphView.tsx:214` `?unit=`、`CommandPalette.tsx:315` `?unit=` —— 三者均无 `mode=cards`，`TC-REG-04` 断言改前改后判定结果一致 |
| `ReviewSession` 可复用资产 | 键盘 `Space/1-4/Enter/Esc`（`:245-273`）、5s 撤销（`:276-286`）、四档按钮（`:422-434`）、`SummaryView`（`:490`）、「固定会话队列」口径（`:153-163`） |
| 入口落点 | `ChapterReaderPage.tsx:274-312`（第 3 区 `Section` 带 `action` 插槽，已有「打开本章概念图谱」先例）；`KnowledgeTab.tsx:232-265`（`keyPointRefs` 分支 + 老数据回退） |
| 证据 kind → 文案键单一真源 | `src/features/evidence-label.ts::evidenceActionKey`（穷尽 switch）。⚠️ `EvidenceKind` 加 `"card"` 后该 switch **立即 TS 报错** → 此文件必须随 domain **同一提交组**落地，保证逐提交可编译（与方案 §9 的一处分组调整，见下） |
| 存储落地模式 | `storage/{types,memory,local}.ts`：interface → memory Map/对象 → local `KEY_` 常量 + constructor load + `persist()`；新 key `plos.flashcards` **零迁移**（先例 `plos.restatements`） |
| `review` 文案块键已齐备（直接复用） | `rating.{forget,hard,good,easy}` / `askSelf` / `meetAgain(d)` / `intervalPreview` / `showRef` / `hideRef` / `undo(s)` / `nextItem` / `finishReview` / `opening` / `missingChapter` / `confirmExit` / `exit` —— 不重写 |
| `units.action` 现有键 | 无 `card`（现有 …`"retake-quiz"`、`"review-points"`、`restatement`）→ 新增 `card: "自测卡"` |
| 单章卡数上限 | `src/ai/pipeline-core.ts:54` `keyPointMergeMax: 8` → 单章卡天然 ≤ 8；会话上限另设 `FLASHCARD_SESSION_CAP = 20` |
| hash 工具 | 全仓**无** → djb2（~6 行，base36）内置于 `flashcard-engine.ts`，不新增通用工具库 |

### 既有工程约束（会卡住单测）

1. `node --experimental-strip-types` **不支持 JSX 与 TS 参数属性** → 派生 / hash / 评分 / 队列 / prune / 模式判定**必须放 `.ts`**；测试文件不得 import `.tsx`。
2. `src/i18n` **无 React 之外的消息访问器** → 服务层只产出分类（`CardCollection` 计数字段等），文案一律由 UI 侧 `useI18n` 映射。
3. 本方案零 AI：`flashcard-service.ts` **不 import `src/ai/*`**（单测 `TC-UC08-01` 断言全链路无模型调用）。
4. 服务层不 import React：只编排 engine + storage；不读 zustand UI 状态。

### ⚠️ 工具坑（历史实际踩到，实施时避免）

- **同一文件多处修改必须串行 Edit**：同一条消息里对同一文件发多个 Edit 会竞态（各自读盘快照后整文件回写、后者覆盖前者，typecheck 才暴露）。跨文件并行安全。
- **macOS 自带 grep（BSD）不支持 `\|` 交替**：`grep "a\|b"` 永远 0 命中且静默，用 `grep -E "a|b"`。

## Tasks

> 状态取值：`pending` / `in_progress` / `done`。**T1–T14 全部 done（2026-09-15）**。

### T1 — `domain/flashcard.ts` + `domain/index.ts` 导出 + `domain/evidence.ts` 加 `"card"`
- **Status:** done
- **Outcome:** 新增 `DerivedCard` / `CardState` / `CardStateMap` / `FLASHCARD_SESSION_CAP = 20`（含「卡面不落库」「零 AI」「成卡充要条件 = 有原文出处」三条不变量注释）；`EvidenceKind` 加 `"card"` 并补 kind 语义（`delta=0`、`sourceId = DerivedCard.id`、不改掌握度）。

### T2 — `engine/flashcard-engine.ts`：全部纯函数
- **Status:** done
- **Outcome:** `hashId`（djb2→base36，私有）+ `cardIdOf`（导出，供测试断言稳定 id）；`deriveChapterCards`（`cardRefOf` 三重判据 + 同章内 id 去重）；`deriveDocumentCards`；`uncardedPointCount`；`applyCardRating`（复用 `nextReviewInDays`，不碰 `LearnerState`）；`isCardDue`；`dueQueue`（到期升序 → 新卡保序，`slice(0, 20)`）；`pruneCardStates`（无变化返回原引用）；`cardStats`；**追加** `nextDueAt`（§14 偏差 4）。`engine/index.ts` 追加导出（偏差 7）。

### T3 — `storage/{types,memory,local}.ts`：`listCardStates` / `saveCardState` / `deleteCardStates`
- **Status:** done
- **Outcome:** interface 三方法（含分组注释）+ memory（`protected cardStates: CardStateMap = {}`）+ local（`KEY_CARDS = "plos.flashcards"`；constructor load；`persist()` 写入；两个写方法 override 后 `persist()`）。`deleteCardStates([])` 短路；`tauri.ts` 零改动。
- **验收:** `TC-EDGE-09`（localStorage 往返）/ `TC-EDGE-10`（空数组不触发持久化）通过。

### T4 — `features/learn/flashcard-service.ts`：编排
- **Status:** done
- **Outcome:** `collectCards`（返回 cards/queue/state/计数/`uncarded`/`pruned`/`nextDueAt`/**`scopeMissing`**）、`peekCardStats`（只读）、`readCardState`、`rateCard`（`applyCardRating` → `saveCardState` → `appendEvidence(kind="card", delta=0)`，证据失败不阻断）、`revertCard`、`resetCards`。**孤儿清理限定 scope**（§14 偏差 6）。
- **验收:** `TC-UC01-02`（零写入）、`TC-UC02-02`（mastery 逐位不变）、`TC-UC02-03/04`、`TC-UC06-02`（不误删其他章）、`TC-UC07-*`。

### T5 — `features/evidence-label.ts` 加 `"card"` 一档（G2 单一真源）
- **Status:** done
- **Outcome:** `EvidenceActionKey` 加 `"card"` + 穷尽 switch 补 `case "card"`；HomePage / GoalDetailPage 零改动（经 `evidenceActionKey` 取键，未再出现 TS7053）。**实施补充**：`units.action.card`（zh/en 各一行）必须与 domain 组同提交，否则两处 `m.units.action[key]` 索引报错（§14 偏差 2）。

### T6 — `features/study/session-mode.ts` + 卡片会话
- **Status:** done
- **Outcome:** `resolveReviewSessionMode`（`cardMode` 优先；`conceptMode = !cardMode && chapterId≠null`）；**接线改为委托**：新增 `CardSession.tsx`（正/背面 · 四档 · `Space`/`1-4`/`Enter`/`Esc` · 5s 撤销 · 汇总 · 无卡/全未到期/加载/写库失败四空态 · 全套 `data-testid`），`ReviewSession.tsx` 只加模式分发包装（原组件体更名 `SessionBody`，**零改动**，`:41` 一行未碰）。
- **验收:** `TC-REG-02`（既有入口判定不变）、`TC-REG-04`（优先级）；`data-testid` 齐备（`card-front/reveal/back/rate-*/source-jump/undo/next/exit/summary/empty-*/loading/error-storage/retry`），未跑 Playwright。

### T7 — `ChapterReaderPage.tsx` 第 3 区入口
- **Status:** done
- **Outcome:** action 区并列「自测本章 · N 张（· M 张到期）」+「打开本章概念图谱」；`peekCardStats` 只读计数（`total=0` 不渲染入口）；chips 下方补「M 条要点中 N 条暂无原文出处，未成卡」+ 去「关键知识点」链接 + 无 AI 说明。头注释「第 3 区」补入口说明。
- **验收:** `data-testid="chapter-cards-cta/count/uncarded"`。

### T8 — `KnowledgeTab.tsx` 资料级入口
- **Status:** done
- **Outcome:** 头部 action 并列「开始自测（全资料 N 张 · 到期 M）」+「AI 分析要点」；无卡时禁用；计数只读、随 `chapters.length`/`withRefs` 刷新；`data-testid="knowledge-cards-cta"`。

### T9 — `i18n/messages/{zh,en}.ts` 文案块
- **Status:** done
- **Outcome:** `units.action.card`；新增 `learn.reader.cards` 21 键（cta/dueBadge/uncarded/uncardedAll/goAnalyze/needAi/startAll/emptyNoCards/emptyNotDue/loading/title/frontLabel/backLabel/sourceJump/errStorage/retry/backToChapter/backToDoc/summaryDone/summaryEmpty/stillDue）；**复用**既有 `review.rating/askSelf/meetAgain/intervalPreview/undo/nextItem/finishReview/showRef/exit/confirmExit/missingChapter`，`review` 块零改动（§14 偏差 8）。
- **验收:** `npm run test:i18n` 8/8 通过（递归结构 + 键集 + arity 一致）。

### T10 — `tests/flashcard.test.ts` + `package.json`
- **Status:** done
- **Outcome:** 31 项断言（TC-UC01~08 / TC-EDGE-01~10 / TC-REG-01~04 + `scopeMissing` / `nextDueAt` / `resetCards([])` 补充）；`CountingStorage` 断言零写入；源码级断言「零 AI import」与「不调用 `submitAnswer`/`applyRating`/`saveLearnerState`」；`package.json` 加 `test:flashcard` 并追加为 `test:library` 第 13 组。
- **修正:** 4 处断言期望在首跑后校正（到期升序方向、`uncarded` 口径、第三张新卡、源码断言改为**调用形态**匹配以免被注释误伤）。

### T11 — `typecheck` + 全链回归
- **Status:** done
- **Outcome:** `typecheck` 仅 3 条既存 `AIModelsSection` error；`test:library`（13 组）与 qa/restatement/i18n/profile/eta/advice/rag/ai/graph/chapters **全部 exit=0**。

### T12 — 链路核查三步
- **Status:** done
- **Outcome:** ① 存储三方法的非 storage 消费方 = `flashcard-service.ts`（10 处）；② `peekCardStats`/`collectCards`/`rateCard`/`revertCard`/`resolveReviewSessionMode` 被 `CardSession` / `ChapterReaderPage` / `KnowledgeTab` / `ReviewSession` 真实调用；③ 引擎 9 个函数中 8 个被服务层直接调用（`cardIdOf` 供测试与自身使用），非仅单测覆盖。零改动核对：`useLoopStore.ts` / `learning-planner.ts` / `learner-model.ts` / `src/ai/**` / `tauri.ts` / 两个在线面板 **均不在 diff 中**。

### T13 — README 双语 + roadmap 同步
- **Status:** done
- **Outcome:** README×2 自测卡条目 `[ ]` → `[x]` + 一句话描述；统计行 27/17 → **28/16**（`grep -c` 复核两版一致，`### ` 均 29）；roadmap §F5 第 4 条标 ✅ + 三条定案要点 + **未纳入项（D1-C / D5-C）**显式记录，候选表 F5 行改为「仅笔记未做」。

### T14 — 分层本地提交（不 push）
- **Status:** done
- **Outcome:** 7 组提交按「domain（含 `evidence-label.ts` + `units.action.card`）→ engine → storage → features-service → ui/i18n → tests → docs」落地；逐组精确 `git add` + 串联 `git commit`（无裸 `git commit -a`），每组后 `git diff --cached --name-only` 为空，末组后 `git status --short` 为空；`git rev-list --count origin/main..HEAD` 记录在提交说明中，**未 push**。

### 实施偏差与修正（已回写方案 §14.3 / §14.4）

1. 接线改为「`CardSession.tsx` + 包装层委托」，`SessionBody` 零改动（§14.3-1）。
2. `units.action.card` 随 domain 组提交，才满足逐提交可编译（§14.3-2）。
3. `CardCollection` 增 `scopeMissing`；4. 引擎增 `nextDueAt`；7. `engine/index.ts` 追加导出；8. `review` 块不加 `titleCards`。
4. **`pruneCardStates` 限定 scope（最重要的一处修正）**：否则打开 A 章的卡片会话会删掉 B 章的进度（§14.3-6，`TC-UC06-02` 断言）。
5. `CardSession` 汇总态：初稿的「`Set` + 模块级可变 Map」有跨会话串味缺陷，改为组件内 `Map`；`Card` 不支持 `data-testid`（改用包裹 `div`）（§14.4-1）。
6. `uncardedPointCount` 口径：分母 = 有要点文本的条数；重复文本各算一条且都算「已成卡」（§14.4-2）。

## 收工清单

- [x] T1–T13 全部 done，Outcome 已回填
- [x] `typecheck` 0 新增 error（仅 3 条既存 `AIModelsSection`）；`test:flashcard` 31 项 ALL PASS；`test:library` 13 组 exit=0
- [x] 硬断言 ①未评分路径零写入 ②评分后 mastery 逐位不变 在测试中显式存在
- [x] `useLoopStore.ts` / `learning-planner.ts` / `learner-model.ts` / `src/ai/**` / `tauri.ts` 在 diff 中零改动（`git diff --name-only` 核对）
- [x] 链路核查三步通过（T12）
- [x] 分层本地提交完成（7 组，见下表），**不 push**，末组后 `git status --short` 为空

### 提交分组与短哈希（本地 7 组）

| 组 | 内容 | 短哈希 |
|---|---|---|
| 1 | `feat(domain)` 领域类型 + `EvidenceKind="card"` + `evidence-label` + `units.action.card` | `da03c46` |
| 2 | `feat(engine)` 自测卡引擎纯函数 | `60938dd` |
| 3 | `feat(storage)` 卡级调度状态三方法 | `aee2b59` |
| 4 | `feat(features)` 服务层（派生 / 评分 / scope 限定孤儿清理） | `f2c99d7` |
| 5 | `feat(ui)` 卡片会话 + `session-mode` + 两处入口 | `0a17d55` |
| 6 | `test(learn)` 31 项单测 + `test:flashcard` | `f465327` |
| 7 | `docs` 方案 §13/§14 + 本 runbook + roadmap §F5 + README×2 | 本提交 |

> 逐组核对：每组 `git add` 精确路径 + 串联 `git commit`；每组后 `git diff --cached --name-only` 为空；末组后 `git status --short` 为空。
> ⚠️ 与方案 §9 分组的两处调整：`features/evidence-label.ts` + `units.action.card` 提前并入组 1（`EvidenceKind` 加成员后穷尽 switch 与 `units.action` 索引会 TS 报错，同组才逐提交可编译）；`i18n/messages/{zh,en}.ts` 因此整文件落在组 1（`learn.reader.cards` 文案块随文件同行），组 5 只剩 UI 组件。

## 变更记录

| 日期 | 变更 | 作者 |
|------|------|------|
| 2026-09-15 | 初稿（D1–D6 定案后随方案同步产出）；登记 §4.4 `chapterId` 参数冲突解法与 T5 提交分组调整 | Agent |
| 2026-09-15 | **实施完成**：T1–T14 全部 done 并回填 Outcome；登记 8 处偏差 / 2 处实现缺陷；收工清单全部勾选 | Agent |
