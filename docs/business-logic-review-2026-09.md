# Personal Learning OS · 业务逻辑评审与优化建议

> 评审对象：`Personal-Learning-OS`（Pre-MVP / Phase 0 基座 + 交互闭环进行中）
> 评审日期：2026-09-07 · 基准 commit：`fed5f9e`（含未提交工作区：docs ×2、ReviewSession、DeltaBadge、units、useSessionStore、Home/Study/loopStore 修改）
> 验证基线：`npm run typecheck` = **0 错误**；`npm run build` 未跑（只读评审，未改代码）
> 范围：业务逻辑正确性 / 学习模型一致性 / 闭环完整度；**不含**已在 `docs/interaction-design-spec-2026-09.md` 规划好的 UI/交互事项（P0-1~P2-6、T1~T10），仅在相关处给出前置依赖提醒。

---

## 一、TL;DR（结论先行）

产品叙事清晰（**Learn → Prove → Adapt** 的自适应学习闭环），分层架构干净：领域纯 TS → 7 引擎纯函数 → 存储适配器 → Zustand → UI，AI 抽象隔离良好。当前 demo 全链路可跑通的部分是 **「缺口队列 → 复习自评四档 → 掌握度更新 → 下一步推荐」**，这也是未提交工作区正在收尾的交互闭环（对应设计文档 T1–T3）。

但深入业务逻辑后发现 **3 个会动摇「学习系统」可信度的模型级缺口**，均不在既有交互规划内：

| 级别 | 问题 | 一句话 |
|---|---|---|
| **P0-1** | 复习调度断链 | 「下次复习 N 天后」只是展示文案，`下次复习时间`从未持久化、到期也从不产生复习动作 → **间隔重复没有真正运行** |
| **P0-2** | 展示前不衰减 | 遗忘曲线只在「提交证据时」顺带算一次；打开首页/看板时未先衰减 → **就绪度与掌握度展示长期高估** |
| **P0-3** | 测评本地判分恒错 | 本地降级要求答案与参考逐字相等（开放题几乎恒判错），misconceptions 链路空转 → **在 T4 测评 UI 落地前必须重定义「本地判分」契约** |
| P1 群 | 掌握度阈值 0.8 魔法数字 4 处重复；applyRating 污染 attempts/correctCount；单元标题硬编码 demo id 表；demo seed 策略页面间不一致 | 一致性/正确性风险，建议随下一批提交收敛 |
| P2 群 | Provider 配置零消费点；localStorage 无版本/损坏静默；空态文案与能力不符等 | 工程卫生，可分批 |

> **建议里程碑**：N1（学习模型修正批，纯函数层改动、风险低）→ N2（阈值/数据驱动/seed 一致性批）→ 之后再落地测评 UI 与 Provider 装配。

---

## 二、业务逻辑全景

### 2.1 一句话理解

**用户以 Learning Goal 为入口，系统从「该目标所需的知识单元」出发，对照持久化的 LearnerState（每单元掌握度/置信度/尝试数…）算出缺口，按 prerequisite 依赖排序给出「最佳下一步」；用户执行复习自评（四档）或测评作答，证据回写掌握度，遗忘曲线随时间衰减，闭环重算，直至目标就绪度 ≥ 80%。**

### 2.2 数据流（证据链）

```
LearningGoal.requiredUnitIds
   ↓ (planner: mastery < 0.8 → gap；prerequisite DFS 排序 + 瓶颈标记)
NextAction[]（含 reasons，可解释）
   ↓ (recommendation: priority 最小 = next)
Home 主 CTA / Study 队列（actions 按序）
   ↓ 执行：ReviewSession 自评 1-4 或（未来）Assessment 作答
submitAnswer(unitId, {rating|correct})
   ├─ applyForgetting(state, now)      ← 提交时顺带对全库做遗忘衰减
   ├─ applyRating / applyEvaluation    ← 纯函数更新 mastery/confidence/attempts/misconceptions…
   ├─ storage.saveLearnerState + 5s 撤销栈
   └─ refresh() → runLearningLoop() → 新 LoopSnapshot（readiness/gaps/next）
Evidence 理想链: Source → Knowledge → Question → Answer → Evaluation → Mastery
```

### 2.3 分层职责与健康度

| 层 | 文件 | 职责 | 状态 |
|---|---|---|---|
| 领域 | `src/domain/*` | 5 核心对象 + action/plan 类型 + 阈值/生成器 | ✅ 干净，纯 TS 无依赖 |
| 引擎 | `src/engine/*` | knowledge / graph / learner-model / mastery / assessment / planner / recommendation + loop 编排 | ✅ 纯函数为主；assessment/knowledge 未接 Provider 时降级 |
| AI | `src/ai/*` | AIProvider 契约 + OpenAI-compatible 传输层 + registry | ◐ chat 可用；extract/generate/evaluate 三项 `not-implemented` |
| 存储 | `src/storage/*` | StorageAdapter → InMemory 基类 → localStorage 适配器 | ✅ 契约清晰，SQLite 预留 |
| 状态 | `src/stores/*` | loopSnapshot / settings / 会话记录 | ◐ undoStack 模块级；settings 不持久化 |
| UI | `src/features/*` | 7 页 | ◐ Home/Study/ReviewSession 已闭环；其余为 Scaffold 占位 |

### 2.4 闭环各环节「当前真实可交互度」评估（核心产出）

| 环节 | 契约实现 | UI | 当前可走通？ | 备注 |
|---|---|---|---|---|
| Document 导入 | 模型 OK | 无入口 | ✗ | 仅 demo seed 1 篇占位文档 |
| Knowledge 抽取 | engine 返回 []（无 Provider） | 无入口 | ✗ | 下一里程碑（docs P1-2） |
| Graph 构建 | GraphEngine 纯函数可用 | 无编辑 UI（列表只读） | ✗ | demo 预置图谱 |
| Learning Goal | 模型 OK | 无创建/切换（恒取 goals[0]） | ◐ | demo 单目标 |
| 缺口识别 / 计划 | planner ✅（依赖优先+瓶颈+reasons） | ✅ 队列页 | ✅ **主演示路径** | |
| 复习自评（四档）→ applyRating | ✅ 含 5s 撤销/键盘/完成汇总 | ✅ ReviewSession | ✅ **主演示路径** | 未提交工作区正在收尾 |
| 测评（对错）→ applyEvaluation | engine 在 | 占位页 | ✗ | docs P0-3/T4；落地前需先解决 P0-3 判分契约 |
| 遗忘衰减 | 逻辑在（30d 半衰期） | — | ◐ 仅提交时触发 | 见 P0-2 |
| 复习到期调度 | **未建模** | — | ✗ | 见 P0-1 |
| 推荐 next action | ✅ priority 最小 | ✅ 主 CTA | ✅ | |
| 持久化 | localStorage 全量 JSON | — | ✅ 刷新保留 | 无版本号/损坏静默（P2） |
| AI Provider | chat 可用；3 能力未实现 | 设置表单无消费点 | ◐ | settings 未持久化、无连接测试（docs P2-1） |

---

## 三、问题清单（按优先级）

### P0 级 —— 学习模型核心，建议在测评 UI / 对外演示前处理

#### P0-1 · 复习调度断链：间隔建议只是装饰，「到期复习」从未发生
- **现象/证据**：`learner-model.ts` 的 `RATING_INTERVAL_DAYS`（忘记→1 / 困难→2 / 记得→4 / 轻松→7）只被 `nextReviewInDays()` 消费，返回值仅用于 UI 展示（DeltaBadge、StudyPage）；**`UnitMastery` 没有 `nextReviewAt` 字段，自评后该时间点未落库**。`learning-planner` 只把 `mastery < 0.8` 的单元视为缺口 → 一个单元被评到 0.8+ 后，系统再也不会安排它复习（遗忘要跌破 0.8 需 ~30 天半衰期，远大于 easy 的 7 天间隔），且 ReviewSession 的 `next()` 直接 `index+1`，无「到期卡片」概念。
- **影响**：对自称 **间隔重复/遗忘曲线驱动** 的产品，这是核心能力的空转——"4 天后回来"永远只是文案。若用户照做，系统却没有任何字段记得这件事。
- **建议（最小实现）**：
  1. `UnitMastery` 增加 `nextReviewAt?: number`；`applyRating`/`applyEvaluation` 依据 rating/对错写入 `now + intervalDays*MS_PER_DAY`；
  2. planner（或独立 scheduler）把 `mastery ≥ 0.8 但 nextReviewAt ≤ now` 的所需单元生成 `kind: "review"`、低优先级的 action（priority 排在真实缺口之后），使到期单元回到队列；
  3. StudyPage `queueHint` 由硬编码「3 天」阈值改为读 `nextReviewAt` 判定「今天到期 / 可延后」。
- **改动面**：`domain/learner.ts`、`engine/learner-model.ts`、`engine/learning-planner.ts`、`features/study/StudyPage.tsx`。工作量小，纯函数层先行可单测。

#### P0-2 · 遗忘衰减只在提交时触发，展示层掌握度/就绪度长期高估
- **现象/证据**：`applyForgetting` 唯一的调用点是 `useLoopStore.submitAnswer`（提交证据前对 prevState 算一次，被保存的只是被提交单元，其余单元的衰减随 prevState 一并持久化——这点是对的）。但 **`runLearningLoop()`（首页/看板/队列的计算入口）从不先应用衰减**：用户 40 天未打开，首页仍显示上次的 mastery 与就绪度，直到他提交一次复习才「补扣」。且衰减每次被 cap 到 5%，需连续提交才缓慢累进。
- **影响**：看板数字不是「此刻真实掌握度」的估计，违背产品原则（诚实数字、Evidence-based）。
- **建议**：在 `runLearningLoop` 内 `getLearnerState()` 之后先 `applyForgetting(state, now)`，若 `changed` 则写回再继续算缺口/就绪度。改动 1 个文件（`engine/loop.ts`）+ 保持 `submitAnswer` 现状即可。
- **附带参数建议**：30 天半衰期偏宽松（与 7 天 max 间隔不匹配），建议半衰期随 `RATING_INTERVAL_DAYS` 最大档对齐（约 14–21 天），并把 `MS_PER_DAY`/`halfLifeDays` 提为命名常量。

#### P0-3 · 测评本地判分契约：未配置 AI 时「几乎恒判错」，且 misconceptions 链路空转
- **现象/证据**：`assessment-engine.ts` 本地降级 `evaluate`：`normalize(content) === normalize(referenceAnswer)` 才判对。题目是开放题（`Explain "X" ... one example`），reference = `unit.summary` 一句摘要 → 用户**不可能逐字命中** → `correct=false`、`score=undefined`、feedback 提示需 AI。同时 `misconceptionsDetected` 本地恒 `[]`；demo 里 `react` 单元的 `tags:["remediation"]` 是 seed 手写，并非测评产出——「答错 → 误解登记 → remediation 复习」这条 README 主张的证据链实际是空转的。
- **影响**：docs 的 T4（Assessment 作答循环，P0-3）一旦落地，在无 AI 的环境下会做出一个**永远判错**的测评，直接损害 demo 说服力。
- **建议**：在 T4 之前把「本地模式」契约改为**两段式**——先出参考要点，用户作答后先对照自评「我觉得对了/错了」，或按关键词/要点命中给参考分；`Evaluation` 补充 `mode: "ai" | "self" | "keyword"`，本地模式不宣称 AI 判分。misconceptions 仅当 `mode==="ai"` 时才写入，避免模型语义造假。改动集中在 `engine/assessment-engine.ts` + 领域类型注释。

### P1 级 —— 高确定性收益，建议随下一批提交收敛

| # | 问题 | 证据 | 建议 | 改动面 |
|---|---|---|---|---|
| P1-1 | **掌握度阈值 0.8 四处重复** | `plan.ts` 定义 `MASTERY_THRESHOLD=0.8`，但 `loop.ts:162` 硬编码 `>= 0.8`、`HomePage` 自造 `GOAL_TARGET = 0.8`、`ReviewSession` SummaryView 写死「目标 80%」 | 全部改为 `import { MASTERY_THRESHOLD }`；LoopSnapshot 携带 `targetMastery` 供 UI 渲染 | loop/Home/SummaryView 3 文件 |
| P1-2 | **applyRating 污染 attempts/correctCount，稀释正确率** | `learner-model.ts` `applyRating` 里 `attempts: prev.attempts + 1` 但不加 `correctCount`（注释自述「自评不是对错证据」，实现却计入分母）。后续任何 `applyEvaluation` 的 confidence 向 `accuracyOf = correct/attempts` 收敛时会被稀释 → 纯自评用户的自评越多、confidence 被压得越低 | 自评只更新 `mastery/confidence/lastReviewedAt/nextReviewAt`，不碰 attempts/correctCount；attempts 只由真实对错证据累加 | learner-model.ts |
| P1-3 | **单元标题硬编码 demo id 表，真实数据会显示裸 id** | `features/units.ts` 的 `UNIT_TITLES` 只覆盖 RAG demo 的固定 id；`unitTitle()` 回退返回 id。一旦导入真实知识（P1-2 导入管道落地），Home/Study/Review 全显示 `knowledge-xxxx` | UI 改为从 graph 的 `units[]` 解析 `title`（ReviewSession 取 summary 已是此模式），`units.ts` 只保留 action/goal-type/importance 标签表；可加 `resolveUnit(graph, id)` 工具 | units.ts + 各调用页 |
| P1-4 | **demo seed 策略页面间不一致** | `HomePage` 空库时特意不 seed（把选择权交给用户），但访问 `/study` 等页 `refresh → runLearningLoop → seedDemoIfEmpty` 会静默播种 → 用户从空态点一下导航，「空库」即消失 | seed 收敛为显式动作：store 增加 `loadDemo()`（Home 空态按钮调用），`refresh` 默认不 seed；空库时各页统一走空态（见 P2-3） | useLoopStore + loop.ts |
| P1-5 | **「导入资料」空态是死胡同** | Home 空态文案「导入第一份资料，系统会自动生成学习闭环」+ 主按钮跳 `/knowledge`，但 Knowledge 页无任何导入入口 | 空态主按钮改为「载入演示数据」，次按钮文案改为「即将支持导入」；或先落地 docs P1-2 的「手动建单元」最小入口 | HomePage |

### P2 级 —— 工程卫生 / 架构前瞻

| # | 问题 | 建议 |
|---|---|---|
| P2-1 | **Provider 配置零消费点**：`buildActiveProvider()` 无调用方，settings 状态不持久化、无连接测试 → 配了 Ollama 也不会作用于任何引擎 | 提供引擎装配点（如 `composeEngines(settings)` 工厂），供未来 Assessment/Knowledge 页消费；持久化与连接测试见 docs P2-1/T7；Tauri 侧密钥建议走系统 keyring（localStorage 不放密钥是对的） |
| P2-2 | **重复/卫生**：`ratingLabel` 在 StudyPage 与 ReviewSession 重复定义（应入 units.ts）；`queueHint` 3 天硬阈值与 rating 间隔（1/2/4/7）脱钩（P0-1 修复后顺带解决）；ReviewSession 顶部 `useMemo` import 未使用（tsconfig 已开 noUnusedLocals，但 TS7 未报——建议补 ESLint 兜底） | 归一 + 引入 ESLint + 清理 unused import |
| P2-3 | **localStorage 适配无版本/无 schema**：JSON.parse 失败静默 fallback（数据损坏时用户无感知丢失）；每次 save 全量序列化 graph+learner | 加 `plos.meta.version`、load 失败 `console.warn`；数据量大后再做节流/增量（SQLite 就绪即替换） |
| P2-4 | **空库行为统一**：`runLearningLoop` 在无 goals 时 `throw`（Study 直接访问会被 error 态兜住而非空态引导） | 与 P1-4 一并处理：空库返回 `{empty:true}` 快照，各页渲染统一 EmptyState |
| P2-5 | **`DEFAULT_GOAL`（goal.ts）`requiredUnitIds: []` 且有误导性的就绪度语义**：若被复用，`actions.length===0` 会触发「🎉 已全部达标」 | 若仅作类型示例建议删除，或空 required 时 readiness 展示为「—」而非 0%/达标 |

---

## 四、里程碑建议（与 docs T1–T10 对齐，不重复其 UI 事项）

```
N1 学习模型修正批（纯函数层，低风险、可单测）      ← 建议先于 T4
   P0-1 复习调度(nextReviewAt+到期入队) · P0-2 读时衰减 · P0-3 本地判分契约 · P1-2 attempts 修复
N2 一致性收敛批（随当前未提交工作一起提交）
   P1-1 阈值收敛 · P1-3 标题数据驱动 · P1-4 seed 显式化 · P1-5 空态文案 · P2-2/3/4/5 卫生项
N3 测评最小闭环（docs T4/T1 依赖）：本地判分两段式 UI → 完成评估模式后接 AI（evaluateAnswer 已留契约）
N4 Provider 真装配：settings 持久化(keyring) + 连接测试(docs P2-1) + composeEngines → 解锁 docs P1-2 导入抽取
N5 知识图谱三态 GraphView（docs P1-1）—— 依赖 P1-3 数据驱动标题
```

---

## 五、风险与开放问题

1. **模型步长是启发式常数**（±0.08/0.12、rating 档位），confidence 校准依赖历史证据——当前无事件日志，`LearnerState` 只存聚合值。Phase 2 做遗忘曲线/置信度校准前，建议先加 **append-only 事件流**（对错/自评/时间戳），否则校准无从谈起。
2. **halfLife 与间隔档位不匹配**（30d vs max 7d），衰减公式单次 cap 5%、需重复提交才累进——在 P0-2 一并参数化。
3. **无任何测试**：引擎层全是纯函数，是 vitest 单测的高性价比对象（阈值/衰减/调度/planner 依赖排序均值得先锁行为再重构）。
4. 本次为只读评审，未运行 `npm run build`/Tauri 桌面打包；`tauri.conf.json` 中 `bundle.active=false`、`csp=null` 属 Phase 0 已知状态。

---

## 附：评审中核验过的关键事实

- `npm run typecheck`：0 错误（耗时约 2m，冷启动）。
- 工作区未提交 = 交互闭环 T1–T3 实现（Home 主 CTA/空态、Study 队列+ReviewSession 已完成含 sessionItems/撤销/完成汇总就绪度对比）+ docs 两份 2026-09 文档，与 `fed5f9e` 后的演进方向一致。
- AI Provider：`chat()` 传输层可用；`extractKnowledge/generateAssessment/evaluateAnswer` 明确 `not-implemented`（下一里程碑），anthropic/gemini 以 `NotImplementedProvider` loud-fail，符合设计。
- `useLoopStore.submitAnswer` 的 5s 撤销窗口 + 幂等保护逻辑自洽（undoStack 模块级 Map，跨组件存活，刷新即失效——可接受，已在 UI 明示会话级）。
