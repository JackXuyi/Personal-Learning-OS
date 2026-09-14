# 费曼式复述 + AI 差距反馈（Chapter Restatement）实施 runbook

方案：`docs/learn-feynman-restatement-design-2026-09.md`（状态 **已实施**，2026-09-14；决策 D1–D5 取推荐 A，**D6 取 B：无 AI 直接阻断 + 引导配置**）。

> 本文件随实施推进：T1–T18 已全部从 `pending` 走到 `done` 并回填 Outcome；偏离方案之处登记在「与方案的实现偏差」并已同步回写方案 §13.3。

## Goal

在章节阅读页（`ChapterReaderPage` 右栏**第 6 区**）让用户**用自己的话把这章讲一遍**，由 AI 对照本章原文给出**逐条可锚回的差距反馈**（你讲到了 / 你漏掉了 / 你讲岔了 + 下一步建议），并把这次复述**落库**、可回看、可按复述显式安排复习。

三条硬约束：

1. **零伪造引用**：`covered` / `missed` / `errors[].evidence` 的引文必须能在**本章正文**中逐字（或折叠空白后）定位，`errors[].quote` 必须能在**用户复述原文**中定位；**锚不上即丢弃**，绝不产出"近似位置"。
2. **无 AI 直接阻断（D6-B）**：`useAiReady() === false` 时输入框与提交按钮**整体禁用** + 引导条「去配置 AI →」（对齐第 4 区章内提问）；服务层在**落库之前**同语义早退，**零写入、零模型调用**。
3. **不碰掌握度**：mastery 的唯一写方仍是卷面（`applyPaperResult`）。本方案的"闭环"落在**证据流**（`EvidenceKind="restatement"`，delta=0）与**显式复习调度**（`applyKeyPointRating`）两环。

## Context

- **包 / 路径**：
  - 新增：`src/domain/restatement.ts`、`src/ai/restatement.ts`、`src/features/learn/restatement-service.ts`、`src/features/learn/reader/ChapterRestatementPanel.tsx`、`src/features/evidence-label.ts`（T10 共享映射）、`tests/restatement.test.ts`
  - 修改：`src/domain/index.ts`、`src/domain/evidence.ts`、`src/ai/pipeline-core.ts`、`src/storage/{types,memory,local}.ts`、`src/features/learn/ChapterReaderPage.tsx`、`src/features/home/HomePage.tsx`、`src/features/goals/GoalDetailPage.tsx`、`src/i18n/messages/{zh,en}.ts`、`package.json`
  - **不动**（已核实为零改动）：`src/engine/*`（复用既有 `applyKeyPointRating`）、`src/stores/useLoopStore.ts`（阅读页既有先例就是直连 storage，见方案 §4.4）、`src/features/learn/reader/ChapterQaPanel.tsx`（不为一处复用去动已在线的第 4 区）、`src/storage/tauri.ts`（`extends LocalStorageAdapter` 自动继承新方法）
- **已读文档**：`docs/learn-feynman-restatement-design-2026-09.md`、`docs/learn-chapter-qa-design-2026-09.md`（最近邻先例：六态状态机 / 锚定护栏 / 面板内联反馈）、`docs/learner-profile-design-2026-09.md`（可选参数零回归 + 防注入）、`docs/roadmap-next-features-plan-2026-09.md` §F5、`docs/knowledge-sqlite-prereq-plan-design-2026-09.md`（若将来要迁 SQLite 的既有路径）
- **适用规范**：`rules/layer-import-boundaries`（`ai/` 不得 import `features/`；服务层文案一律由 UI 走 i18n）、`rules/pre-task-technical-design`、`rules/commit-conventions`、`rules/no-headless-browser-validation`（`data-testid` 写齐但不跑 Playwright）
- **验收命令**：`npm run typecheck`、`npm run test:restatement`（新增）、`npm run test:library`（含新脚本）、`npm run test:qa`、`npm run test:profile`、`npm run test:eta`、`npm run test:advice`、`npm run test:i18n`

### 开工时的代码事实（已核实）

| 事实 | 值 / 位置 |
|---|---|
| 右栏现状 **5 区** | `ChapterReaderPage.tsx:242-342`；第 4 区（章内提问）在 `:312-319` → 第 6 区插在它之后、Evidence 之前 |
| 章正文唯一取法 | `ChapterReaderPage.tsx:198` `doc.textPreview?.slice(chapter.contentRef.start, chapter.contentRef.end) ?? ""` |
| 高亮机制既有 | `ChapterReaderPage.tsx:28/122-137`（`highlightRange` + `HIGHLIGHT_WINDOW` 两帧）；`features/learn/highlight.ts:21/39` |
| 调度写回完整先例 | `ChapterReaderPage.tsx:157-176` `markReviewed()`：读 state → `applyKeyPointRating` → `saveLearnerState` → `appendEvidence({kind:"review",verdict:"good",delta:0})` → `refresh(m)` |
| `Chapter` 字段 | `domain/chapter.ts:64-85`：`contentRef{start,end}`（**文档绝对偏移**）、`keyPoints: string[]`、`keyPointRefs?: KeyPointRef[]`（start/end 亦为绝对偏移） |
| 锚定工具 | `features/learn/evidence-anchor.ts:75` `locateQuote(body, quote)` → **相对 body** 的 `[start,end)`（两档：精确 → 折叠空白）；`:108` `anchorToDocument`；`:14` `MAX_QUOTE_CHARS=2000` |
| 提示词常量集中地 | `ai/pipeline-core.ts:30-66` `PIPELINE_LIMITS`（`chapterBlockMaxChars: 12_000`、`keyPointMergeMax: 8`、`keyPointMaxChars: 60`、`keyPointQuoteMaxChars: 200`）；`:69` `TEMPERATURE`（`grade: 0.1`） |
| AI 层可直接复刻的先例 | `ai/chapter-qa.ts:88-124`：`parseChapterQaAnswer`（宽容取值 + 严判）、`answerChapterQuestion`（`chatJson(provider, messages, TEMPERATURE.grade)`） |
| 画像块可复用 | `ai/learner-context.ts`：`buildLearnerContextBlock(profile?)` + `LEARNER_CONTEXT_LIMITS`（剥 ``` / 去控制字符 / 截断 / 免责声明） |
| 服务层只产分类的先例 | `domain/qa.ts:36-61` `ChapterAnswerStatus` 六态 + `ChapterQaErrorKind` |
| ⚠️ `EvidenceKind` 仅两种 | `domain/evidence.ts:16` `"assessment" \| "review"`；两处消费见下 |
| ⚠️ G2 消费点 1（**会 typecheck 报错**） | `features/home/HomePage.tsx:360-362` `function evidenceActionLabel(kind: "assessment" \| "review", m)` —— 窄字面量参数 |
| ⚠️ G2 消费点 2（**会静默错标**） | `features/goals/GoalDetailPage.tsx:470` `m.units.action[e.kind === "assessment" ? "assessment" : "review-points"]` —— 内联三元，新增 kind 会被显示成「复习要点」 |
| `units.action` 键表 | `i18n/messages/zh.ts:88-99`（现 10 键，**无** `restatement`） |
| `applyKeyPointRating` 不改掌握度 | `engine/learner-model.ts:219-239`：只写 `confidence` / `lastReviewedAt` / `nextReviewAt` |
| mastery 唯一写方 + 护栏 | `engine/quiz-engine.ts:609-652` `gradeAndApply` → `applyPaperResult`；`:621` `if (ch.score === undefined) continue;`（**无客观分的章不回写**）；`:692-722` `mergeSubjectiveGrades` 注释「不触碰 perChapter / 不回写 learnerState」 |
| 既有主观批改（本方案**不调用**） | `ai/pipelines.ts:343-432` `SubjectiveGradeItem` / `buildGradeMessages` / `gradeSubjectiveWithAi` |
| 存储三处落地模式 | `storage/types.ts:156-160`（interface）、`storage/memory.ts`、`storage/local.ts:42/90/93`（`KEY_PROFILE` 常量 → 构造函数 load → `persist()`）；`storage/tauri.ts` 继承 → **零迁移** |
| AI 就绪响应式 | `hooks/useAiReady.ts:18` `useAiReady()`（订阅 `useSettingsStore.providerReady`） |
| **D6-B 直接先例** | `features/learn/reader/ChapterQaPanel.tsx:54` `canAsk = aiReady && …`；`:79` `placeholder={aiReady ? t.placeholder : t.notReady}`；`:80` `disabled={!aiReady \|\| asking}`；`:130-136` `!aiReady` → `QaNotice(kind="info", text=t.notReady, action={label:t.goConfigure, to:"/settings"})`；`QaNotice` 定义在 `:153`（**局部函数，不抽共享组件**） |
| 同族文案先例 | `i18n/messages/zh.ts:1219-1220`（qa `notReady` / `goConfigure`）、`:1268`/`:1276`（概念层同款） |
| i18n 落点 | `i18n/messages/zh.ts:1179-1234` `learn.reader` 区，`qa.*` 在 `:1211-1233` → 新块紧邻其后 |
| `test:library` 开工现状 | **11 组串联**：`anchor → advice → keypoint → preview → overview → enrich → profile → resume → card → aimap → qa`；脚本形式统一 `node --experimental-strip-types --no-warnings --import ./tests/register-loader.mjs tests/*.test.ts` |
| 可复用 UI 原语 | `components/primitives.tsx`：`Card` `Section` `SectionTitle` `Bar` `EvidenceRow` `SegmentedTabs` `ActionCard` `Stat` `KnowledgeRow` `BandBadge`；`components/ui/confirm-dialog.tsx` → `ConfirmDialog` |

### 既有工程约束（会卡住单测）

1. `node --experimental-strip-types` **不支持 JSX 与 TS 参数属性** → 锚定 / 覆盖率 / 档位映射 / 解析等纯逻辑**必须放 `.ts`**（不得留在 `.tsx`）；错误类**不得**写 `constructor(readonly kind: K)`，改**显式字段赋值**。
2. `src/i18n` **无 React 之外的消息访问器** → 服务层只允许产出 `RestatementStatus` / `RestatementErrorKind` 分类，文案一律由面板 `useI18n` 映射。
3. `ai/` 不得 import `features/`，也不得 import `pipelines.ts`（无环、无 TDZ）→ **锚定必须在 `features/` 层**；`ai/restatement.ts` 只产 `quotes`，**绝不产偏移量**。
4. 服务层不 import React：`restatement-service.ts` 纯编排，AI 就绪判定用**注入的 provider**（`input.provider ?? buildActiveProvider()`），不在服务层读 zustand 状态。

### ⚠️ 工具坑（本次实际踩到，后续须避免）

**同一文件多处修改必须串行 Edit**：同一条消息里对同一文件发多个 Edit 会竞态 —— 各自读盘快照后整文件回写，后者覆盖前者。本次 `src/i18n/messages/zh.ts`、`src/storage/{types,memory,local}.ts` 均因此丢失过若干条 Edit（typecheck 才暴露），需逐条重做。跨文件并行安全。

### 与方案的实现偏差（已回填方案 §13.3）

1. **`evidenceActionKey` 落点变更**：方案 §8.13 建议 `features/learn/evidence-label.ts` → 实际落 **`src/features/evidence-label.ts`**。理由：该映射被 HomePage 与 GoalDetailPage 两处消费，放进 `features/learn/` 会让 `home → learn` 形成不必要的子域耦合；根目录与既有跨域共享文件 `features/units.ts` 同层。`domain/evidence.ts` 注释已同步为实际路径。
2. **`error` 分支的 `record` 语义按 §8.9 伪代码实现**：方案 §4.3.1 类型注释原写「`no-ai` / `error` 时恒为 `undefined`」，与 §8.9 伪代码（`catch` 返回 `record`）、§5.2（「记录仍保留（无 feedback）」）、`TC-UC06-01`（「记录仍在」）相互矛盾。实际口径：**只有"落库之前"的失败**（`too-short` / `too-long` / `generic` / `no-ai`）才 `record === undefined`；AI 调用 / 解析失败发生在落库之后 → 返回 `record`（文本已入库存，可重试）。§4.3.1 注释已改写为与此一致。

### 实现中额外修正的 2 处（非方案偏差，属缺陷）

3. **`anchorRestatement` 补 `point` 空值判定**：原实现只校验 `quote`，单测 `anchorRestatement 空 point / 空 quote 一律丢弃` 暴露（期望 1 条实得 2 条）。`TC-EDGE-06` 明确要求锚定函数同样丢弃空 `point` → 已补（与 `parseRestatementDraft` 同口径的双层护栏）。
4. **面板 `no-body` testid 去重**：提交前提示条与 `FeedbackBody` 的 `no-body` 分支曾共用 `chapter-restatement-notice-nobody`；后者已去 testid（该分支实际不可达：`noBody` 时 `canCheck === false`）。

## Tasks

> 状态取值：`pending` / `in_progress` / `done`。

### T1 — `domain/restatement.ts`：类型 + `RESTATEMENT_LIMITS`
- **Status:** done
- **Outcome:** 新增 `Restatement` / `RestatementFeedback` / `RestatementPoint` / `RestatementMisread` / `RestatementStatus`（五态）/ `RestatementErrorKind`（六类）/ `RestatementResult`；`RESTATEMENT_LIMITS = { minChars: 20, maxChars: 2000 }`。零依赖（仅 `import type { SelfRating }`）。

### T2 — `domain/index.ts` 导出 + `domain/evidence.ts` 加 `"restatement"`
- **Status:** done
- **Outcome:** `export * from "./restatement"`；`EvidenceKind = "assessment" | "review" | "restatement"`，kind 注释补 restatement 语义与「跨切面扩展点」警示。

### T3 — `storage/{types,memory,local}.ts`：`listRestatements` / `saveRestatement` / `deleteRestatement`
- **Status:** done
- **Outcome:** interface + memory（`protected restatements: Map`，按 `createdAt` 降序过滤本章）+ local（新 key `plos.restatements`，三处落地：常量 → constructor load → `persist()`；两个写方法 override 后 `persist()`）。`tauri.ts` **零改动**（继承）。
- **验收:** `TC-EDGE-10` localStorage 跨实例往返回读通过。

### T4 — `ai/pipeline-core.ts`：新增 6 项复述上限
- **Status:** done
- **Outcome:** `restatementMaxPoints: 8` / `restatementMaxErrors: 4` / `restatementPointMaxChars: 60` / `restatementQuoteMaxChars: 200` / `restatementAdviceMaxChars: 120` / `restatementBodyChars: 12_000`。

### T5 — `ai/restatement.ts`：`RESTATEMENT_SYSTEM` + `parseRestatementDraft` + `extractRestatementFeedback`
- **Status:** done
- **Outcome:** `buildRestatementMessages`（要点截断 `keyPointMergeMax`、正文截断 `restatementBodyChars`、画像块可选追加）+ `parseRestatementDraft`（宽容取值：`covered`/`missed` 逐条 point+quote 非空才留、**合计**截断；`errors` 三字段齐全才留；`advice` 截断；`!isRecord` → 全空草稿、**绝不抛错**）+ `extractRestatementFeedback`（`TEMPERATURE.grade`）。只产 `quotes`，**零偏移量**。
- **验收:** `TC-EDGE-04/05/06`、`TC-REG-01/02`。

### T6 — `features/learn/restatement-service.ts`：编排（**D6-B：先判就绪 → 再落库**）
- **Status:** done
- **Outcome:** `checkRestatement` 六步：长度校验 → 取 doc/chapter → `no-body` → **`provider.isConfigured()` 早退（不返回 record、零写入）** → 落文本 → 调 AI → 锚定 → 覆盖率 → 回填 `feedback`。`partial`（一条都没锚上）/ `ok`（含 `rating`）分支；catch 返回 `classifyRestatementError`（照抄 `classifyQaError`）。
- **验收:** `TC-UC04-01`（`no-body` 零落库）、`TC-UC05-01/02`（`no-ai` 零落库 + 零调用）、`TC-UC06-01`、`TC-UC07-01`。

### T7 — `anchorRestatement` 双目标锚定 + `coverageOf` + `ratingForCoverage`（纯函数）
- **Status:** done
- **Outcome:** `anchorRestatement(draft, body, restatementText)`：covered/missed/evidence → `locateQuote(body)`（章内相对偏移）；errors.quote → `locateQuote(restatementText)`；**任一锚不上即丢该条**。`coverageOf` 分母 0 → `undefined`。`RESTATEMENT_COVERAGE_RATING = { good: 0.8, hard: 0.5 }`；`ratingForCoverage(undefined) = "forget"`（保守：无法核对时把复习安排得更近）。
- **验收:** `TC-UC01-01`、`TC-UC02-01/02`、`TC-UC03-01/02/03`、`TC-EDGE-07/08`。

### T8 — `scheduleRestatementReview` 调度写回 + `appendEvidence`
- **Status:** done
- **Outcome:** 读 state → `applyKeyPointRating` → `saveLearnerState` → `appendEvidence({kind:"restatement", verdict:rating, delta:0, sourceId?})`（失败不阻塞）。**不动 mastery / attempts / correctCount**。
- **验收:** `TC-UC10-01`（mastery 0.42 → 0.42、attempts 3 → 3）、`TC-UC10-02`（evidence kind/delta/sourceId）。

### T9 — `listChapterRestatements` / `removeRestatement` 只读包装
- **Status:** done
- **Outcome:** 两函数均带 `store: StorageAdapter = storage` 默认参数（避免 UI 直接摸 storage）。
- **验收:** `TC-UC08-01/02`、`TC-UC09-01`、`TC-UC05-03`。

### T10 — G2 修复：`units.action.restatement` + 共享 `evidenceActionKey`
- **Status:** done
- **Outcome:** 新增 `src/features/evidence-label.ts::evidenceActionKey`（穷尽 switch）；`HomePage.tsx` 参数类型由窄字面量放宽为 `EvidenceKind`；`GoalDetailPage.tsx:470` 内联三元换为同一 helper。**两处都改**（只改会报错的那处会漏掉静默错标）。
- **验收:** `TC-REG-03`；`typecheck` 确认两页均通过。
- **副作用（有意）**：HomePage 的 review 证据行文案由 `units.action.review`（"复习"）统一为 `units.action["review-points"]`（"复习要点"），与 GoalDetailPage 一致。

### T11 — i18n `learn.reader.restatement.*`（zh / en 逐键对齐）
- **Status:** done
- **Outcome:** `units.action.restatement` + `learn.reader.restatement.*`（27 键：eyebrow / placeholder / check / checking / tooShort / tooLong / footnote / notReady / goConfigure / noBody / coveredTitle / missedTitle / errorsTitle / adviceTitle / coverage / truncated / unanchored / retry / resubmit / clear / schedule / scheduled / scheduleHint / historyTitle / historyEmpty / historyDelete / deleteConfirmTitle / deleteConfirmDesc / errParse / errNotConfigured / errFetch / errGeneric），en 逐键镜像。
- **验收:** `npm run test:i18n` exit=0。

### T12 — `ChapterRestatementPanel.tsx`：**阻断态** + 四态面板 + 三组反馈 + 历史
- **Status:** done
- **Outcome:** `useAiReady()` 阻断态（`blocked = !aiReady || noBody`；`placeholder` 切换；`disabled`；内联 `RestatementNotice` + 「去配置 AI →」跳 `/settings`）；三组反馈（covered/missed 可点回正文、errors 展示复述原话 + 更正 + 依据）；本地算覆盖率；`[按这次复述安排复习]` / `[重试]` / `[清空重写]`；`往次复述` 折叠（展开回看 + 二次确认删除）；章切换重置本地态（UC-11）；`aliveRef` 丢弃迟到 setState；`data-testid` 齐备（`rules/no-headless-browser-validation`）。
- **注:** `RestatementNotice` 就地实现（不抽共享组件，沿项目 5 处面板各自内联的现状）；`errorText` 映射在 `FeedbackBody` 内（唯一映射点）。

### T13 — `ChapterReaderPage.tsx`：插入第 6 区 + 头部注释「五区」→「六区」
- **Status:** done
- **Outcome:** `<ChapterRestatementPanel doc chapter onHighlight={(s,e)=>setHighlight({start:s,end:e})} />` 插在第 4 区之后、Evidence 之前；头部布局注释与 JSX 注释同步为「六区」。

### T14 — `tests/restatement.test.ts` 单测（含 **`no-ai` 零落库**断言）
- **Status:** done
- **Outcome:** **34 项 ALL PASS**。覆盖 TC-UC01~11、TC-EDGE-01~10、TC-REG-01~03 + 2 项 `anchorRestatement` 直测。关键断言：`CountingStorage.saves === 0`（`no-ai` / `no-body`）、`calls.chat === 0`、偏移可切回 verbatim、覆盖率/档位边界、localStorage 往返。
- **验收:** `npm run test:restatement` → `ALL PASS`。

### T15 — `package.json`：`test:restatement` + 串入 `test:library` 末尾
- **Status:** done
- **Outcome:** `test:restatement` 脚本形式与既有 11 条一致（`--experimental-strip-types --no-warnings --import ./tests/register-loader.mjs`）；`test:library` 末尾追加 `&& npm run test:restatement` → **12 组**。

### T16 — `typecheck` + 全链回归
- **Status:** done
- **Outcome:** `typecheck` = **3 条既存 `AIModelsSection` error，0 新增**；`test:library`（含新脚本）/ `test:qa` / `test:profile` / `test:eta` / `test:advice` / `test:i18n` / `test:rag` / `test:ai` / `test:graph` **全部 exit=0**。

### T17 — README 双语清单加「费曼式复述」条目 + 统计行重算
- **Status:** done
- **Outcome:** `[ ] 费曼式复述 + AI 差距反馈 P1` → `[x]` 并补描述（三组差距 / 可点回原文 / 可安排复习不动掌握度）；统计行 **26/18 → 27/17**（两版同步）。复核：`grep -c '^- \[x\] '` / `'^- \[ \] '` 双语一致；`### ` 标题数均 29。

### T18 — roadmap §F5 第 3 条状态 + 方案置「已实施」+ 方案 §13 实施结果
- **Status:** done
- **Outcome:** roadmap §F5 第 3 条标 ✅（含「进入掌握度闭环」表述修正 = D3-A 与 D6-B 说明）；候选表 F5 标 `P1 ◐`（提问 + 复述已实施）；方案状态置「已实施」+ 新增 §13（交付物 / 验收 / 2 条偏差 / 2 处实现修正）；§4.3.1 `record` 语义收回；变更记录追加一行。

> 收工后按 `rules/commit-conventions` **分层本地提交**（**7 组**：domain → ai → storage → features-service → features-UI/i18n → tests → docs），**不 push**。实际落地见文末收工清单（含 7 条 commit 短哈希）。

## 链路核查（新增存储/服务层后必跑）

1. `grep -rnE "listRestatements|saveRestatement|deleteRestatement" src/ | grep -v '^src/storage/'` → ✅ 命中 `features/learn/restatement-service.ts:91/117/248/256`（编排 + 只读包装）。**未退化为"只命中 storage/*"**。
2. 顺数据流验证每跳有真实调用者 → ✅ `ChapterRestatementPanel` → `checkRestatement`（面板 `:105`）→ `extractRestatementFeedback` → `anchorRestatement` → `saveRestatement` → `feedback` 回填；`ChapterReaderPage` →（`onHighlight`）→ `setHighlight` → 既有 `highlightRange`。
3. 反向核查新编排函数被 UI **真实调用**（而非仅单测）→ ✅ `checkRestatement`(:105) / `scheduleRestatementReview`(:125) / `listChapterRestatements`(:84) / `removeRestatement`(:139) ← `ChapterRestatementPanel`；`evidenceActionKey` ← `HomePage.tsx:365` **且** `GoalDetailPage.tsx:471`（两处都改）。

## 收工核对清单

- [x] `npm run typecheck` 0 新增 error（`AIModelsSection.tsx` 的 3 条既存债**不计入、也未顺手改**）
- [x] `npm run test:restatement` 全绿（34 项）
- [x] `npm run test:library`（含新脚本，12 组）/ `test:qa` / `test:profile` / `test:eta` / `test:advice` / `test:i18n` / `test:rag` / `test:ai` / `test:graph` 全 `exit=0`
- [x] §11.3 零回归硬断言通过（不传 `learner` 时提示词**逐字节相同**，`TC-REG-01`）
- [x] **D6-B 双查**：服务层 `no-ai` 时 `saveRestatement` 零调用（`TC-UC05-01/02` 单测）；面板 `aiReady === false` 时输入/提交 `disabled` + 引导条跳 `/settings`
- [x] **G2 双查**：`HomePage.tsx:365` 参数类型已放宽 + `GoalDetailPage.tsx:471` 内联三元已换 `evidenceActionKey`（两处都改）
- [x] 链路核查三步通过（第 1 步不得只命中 `storage/*`）
- [x] 偏差已回填本文件「与方案的实现偏差」并同步方案 §13.3
- [x] README 双语 `[x]` / `[ ]` 计数复核一致（27 / 17；两版 `### ` 标题数均 29）
- [x] 分层本地提交，不 push；提交后 `git status --short` 为空
      - 第 1 组 `28de66d` feat(domain)：领域类型 + `EvidenceKind` 扩展
      - 第 2 组 `bc49272` feat(ai)：提示词 + 宽容解析 + 6 条限额
      - 第 3 组 `f2a6b6e` feat(storage)：三方法四后端
      - 第 4 组 `aacb3a7` feat(features)：服务层双向锚定 / 覆盖率 / 复习调度
      - 第 5 组 `a59cf63` feat(ui)：第 6 区面板 + G2 跨切面修复 + zh/en 文案
      - 第 6 组 `fd24563` test(learn)：34 项单测 + `test:restatement` 脚本
      - 第 7 组：docs（方案 §13 / 本 runbook / roadmap §F5 / README 双语 27·17），**即含本文件**
      - 提交纪律：逐组 `git add <精确路径> && git commit` 串联，**绝无裸 `git commit -a`**；每组后 `git diff --cached --name-only` 均为空；全程**本地**，`origin/main` 未动。
