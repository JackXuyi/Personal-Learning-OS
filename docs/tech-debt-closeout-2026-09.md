# 隐性债收口 —— 认知层级「两把尺子」+ 两级 planner 语义归位

> **范围**：`roadmap` / `doc-truth-rescan` 记的「P2 **#10** 章级与概念层两套 planner 并行」
> 与「P2 **#11** `cognitiveLevel` 零消费」。
>
> **本轮不动**：**F5 `D1-C` / `D5-C`**（实测是 `learn-flashcard-design` 的**既定取舍**，不是债）、
> **⑤ `deleteDocumentCascade` 证据流清理**（三份文档一致标「**待拍板**」）、
> **E5 收口**（能力证书 / 下一目标引导 / 达标总结页 —— 属功能）。
>
> **结论一句话**：`#10` **零算法改动**收口（错的是叙述，不是代码）；`#11` 收口的是
> **「两把尺子」**（原有判据「零消费」只描述了症状），而「出卷难度引入 `cognitiveLevel`
> 权重」那一层**仍开放**（属产品决策，未拍板）。

---

## 1. 立项依据：实测推翻了原判

原判两条都写在 `docs/doc-truth-rescan-2026-09.md`（§2 表）与
`docs/business-flow-end-to-end-2026-09.md`（§六 P2 表）。动手前逐条实测，**两条都不准**：

| 原判 | 实测 | 差在哪 |
|---|---|---|
| **#11** `cognitiveLevel` **零消费** | **不是「死字段」，是「两把尺子」** | 原判只说了「没人读」。真正的问题是：**唯一关心层级的界面自己算了一遍**，且算得与引擎**不一致** |
| **#10** 两套 planner **并行** | **两者都活着、且服务不同页面** —— 是**上下两级** | 原判暗示「两个候选方案，选一个」；实测不存在可合并项，错的是「Phase 0 基座」这句过期叙事 |

### 1.1 #11 的决定性证据

| 侧 | 位置 | 行为 |
|---|---|---|
| **引擎（写盘）** | `engine/learner-model.ts:117`（`applyEvaluation`）、`:191`（`applyPaperResult`）→ `nextCognitiveLevel` | 把认知层级算好并**持久化**进 `UnitMastery.cognitiveLevel` |
| **界面（另算一遍）** | `features/assessment/AssessmentSession.tsx:49-55` | **无视**上述字段，由 `masteryByUnit` **重新推导**起始档位：`≥0.8→应用 / >0→理解 / 否则记忆`；再用会话内 `levelIdx`（`:106-112`）自行升降 |

**分歧点**：`mastery ∈ (0, 0.5)` 时，引擎此刻仍判「记忆」（`nextCognitiveLevel` 要 `after ≥ 0.5`
才从首档升到「理解」），而界面**从「理解」起步** —— 同一输入、两套规则、两个结果。

### 1.2 #10 的决定性证据

| 规划器 | 入口 | 消费页面 |
|---|---|---|
| 章级 `buildChapterPlan` | `engine/loop.ts:283`（`runChapterLoop`） | 首页「今日主行动」· `/plan` · `QuizReportPage` 的「生成学习计划」 |
| 概念层 `createLearningPlanner().buildPlan` | `engine/loop.ts:167`（`runLearningLoop`）→ `useLoopStore.snapshot` | `/assessment`（推荐下一个待测概念）· `CommandPalette` · 非概念模式 `ReviewSession`；另由 `ReviewSession` 的**概念模式按章裁剪**后调用（`requiredUnitIds = 该章 unitIds`） |

两者**输入与粒度都不同**（章集合+章掌握度 vs 目标所需概念集合），且**没有一页同时渲染两者**。
故「两把尺子」的判据（**同一输入算出同一件事**）在此**不成立** —— 它们是「章级选章 →
概念层在其范围内选概念」的**两级分工**。

---

## 2. #11 收口：认知层级只剩一把尺子

### 2.1 根因

**同一规则散在多处**。次序（`remember→…→create`）此前有**两份等价副本**：
`engine/learner-model.ts:60` 与 `features/learn/resplit-mastery.ts:29`；
而「档位怎么算」在界面里**还有第三份**（`AssessmentSession` 的 `LEVEL_ORDER` + 由 mastery 推导）。

### 2.2 改动

| # | 文件 | 改动 |
|---|---|---|
| 1 | `domain/learner.ts` | 新增**唯一真源**：`COGNITIVE_ORDER`（6 档次序）、`COGNITIVE_BASE_LEVEL`（初值）、`cognitiveIndexOf`（序号，**未知识 / 缺省回退 0，绝不返回 -1**）、`SESSION_LEVEL_COUNT`（＝3）、`sessionLevelIndexOf`（会话起始档位，越界钳到末档） |
| 2 | `engine/learner-model.ts` | 删除本地 `COGNITIVE_ORDER` 副本 → 引用 domain；`emptyUnit` 初值改用 `COGNITIVE_BASE_LEVEL`；`nextCognitiveLevel` 改用 `cognitiveIndexOf` |
| 3 | `features/learn/resplit-mastery.ts` | 删除本地副本 → 合并取最高改走 `cognitiveIndexOf` |
| 4 | `engine/loop.ts` | `LoopSnapshot` 增 `cognitiveByUnit: Record<string, CognitiveLevel>`；`runLearningLoop` **原样透传**持久化值（兜底走 `COGNITIVE_BASE_LEVEL`） |
| 5 | `features/assessment/AssessmentSession.tsx` | 起始档位改 `sessionLevelIndexOf(snapshot?.cognitiveByUnit[unit.id])`；**删除**本地的 `levelIndexOf` 与「由 mastery 重推」整段 |

### 2.3 唯一的行为变更（已知、已确认）

`mastery ∈ (0, 0.5)` 的单元，测评会话起始档位**从「理解」变为「记忆」**。
这是**预期的**：改前它违反「引擎已算好、界面却另算」的单一真源原则；
改后会话起始档位与题干上并列展示的 `masteryNow` / `BandBadge` 同源。

> 若将来产品希望「答对即升到理解」，**应改引擎的 `nextCognitiveLevel` 规则**（一处），
> 而不是把界面那份推导加回来 —— 后者即本轮的债。

---

## 3. #10 收口：语义归位（零算法改动）

错的是**叙述**：`engine/learning-planner.ts` 文件头曾写「概念层（**Phase 0 基座**）」，
读起来像一份「待被 V2 取代的过渡层」，于是「并存」被当成必须在「合并 / 删除」里二选一的债。

改 4 处注释，**未动任何排序 / 算法**：

| # | 位置 | 改动 |
|---|---|---|
| 1 | `engine/learning-planner.ts` 文件头 | 改写为**两级分工**：章级选章 → 概念层选章内概念；并写明两者**服务不同页面**、**不是**「两把尺子」 |
| 2 | `domain/plan.ts`（`ActionKind` 分组注释） | 「概念层（Phase 0 基座，保留给概念粒度缺口）」→「概念粒度动作（章粒度见下组）……」 |
| 3 | `stores/useLoopStore.ts`（`snapshot` 字段） | 「Phase 0 基座；ReviewSession / career 等沿用」→ 写明是**概念级**、列出真实消费方 |
| 4 | `engine/loop.ts`（`runLearningLoop` doc） | 补「两级分工的下一级；章级见 `runChapterLoop`」与消费方；删掉「随着 MVP 落地把 demo 换成真实数据」这句过期描述 |

---

## 4. 不修项及理由（本轮实测排除）

| 项 | 文档怎么说 | 为什么不修 |
|---|---|---|
| **F5 `D1-C` / `D5-C`** | `learn-flashcard-design:1185-1189` **定案 A**：「到期数只在**两处入口**显示……planner / 资料库卡面**不动**」；「B（改 planner 纳入卡到期）与 C（首页新增卡片入口）**待实际用起来后再评估，不预先实现**」 | 这是**白纸黑字的既定取舍**，不是漏做。改它 = 推翻一个已定案的决策，需先有「实际用起来后」的证据 |
| **⑤ `deleteDocumentCascade` 证据流清理** | `raw-id-label-fix:141`「孤儿引用清理策略**仍未定**……是否补证据流清理**仍待拍板**」；`evidence-log-idempotency-fix:196` 同口径 | **待拍板**项，不是可直接实施的债。`learner.byUnit` 走 (c) 档 append-only 是**刻意的** |
| **E5 剩余收口** | 能力证书 / 可复用产出、下一目标引导、达标总结页 | 属**功能开发**，不是债；有独立设计文档 `goal-capability-assessment-design-2026-09.md` |

---

## 5. 验收与守卫

新增 `tests/cognitive-level.test.ts`（**12 例**，`npm run test:cognitive`，并已并入 `npm run test:library`）：

| 组 | 断言 |
|---|---|
| 次序真源 | `TC-COG-01..05` —— 6 档次序锁定；初值＝首档；`cognitiveIndexOf` 逐档 + 未知/缺省回退 0；`sessionLevelIndexOf` 钳位；会话三档＝真源前 3 档 |
| 引擎写路径 | `TC-COG-06..08` —— 空单元初值；卷面 0.9 首考把层级推到「理解」；单次答对不足以晋级 |
| 源码守卫 | `TC-COG-09/10` —— `learner-model` / `resplit-mastery` **不得再各自定义** `COGNITIVE_ORDER`；`TC-COG-11` —— `AssessmentSession` 不得再出现本地 `levelIndexOf` 或「按 mastery 重推」分支；`TC-COG-12` —— `LoopSnapshot` 透传 `cognitiveByUnit` 且兜底**不得硬编码字面量** |

**负向验证（守卫不是假绿，三组实跑）**：

| 变体 | 结果 |
|---|---|
| 把 `COGNITIVE_ORDER` 副本塞回 `learner-model.ts`（函数作用域，避免模块级重复声明） | `TC-COG-09` **变红** |
| 把旧 `levelIndexOf` + `from >= 0.8` 分支塞回 `AssessmentSession.tsx` | `TC-COG-11` **变红** |
| 把 `COGNITIVE_ORDER` 前两档对调 | **5 例变红**（次序 / 序号 / 钳位 / 覆盖面全中） |

> 附注：若直接以模块级 `const` 塞回副本，`node` 会在**加载期**就抛重复声明 —— 比断言更早，
> 说明该回归在类型检查阶段即可被拦住。

**门禁**：`npm run typecheck` 仅剩既存 3 条 `AIModelsSection` banner* 基线；`test:cognitive` 12/12；
`test:i18n` 与其余测试组不受影响（本轮**未新增任何用户可见文案**，故无需 i18n 改动）。

---

## 6. 遗留（本轮明确未做）

1. **#11 的另一层**：`quiz-engine.ts::bandOfMastery` **仍只看 `mastery`**，未引入 `cognitiveLevel`
   权重；无历史时也**未**用 `profile.level` 定 band。**属产品决策**（难度是否该随认知层级上升），
   未拍板 → 保持现状并登记。
2. **#10 的调用边界已写进注释**，但没有机器可验的约束（例如把 `buildPlan` 的适用范围做成类型）。
   当前靠代码评审；若将来出现「误用」，再考虑加护栏。
3. 其它仍在 `roadmap` 的项：F5 `D1-C`/`D5-C`（**刻意不做**）、F7 范围 2/4、F8 范围 2–5、
   E5 收口、F10 §12.3 手工验收（**需桌面端实跑**）。

---

## 变更记录

| 日期 | 版本 | 说明 |
|---|---|---|
| 2026-09-22 | v1 | 立项并实施：#11 消「两把尺子」（次序真源 + 起始档位读持久化值）；#10 语义归位（4 处注释）。新增 `tests/cognitive-level.test.ts`（12 例）并完成三组负向验证 |
