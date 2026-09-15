# F6 目标级能力评测 — 实施 Runbook

## Goal

按 `docs/goal-capability-assessment-design-2026-09.md`（D1–D9 全部确认）落地「我够格了吗」：目标拆成 3–6 个能力项，用**客观摸底卷（参考分，不参与判定）+ 场景任务（判定唯一依据）**取证据，AI 按 rubric 逐项给 0–1 分并给可锚回作答原文的引文，产出 append-only 的能力报告；**不改 mastery、不改 readiness 口径**（独立证据层）。

Done = §12 全部用例通过 + `npm run typecheck` 零新增错误 + `npm run test:capability` 全绿 + 两条新路由可访问（用户人工核对 UI）。

## Context

- **方案**：`docs/goal-capability-assessment-design-2026-09.md`（12 章 + §13 决策点）
- **路径**：C（新建 6 文件 / 修改 11 文件）
- **关键约束**：`src-tauri/**` 与 `storage/tauri.ts` **零改动**；`ai/` 不 import `features/`；单测不 import `.tsx`；不启动浏览器
- **质量门槛（G3）**：`EvidenceKind` 加 `"capability"` → `features/evidence-label.ts` 穷尽 switch **必 TS 报错** → T1 与 T7-前半**必须同提交**（逐提交可编译）
- **禁止事项**：不调用 `saveLearnerState`（T12 `TC-REG-01` 硬断言）

## Tasks

### T1 — 领域层：`domain/capability.ts` + `evidence.ts` 扩展 + barrel
- **Status:** done
- **Outcome:** 新增 `src/domain/capability.ts`（13 个导出：`CapabilityVerdict` / `CapabilityItemSource` / `CapabilityItem` / `CapabilityItemSnapshot` / `CapabilityTaskRubric` / `CapabilityTask` / `CapabilityRunStatus` / `CapabilityRun` / `CapabilityQuote` / `CapabilityScore` / `CapabilityReport` / `CapabilityErrorKind` / `CapabilityStatus` + 3 个纯函数 `capabilityItemId` / `capabilityTaskId` / `snapshotItems`，内部私有 djb2 `hashId`）。`evidence.ts` 扩展 `EvidenceKind += "capability"` + 新增可选 `subjectKind?: "chapter" | "goal"`（缺省 chapter → 旧数据零回归）。`domain/index.ts` barrel +1 行。
- **Notes:** ⚠️ **偏差 1（正向）**：`units.action.capability` 键必须**随 T1 同批**落地 —— 只改 `evidence-label.ts` 仍会让 `GoalDetailPage.tsx:471` 与 `HomePage.tsx:365` 出现 TS7053（索引 `m.units.action` 缺键）。方案 §10 步骤 2 未预见此点，实施时把该键从 T11 提前到 T1，否则中间态不可编译。验证：`npm run typecheck` → 仅剩既存 3 条 `AIModelsSection.tsx:56-58`。
- **依赖:** —

### T2 — 引擎层：`engine/capability-engine.ts` 全量纯逻辑
- **Status:** done
- **Outcome:** 新增 `src/engine/capability-engine.ts`（241 行）：`CAPABILITY_THRESHOLD = 0.8`（独立常量，与 `MASTERY_THRESHOLD` 同值不同源）、`CAPABILITY_LIMITS`（items 1–6 / tasks 2–5 / 各字段字数上限 / `answerMinChars=40` / `answerMaxChars=4000`）、`CAPABILITY_EVIDENCE_PREVIEW_CHARS=60`；纯函数 `clampScore` / `normalizeWeights`（全 0 → 均分）/ `scoreOfItem`（跨任务算术平均，无命中返 `undefined`）/ `verdictOf`（`>=` 含等号）/ `coverageGaps` / `overallScore`（**unknown 不进分母**）/ `buildReport`（唯一入口，含 `dedupeQuotes` 私有去重 + `unanchored` 标记）/ `capabilityStatsOf` / `canStartCapabilityRun`。`engine/index.ts` barrel +1 行。
- **Notes:** 未 import `learner-model.ts`（守 D5）；`buildReport` 不就地改入参（快照由 `normalizeWeights` 复制）。typecheck 仅剩既存 3 条 `AIModelsSection.tsx`。
- **依赖:** T1

### T3 — 引擎层：`createPaperGroupedByDoc` 抽取 + `createGoalPaper`（含 700 行护栏）
- **Status:** done
- **Outcome:** 新增 `src/engine/paper-scope.ts`（188 行）= 卷型候选（`NEW_PAPER_MODES` / `PAPER_MODE_MIN_CHAPTERS` / `availablePaperModes` / `canCreatePaperMode`）+ 跨文档聚合出卷（`createPaperGroupedByDoc` 新抽出 / `createRetakePaper` 改为委托 / `createGoalPaper` 新增，`mode:"final-test"`）。`quiz-engine.ts` **792 → 679 行**（护栏要求 ≤690）；`engine/index.ts` +1 行 re-export。
- **Notes:** ⚠️ **偏差 1（护栏被触发）**：方案 §8.5 记「当前 653 行、净增后约 678」已过期 —— 实测本文件已 792 行（*已超 700 行上限*），故直接执行护栏分支「拆出 `engine/paper-scope.ts`」。拆分后 679 行，回归 700 行约束。⚠️ **偏差 2**：`features/quiz/meta.ts:19` 是唯一**深路径**导入该常量的调用方（`from "../../engine/quiz-engine"`），随拆分改为 `"../../engine/paper-scope"`（其余调用方均走 `../../engine` barrel，零改动）。⚠️ 偏差 3：`createGoalPaper` 语义确认 —— 不走 `createPaperAndSave`（其 `canCreatePaperMode("final-test")` 要求 `selected===total`，G1），卷型校验下沉到服务层。验证：`typecheck` 仅剩既存 3 条；`test:advice` 9/9、`test:eta` ALL PASS（TC-REG-02 回归通过）。
- **依赖:** —

### T4 — AI 层：`PIPELINE_LIMITS` 扩展 + `ai/capability.ts` 三管线
- **Status:** done
- **Outcome:** `pipeline-core.ts` 的 `PIPELINE_LIMITS` +13 项（`capabilityItemMax:6` / `LabelChars:60` / `DescChars:200` / `TaskMax:5` / `TaskPromptChars:600` / `TaskHintChars:200` / `TaskCriteriaMax:4` / `TaskCriteriaChars:120` / `RationaleChars:120` / `QuoteMaxChars:200` / `MaterialChars:12000` / `AnswerChars:4000`，各自注释镜像来源）。新增 `src/ai/capability.ts`（444 行）：三段 system 提示词常量 + `GOAL_TYPE_LABEL`；类型 `CapabilityMaterial` / `IndexedCapabilityItem` / `CapabilityIdRefs` / 三个 Input 与三个 Draft；`toIndexedItems`；三组 `build*Messages` + `parse*Draft` + 执行器 `extractCapabilityItems` / `generateCapabilityTasks` / `scoreCapabilityWithAi`（均走 `TEMPERATURE.grade` + `chatJson`）。
- **Notes:** ⚠️ **偏差 1（设计缺陷修正）**：方案 §8.6 的 `parse*Draft(raw, items: CapabilityItemSnapshot[])` 与执行器入参（`items: {index,label,description}[]`）**互相矛盾** —— 编号视图不带真实 id，parse 便无法把 `itemIndex` 映射回 `CapabilityItem.id`（会把 `"1"` 当成 id 写进报告）。修正：`IndexedCapabilityItem` **必须携带真实 `id`**；parse 形参放宽为最小结构类型 `CapabilityIdRefs = readonly {id:string}[]`（`CapabilityItemSnapshot[]` 天然兼容），执行器把 `input.items` 原样透传 → 「序号 → id」在 build 与 parse 两侧必然同序。⚠️ 偏差 2：`parseCapabilityTasksDraft` 额外丢弃「`criteria` 全空」的任务（无 rubric 无法判分，留着只会产出伪证据）；`capabilityTaskHintChars` 为方案未列但必需的字段上限（对齐 `CAPABILITY_LIMITS.deliverableHintChars`）。验证：`typecheck` 仅剩既存 3 条。
- **依赖:** T1

### T5 — 存储层：`types.ts` + `memory.ts` + `local.ts`（含 `deleteGoal` 级联）
- **Status:** done
- **Outcome:** 契约 +9 方法（`listCapabilityItems` / `saveCapabilityItems`（空数组=清空）/ `listCapabilityRuns` / `getCapabilityRun` / `saveCapabilityRun` / `listCapabilityReports` / `getCapabilityReport` / `saveCapabilityReport` / `deleteCapabilityDataByGoal`）。`memory.ts`：3 个 `protected Map` + 9 方法实现，**`deleteGoal` 内联级联** `deleteCapabilityDataByGoal`。`local.ts`：3 个新 key（`plos.capability-items` / `-runs` / `-reports`，无旧数据 → 零迁移）+ 构造载入 + `persist()` 三段回写 + 4 个写操作 override。**`tauri.ts` 零改动**（`TauriStorage extends LocalStorageAdapter`，自动继承）。
- **Notes:** ⚠️ **偏差 1（相对方案 §8.10）**：方案要求「在 `local.ts::deleteGoal` 里补 `super.deleteCapabilityDataByGoal(id)`」。实施改为**级联下沉到 `memory.ts::deleteGoal`** —— 理由：memory 后端（单测 / SSR / 无 localStorage 预览）同样必须无残留，否则「删目标后仍有孤儿报告」只在 memory 档隐形复现；`local.ts` 只需在其 `super` 之后落盘（原有 override 一行未改，仅补注释说明「勿重复调用」）。UC-08 在三个后端语义一致。验证：`typecheck` 仅剩既存 3 条；`test:storage` 28/28。
- **依赖:** T1

### T6 — 服务层：`features/goals/capability-service.ts`（六态 + 锚定 + 落库顺序 + 证据流）
- **Status:** done
- **Outcome:** 新增 `src/features/goals/capability-service.ts`（约 610 行）：`CapabilityOutcome<T>` / `ObjectiveStage`；`proposeCapabilityItems`（提炼并覆盖）/ `saveManualCapabilityItems`（手动建清单，按 id 合并保留既有 weight-threshold）/ `saveCapabilityItemsForGoal`（页面编辑全量写回）/ `startCapabilityRun`（快照 + 出任务 + ≥3 章出客观卷）/ `submitCapabilityRun`（①→⑪ 固定顺序）/ `anchorCapabilityEvidence`（纯函数）/ `objectiveStageOf` / 四个只读包装 / `classifyCapabilityError`。
- **Notes:** ⚠️ **偏差 1（顺序契约）**：`startCapabilityRun` 内部把**AI 就绪判定提到清单判定之前**（对齐 TC-UC06-01「未配置 AI 时两个入口都返 `no-ai`」；`submitCapabilityRun` 保持方案 §8.11 原序：②清单 → ④AI）。⚠️ **偏差 2（真实缺陷修复）**：`anchorCapabilityEvidence` 新增 `itemIds` **rubric 白名单** —— 实测模型会在任务 B 的调用里顺带给「只由任务 A 考察」的能力项打分，若不拦，该分会被并入聚合（单测实测把 0 分项抬到 0.45）。这正是决策 D9-A 要防的假因果：**不能让任务去证明它没考察的能力项**。⚠️ 偏差 3：`no-scope` 落地口径 —— 目标**显式圈定**过范围但一章都解析不到（范围已失效）→ `no-scope`；从未圈定（回退全库）且全库无章 → `no-material`（TC-EDGE-02 语义不变）。⚠️ 偏差 4：手动清单**全部为空**返 `no-items`（方案 TC-UC02-02 写作 `generic`）—— `no-items` 与该状态在 UI 的引导文案一致，避免两个分类表达同一件事。⚠️ 偏差 5：阶段 1 客观卷 `allowSubjective: false`（纯客观题、本地可判，不依赖 AI 批改）；「阶段 1 未完成」由 `objectiveStageOf(run)` 承载，`report.objective` 仅在有判卷结果时出现（TC-EDGE-13 据此断言）。⚠️ 偏差 6：`useLoopStore` **零改动**（方案 §8.22 预留 2 行）—— `removeGoal` 早已调 `storage.deleteGoal`，级联已在存储层落地。新增两个导出 `snapshotOf` / `indexedOf` 供 UI 复用（T8/T9 若不需要则删，勿留死代码）。
- **依赖:** T2 T4 T5

### T7 — 证据接线：`evidence-label.ts` + `HomePage.logToView`（G3/G4）
- **Status:** done
- **Outcome:** **前半**（随 T1 同批）：`EvidenceActionKey` 联合类型 +`"capability"`，`evidenceActionKey()` 补齐 `case "capability" → "capability"` 分支（`features/evidence-label.ts:22/35-37`）—— 穷尽 switch 由 TS 强制，故必须与 `EvidenceKind` 扩展同提交。**后半**：`HomePage.tsx` `logToView` 增加主体解析分支（`:378-401`）——`entry.kind === "capability" && entry.subjectKind === "goal"` 时主体取**目标**：标题走 `m.capability.evidenceSubject(goalTitle)`；目标已删（证据保留）→ `m.capability.evidenceFallback`（**绝不显示裸 goalId**）；`verdict` 用 `m.capability.verdict.pass/fail` 而非 `delta`（D5：能力评测不产生掌握度变化，`delta` 恒 0）。`EvidenceView` 接口 +可选 `verdict?: "pass" | "fail"` 字段。
- **Notes:** ⚠️ **偏差 1（顺序）**：T7 拆成两半执行 —— 前半受 G3 约束必须随 T1；后半依赖 `m.capability.*` i18n 键，故移到 T11 之后（方案 §10 执行序已同步记录）。⚠️ 偏差 2：`EvidenceView` 加 `verdict?` 是方案未预见的最小扩展 —— 能力行的语义是**达标/未达标**（离散）而非掌握度增量（连续），复用 `delta` 会迫使编造数值。⚠️ **零回归（TC-REG-04）**：旧证据数据无 `subjectKind` 字段（缺省 = `"chapter"`）→ 一律走原章分支，旧 `logToView` 行为逐字不变。⚠️ TC-REG-04 **无法自动化**（`.tsx` 不被 strip-types 支持），以本节代码复核 + `TC-REG-03`（四个旧 kind 映射不变）作为替代证据。
- **依赖:** T1（前半）T11（后半）

### T8 — UI：`CapabilityPage.tsx` + `capability/CapabilityReportView.tsx`
- **Status:** done
- **Outcome:** 新增 `src/features/goals/CapabilityPage.tsx`（524 行，路由 `/goals/:goalId/capability`）：空态引导 → 能力项清单**内联编辑**（增删改 label/description/weight/threshold）→ AI 提炼按钮（`proposeCapabilityItems`，覆盖前有覆盖提示）→ 「开始评测」（`startCapabilityRun` 成功即跳 run 页）→ 最新报告卡 + 历史报告切换。新增 `src/features/goals/capability/CapabilityReportView.tsx`（198 行）：**只读快照**渲染 —— 总览（达标项 / 未覆盖项 / 综合分）、逐项分数 + 理由、引文**可展开**（带 `unknown` 琥珀色警示标记）、阶段 1 客观卷参考分**独立成块**（D9-A：明示「不参与判定」）。新增 `src/features/goals/capability/status-text.ts`（48 行）：六态 → 文案的**单一映射点** `capabilityStatusText` + 判定 `wantsAiSettings` / `wantsScopeEdit`。
- **Notes:** ⚠️ **偏差 1（架构一致性）**：服务层只产**分类**（`CapabilityOutcome.errorKind` 等），中文文案全部落在 `status-text.ts` 由 UI 侧 `useI18n` 映射 —— 对齐项目既有约定「服务层不抛中文 message」（`ai/` 与 `features/*-service.ts` 均不得硬编码文案）。⚠️ 偏差 2：报告渲染严格**只读快照**（`CapabilityReport` 自带 items/scores 副本），不反查当前能力项清单 —— 否则改写 label 会让历史报告错配（与 `capabilityItemId` 的内容派生 id 口径配套）。⚠️ 偏差 3：import 修正 2 处 —— `capabilityItemId` 来自 `domain`（非 `engine` barrel），`fmtDate` 来自 `./GoalsPage`（非 `../GoalsPage`）。验证：`typecheck` 仅剩既存 3 条。
- **依赖:** T6

### T9 — UI：`CapabilityRunPage.tsx`（两阶段 + 作答草稿；阶段 2 不依赖阶段 1）
- **Status:** done
- **Outcome:** 新增 `src/features/goals/CapabilityRunPage.tsx`（287 行，路由 `/goals/:goalId/capability/run/:runId`）：**两阶段作答** —— 第 1 步客观摸底卷（题面 + 选项，本地判卷；`scope` 无卷时该步显示 skipped 并跳过）；第 2 步场景任务（题面 + 交付物提示 + rubric 条目 + textarea）。作答**800ms 防抖草稿落库**（防刷新丢稿）；提交先落 `collected`（作答完整持久化）再调 AI 评分 —— 使「评分中途失败」不丢作答（TC-EDGE-10）。提交成功后跳回 `CapabilityPage` 看报告。
- **Notes:** ⚠️ **偏差 1（顺序契约）**：提交路径固定为「先 `collected` → 再 AI」而非一步 `scored`，这是 TC-EDGE-10（评分失败仍保有完整作答、可重试）的实现前提 —— 方案 §9 未显式规定该中间态的写入时机。⚠️ 偏差 2：**阶段 2 不依赖阶段 1**（D9-A 的 UI 侧体现）—— 客观卷未做/未判卷时「下一步」按钮始终可用，`objectiveStageOf(run)` 仅用于展示进度，不参与按钮禁用。⚠️ 偏差 3：应答长度下限 `answerMinChars=40` 在**提交前**做 UI 提示（服务层仍有同一校验兜底，见 TC-EDGE-09b）。验证：`typecheck` 仅剩既存 3 条。
- **依赖:** T6

### T10 — UI：`GoalDetailPage` CAPABILITY 区 + `App.tsx` 路由
- **Status:** done
- **Outcome:** `App.tsx`（`:57-59`）：+2 条路由 —— `goals/:goalId/capability` → `CapabilityPage`、`goals/:goalId/capability/run/:runId` → `CapabilityRunPage`，**插在 `goals/:goalId` 详情路由之前**（语义更窄者优先，避免被通配吞掉）。`GoalDetailPage.tsx`：`Loaded` 接口 +`capability: { items: CapabilityItem[]; report?: CapabilityReport }`；并行加载 `listGoalCapabilityItems` + `latestCapabilityReport`（`:67-68`）；渲染 CAPABILITY 摘要卡（`data-testid="goal-capability"`，`:310-343`）—— 展示 `capabilityStatsOf` 的达标/总数、未覆盖项数、报告快照日期提示、能力项数量，并给 `/goals/:goalId/capability` 入口链接（`data-testid="goal-capability-link"`）。未做评测时显示 `capabilityEmpty` 引导（**明示「章就绪度不等于我够格了」**）。
- **Notes:** ⚠️ **偏差 1（路由顺序）**：方案 §9 只列路由未提顺序；react-router 7 按声明序匹配，若把 capability 路由放在 `goals/:goalId` 之后，`/goals/g1/capability` 仍能命中（因为详情路由无 `*` 通配），但为免后续引入通配子路由时踩坑，统一采用「窄优先」。⚠️ 偏差 2：摘要卡与**章就绪度卡并列展示、互不改写**（守 D5：能力评测是独立证据层，不回头改 readiness 口径）。⚠️ 偏差 3：`capabilityStatsOf` 直接消费报告快照（与 `CapabilityReportView` 同源，见 TC-UC09-01），避免摘要与报告页两套口径。验证：`typecheck` 仅剩既存 3 条。
- **依赖:** T8

### T11 — i18n：`zh.ts` / `en.ts` 成对新增
- **Status:** done
- **Outcome:** `zh.ts` / `en.ts` 成对新增 `capability` 整段（关键词：`title` / `loading` / `emptyTitle` / 清单编辑 / 提炼 / 开始评测 / 六态文案 / `score` / `rationale` / `quote` / `unknown` / `objective`（阶段 1 参考分块，含「不参与判定」明示）/ `verdict.pass|fail` / `evidenceSubject` / `evidenceFallback` / `snapshotNote` / `itemsCount`）；`units.action.capability`（随 T1）+ `goals.detail.*` 5 键（`capabilityEyebrow` / `capabilityOf` / `capabilityUncovered` / `capabilityEmpty` / `viewCapabilityReport`）。
- **Notes:** ⚠️ `units.action.capability` 已按 T1 偏差 1 提前落地（否则 `GoalDetailPage`/`HomePage` 的 `m.units.action[...]` 索引 TS7053）。验证：`test:i18n` **8/8 通过**，其中「zh/en 字典**递归结构一致**（缺键/多键/叶子类型）」确保无漏键；另「zh/en 叶子无空字符串」确保无占位空串。⚠️ 复核提示：大小写敏感检索 `grep -c "capability"` 会漏掉驼峰键（如 `viewCapabilityReport`），核验键齐备**应以 `test:i18n` 为准**，不要用裸 grep 计数。
- **依赖:** T8 T9 T10

### T12 — 测试：`tests/capability.test.ts` + `package.json` 脚本
- **Status:** done
- **Outcome:** 新增 `tests/capability.test.ts`（约 900 行，43 条断言全绿）：TC-UC01-01~05 / UC02-01~03 / UC03-01~02 / UC04-01~04 / UC05-01~03 / UC06-01~02 / UC07-01 / UC08-01 / UC09-01 / UC10-01；TC-EDGE-01 / 02 / 02b / 03 / 04 / 08 / 09 / 09b / 10 / 11 / 12 / 13 / 14 / 15 / 16；TC-REG-01（`LearnerState` 逐字节不变）/ 02 / 02b / 03 / 05 / 06。`package.json` +2 行（`test:capability` 脚本 + 挂进 `test:library` 链）。假 provider 为**按调用顺序出预置 JSON 的队列**（无真实网络 / 无真实模型）。
- **Notes:** ⚠️ **TC-REG-04 无法自动化**：`HomePage.logToView` 在 `.tsx` 里，strip-types 不支持 JSX → 该用例改由 T7 的代码复核覆盖（runbook T7 记录证据）。⚠️ 首轮 3 条失败中有 **1 条是真实缺陷**（见 T6 偏差 2：rubric 越权给分），另 2 条是测试期望写错（`seeded()` 未装 `GOAL_EMPTY`；`sortChaptersByOrder` 只按 `order` 排序 → 跨文档同 order 会交错，`scope.chapterIds` 为 `["c1","c4","c2","c3"]`）。
- **依赖:** T2 T6

### T13 — 清理废弃契约：删 `generateAssessment` / `evaluateAnswer` + 止损 `assessment-engine.ts`
- **Status:** done
- **Outcome:** 契约层：`ai/types.ts` 删 `AssessmentContext` 接口 + `AIProvider` 两个方法声明 + 随之失效的 `../domain` 类型 import，原位留下「**不要再往本接口加出题方法**」的说明注释（与 G8 的 `extractKnowledge` 删除记录并列）。实现层 **4 处**（非方案的 3 处）：`openai-compatible.ts` / `builtin.ts` / `registry.ts::NotImplementedProvider` / **`active.ts::NoActiveProvider`** 各删 2 个方法 + 失效 import（`builtin.ts` 头部「能力边界」注释同步改写）。止损 `engine/assessment-engine.ts`：删掉「provider 已配置 → 交模型出题/判分」的两段 try/catch 与 `askProvider` 判定，签名由 `createAssessmentEngine(provider?, m)` 收窄为 **`createAssessmentEngine(m: Messages = zh)`**（`provider` 参数与 `AIProvider` import 一并移除 —— 否则 `noUnusedParameters` 必报错）。测试侧：9 个文件（`capability` / `ai-map-reduce` / `library-keypoint` / `enrich-service` / `chapter-qa` / `ai-pipeline` / `restatement` / `resume-parse` / `library-overview`）的假 provider 删除对应死方法；`chapter-qa.test.ts` 随之失效的 `AiProviderError` import 一并删除；`i18n-alignment.test.ts` 调用点由 `createAssessmentEngine(undefined, en)` 改为 `createAssessmentEngine(en)`。
- **Notes:** ⚠️ **偏差 1（方案漏数）**：方案 §9 与伪代码均记「**3 处** provider」（openai-compatible / builtin / registry），实测 `ai/active.ts:65-70` 的 `NoActiveProvider` 是**第 4 处**实现（`business-flow-end-to-end-2026-09.md:372` 曾正确点到 `active.ts:65-70`，但方案本体没吸收）。漏删会使 `NoActiveProvider implements AIProvider` 因多出两个不在接口上的方法而 TS 报错（对象字面量多余属性检查）—— 即该遗漏**一定会被 typecheck 挡住**，不会静默。⚠️ **偏差 2（签名收窄）**：方案伪代码只说「仅删两段 try/catch、保留本地确定性题」，未处理随后必然出现的 `provider` 参数未使用问题（`tsconfig` 开 `noUnusedParameters` + `noUnusedLocals`）。选择**直接收窄签名**而非给参数加 `_` 前缀 —— 保留一个「传了也不生效」的 provider 形参与本次清理的立意（行为更诚实）相悖。已核实 `createAssessmentEngine` 在 `src/` 侧**零消费方**（仅 `engine/index.ts` barrel re-export；`features/assessment/AssessmentSession.tsx` 只用 `domain/assessment.ts` 的 `Question/Answer/Evaluation` 类型，与方案「保留 domain/assessment.ts」一致），故 arity 变更为安全操作。⚠️ 偏差 3：`extractKnowledge`（G8）的历史删除注释**曾被本次编辑误覆盖**，已在同一提交内补回（两条记录并列，两条都需保留）。⚠️ 偏差 4：`tsconfig.json` 仅 `include: ["src"]` → **tests/ 不参与 typecheck**，故测试侧残留死方法不会被 `npm run typecheck` 发现（只会在运行时被完全忽略）；本次仍逐一清理，避免留下「接口已删、假实现还在」的误导样本。验证：`npm run typecheck` 仅剩既存 3 条 `AIModelsSection`；`grep -rn "generateAssessment|evaluateAnswer" src/` **仅命中 2 处说明性注释**（`ai/types.ts` / `ai/builtin.ts`，零真实实现、零调用）；**全部 33 个测试套件通过**（含 `test:i18n` 8/8 —— 其中「assessment-engine 未作答 feedback」用例正是签名收窄的回归证据）。
- **依赖:** —

### T14 — 文档同步：README 双语 + roadmap + 方案实施结果章
- **Status:** done
- **Outcome:** **README 双语**：`- [ ] 目标级能力评测 P1 —— 卡在产品定义尚未澄清` → `- [x]` 并改写为交付描述；两版计数 **28/16 → 29/15**，`grep -c '^- \[x\] '` / `'^- \[ \] '` 复核一致。**额外发现并修复**：两版 README 的 `AIProvider` 接口示例**本来就是错的**（列了 G8 已删的 `extractKnowledge` + 本次 T13 删掉的两个方法）→ 同步为真实签名，并补一句说明「向量化 / 概念抽取 / 能力评测**不在**该接口上」。**roadmap**：§零.3「E4 洞」标已收口（并指出 E2-b 由 F1 于 09-14 补上）；§三候选表 F6 标 ✅ + 状态列改为「已实施」；§F6 节补「已实施」状态块（D5-A/D9-A 口径）+ 产品问题结论表 + 范围交付情况 + Done 标准验收；§三 mermaid 节点、「有前置」、§五总结改写、**新增「变更记录」表**；§四.3 技术债第 3 条标**已清理**（含「方案曾漏记 `ai/active.ts`」的更正）。**方案本体**（`goal-capability-assessment-design-2026-09.md`）：状态行 → 已实施 + 补执行记录链接；§3 第 3 条更正为 **4 处** provider 并标已清理；§8.23 文档同步表改写为**实际结果**（含「原预测 28/16 已失效」的成因说明）；**新增 §14 实施结果**（交付清单 / 2 处实现期真实缺陷 / 11 条偏差 / 验收证据 / 未自动化验证说明）；变更记录 +1 行。**额外回扫**（方案未列，但属 E4 失真的当前态描述）：`docs/business-flow-end-to-end-2026-09.md` 的 E4 行、流程总览 mermaid（删除两条已废弃的 E4 虚线并注明原因）、`### E4` 章节结论与语义澄清、缺口清单 P0 第 2 条、路由表（+2 条能力路由）、§七一句话诊断。**runbook**：T7–T14 状态回填 + 本文收尾节。
- **Notes:** ⚠️ **偏差 1（跨会话基线漂移）**：方案 §8.23 预言「改后应为 **28 已实现 / 16 未实现**」，依据 `0b5e49f`（27/17）基线；但**期间另一会话并行提交了自测卡**（`8e4f8ec`，已自行把 README 推到 28/16，并写了「F6 待做」的行）。故 F6 落地后的正确基线是 **29/15**。已在方案 §8.23 原地更正并说明成因 —— 这是本项目「多会话并行同一工作树」的固有风险，**任何在文档里预言计数/行号的表述都可能被并行提交作废**，收尾时须以 `git show <commit>:<file>` 实测为准。⚠️ 偏差 2：`docs/business-flow-end-to-end-2026-09.md` 不在方案 §8.23 的同步清单内，但该文档把「E4 未实现」当作**当前态**断言（项目记忆亦如此引用），不改会持续误导 → 纳入本轮回扫。⚠️ 偏差 3：该文档的 **E2 行同样已过期**（F1 于 09-14 落地画像输入），但不属 F6 范围，**未逐项核对**，仅在表格下方显式标注以免读者误信。⚠️ 偏差 4：README 接口示例的修复属「顺手改正错误信息」，非纯同步。验证：两版 README 计数一致；`typecheck` 仅剩既存 3 条；测试全绿。
- **依赖:** T12

## 执行顺序（方案 §10）

T1(+T7 前半) → T2 → T3 → T5 → T4 → T6 → T12 → T8 → T9 → T10 → T11 → T7 后半 → T13 → T14

> 调整说明：T7 后半（`HomePage`）依赖 i18n 键（`m.capability.evidenceFallback`），故移到 T11 之后；T7 前半（`evidence-label.ts`）按 G3 硬约束随 T1 同提交。

---

## 实施偏差与修正（汇总）

> 逐任务明细见各 T 的 Notes；此处只列**影响他人判断**的条目。完整版同时回写进方案 §14.3。

| # | 任务 | 偏差 | 性质 |
|---|------|------|------|
| 1 | T3 | `quiz-engine.ts` 实测 **792 行**（方案记 653），已超 700 上限 → 触发 G5 护栏，拆出 `engine/paper-scope.ts`（拆后 679） | 护栏被触发 |
| 2 | T1/T7 | `units.action.capability` 从 T11 **提前到 T1 同批** —— 否则中间态 TS7053，逐提交不可编译 | 方案时序疏漏 |
| 3 | T4 | §8.6 的 `parse*Draft(raw, items: CapabilityItemSnapshot[])` 与执行器入参**自相矛盾**（编号视图不带真实 id）→ `IndexedCapabilityItem` 必带 `id`，parse 形参放宽到 `CapabilityIdRefs` | **设计缺陷** |
| 4 | T5 | `deleteGoal` 级联由 `local.ts` **下沉到 `memory.ts`** —— 让 memory 档（单测 / SSR / 无 localStorage 预览）同样零残留 | 落点调整 |
| 5 | T6 | `startCapabilityRun` 把 **AI 就绪判定提到清单判定之前**（`submitCapabilityRun` 保持原序） | 顺序契约 |
| 6 | T6 | `anchorCapabilityEvidence` 新增 **`itemIds` rubric 白名单** —— 拦截「任务 B 顺带给只由任务 A 考察的能力项打分」（实测把 0 分项抬到 0.45） | **实现期真实缺陷** |
| 7 | T6 | `no-scope` / `no-material` 口径细化：显式圈定过但解析不到章 → `no-scope`；从未圈定且全库无章 → `no-material` | 语义细化 |
| 8 | T7 | 新增 `EvidenceView.verdict` 可选字段 —— 能力行语义是达标/未达标（离散），复用 `delta` 会迫使编造数值 | 最小扩展 |
| 9 | T8 | 服务层**只产分类**，文案由 `status-text.ts` + UI `useI18n` 映射；报告严格**只读快照** | 架构一致性 |
| 10 | T10 | 两条能力路由声明在目标详情路由**之前**（窄优先） | 顺序防御 |
| 11 | T13 | 方案记「**3 处** provider」，实测 **4 处**（漏 `ai/active.ts` 的 `NoActiveProvider`）；`createAssessmentEngine` 签名由 `(provider?, m)` **收窄为 `(m)`** | 方案漏数 + 必要收窄 |
| 12 | T14 | 方案 §8.23 预言「改后 28/16」失效（并行提交 `8e4f8ec` 已推到 28/16）→ 实际 **29/15** | **跨会话基线漂移** |

## 收工清单

- [x] T1–T14 全部 done，Outcome 已回填
- [x] `npm run typecheck` 仅剩 **3 条既存**错误（`settings/AIModelsSection.tsx:56-58`，非本任务引入、未顺手改）
- [x] `npm run test:capability` **43/43 ALL PASS**
- [x] 全量测试 **33 套全绿**
- [x] `TC-REG-01` 硬断言：跑完整评测后 `LearnerState` **逐字节不变**（守 D5-A）
- [x] `src-tauri/**` 与 `storage/tauri.ts` **零改动**（约束达成）
- [x] 链路核查三步通过（存储方法有消费方 / 服务函数有 UI 调用方 / 无「仅 storage 自循环」）
- [x] README 双语 29/15 对齐 · roadmap 同步 · 方案 §14 实施结果 · business-flow E4 回扫
- [x] T13 废弃契约：`grep` 仅命中 2 处**说明性注释**，零实现零调用
- [ ] **用户人工核对两条新路由的 UI 视觉**（受 `rules/no-headless-browser-validation.mdc` 约束，未启动浏览器）
- [ ] 分批本地提交（不 push）

## 变更记录

| 日期 | 变更 | 作者 |
|------|------|------|
| 2026-09-15 | 创建 runbook（T1–T14）+ T1/T2 完成 | Agent |
| 2026-09-15 | T3–T6、T12 完成并回填 Outcome 与偏差（含 1 处实现期真实缺陷：rubric 越权给分） | Agent |
| 2026-09-15 | T7 后半 / T8–T11 完成；链路核查通过；T13 清理废弃契约（**发现方案漏记第 4 处 provider**）；T14 文档同步（README 29/15 · roadmap · 方案 §14 · business-flow 回扫）；**T1–T14 全部 done**，补「实施偏差与修正汇总」+「收工清单」 | Agent |

