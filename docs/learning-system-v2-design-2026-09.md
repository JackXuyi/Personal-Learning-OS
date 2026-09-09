# Personal Learning OS · 学习方案 V2 设计（章节学习 + 试卷测评 + AI 判卷驱动）

> 状态：**设计稿 v0.2（章节建模决策已定，可开工 N0）** · 2026-09-07
> 实施状态：V2 核心 N 系列已落地（2026-09-07~09-08：章级学→测→判→计划闭环、遗忘衰减/到期复习、补考卷调度、AI 判分回填、概念层回归 `27ae610`）；其后 i18n / UI Workbench 为独立轨道，见对应文档
> 关联：`docs/interaction-design-research-2026-09.md`（P0/P1/P2 建议）、`docs/interaction-design-spec-2026-09.md`（S0-S6 文字原型）、`docs/business-logic-review-2026-09.md`（业务逻辑评审 P0-P2）
> 定位：在既有 Phase 0 基座（五核心对象 + 七引擎 + 存储/AI 抽象）之上，把学习闭环从「概念级自评复习」升级为「**章节级 学 → 考 → 判 → 计划**」的考试驱动模式；本版明确**章节长期建模方案**，并给出原设计资产的完整融合去向。

**v0.1 → v0.2 变更摘要**
1. **章节建模定案：独立 `Chapter` 实体**（放弃 v0.1「unit.kind="chapter" 最小改动」）。判定依据：掌握度主体粒度将决定长期架构——章内概念层（图谱/精学）必然回归（README 愿景 + 自适应学习演进方向），扁平 kind 判别式会在概念回归时触发数据迁移 + 语义重构。
2. 保住复用红利的方式从「复用类型」改为「**复用算法**」：引擎只依赖 `MasterySubject` 接口（chapter 与 concept 皆可实现）→ learner-model / mastery-engine / 遗忘曲线 / planner 算法零重复。
3. 新增 **§2 原设计资产融合矩阵**：S0-S6 交互规格、评审 P0-1/2/3、五核心对象与七引擎逐一标注 V2 去向。
4. 掌握度写入收敛为「**双证据原则**」：章掌握度唯一写入方 = 卷面成绩；四档自评保留为章内要点复习，只刷新复习调度与置信度、不再移动 mastery（一并修正 `applyRating` 的 attempts 污染，P1）。

---

## 一、TL;DR（结论先行）

用户提出的三步思路本质是把闭环的主操作对象从「知识单元 + 四档自评」换成「**章节 + 试卷**」：

| | 现状（Phase 0.5） | V2（三步方案） |
|---|---|---|
| 学习单位 | 抽取出的知识概念（unit） | **章节**（资料切分，贴近原文阅读） |
| 验证方式 | 四档自评（忘记/困难/记得/轻松） | **试卷**：选择/判断/问答/应用题，AI 判分 |
| 掌握度依据 | 自评步进 ±0.08/0.12 | **卷面成绩**（难度加权）→ 章节掌握度 |
| 下一步 | planner 按概念缺口排序单条 action | **判卷报告 → 学习计划**（弱章重学/补考/复习） |
| 出卷粒度 | 无 | **单章（单元测）/ 多章（阶段测）/ 全本（综合测）** |

**架构决策（已定，详见 §5）**：章节是一等实体 `Chapter`（挂在 Document 下、带 order），不是 KnowledgeUnit 的一种；KnowledgeUnit 回归「概念/技能」原子语义并留位到章下。引擎层通过 `MasterySubject` 接口同时服务 chapter 与 concept，**复用算法、不复用类型**。概念抽取与图谱视图延后（N5），不阻塞三步主链路。

**闭环（三步回流）**：上传资料 → ① 章节化学习 → ② 出卷测评（客观题本地判、主观题 AI 批）→ ③ 报告生成章节掌握度 → 学习计划 → 弱章回到 ① 重学再测。目标就绪度 = 目标章节全部达到测验达标线。

---

## 二、原设计资产融合矩阵（原有设计 × V2 去向）

融合原则：**不推倒 Phase 0 基座**；每个原资产要么保留、要么改造/迁移到 V2 对应物、要么显式标注延后——不静默丢弃。

| # | 原资产（来源） | V2 中的去向 | 处理 |
|---|---|---|---|
| 1 | 五核心对象：Document / KnowledgeUnit / KnowledgeGraph / LearnerState / LearningGoal / LearningPlan（`src/domain`） | 全部保留；**新增 Chapter**（文档 → 章 → 概念三层）；KnowledgeUnit 语义回到概念粒度；LearningGoal 增加 `requiredChapterIds` 主维度 | 保留 + 扩展 |
| 2 | 概念抽取引擎 knowledge-engine（AI 抽 unit） | 挂到章下（`Chapter.unitIds` 留位），V2 首版不接入；首版的「内容理解」由章内要点卡（keyPoints）承接 | 延后 N5 |
| 3 | graph-engine + 图谱可视化（原 S3 / P1-1 GraphView） | 章节目录取代图谱作为主视图；graph 关系保留给章内概念层复用 | 延后 N5 |
| 4 | ReviewSession 四档自评（原 S1，`ReviewSession.tsx`） | 保留为章内「要点卡复习」（对 keyPoints 出卡）；按双证据原则改造：不再移动章 mastery，只更新复习调度（lastReviewedAt）与 confidence | 改造（N0 同批） |
| 5 | 学习页队列 /study（原 S1） | 迁移为「学习计划执行页」/plan（路由重定向兼容），队列项 = 计划 action（重学/补考/复习/学下一章） | 迁移（N1） |
| 6 | 测评页 S2 · 最小作答循环（单概念反复刷） | 吸收为「整卷模式」（P4 答题页 / quiz/:paperId）；判分从逐题 submitAnswer 升级为 gradePaper 整卷回写 | 吸收 |
| 7 | 首页 S0 · 范式 A（每日一屏一主行动）+ 目标梯度 + 主 CTA | 保留全部范式；语义换为「章就绪度条 + 今日主行动 = 计划头项（去学/去测/去补考）」 | 改造（N1） |
| 8 | 导入 → 抽取 → 图谱 → 学习（原验收场景 2） | 改造为「导入 → 章节切分预览（可人工微调）→ 单章学习」；抽取/图谱步骤延后 N5 | 改造 |
| 9 | M1 submitAnswer 统一评分回写（原 store action） | 升级为 gradePaper 整卷统一回写（含客观本地判 + 主观 AI 判 + 章 mastery 更新） | 吸收 |
| 10 | 共享模块：键盘流 / 5s 撤销 / Toast / 空态四件套 / DeltaBadge | 全部沿用为 V2 页面基线（答题页键盘选择、判卷后 5s 撤销、报告 Δ 徽标） | 保留 |
| 11 | Provider 连接测试（原 S4 / P2-1） | 随 N3 AI 接入落地（Settings 装配 + 连接测试 + keyring 持久化） | 保留 |
| 12 | 命令面板 Cmd+K（原 S5 / P2-2） | N4 收尾保留（跳转 /learn、/quiz/new、/plan 高价值） | 保留 |
| 13 | 职业页（原 S6 / P2-3） | 归入「目标」配置；首页就绪度按目标章显示 | 轻改（N1） |
| 14 | P0-1 复习调度断链（评审） | `UnitMastery.nextReviewAt` 字段 + 到期复习以低优先级 `review` 入队 | 吸收（N0/T3、N2/T9） |
| 15 | P0-2 遗忘衰减只写不读（评审） | `applyForgetting` 挂到读取路径（读章/目录/首页前先衰减），展示不再高估 | 吸收（N2/T9） |
| 16 | P0-3 判分契约恒判错（评审） | gradePaper：主观题无 Provider → `pending` 不伪造；misconceptions 由 AI 批语回填 | 吸收（N0/T3） |
| 17 | P1 掌握度阈值 0.8 四处重复 | 收敛为 domain 常量引用（Home/SummaryView/planner/quiz 达标判定同源） | 吸收（N0） |
| 18 | P1 applyRating 污染 attempts 分母 | 双证据原则：要点复习不再走 mastery/attempts 路径，单独 `applyKeyPointRating`（只调度 + confidence） | 修正（N0） |
| 19 | P2 Provider 装配缺失（`buildActiveProvider` 零调用） | N3/T11 真正装配 + 设置持久化 | 吸收（N3） |
| 20 | P2 localStorage 无版本 / 损坏静默回退 | storage 写入 `schemaVersion` + 迁移钩子 | 吸收（N4） |

---

## 三、三步闭环设计

### 步骤 1 · 章节化学习（学一章，过一章）

```
上传资料（V2 首版：Markdown / TXT 粘贴，PDF/DOCX 延后）
   ↓ 章节切分引擎 splitDocument()
章节列表（每章 = 独立 Chapter 实体：order / title / contentRef 正文切片 / keyPoints 要点）
   ↓ 可人工微调切分（合并 / 重命名 / 调整顺序）
逐章学习：章正文阅读 + 章内要点卡（AI 提炼；无 AI 用段落摘要兜底）
   ↓ 标记学完（不强制作答，仅提示建议先读）
单章闭环入口：「去测本章」（允许先测后学，自由顺序）
```

- 切分策略：Markdown 按 `#/##`、TXT 按空行聚类、AI 就绪后做「标题提炼 + 边界修正」，产出始终落到 Chapter（含正文切片引用，避免复制原文）。
- 章状态机：`not-started → learning（打开阅读）→ ready（标记学完）→ mastered（卷面 ≥ 0.8）`；ready 后卷面 < 0.6 → 追加 `retake`（待补考）分支。目录徽标与计划排序均读此状态。

### 步骤 2 · 章节测评（出卷 + 作答）

| 模式 | 触发场景 | 范围 | 题量 | 客观/主观配比 | 预计时长 |
|---|---|---|---|---|---|
| **单元测** | 单章 ready / 想检验单章 | 1 章 | 5 | 选择2 · 判断1 · 问答1 · 应用1 | ~8 min |
| **阶段测** | 连续几章 ready | 2–3 章 | 每章 4 | 每章客观 3 + 主观 1（轮换出章） | ~15 min |
| **综合测** | 全章 ready / 目标就绪判定 | 全本 | 15–20 | 客观 ~60% / 主观 ~40% | ~30 min |
| **补考卷** | 单元测未达标后 | 仅错题章 | 每章 3 | 客观为主（降一档难度） | ~5 min |

- 难度自适应：按章 mastery 出题——< 0.4 记忆/理解档客观题为主；0.4–0.7 标准档；> 0.7 增加应用/分析档。题面 AI 即时生成；本地模式用该章确定性题库降级（仅客观题，主观题标注「需 AI」）。
- 作答交互：客观题点击即选（交卷前可改）；主观题 textarea（标注「由 AI 批改」）；交卷前未答提示；草稿暂存 localStorage。
- 题型 → Bloom 映射：选择/判断 = remember/understand；问答 = understand/analyze；应用题 = apply/evaluate。

### 步骤 3 · AI 判卷 → 掌握度 → 学习计划

```
交卷
   ├─ 客观题：本地比对参考答案（即时确定）
   └─ 主观题：AI 逐题评分（0-1 得分 + 批语 + 定位到章节要点/原文）
              —— 未配置 Provider 则标「待配置 AI」，不计入主观分，不阻断流程
   ↓ gradePaper() → PaperResult
报告 /report/:paperId
   总分与档位 · 逐章掌握度（对比测验前 +Δ）· 错题回顾 · 薄弱要点清单
   ↓ buildLearningPlan()（由报告驱动）
学习计划 /plan + 首页主 CTA
   优先级：重学弱章 > 补考弱章 > 复习要点 > 推进下一未学章
   ↓ 回流步骤 1/2，直到目标章节全部达标
```

- **章掌握度更新（双证据原则，唯一写入方 = 卷面）**：
  `chapterScore = 客观正确率 × 0.5 + 主观均分 × 0.5`（客观按难度加权）
  `newMastery = 0.65 × chapterScore + 0.35 × prevMastery`（含历史，避免单次波动）
  落库于 `UnitMastery`（键控 chapter id），遗忘曲线继续作用于该值。
- 达标线：沿用 `MASTERY_THRESHOLD = 0.8`（综合测判定目标就绪）；单元测 < `MASTERY_FLOOR = 0.6` 触发补考建议。
- 可解释性：每个计划动作携带理由，如「《第三章 检索》卷面 52%，错 3 题集中在『向量化』→ 建议重读 3.2 节后补考」。

---

## 四、信息架构与页面交互重构

### 4.1 导航收敛（5 项）

```
旧（7 项平级）              新（5 项，主次分明）
首页 Home                 首页 Home（今日主行动 + 目标章就绪 + 最近测验）
学习空间 Spaces ┐
知识 Knowledge  ├→ 内容库（文档 → 章节目录 / 章节阅读）     [合并]
学习 Study      ┘
测评 Assessment           测评（试卷中心 / 出卷 / 答题 / 判卷 / 报告）
职业 Career  ─────→        归入「目标」配置（首页就绪可见；独立页过渡保留）
设置 Settings             设置（N3 起含 Provider 装配）
```

### 4.2 页面清单与流程（文字版原型，S0-S6 范式继承）

| 页 | 路由 | 交互要点 |
|---|---|---|
| **P1 章节目录** | `/learn` | 顶部：当前文档 + 目标就绪条；章卡片：序+标题、状态徽标（未学/学习中/待测验/待补考/已掌握）、掌握度进度、上次测验分；点卡片进阅读，菜单含「对本章出卷」；过滤（仅未达标/全部） |
| **P2 章节阅读** | `/learn/:chapterId` | 左：章正文（contentRef 切片）；右：AI 要点卡；底部主行动「标记学完」→ CTA「去测本章」；mastery≥0.8 提示「可直接综合测」 |
| **P3 新建试卷** | `/quiz/new` | 三步弹层：范围（本章/多选章/全本）→ 模式（单元/阶段/综合，实时预览题型配比与时长）→ 生成并开始；/quiz 首页保留历史试卷（继续/查看） |
| **P4 答题页** | `/quiz/:paperId` | 进度 x/y + 范围标签；选择(radio) / 判断(对·错) / 问答与应用(textarea)；交卷未答二次确认；草稿暂存；键盘 1-4 快速选择 |
| **P5 判卷中** | `/quiz/:paperId/grading` | 客观题即时对错；主观题逐题「AI 批改中…」；完成后 5s 内可撤销回改；完成自动跳报告 |
| **P6 报告** | `/report/:paperId` | 总分+档位；逐章掌握度条（vs 测验前 +Δ，DeltaBadge）；错题回顾（题目/答案/AI 批语/定位要点）；主行动「生成学习计划」；次行动「补考」（仅错题章） |
| **P7 学习计划** | `/plan` | 行动队列（带 reasons）：重学章节 → 补考 → 要点复习 → 学下一章；点击直达；与首页主 CTA 同源 |

### 4.3 复用与降级

- ReviewSession 四档自评 → 章内「要点卡复习」（对 keyPoints 出卡，复用既有卡片/键盘/5s 撤销 UI）；
- 原 Knowledge 列表页 → P1 章节目录（数据源：按文档聚合的 Chapter 列表）；
- 原 Study 队列 → P7 计划页（`/study` 301 重定向）；
- 键盘流、Toast、空态四件套、DeltaBadge 全部沿用。

---

## 五、领域模型（v0.2 定稿：三层 + 引擎接口化）

### 5.1 对象关系

```
Document（资料，五对象之一）
  └─ 1 : n  Chapter（新增一等实体，order 排序）   ← V2 学习/测评/计划的主对象
              └─ 0 : n KnowledgeUnit（章内概念/技能，N5 启用，此处仅留位 unitIds）

LearnerState.byUnit ── 键放宽为「可掌握对象 id」：chapter id（V2 主）或 unit id（概念层）
LearningGoal.requiredChapterIds（主） ／ requiredUnitIds（概念层，延后）
```

设计理由（决策记录）：**掌握度主体的粒度决定长期架构**。考试驱动模式下掌握度主体就是章；但 README 愿景与自适应学习演进（跳过已掌握章、只补薄弱概念、图谱可视化）都要求概念粒度最终回归。独立 Chapter 让「文档 → 章 → 概念」三层天然可表达：概念回归时只是给 `Chapter.unitIds` 填数据 + 引擎算法经 `MasterySubject` 直接复用，**无迁移、无 kind 判别式蔓延**。

### 5.2 类型草案（对齐真实代码 `src/domain`）

```ts
// domain/chapter.ts（新增）
export interface Chapter {
  id: string;                    // "chp-…"
  documentId: string;            // 所属文档（原 unit.sourceDocumentId 语义上移）
  order: number;                 // 章序号 1..n（planner / 目录排序依据）
  title: string;
  contentRef: { start: number; end: number };  // 正文切片引用（不复制原文）
  keyPoints: string[];           // 章内要点（AI 提炼 / 段落摘要兜底）→ 要点复习数据源
  unitIds: string[];             // 章下概念留位（N5 抽取引擎写入；V2 首版恒空）
  status: ChapterStatus;         // not-started | learning | ready | mastered | retake
  createdAt: number;
}

// domain/knowledge.ts（收敛：KnowledgeUnit 回归概念语义，kind 不加 "chapter"）
// 原五核心对象全部保留；LearningGoal 扩展：
export interface LearningGoal {
  // …原字段…
  requiredChapterIds: string[];  // V2 主维度（跨文档章节集合）
  requiredUnitIds: string[];     // 概念层（N5 启用，V2 首版空）
}

// 引擎接口化 —— 掌握度引擎只依赖可掌握对象抽象（复用算法，不复用类型）
export interface MasterySubject {
  id: string;                    // chapterId 或 unitId
  kind: "chapter" | "concept";
  title: string;
}
// learner-model / mastery-engine / 遗忘曲线 / planner 的入参由
// 「KnowledgeUnit 派生」放宽为「MasterySubject 派生」，签名语义不变。
export type TrackableId = string; // 兼容：byUnit 键名保留（存储无迁移），键值可为章或概念 id
```

### 5.3 掌握度与调度（对 UnitMastery 的扩展，对齐 `domain/learner.ts`）

```ts
export interface UnitMastery {
  // …原字段（mastery / confidence / attempts / correctCount / cognitiveLevel /
  //         misconceptions / lastReviewedAt / lastAssessmentAt / applicationAbility /
  //         interviewAbility）……
  nextReviewAt?: number;   // P0-1：由卷面/要点复习写入，planner 到期后以 review 入队
}

// engine/learner-model.ts（新增）
export function applyPaperResult(
  state: LearnerState, chapterId: string,
  result: { score: number; prevMastery: number },
  now: number,
): LearnerState;   // newMastery = 0.65×score + 0.35×prev；更新 confidence、nextReviewAt

// engine/learner-model.ts（改造：双证据原则）
export function applyKeyPointRating(
  state: LearnerState, chapterId: string, rating: SelfRating, now: number,
): LearnerState;   // 只写 nextReviewAt + 微调 confidence；不动 mastery / attempts / correctCount
                   //（替代原 applyRating 的 mastery+attempts 副作用；ReviewSession 同批切换）
```

> 注意：v0.1 曾以 `KnowledgeUnit.kind = "chapter"` 作为推荐方案，本版已否决。遗留影响：原 `KnowledgeUnit` 的 `sourceDocumentId` 字段可保留（概念级证据链），Chapter 用独立 `documentId`。

### 5.4 quiz 域对象（新增，同 v0.1）

```ts
// domain/quiz.ts（新增）
type QuizType = "choice" | "judge" | "qa" | "application";
type PaperMode = "unit-test" | "stage-test" | "final-test" | "retake";
interface PaperScope { chapterIds: string[]; mode: PaperMode; }
interface PaperQuestion {
  id: string; chapterId: string; type: QuizType;
  cognitiveLevel: CognitiveLevel; prompt: string;
  options?: string[];          // choice 用
  answer?: string;             // judge/choice 参考答案
  referenceAnswer?: string;    // qa/application 评分参考
  difficulty: number;          // 1..5
}
interface Paper {
  id: string; scope: PaperScope; title: string;
  questions: PaperQuestion[]; status: "open" | "grading" | "done";
  createdAt: number; submittedAt?: number;
}
interface PaperResult {
  paperId: string; totalScore: number;         // 0..1
  perChapter: Record<string, { score: number; previousMastery: number; mastery: number }>;
  wrongQuestions: { questionId: string; yourAnswer: string; aiFeedback?: string; point?: string }[];
  createdAt: number;
}
```

### 5.5 plan 域对象（扩展）

```ts
// domain/plan.ts（扩展；原 learn/review/practice/remediation/assessment/explore 保留给概念层）
type ActionKind 增加 "learn-chapter" | "chapter-quiz" | "retake-quiz" | "review-points";
// NextAction.unitId 兼容承载 chapterId（字段注释泛化为 subjectId），避免 UI 层双字段
```

### 5.6 引擎改造映射（对齐 `src/engine/*` 真实实现）

| 模块 | 文件 | V2 职责与改造 |
|---|---|---|
| **章节切分引擎**（新） | `src/engine/splitter-engine.ts` | `splitDocument(doc) → Chapter[]`；启发式优先（标题/段落），Provider 就绪后 AI 精修（标题提炼 + 边界修正 + keyPoints）；产出直接落 Chapter + 写入存储 |
| **试卷引擎**（新） | `src/engine/quiz-engine.ts` | `createPaper(scope, learnerState)` 出卷（配额/配比/难度自适应）；`gradePaper(paper, answers, provider)` 客观本地判 + 主观 AI 判；`buildReport` → PaperResult + 调 `applyPaperResult` |
| 测评引擎改造 | `src/engine/assessment-engine.ts` | 题型扩展 choice/judge/qa/application；本地确定性题库（单章 recall/判断模板）；**落地 P0-3 判分契约**：主观题无 Provider → `pending`，不伪造判分；misconceptions 由 AI 批语回填 |
| 学习模型 | `src/engine/learner-model.ts` | 新增 `applyPaperResult` / `applyKeyPointRating`；`applyRating` 退场或仅作兼容转发；`UnitMastery.nextReviewAt` 写入；**修正 P1 attempts 污染** |
| 规划器 | `src/engine/learning-planner.ts` | 输入改为「章维度」：goal.requiredChapterIds → 按 order + 章状态排序（重学 > 补考 > 复习 > 下一章）；章内概念缺口 DFS 原逻辑保留给 N5 概念层 |
| 掌握度引擎 | `src/engine/mastery-engine.ts` | `masteryOfUnit` 泛化为 subjectId（读 byUnit 同键即可，改动极小）；bandOf 不变 |
| 遗忘曲线 | `src/engine/learner-model.ts` `applyForgetting` | 逻辑已遍历全部 byUnit 键——章键天然受覆盖；**P0-2** 补：读取路径先衰减（N2/T9） |
| AI Provider | `src/ai/types.ts` + openai-compatible | 新增 `splitDocument` / `generateQuizQuestions(scope, learnerState)`；强化 `evaluateAnswer` 输出（批语 + 定位要点） |
| 存储 | `src/storage/*` | 新增 chapters / papers / paper-results / 切分草稿持久化键（沿用 localStorage，SQLite 预留）；`schemaVersion` 字段（P2） |
| 状态 | `src/stores/*` | 新增 `useQuizStore`（出卷配置/答题草稿/判卷状态）；loopStore 报告与计划联动 |

---

## 六、本地模式（无 AI）行为清单（诚实降级）

| 能力 | 无 Provider 时的行为 |
|---|---|
| 章节切分 | 标题/段落启发式切分（可手动微调）；keyPoints 取该章首段摘要 |
| 客观题（选择/判断） | 本地确定性题库 + 本地判分（完整可用） |
| 问答/应用题 | 卷面标注「主观题需配置 AI 出题/批改」，剔除不计分；报告提示配置 Provider 入口 |
| 掌握度与计划 | 基于客观分正常产出（主观缺失以「待配置」占位，不做伪造加权） |
| UI 引导 | 首次出主观题时弹「配置本地模型 / API」引导（复用 Settings 连接测试） |

## 七、里程碑与 Task 建议（v0.2）

```
N0  数据与模型地基（纯函数层，typecheck + 自测通过为准）
    T1  Chapter 实体 + 存储键 + splitter-engine 启发式切分（MD/TXT，含切分草稿与人工微调）
        · 改动：新增 domain/chapter.ts、engine/splitter-engine.ts；storage 键扩展
    T2  quiz 域对象 + quiz-engine 出卷（四卷型配额/配比/难度自适应）+ 本地确定性题库
        · 改动：新增 domain/quiz.ts、engine/quiz-engine.ts；assessment-engine 题型扩展
    T3  gradePaper 客观判分 + learner-model.applyPaperResult 平滑更新 + UnitMastery.nextReviewAt
        · 一并落地：P0-3 判分契约（主观无 AI → pending）、P1 阈值收敛到 domain 常量、
        · applyKeyPointRating 替换 applyRating（修正 attempts 污染，P1）
    T4  planner 章级化：LearningGoal.requiredChapterIds + 章状态机排序（learn-chapter /
        chapter-quiz / retake-quiz / review-points）+ 报告→计划联调
N1  页面闭环（对齐 §4 文字原型）
    T5  /learn 章节目录 + /learn/:chapterId 阅读与「标记学完」（改造原 Knowledge/Study 路由）
    T6  /quiz 新建试卷(范围/模式三步弹层) + /quiz/:paperId 答题页（草稿/未答确认/键盘流）
    T7  /quiz/:paperId/grading 判卷流 + /report 报告页（DeltaBadge、补考入口）
    T8  /plan 计划页 + 首页主 CTA 改造（章就绪度语义，替换概念缺口仪表盘）
N2  学习模型增强
    T9  遗忘曲线接入读取路径（P0-2，读目录/首页前 applyForgetting）+ nextReviewAt 到期复习入队（P0-1 收口）
    T10 补考卷生成（仅错题章，降一档难度）+ 章状态机 retake 流转
N3  AI 接入（可选，依赖 Provider 装配）
    T11 Settings Provider 装配（buildActiveProvider 真正接线 + 连接测试 + keyring 持久化，P2）
    T12 splitDocument AI 精修 / generateQuizQuestions / 主观题 AI 批改提示词流水线
N4  收尾
    T13 路由迁移（/study → /plan 重定向）、导航收敛（7→5）、键盘流/5s 撤销/空态回归、
        命令面板（S5）、storage schemaVersion 与损坏恢复（P2）
N5  概念层回归（单独立项，不阻塞 V2 主链路）
    T14 抽取引擎挂回章下（Chapter.unitIds）+ 概念级缺口 DFS 规划 + 图谱视图（恢复原 S3/P1-1 资产）
```

## 八、决策记录与待确认问题

**已定决策（v0.2）**
1. **章节建模：独立 Chapter 实体（方案 B）+ 引擎接口化（MasterySubject）**——理由见 §5.1 决策记录。原 v0.1 的「kind="chapter" 最小改动」作废。落地节奏：N0/T1 建实体与接口，N5 概念层回归时零迁移。
2. **掌握度双证据原则**：章 mastery 唯一写方 = 卷面（applyPaperResult）；自评仅作要点复习（applyKeyPointRating：调度 + confidence）。

**待确认问题（默认值即推荐项，如无异议按默认推进）**
3. 四档自评在 V2 的定位：**保留为章内「要点卡复习」（推荐）** / 移除 / 仅对 mastery≥0.8 章开放
4. 无 AI 时主观题：**从卷面剔除并引导配置（推荐）** / 参考要点 + 自我对照打分
5. 章节来源范围：首版只支持「Markdown/TXT 粘贴导入」（推荐，绕开 PDF 解析依赖），PDF/DOCX 延后至文档管线里程碑
6. 题库归属：出卷「AI 即时生成为主 + 本地模板题库兜底」是否满足预期，还是需要「手动录题 + 题库持久化」（后者工作量显著上升，建议延后）

## 附：与本轮评审/规格的衔接索引

- 评审 P0-1 复习调度 → N0/T3 + N2/T9（nextReviewAt + 到期入队）
- 评审 P0-2 读时遗忘衰减 → N2/T9
- 评审 P0-3 判分契约 → N0/T3 + §6 本地模式清单
- 评审 P1 阈值收敛 / applyRating 污染 → N0/T3
- 评审 P2 Provider 装配 / storage 版本 → N3/T11、N4/T13
- 交互规格 S0 首页范式 / M1 回写 / S1 自评复习 / S2 作答循环 → 见 §2 融合矩阵 4/5/6/7/9/10
- 原 P1-1 图谱可视化 / 场景 2 导入链路 → 降级 N5/T14，章节目录先行

