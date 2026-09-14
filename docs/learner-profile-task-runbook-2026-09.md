# 学习者画像（自评水平 / 每周时间预算 / 学习偏好 + 简历导入）实施 runbook

方案：`docs/learner-profile-design-2026-09.md`（状态 **已实施**，决策 D1–D6 全部拍板，D4/D5/D6 按推荐 A）。

> 本文件已收工：T1–T18 全部 `done`，验收全绿。实施结果与偏差亦回填方案 §14。

## Goal

在 `/learner` 让用户声明**自评水平（level）/ 每周时间预算（weeklyMinutes）/ 学习偏好（depth + style）/ 背景摘要（background）**，并支持**导入简历**（PDF 或粘贴）由 AI 解析出「背景摘要 + 水平建议值」，经用户确认后写入。

三条硬约束：

1. **每一项都有可观察的消费点**（否则就是「填了没用」的假个性化）：① 无掌握度证据的章，出卷难度带随 `level` 变化；② `/plan` 与目标详情显示「预计完成日期」并与 `deadlineAt` 对比；③ AI 出题与章内提问提示词注入背景块。
2. **零回归**：未填写画像的用户，既有行为**逐字节/逐项不变**（靠「新增可选参数 + 默认恒等」，见 §11.3 三条硬断言）。
3. **隐私**：简历原文不落库、发送前过 `maskPii` 代码层脱敏、UI 明示云端 provider 会收到简历。

## Context

- **包 / 路径**：
  - 新增：`src/engine/profile-band.ts`、`src/features/profile/{profile-service,pii-mask,resume-import}.ts`、`src/ai/{resume-pipeline,learner-context}.ts`、`src/features/profile/{LearnerProfileCard,ResumeImportDialog}.tsx`、`tests/learner-profile.test.ts`、`tests/resume-parse.test.ts`
  - 修改：`src/domain/learner.ts`、`src/engine/{quiz-engine,learning-planner,loop,index}.ts`、`src/features/learn/paper-advice.ts`、`src/features/learn/detail/PapersTab.tsx`、`src/features/plan/chapter-action.ts`、`src/storage/{types,memory,local}.ts`、`src/stores/useLoopStore.ts`、`src/ai/{pipelines,chapter-qa}.ts`、`src/features/quiz/paper-flow.ts`、`src/features/learn/chapter-qa-service.ts`、`src/features/learner/LearnerPage.tsx`、`src/features/plan/PlanPage.tsx`、`src/features/goals/GoalDetailPage.tsx`、`src/i18n/messages/{zh,en}.ts`、`package.json`
- **已读文档**：`README.md` / `README.zh-CN.md`、`AGENTS.md`、`docs/learner-profile-design-2026-09.md`、`docs/roadmap-next-features-plan-2026-09.md`、`docs/business-flow-end-to-end-2026-09.md`、`docs/import-ai-enrich-design-2026-09.md`（AI 管道文件组织先例）、`docs/learn-chapter-qa-design-2026-09.md`（链路 + 护栏先例）、`skills/docs-task-runbook/SKILL.md`
- **适用规范**：`rules/layer-import-boundaries`（`domain/engine/ai` 不得 import React/`features/`；持久化只经 `storage/`）、`rules/code-structure-and-dependencies`（≤700 行 / 依赖单向）、`rules/engineering-code-style`（文案一律 i18n、服务层不产文案）、`rules/no-headless-browser-validation`（不自起浏览器）、`rules/docs-task-runbook`（本文件）
- **验收命令**：`npm run typecheck`、`npm run test:profile`（新增）、`npm run test:resume`（新增）、`npm run test:library`、`npm run test:eta`、`npm run test:advice`、`npm run test:rag`、`npm run test:ai`、`npm run test:graph`、`npm run test:i18n`

### 开工时的代码事实（已核实）

| 事实 | 值 / 位置 |
|---|---|
| `LearnerState` 无画像字段 | `domain/learner.ts:18-46`（只有 `byUnit` 掌握度） |
| `LearnerPage` 纯只读 | `features/learner/LearnerPage.tsx:32-63`（无输入控件） |
| 出卷难度带只看 mastery | `engine/quiz-engine.ts:36-41` `bandOfMastery`；四处调用 `:226 :249 :268 :315` |
| 展示侧同口径要求 | `features/learn/paper-advice.ts:54 :86`（文件头注释要求复用 `bandOfMastery`） |
| 计划排序 cls 语义 | `engine/learning-planner.ts:273` `buildChapterPlan`；排序 `:299-307`；cls 见 `:154`（0 重学弱章 > 1 补考 > 2 复习要点 > 3 测已学章 > 4 到期复习 > 5 推进未学章） |
| 耗时估计硬编码 350 | `features/plan/chapter-action.ts:102-116`（`:113` `chars/350`，clamp 5–40） |
| **掌握度证据判据** | `engine/learner-model.ts:219` `applyKeyPointRating` **不移动** mastery/attempts；`:248` `applyRating` **移动 mastery 不增 attempts** → 「有证据」必须 `mastery > 0 \|\| attempts > 0`，**只看 attempts 会误判**（TC-UC02-02） |
| 存储层无 profile 方法 | `storage/types.ts:151-153`；`local.ts:27-42` 15 个 `plos.*` key、`:104` `persist()` 全量回写 |
| `tauri` 继承 localStorage | `storage/tauri.ts:1-17`（LearnerState / Goal / Evidence 同层先例）→ **profile 同样零迁移** |
| store 装配点 | `stores/useLoopStore.ts:19` `export const storage`；`:79-103` `refresh()`；`:110-113` `saveGoal` |
| 快照 | `engine/loop.ts:204-222` `ChapterLoopSnapshot`；`:231` `runChapterLoop(storage, m, goalId?)` |
| AI provider 唯一装配点 | `stores/useSettingsStore.ts:306` `buildActiveProvider()`（UI/服务层取用后以参数注入 `ai/`） |
| ⚠️ 命名冲突 | `ai/pipelines.ts:187-191` `buildQuizGenMessages(chapters, text, **profile**)` 的 `profile` 是**题目清单**；新参数一律叫 `learner`，**不得改名** |
| 简历 PDF 抽取可复用 | `features/learn/import/pdf.ts:56` `extractPdfText`；`PdfNoTextError` `:31` / `PdfTooLargeError` `:39`；护栏 `LIMITS.localPdfBytes=30MB`、`pdfMaxPages=500` |
| 路由 | `App.tsx:57` `<Route path="learner" …>`（D6-A：**不改**） |

### 既有工程约束（会卡住单测）

1. `node --experimental-strip-types` **不支持 JSX 与 TS 参数属性** → 想被单测覆盖的纯逻辑必须放 **`.ts`**（不得 `.tsx`）；错误类**不得**写 `constructor(readonly kind: …)`，改显式字段赋值。
2. `src/i18n` 无 React 之外的消息访问器 → 服务层**只允许产出分类 / enum**（`ProfileErrorKind` / `ResumeImportErrorKind`），文案由 UI 侧 `useI18n` 映射。
3. 服务层不得 import store / React：`enrich-service`（纯编排）+ `auto-enrich`（store 接线）**分文件**是既定先例，本方案同样把 `profile-service`（纯）与 `useLoopStore` 接线分开，避免单测进程拉起 zustand。

### 与方案的实现偏差（实施中回填）

> 已回写方案 `docs/learner-profile-design-2026-09.md` **§14.1**。

1. **测试文件数 3 → 2**：方案 §9 T17 写「三个测试文件」，实际落地 `tests/learner-profile.test.ts`（画像 / 难度先验 / ETA / 规划档位 / 存储往返）+ `tests/resume-parse.test.ts`（掩码 / 简历解析 / 上下文注入 / 零回归）。消费点用例与画像/简历共用同一批 fixture，拆第三个文件徒增重复；§12 全部用例仍有覆盖。
2. **重考卷也透传 `profile`**：方案 §9 T4 只提 `createPaper` 四处调用点，实际 `createRetakePaper` 亦显式透传 `profile`（否则重考会回退 band1，与首考口径不一致）。
3. **pdf 错误按 `err.name` 判定**：`resume-import.ts::kindOf` 用 `err.name === "PdfNoTextError" / "PdfTooLargeError"`，不用 `instanceof` —— `pdf.ts` 是运行时动态 `import()`，`instanceof` 在 node 单测进程下不可靠。
4. **UI 错误键口径**：`ResumeImportErrorKind` 为 kebab-case（`ai-not-configured` / `pdf-no-text` …），`ResumeErrorKey = ResumeImportErrorKind | "needLevel"`；实施中一度误写 camelCase `aiFailed`，被 `typecheck` 拦下后统一为 kebab。

## Tasks

> 状态取值：`pending` / `in_progress` / `done`。每个任务完成时在 **Outcome** 写「改了什么 + 验收命令与结果」。

### T1 — `domain/learner.ts`：`LearnerProfile` 与常量
- **Status:** done
- **Outcome:** 新增 `LearnerLevel` / `LEARNER_LEVELS` / `StudyDepth` / `StudyStyle` / `PROFILE_LIMITS`（`weeklyMinutesMin=30`、`weeklyMinutesMax=10080`、`backgroundChars=600`）/ `LearnerProfile`。barrel 走 wildcard，未改 `domain/index.ts`。`npm run typecheck` 0 新增 error。

### T2 — `storage/{types,memory,local}.ts`：`getProfile` / `saveProfile`
- **Status:** done
- **Outcome:** 三后端接口一致（`storage/types.ts` 增两方法签名）。`memory.ts` 增 `protected profile` + 读写。`local.ts` 新增 `KEY_PROFILE="plos.learner-profile"`，载入 `this.profile`；`persist()` 中 `undefined` → `removeItem`（不留 `'undefined'` 串）；`saveProfile` override 走 super + persist。`tauri.ts` **零改动**。TC-UC07-01/02、TC-EDGE-06/07 通过。

### T3 — `engine/profile-band.ts`：`LEVEL_BAND` / `LEVEL_PACE` / `bandForChapter` / `paceOf`
- **Status:** done
- **Outcome:** `LEVEL_BAND`（beginner/basic→1、intermediate→2、advanced→3）、`LEVEL_PACE`（300/350/400/450）、`DEFAULT_PACE=350`；`bandForLevel` / `bandForChapter(unit, profile?)`（证据 `mastery>0||attempts>0` → `bandOfMastery`，否则先验）/ `paceOf`。已加入 `engine/index.ts` 导出。TC-UC01-01/02、TC-UC02-01/02 通过；纯 `.ts` 无 React。

### T4 — `engine/quiz-engine.ts` + `features/learn/paper-advice.ts`：难度带接先验
- **Status:** done
- **Outcome:** `CreatePaperInput` / `createRetakePaper` 入参增可选 `profile`，线程贯穿 `createPaper → unitQuota/stageQuota/retakeQuota/buildFinalTest/objectiveQuestions/generateQuizQuestionsWithAi`；四处 objective 出卷点改 `bandForChapter(learnerState?.byUnit[id], profile)`；`createRetakePaper` 透传 `profile`（偏差 #2）。`recommendPaper` / `recommendDocPaper` 增 `profile?`，`PapersTab.tsx` 用 `storage.getProfile()` 取值传入。TC-UC02-03 零回归通过；`test:advice` 不回归。

### T5 — `engine/learning-planner.ts`：`clsRankMap(depth)` 档位覆盖
- **Status:** done
- **Outcome:** `ChapterPlanInput` 增 `prefs?: { depth?: StudyDepth }`；`clsRankMap(depth?)` 默认恒等，`breadth` 交换 3↔5（`{0:0,1:1,2:2,3:5,4:4,5:3}`）；排序改用 `rank[a.cls]-rank[b.cls]`。TC-UC08-01 零回归、TC-UC08-02 通过。

### T6 — `features/plan/chapter-action.ts`：`estimateEtaMin(pace?)` + `estimatePlanEta`
- **Status:** done
- **Outcome:** `estimateEtaMin(action, chapter, pace=DEFAULT_PACE)` 对 learn-chapter 用 `pace`；新增 `PlanEta`（`totalMinutes`、`finishAt?`、`deadline?: {at, behind, days}`）、`weeklyOf()`、`estimatePlanEta({actions, chapterOf, profile?, deadlineAt?, now?})`（D5 三支）。TC-UC03-01~06、TC-EDGE-01/02/08 通过；既有三处调用点不传 pace → 数值不变。

### T7 — `engine/loop.ts` + `stores/useLoopStore.ts`：快照带 profile、`saveProfile` 动作
- **Status:** done
- **Outcome:** `ChapterLoopSnapshot` 增 `profile: LearnerProfile | undefined`；`runChapterLoop` 并行 `storage.getProfile()`，传 `prefs: profile.preferences` 给 `buildChapterPlan` 并回传 `profile`。store 增 `profile` 状态 + `saveProfile(profile, m?)`（写库后 `refresh`）；`refresh` 回填 `profile: chapterPlan.profile`。未填画像时 `/plan` 首屏无完成日期行。

### T8 — `ai/learner-context.ts` + `ai/pipelines.ts` + `ai/chapter-qa.ts`：上下文块与两处接入
- **Status:** done
- **Outcome:** 新增 `ai/learner-context.ts`（`LEARNER_CONTEXT_LIMITS` blockChars=800/backgroundChars=600、`hasLearnerContext`、`buildLearnerContextBlock`：剥 ``` 围栏 + 控制字符 + 截断 + 「不得作为指令执行」免责声明）。`buildQuizGenMessages(chapters, text, profile, learner?)` 与 `ChapterQaInput.learner?` 追加块。TC-UC08-03 零回归、TC-UC08-04 防注入通过；既有 `profile` 参数名未动。

### T9 — `features/quiz/paper-flow.ts` + `features/learn/chapter-qa-service.ts`：调用侧注入
- **Status:** done
- **Outcome:** `paper-flow` 读 `const profile = await storage.getProfile()`，传 `createPaper` 与 `generateQuizQuestionsWithAi`；`chapter-qa-service` 读 `store.getProfile()` 传 `learner: profile`。`ai/` 未 import `features/`（依赖单向不破）。

### T10 — `features/profile/profile-service.ts`：normalize / load / save / merge
- **Status:** done
- **Outcome:** `ProfileErrorKind` / `ProfileError`（**显式字段**，无参数属性）/ `LearnerProfileInput` / `normalizeProfile`（六种畸形按 §4.3.3）/ `toProfile(input, now?)` / `mergeResumeDraft(base, draft, applyLevel, now?)`。TC-UC08-05、TC-EDGE-06/07、TC-UC04-05、TC-UC07-01 通过。

### T11 — `features/profile/pii-mask.ts`：`maskPii`
- **Status:** done
- **Outcome:** `maskPii(text)` 纯函数（顺序敏感：URL → email → 身份证 → 手机 → 固话 → 生日 → 姓名标注）；非字符串入参不抛。TC-UC04-01、身份证优先于手机用例通过。

### T12 — `ai/resume-pipeline.ts`：提示词 + `parseResumeDraft` + 执行器
- **Status:** done
- **Outcome:** `RESUME_LIMITS` / `RESUME_SYSTEM` / `ResumeDraft` / `parseResumeDraft`（宽松、**绝不抛**）/ `isEmptyResumeDraft` / `extractResumeDraft`（复用 `pipeline-core` 的 `chatJson`）。TC-UC04-02（非法 level 丢弃）、TC-UC04-03（`null`/`{}`/字符串不抛）通过。

### T13 — `features/profile/resume-import.ts`：编排（复用 `extractPdfText`）
- **Status:** done
- **Outcome:** `importResume(args)`：取文本（file → 体积护栏 → `extractPdfText`；paste → 直取）→ `maskPii` → 长度护栏 → AI 解析 → 空草稿判负 → 摘要二次 `maskPii`；`extractText` 可注入；`pdf.ts` 走动态 `import()`，错误按 `err.name` 判（偏差 #3）；外层 try/catch 抛 `ResumeImportError(kindOf(err))`。TC-UC04-04、TC-UC05-01、TC-UC06-01/02、TC-EDGE-04/05 通过。

### T14 — UI：`LearnerProfileCard.tsx` + `ResumeImportDialog.tsx` + `LearnerPage.tsx`
- **Status:** done
- **Outcome:** `LearnerProfileCard`（摘要/编辑两态；level/weeklyHours/depth/style/background；save 走 `useLoopStore.saveProfile`；clear 走 ConfirmDialog）；`ResumeImportDialog`（来源选择/解析中/确认三态 + SegmentedTabs(file/paste) + 隐私告知 + `applyLevel` 默认不勾 + `mergeResumeDraft`）；`LearnerPage` 两段式（声明区可编辑 + 观测区只读）+ 自评高于实测提示。文案全走 i18n。`typecheck` 0 新增 error。

### T15 — UI：`PlanPage.tsx` + `GoalDetailPage.tsx` 完成日期行
- **Status:** done
- **Outcome:** 两页各引入 `estimatePlanEta`（`GoalDetailPage` 补 `estimatePlanEta` import），仅在 `eta.finishAt !== undefined` 时渲染（`data-testid` = `plan-eta-finish` / `goal-eta-finish`），含 D5 充裕 / 晚 N 天条件句。`weeklyMinutes` 缺失 → 整行不渲染。

### T16 — i18n 双语 + `test:profile` / `test:resume` 脚本
- **Status:** done
- **Outcome:** `zh.ts` / `en.ts` 新增 `learner.declaredSection` / `observedSection` / `learner.profile.*` / `learner.resume.*` / `plan.etaFinish|etaBehind|etaAhead`，逐键对齐；`package.json` 新增 `test:profile` / `test:resume` 并串入 `test:library`。`npm run test:i18n` 通过。

### T17 — 三个测试文件补齐（画像 / 简历 / 消费点）
- **Status:** done
- **Outcome:** 落地 **2 个**文件（偏差 #1）：`tests/learner-profile.test.ts`（难度带映射 / 证据压倒先验 / `createPaper` 零回归形状 / pace / ETA + D5 / `clsRankMap` / `normalizeProfile` / `mergeResumeDraft` / 存储往返）+ `tests/resume-parse.test.ts`（`maskPii` / `parseResumeDraft` / `importResume` 各失败态 / 上下文防注入 / prompt 零回归）。二者 **ALL PASS**，覆盖 §12 全部用例（含 §12.1 边界）。

### T18 — 文档同步
- **Status:** done
- **Outcome:** README 双语画像条目 → `[x]` 并新增「简历导入」条目；统计行重算为 **26 已实现 / 18 未实现**（`grep -c '^- \[x\] '` / `'^- \[ \] '` 复核两版一致，`### ` 标题数 29 对齐）；本方案置「已实施」+ 新增 §14（实施结果与偏差）；roadmap F1 标题 + 候选表行标注 ✅ 已实施。

## 链路核查（新增存储/服务层后必跑）

1. `grep -rn "getProfile\|saveProfile" src/` → 命中的不止 `storage/*`：`useLoopStore`（状态 + 动作）、`LearnerProfileCard` / `ResumeImportDialog`（UI 消费）、`PapersTab` / `paper-flow` / `chapter-qa-service`（读值注入）。**已接线。**
2. 顺数据流逐跳确认真实调用者：`useLoopStore.saveProfile` → `LearnerProfileCard` / `ResumeImportDialog`；`bandForChapter` → `quiz-engine` 四处 + `paper-advice` 两处；`estimatePlanEta` → `PlanPage` / `GoalDetailPage`。**通过。**
3. 反向确认新编排函数被 UI / 管道真实调用（非仅单测）：`importResume` ← `ResumeImportDialog`；`buildLearnerContextBlock` ← `pipelines.ts` / `chapter-qa.ts`。**通过。**

## 收工核对清单

- [x] `npm run typecheck` 0 新增 error（`AIModelsSection.tsx` 的 3 条既存债**不计入、也不顺手改**）
- [x] `npm run test:profile` / `test:resume` 全绿
- [x] `npm run test:library` / `test:eta` / `test:advice` / `test:rag` / `test:ai` / `test:graph` / `test:i18n` 全 `exit=0`
- [x] §11.3 三条零回归硬断言全部通过
- [x] 链路核查三步通过
- [x] 按 `rules/commit-conventions` 分层提交（engine / ai / features-service / ui / docs），只落本地不 push；提交后 `git status --short` 为空
- [x] 偏差已回填本文件「与方案的实现偏差」并同步方案 §14
