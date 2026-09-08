# Personal Learning OS · UI Workbench 优化方案（Today-first 工作台）

> 版本：2026-09-08 · 方案稿 v1.1（**评审定稿版**，含 5 项决策落定，可直接转开发）
> 上游输入：产品评审意见（38 节文字 UI Wireframe，下称「建议稿」）
> 关联文档：`docs/learning-system-v2-design-2026-09.md`（V2 三步闭环，**架构主文档**）、`docs/interaction-design-spec-2026-09.md`（S0–S6 文字原型，**交互主文档**）、`docs/interaction-design-research-2026-09.md`（调研 P0/P1/P2）、`docs/ai-model-center-plan-2026-09.md`、`docs/i18n-design-2026-09.md`
> 定位：在 **V2 领域/引擎不动** 的前提下，把 UI 从「功能页拼装 + 学习流程」重构为「**Personal Learning OS 工作台**」的信息架构与视觉层级方案。不推倒 Domain/Engine，只重构 AppShell + Navigation + 页面层级 + 视觉系统。

---

## 0. 如何读这份文档

| 章节 | 内容 | 读者 |
|---|---|---|
| §1 TL;DR + 决策快照 | 结论先行 + 本次评审落定的 5 项决策 | 所有人 |
| §2 背景与目标 | 为什么现在是「工作台化」的时机 | 产品 |
| §3 现状差距与裁决表 | 建议 38 节 × 仓库现状 × 裁决（采纳/部分/延后/已有） | 产品 + 开发 |
| §4 目标信息架构 | 导航 / 路由 / 页面清单 / UI↔Domain 映射 | 架构 |
| §5 视觉系统（Linear 风格翻新，评审定稿） | 语义 token + 排版节奏 + 三大核心组件规范 | 设计 |
| §6 里程碑 U0–U6 | 每里程碑：目标 / 页面要点 / 数据来源 / 改动文件 / 验收 | 开发 |
| §7 数据与引擎支撑 | 需要新增的薄层清单（不绑架 Domain） | 架构 |
| §8 路线图与并行策略 | U 系列 × V2 N 系列如何共存 | 项目经理 |
| §9 风险矩阵 | P0/P1/P2 | 所有人 |
| §10 决策记录 | 本次评审 5 项决策 + 原文案存档 | 产品决策 |

图例沿用 V2/交互规格文档：`[按钮]`、`█░░░` 进度、`↓` 跳转、`【新】/【原】`。

---

## 1. TL;DR（结论先行）

建议稿方向**总体采纳**：它把 UI 从「系统有什么」翻转为「我现在该做什么」，与 README 核心问题（基于知识/目标/历史持续决定下一步学什么）以及 V2「章就绪度 + 计划头项 = 主行动」的实现是**同一叙事的两层表述**。仓库现状不是要从零改，而是**语义已经到位、叙事与层级没到位**。

### 1.1 本次评审决策快照（v1.1 定稿）

| # | 决策点 | 定稿 | 对方案的影响 |
|---|---|---|---|
| D1 | 视觉方向 | **B 案：Linear 风格 token 全面翻新**（不做 A 案过渡） | §5 视觉系统按 B 案定稿并**前置进 U0**；全站页面随里程碑以新风格落地，不再有「U8 可选翻新」 |
| D2 | Library 与 Learn | **A 案：升级 /learn 为资料库观感**（最小变更） | 不新增 /library 路由（§4.3 / U5） |
| D3 | 目标模型 | **直接多目标 CRUD**（不做单目标过渡） | goal repo + activeGoal 上下文**提前到 U0 数据准备**；U1 Today 起即为多目标上下文；Goals 管理页 U6 收口（§7.2 / U0 / U6） |
| D4 | /assessment 概念级测评 | 默认：**移除导航入口，路由保留**（N5 概念回归后再启用） | U4 落地 |
| D5 | 里程碑节奏 | 默认：**U0–U4 批审后连续开工** | §8 路线图按连续开工编排 |

### 1.2 其余关键裁决（详见 §3）

1. **采纳核心叙事**：首页 → `Today`；一屏只给一个「Next Best Action」，并回答 *why now*（数据源已具备：`NextAction.reasons[]` + `buildChapterPlan` 的可解释理由）。
2. **采纳导航分组收敛**：`TODAY / LEARN / KNOWLEDGE / GOALS / SYSTEM` 五组；页面落地**沿用现有路由与 V2 语义**（/plan /learn /quiz 等路由不变），避免为改名而大迁移。
3. **采纳 `Career` 降为 Goal 视图**：不是删除，而是把「职业 = 目标类型之一」讲清楚；U6 Goals 页上线后 `/career → /goals`。
4. **延后而非砍掉**：全局 Knowledge Graph、Agent、Research、Plugins、概念层 Evidence 深度可视化，均归 P4/延后（与 V2 融合矩阵 #3 一致）。
5. **实现顺序**：`U0 视觉系统+AppShell → U1 Today → U2 Plan → U3 Learn/Reader → U4 Assessment → U5 Library/Import → U6 Goals/My Learner/Evidence`（与建议稿 §37 一致）。

一句话总结：**用 6 个 UI 里程碑（U0–U6），以 Linear 风格视觉系统打底，把已建成的 V2 闭环重新包装成一个「每天打开只回答一个问题：现在最值得学什么」的 Personal Learning OS；目标层从一开始就是多目标（goal repo + activeGoal），领域层不动。**

---

## 2. 背景与目标

### 2.1 为什么是现在

- 仓库已越过 UI scaffold 阶段：V2 已经完成 **章节建模（Document → Chapter → KnowledgeUnit）、试卷中心（出卷向导 → 答题 → AI 判卷 → 报告 → 计划回流）、章级 /plan 执行队列、可解释的 buildChapterPlan 理由链**。
- 但页面叙事仍是「功能页拼装」：导航叫「学习空间/知识/测评/职业」描述的是系统能力，首页 CTA 是 engine 输出的 action 却没有解释它为什么值得现在做；用户看不到「系统怎么理解我」（Learner Profile 缺位）、也看不到「我为什么要学」（Goals 缺位）。
- 产品名是 **Personal Learning OS**，UI 心智却像 **AI 学习工具集合**。本轮改版的本质：让 UI 把 README 里的领域模型讲给用户听。

### 2.2 目标（本方案交付什么）

| 目标 | 度量 |
|---|---|
| 首页从「系统仪表盘」变为「Today 启动器」 | 首屏只突出 1 个决策：Next Best Action，附 why-now 证据链；且目标上下文可切换（多目标） |
| 导航从「页面清单」变为「工作台分组」 | 五组导航（TODAY/LEARN/KNOWLEDGE/GOALS/SYSTEM），Career 从一级导航降级为 Goal 类型 |
| 测评收敛为「Assessment Center」 | 导航入口统一指向 /quiz 试卷中心；概念级 /assessment 移出导航（路由保留） |
| 视觉系统升级为 Linear 风格工作台 | B 案 token 在 U0 一次性落地；每个页面自带新风格验收（无半旧半新） |
| 三大核心组件贯穿全站 | Action Card / Knowledge Row / Evidence Row 成为统一视觉语法 |
| UI 不绑架 Domain | §7 新增全部为「薄查询/视图模型」，不改核心对象与引擎算法 |

### 2.3 明确不做（Out of Scope，本轮）

- 不改路由路径骨架的核心（仅新增/改名少量页面与重定向）。
- 不动领域模型、引擎算法、存储 schema（§7 薄层除外，且向后兼容）。
- 不做全局图谱重设计（延续 V2 融合矩阵 #3，N5 后）。
- 不做移动端（Tauri Desktop 优先，建议稿 §29 同意，Mobile 单列后续）。

---

## 3. 现状差距与裁决表（建议 38 节 × 仓库现状）

> 证据来源为本仓库真实代码（2026-09-08 快照）。裁决五档：**采纳**（按建议做）/ **部分采纳**（改形式，保留意图）/ **已有**（现状已覆盖，仅需微调命名或层级）/ **延后**（方向对，非本轮，挂 P4/N5）/ **调整**（意图保留但做法需与 V2 决策对齐）。

### 3.1 产品叙事与信息架构

| # | 建议要点 | 仓库现状（证据） | 裁决 |
|---|---|---|---|
| 1/5/6/7 | 首页改 Today，突出 NBA + Goal Readiness + why-now | HomePage 已是「章就绪度 + 主行动 CTA」，**但叫「Home/首页」、无 Goal 上下文、无 Evidence feed、无日期** | **采纳**：改名 Today；补 Goal 上下文（activeGoal 可切换）、why-now 卡、Today 清单、Recent Evidence（U1） |
| 2/33/34 | 视觉语言 Linear×Arc×Readwise、quiet/dense/editorial | AppShell 全站 `slate-50 + 白卡 + slate 边框 + indigo + rounded-lg/xl`；无语义 token（main.css 仅 @theme 字体） | **采纳（评审 D1 = B 案）**：视觉系统定稿为 B 案，U0 一次性落地（§5/§6-U0） |
| 3/30/31 | 导航五组 + IA 收敛 + UI↔Domain 映射 | AppShell 已按 5 组视觉分组，但组语义是「学习闭环/开始学习/内容/规划/系统」，项仍平铺 9 个（含骨架页 spaces/career） | **部分采纳**：保留 5 组骨架，重排为 TODAY/LEARN/KNOWLEDGE/GOALS/SYSTEM；映射表见 §4.4 |
| 4/22 | Career 不入一级导航 → Goals（Career=目标类型） | Career 页 = 单目标就绪度快照（snapshot 概念级读法）；无多目标 UI | **采纳（评审 D3 = 多目标）**：U0 起 Career 移入 GOALS 组并视觉降权；数据层 U0 就绪多目标（goal repo + activeGoal）；U6 建成 Goals 页后 Career 语义并入 |
| 8/9 | Plan 不是 todo list，而是 Knowledge State→Action→Reason | PlanPage 已是「章级计划执行队列」，每项带 kind 徽标 + 掌握度 + reasons + 直达入口；**未分段（NEXT/UP NEXT）** | **部分采纳**：复用现有队列；增加 NEXT / UP NEXT 分段 + 时间预估 + 分层视觉（U2） |
| 10/12/13 | Learn = Content→Chapter；Reader 左正文右 AI 要点，增 Knowledge/Evidence | ChapterCatalog + Reader 符合 Content→Chapter→Unit 三层（V2 §5.1）；Reader 右栏有状态卡 + 要点卡，**缺 Knowledge 标签区与 Evidence 溯源区** | **部分采纳**：Reader 右栏扩为四区（状态 / Why it matters / Knowledge / Evidence），U3 |
| 14/15 | Graph 作为 KNOWLEDGE 一级导航，节点承载 Mastery/Goal/Evidence | 全局图谱已被 V2 决策降级为**章内概念图谱**（/learn/:chapterId/graph，N5 概念回归）；全局 GraphView 组件保留未接 | **延后**：与 V2 融合矩阵 #3 一致；导航中 Graph 占位（disabled/coming），概念层级到位后回归 |
| 16/17/18/19 | Assessment Center：Recommended/Recent；New 三步；Quiz 极克制；Report→Plan | /quiz 已完整实现（中心 + 三步向导 + 答题 + 判卷 + 报告）；答题页已基本克制；**导航无「测评」汇聚语义；缺 Recommended 弱项直推** | **部分采纳**：/quiz 中心升级 Recommended 区块（引擎 topN 已具备）；/assessment 概念级收敛（U4，评审 D4） |
| 20/21 | Goals 页 + Goal Detail（Readiness/Knowledge/Gaps/Path） | 无多目标 UI；domain LearningGoal 已含 type/requiredChapterIds/deadlineAt（多目标建模已就绪但无 repo/seed/UI） | **采纳（U6，评审 D3）**：数据层 U0 就绪（goal repo + activeGoal），Goals 管理页 U6 落地 |
| 23 | My Learner（concepts / strengths / gaps / patterns / misconceptions） | 无此页；但全部数据可从 LearnerState + graph + session records 推导 | **采纳（U6）**：纯视图页，零引擎改动 |
| 24 | Evidence 页（Source→Knowledge→Q→A→Evaluation→Mastery） | 无持久化 evidence log；session records 只存会话内 | **部分采纳**：先做「Report/Review 完成后的证据行」在 Today/My Learner 呈现（U1 的 Recent Evidence 起步），独立 Evidence 页待 evidence log 薄层（§7.1） |
| 25/26 | Settings 分区 + Local-first AI 突出 | Settings 已双 Tab（本地/API）且连接测试就绪；未做分区导航与「Local-first」叙事 | **部分采纳**：新增左分区（AI/Storage/Learning/Appearance/Shortcuts/About）骨架 + 顶部 Local-first 摘要卡（U6 与 U0 之间小步，见 §6 U6b） |
| 27 | Import 全产品顺畅入口 | ImportModal 已存在（/learn 内，支持 ?import=1） | **采纳**：入口上提至全局（Header/⌘K/空态）；流程增加步骤进度（Reading→Detecting→…→Linking）反馈（U5） |
| 28 | ⌘K 核心入口（SUGGESTED/SEARCH/COMMANDS） | CommandPalette 已存在：顶部行动项 + 跳转 + recent | **采纳**：补 SEARCH（文档/章节/概念/目标）与 COMMANDS 分区、⌘K 建议首项 = 今日下一步（U0） |
| 29 | Desktop 先、Mobile 后 | Tauri Desktop | **已有**（Roadmap 记档，本轮不做） |
| 35/36 | 三大组件 + 首页克制到极致 | 有 Card/Bar/Stat/BandBadge/DeltaBadge 原语；无 ActionCard/KnowledgeRow/EvidenceRow 语义组件 | **采纳**：抽三个语义组件（U0 建，全站替换） |
| 32 | 减少 Card、增加层级（ONE DECISION 流） | 现 UI 大量 Card 堆叠 | **采纳**：作为 B 案视觉原则写进 §5 |

### 3.2 功能与领域差距

| # | 建议要点 | 仓库现状 | 裁决 |
|---|---|---|---|
| — | Next Action 的 why-now 数据 | `NextAction.reasons: string[]` + planner 已生成可解释理由（goal requirement / 前置就绪 / 测评弱 / 图谱瓶颈在概念层） | **已有**：Today 卡直接渲染 reasons，配 4 条图标化 Reason 行 |
| — | Goal readiness（章级） | V2：目标就绪度 = 目标章全部 ≥0.8（spec 与 plan 页已展示章就绪度卡） | **已有**：U1 首页头直接引用；多目标下按 activeGoal 范围裁剪（§7.3） |
| — | Mastery / 认知层级 / 遗忘 | `UnitMastery{mastery,confidence,cognitiveLevel,misconceptions,nextReviewAt,applicationAbility}` + applyForgetting | **已有**：My Learner 全部字段可映射 |
| — | 概念级 vs 章级测评并存 | /assessment（概念级自适应）+ /quiz（V2 章试卷）双轨 | **调整（评审 D4）**：导航测评入口统一到 /quiz；/assessment 路由保留，首页不再挂概念测评入口，待概念层回归（N5）再恢复为「章内概念自检」 |
| — | 多目标管理 | 单 seed 目标（DEFAULT_GOAL）+ Career 页常量 GOAL_TARGET | **采纳（评审 D3）**：storage 新增 goal repo（U0 数据准备）；UI 从 Today 起为多目标上下文，Goals 管理页 U6 |
| — | Evidence 持久化 | 会话级 records 存在，未持久化到 storage | **U6 前置薄层**（§7.1）：assessment/gradePaper/review 完成时追加 evidence 行 |

---

## 4. 目标信息架构

### 4.1 导航终态（U0 落地）

```
PLOS                                    ⌘K Search everything      ● Local Qwen3.5
├── TODAY
│     Home            ← Today 启动器（activeGoal 上下文）
├── LEARN
│     Plan            ← 章级学习计划（改自 /plan）
│     Learn           ← 章节目录 / 学一章（/learn）
│     Assess          ← Assessment Center（/quiz，V2 试卷中心；含 New/判卷/报告）
├── KNOWLEDGE
│     Library         ← 文档资料库 + 导入（/learn 文档层观感升级）
│     Graph           ← 全局知识图谱（占位，coming；章内图在 /learn/:chapterId/graph）
├── GOALS
│     Goals           ← 目标列表 / 详情 / 新建 / 编辑（U6 前先放 Career 降权入口）
└── SYSTEM
      My Learner      ← 学习者画像（新 /learner，U6）
      Settings        ← 设置（含 Local-first AI 摘要）
```

**路由处理原则**（V2 兼容，不破坏既有链接）：
- `/plan /learn /quiz /report/:paperId /settings` 等既有路径**一律不变**，只改侧栏分组/命名/文案。
- `/spaces`（骨架页）从主导航摘除，路由保留（README/历史链接不 404）；内容能力并入 Library。
- `/career` 在 U6 前保留在 GOALS 组（降权入口）；U6 Goals 完成后重定向 `/career → /goals`。
- 新增 `/goals`、`/goals/:goalId`、`/goals/new`（多目标 CRUD，U6）、`/learner`；`/evidence` 待 evidence log 落地后再开。
- `/knowledge` 维持现状重定向 `/learn`，Graph 占位由导航 disabled 项表达，不建死路由。

### 4.2 Header 终态（U0）

```
┌──────────────────────────────────────────────────────────────────────┐
│  PLOS                  [ ⌘K 搜索文档/章节/概念/目标/证据 ]     ● Qwen │
│  Personal Learning OS                                              │
└──────────────────────────────────────────────────────────────────────┘
```
- 左侧：Brand（现有）；中间：全局搜索框（点击 = 唤起 CommandPalette，U0）；右侧：AI 状态点（复用 providerReady，点击去 /settings）。
- Header 高度收紧（建议 ≤48px），主区让给内容；风格随 B 案（白底 + 底部细分隔线，去大卡片感）。

### 4.3 页面清单与建议稿对照

| 终态页面 | 建议稿来源 | 落点（真实路由/文件） | 里程碑 |
|---|---|---|---|
| Today | §5–7、36 | / → `features/home/HomePage` 重构 | U1 |
| Plan | §8–9 | /plan → PlanPage 分段升级 | U2 |
| Learn（章目录） | §10 | /learn → ChapterCatalog（B 案视觉 + 文档态） | U3 |
| Chapter Reader | §13 | /learn/:chapterId → Reader 右栏扩区 | U3 |
| Assessment Center | §16 | /quiz → QuizCenter 升级（Recommended 直推） | U4 |
| New Assessment | §17 | /quiz/new（已有三步，微调文案对齐模式名） | U4 |
| Quiz | §18 | /quiz/:paperId（已有，克制性审查） | U4 |
| Report | §19 | /report/:paperId（已有，强化 Needs attention → Review 链） | U4 |
| Library | §11 | **A 案：升级 /learn 观感**（文档卡 + 探索度 + 页头导入/搜索） | U5 |
| Import | §27 | ImportModal 上提全局 + 进度反馈 | U5 |
| Goals / New / Detail | §20–22 | 新 /goals、/goals/new、/goals/:goalId（**多目标 CRUD**） | U6 |
| Career(=Goal type) | §22 | U6 前保留 /career 降权；U6 后并入 goals/:goalId 的 type=career 展示 | U6 |
| My Learner | §23 | 新 /learner | U6 |
| Evidence | §24 | Today 内 Recent Evidence 先行；独立页挂 §7.1 薄层 | U6+ |
| Graph | §14–15 | 章内图已有；全局图延后（P4） | 延后 |
| Settings | §25–26 | /settings 分区化 + Local-first 摘要 | U6b |

### 4.4 UI ↔ Domain 映射（建议稿 §31 对齐版）

| UI | 核心对象（真实 domain） | 备注 |
|---|---|---|
| Today | ChapterPlan.next / actions + LearningGoal（activeGoal）+ LearnerState | plan 已含 next/actions/learner；多目标下按 activeGoal 裁剪范围 |
| Plan | LearningPlan.actions（NextAction） | 按 priority 已排序；作用域 = activeGoal |
| Learn | SourceDocument + Chapter | |
| Reader | Chapter（contentRef 切片 + keyPoints） | |
| Assessment Center | Paper + Chapter | Recommended 用引擎 topN/弱项 |
| Report | PaperResult + LearnerState 增量 | gradePaper 已回写 mastery |
| Library | SourceDocument + Chapter 聚合进度 | |
| Graph | KnowledgeGraph（章内）+ KnowledgeRelation | 全局待 N5 |
| Goals | LearningGoal（type/requiredChapterIds/deadlineAt）+ goal repo | 多目标 CRUD（U0 数据层 / U6 UI） |
| My Learner | LearnerState（byUnit）+ KnowledgeGraph + records | 纯视图 |
| Evidence | EvidenceRow（§7.1 薄层） | 新持久化记录 |
| Settings | AIProvider/Storage | 已有 |

> 原则：**导航与页面属于 UI 的自由表达；对象与引擎属于 Domain 的唯一事实。** 上述映射确保任何页面只是 Domain 的一个「读法」，UI 决策不回灌建模（延续 V2 融合矩阵原则）。多目标只新增 **goal 的持久化 repo 与「当前目标」上下文选择**，不改 LearningGoal 模型本身。

---

## 5. 视觉系统（Linear 风格翻新 · 评审 D1 定稿 = B 案）

> 本章是定稿视觉方向，不再有 A/B 两案。原则沿用建议稿 §32/33/34 与 Linear/Arc/Readwise 的 quiet · dense · editorial · technical · focused 气质，但**不复制任何产品**：保留现有品牌 indigo 作唯一强调色，去大面积彩块，信息靠层级与留白而不是边框与阴影。

### 5.1 视觉原则（U0–U6 全程遵守）

1. **ONE DECISION**：每屏只有一个主 CTA；首页首屏只回答「现在学什么」。
2. **减少 Card，增加分隔**：默认内容块用 `divider + 留白` 分层，不再每块套 `border + rounded-xl + shadow`；`Card` 只保留给真正需要抬升语义的块（主行动卡、空态卡）。
3. **Dense but Quiet**：桌面信息密度提上来（正文 13–14px、元数据 11–12px），对比度克制，不出现彩块轰炸（彩色只用于状态点/徽标与唯一强调色）。
4. **状态色即语义**：mastered/learning/weak/not-started 四态在色相上有区分度（见 5.4），但只作用于小徽标/进度/行内点，不染大面积背景。
5. **证据驱动文案**：数字诚实（沿用 Δ 徽标 + 「启发式估计」）、CTA 旁给 reason 小字，不写营销腔。
6. **Editorial 层级**：页面标题 20–22px / section 标题 13px 大写 tracking / 正文 13.5px / 元数据 12px；8px 网格收紧间距，去掉装饰性圆角堆叠。

### 5.2 语义 Token（U0 落地到 `@theme`，全站替换类名）

```css
@theme {
  /* 背景层级 */
  --color-app-bg: #f7f8fa;        /* 应用底色（窗外留白） */
  --color-surface: #ffffff;       /* 主内容面 */
  --color-subtle: #f1f3f5;        /* hover / 次级块 */
  --color-line: #e4e4e7;          /* divider / 细分隔线（zinc-200） */
  /* 文字层级 */
  --color-ink-1: #18181b;         /* 主文字（zinc-900） */
  --color-ink-2: #71717a;         /* 次文字（zinc-500） */
  --color-ink-3: #a1a1aa;         /* 弱化/占位（zinc-400） */
  /* 强调（收敛使用，仅 CTA/激活/选中/goal/掌握度提升） */
  --color-accent: #6366f1;        /* 沿用 indigo-500，唯一强调色 */
  /* 状态（四态 + 失败） */
  --color-state-mastered: #059669;  /* emerald-600 */
  --color-state-learning: #6366f1;  /* indigo-500 */
  --color-state-weak: #d97706;      /* amber-600 */
  --color-state-idle: #71717a;      /* zinc-500 */
  --color-state-failed: #dc2626;    /* red-600 */
  /* 排版节奏 */
  --font-editorial: system-ui, -apple-system, "Segoe UI", Roboto,
    "Helvetica Neue", "PingFang SC", "Hiragino Sans GB", sans-serif;
}
```

**替换策略（U0 一次性完成，杜绝半旧半新）**：
1. U0 首日：`main.css` 写入全部 token；`AppShell / 公共原语 / 三大组件 / Header / 侧栏` 全部改用 token 类。
2. U0–U6：每页落地时以 §5.5 验收清单自检（去边框、token 类、密度、无彩块背景），页面合入即已是 B 案。
3. 全站 `bg-slate-* / text-slate-*` 存量：随各里程碑顺路替换；U0 结束时核心壳层 0 残留，U6 结束时全站 0 残留（tsc/build 门禁 + grep 抽查）。

### 5.3 状态色 → 中文习惯

| 状态 | 语义 | 颜色 | 已用位置 |
|---|---|---|---|
| Mastered | 已掌握 | emerald | chapter-badge / BandBadge |
| Learning | 学习中 | indigo | 徽标 + 进度 |
| Weak | 偏弱（<0.6） | amber | 徽标 + 目录行 |
| Not started | 未开始 | zinc/slate | 目录行 |
| Failed/下降 | 需关注 | red | 负 Δ / retake |

（遵循既有「掌握度上升=暖正、下降=警示」约定，沿用 DeltaBadge 正负规则。）

### 5.4 三大核心组件规范（U0 落地，全站复用）

**① ActionCard（下一步动作卡）** —— 只出现在 Today / Plan 头部。
```
[REVIEW]  RAG Evaluation · 第 6 章            28%   ██████░░░░
Why now
  · 目标要求（AI Application Engineer）
  · 前置已掌握（Retrieval 82%）
  · 近 3 次测评偏弱
  · 知识链瓶颈
                                   [ 开始学习 → ]   约 12 min
```
- 视觉：唯一允许「抬升」的卡片形态（白底 + 1px line + 柔和 shadow，Linear 式主卡）；其余内容一律行/分隔线。
- 数据契约：`{ action: NextAction; chapter?: Chapter; meta: ChapterActionMeta; reasons: ReasonLine[]; etaMin?: number }`
- ReasonLine = 图标 + 短语（由 action.reasons 归类渲染，文案进 i18n）。

**② KnowledgeRow（知识行）** —— Learn 目录 / Graph 侧栏 / Goals Knowledge / Report 表 / My Learner。
```
Reranking                    43% · Learning     上次测评 2 天前      [去复习]
```
- 视觉：`divider` 分隔的行（非卡片），状态点 + 文字 + 行内进度；hover 轻微 subtle 底。
- 数据契约：`{ title; mastery; band; meta?; right? }`。

**③ EvidenceRow（证据行）** —— Today Recent Evidence / Report / My Learner / 未来 Evidence 页。
```
今天  测评 · Reranking   答对 · 理解   43% → 48%   RAG from Scratch · 第5章
```
- 视觉：单行紧凑列表，左侧时间、中间动作+结论、右侧 Δ（DeltaBadge）与来源。
- 数据契约：`{ at; kind: 'assessment'|'review'|'learn'; subject; verdict?; delta; source? }`
- U1 先由 session records + 当次 Δ 组装；U6 后由 evidence log（§7.1）供给。

### 5.5 页面 B 案验收清单（每个里程碑的 DoD 附件）

- [ ] 无 `Card + rounded-xl + shadow` 堆叠（保留主行动/空态卡）
- [ ] 区块分隔用 `--color-line` divider 或留白，不用描边框
- [ ] 文字用 ink-1/2/3 层级，无 slate-900 大面积硬黑
- [ ] 状态仅以点/徽标呈现，无彩色背景块
- [ ] 唯一强调色 indigo，无第二强调色混入
- [ ] 全页类名不含裸 `slate-*`（token 化完成）

---

## 6. 里程碑 U0–U6 明细

> 与 V2 的 N0–N5（功能闭环）**并行不冲突**：U 系列只碰 `features/*` 的页面层、`components/*`、`styles/main.css`、`i18n` 文案、storage 的 goal repo（§7.2，向后兼容）；不碰 `domain/engine` 核心算法。每个 U 结束时页面可运行、类型检查过、双语文案齐、B 案验收清单勾完。

### U0 · 视觉系统 + AppShell（数据准备 + 工作台骨架）
- **目标**：一次性建立 Linear 风格视觉系统与工作台骨架，并让目标层从第一天就是多目标。
- 落地：
  1. `styles/main.css`：§5.2 全量语义 token 写入 `@theme`；AppShell/公共原语类名 token 化。
  2. `components/primitives.tsx`：新增 `Section`（divider 标题）、`KnowledgeRow`、`EvidenceRow`、`ActionCard`；Card 语义收窄（仅主行动/空态）。
  3. `components/layout/AppShell.tsx`：导航重排为 5 组（§4.1）；`/spaces` 摘除、`/career` 入 GOALS 组降权、Graph 占位 disabled；Header 收紧（品牌 + 居中搜索触发框 + AI 状态点，B 案样式）。
  4. `components/CommandPalette.tsx`：⌘K 增加 SEARCH/COMMANDS 分区；SUGGESTED 首项 = 今日 next action；新增「目标」条目（多目标 CRUD 入口，U6 前指向 /career）。
  5. **数据准备（评审 D3）**：`storage` goal repo（§7.2）：`listGoals / saveGoal / removeGoal / getActiveGoal / setActiveGoal`；空库 seed `DEFAULT_GOAL` 并置为 active；`schemaVersion` 迁移钩子补 default。settings store 或 goal repo 持久化 activeGoalId。
  6. `i18n/messages/{zh,en}.ts`：同步全部导航/组件文案；`nav` 结构按新分组重构。
- **验收**：⌘K 可搜到文档/章/概念/目标并跳转；导航分组正确；goal repo 单测（空库 seed/CRUD/active 切换/缺省回退）；B 案验收清单勾完；`tsc --noEmit` 通过；截图自查无死链、无 slate 残留（壳层）。
- **涉及建议稿**：§3/30/31/28/25。

### U1 · Today（首页重构 —— 本轮最重要的页面）
- **目标**：首页第一屏只回答「现在最值得做什么，为什么」，且目标是 activeGoal（可切换）。
- 布局（对齐建议稿 §36 的克制版）：

```
Today                                          Tue · 9月8日
[AI Application Engineer ▾]          [管理目标]       63% ready → 目标 80%
███████████████████░░░░░
─────────────────────────────────────────────
NEXT BEST ACTION
[REVIEW]  RAG Evaluation · 第 6 章
28% 掌握
Why now: 目标要求 · 前置已掌握 · 近 3 次测评偏弱 · 链路瓶颈
                              [ 开始学习 → ]    约 12 分钟
─────────────────────────────────────────────
今日 3 项（activeGoal 范围）
  Review Reranking · 第5章       43%
  读 Retrieval 补充 · 第2章      82%
  试卷：RAG 综合测               1 份到期
[查看完整计划 →]

RECENT EVIDENCE（折叠态）
  今天  测评 · Reranking   +0.05
```
- 多目标交互：Header goal 下拉 = activeGoal 切换（或 + 新建目标 → /goals/new）；就绪度/今日清单/NBA 均随 activeGoal 重算（读取路径：`runChapterLoop` 传入 goal 范围，§7.3）。
- 数据来源：`useLoopStore.chapterPlan`（按 activeGoal 范围）+ activeGoal（goal repo）+ 当次会话 records；**零引擎算法改动**。
- 改动文件：`features/home/HomePage.tsx`（MainCtaCard → ActionCard；ReadinessCard 上提为页头；新增 goal 下拉、Today 清单行 = KnowledgeRow、Recent Evidence 折叠区）。
- **验收**：首屏（1280×800，不滚动）只出现 1 个主 CTA + 就绪度 + why-now；切换 activeGoal 后今日数据随目标重算；任一 action 的 reasons 非空即显示 4 类 reason 行；空库/全达标两态沿用现有 EmptyState/AllDoneCard 并修正文案。
- **涉及建议稿**：§5/6/7/36。

### U2 · Plan（计划页分段化）
- **目标**：计划 = 决策队列，不是 todo list；作用域跟随 activeGoal。
- 落地：
  1. PlanPage 顶部保留章就绪度卡（activeGoal 范围）；下方分两段：**NEXT（高优 1–3，渲染为 ActionCard 纵排）** 与 **UP NEXT（其余，KnowledgeRow 压缩行）**。
  2. 每项增加时间预估（etaMin：由模式/题量或章节字数启发式，标注「估计」）+ 快捷直达（沿用 chapter-action.actionPath）。
  3. 完成/标记入口保留（复习要点、补考卷生成逻辑不动）。
- **验收**：队列可一眼区分「今天做 vs 排队做」；每项能回答 why；空态/全达标一致；切换目标后队列随之变化。
- **涉及建议稿**：§8/9。

### U3 · Learn / Reader（内容→章节→要点→知识的层级呈现）
- **目标**：阅读页与 Learner Model 相连，而非纯文本阅读器。
- 落地：
  1. ChapterCatalog：章状态行改用 KnowledgeRow（Mastered/Learning/Weak/Not started 徽标 + 进度），文档块头加整体探索度；保留 Import 入口。
  2. ChapterReader 右栏扩为四区：**章状态**（现有）→ **Why it matters**（取 keyPoints 首条或 AI 摘要）→ **Knowledge**（本章标签/概念：章内 unitIds 或 keyPoints 生成 chips，点选高亮）→ **Evidence**（「来自《xx》第 5 章 p.87」式溯源 + 最近测评对本章的 Δ）。
  3. 底部：`[标记学完]` + `[去测本章 →]`（已有链路）；新增「标记后提示下一步」（plan 头项）。
- **验收**：任意章在右栏能看到「它讲什么（Knowledge）→ 证据从哪来（Evidence）→ 我学到哪（状态）→ 下一步（去测）」四段信息。
- **涉及建议稿**：§10/12/13。

### U4 · Assessment Center 收口（/quiz 升级 + /assessment 收敛）
- **目标**：测评入口唯一、报告回流计划。
- 落地：
  1. QuizCenter 顶部加 **RECOMMENDED** 区块：取当前 activeGoal 范围最弱/最该测的章（复用 `recommendation-engine.topN` 或 gradePaper 后弱章列表）→ `[开始测评 →]` 直出卷。
  2. 历史列表区标题改 **RECENT**；行 = KnowledgeRow 变体（模式徽标 + 范围 + 得分 + Δ）。
  3. **/assessment 概念级页从导航移除（评审 D4）**；路由保留；首页/⌘K 不再挂概念测评入口（N5 概念层回归后以「章内自检」复用）。
  4. Report 页：Needs attention → 「复习《章/要点》」链（已有部分）；主 CTA `[生成学习计划 →]` 跳 /plan（链路已通，确认文案）。
  5. 答题页极克制审查：无侧栏/图谱/统计；键盘流保留。
- **验收**：从 Today 或 /quiz 的 Recommended 起测 → 交卷 → 报告 → 计划回流全程 <3 跳。
- **涉及建议稿**：§16/17/18/19。

### U5 · Library + Import（内容入库体验）
- **目标**：回答「用户怎么把知识放进系统」，且入口全产品可达。
- 落地（评审 D2 = A 案：升级 /learn，不新增 /library）：
  1. /learn 章目录升级为「文档资料库」观感：文档级卡片显示标题/类型/章数/概念数/探索度/最后学习时间（数据已有）；导入按钮与搜索框固定在页头。
  2. Import：入口上提至 Header + ⌘K「导入知识」+ 各空态；ImportModal 增加阶段进度文案（读取文档 → 检测结构 → 创建章节 → 提炼要点 → 关联目标），完成后结果卡（n 章 / n 要点 / 前置检测）→ `[开始学习] / [检查结构]`。
- **验收**：导入一本书从触发到可学全程有反馈 ≤2s 一阶段；导入完成直接落到 Learn 可点。
- **涉及建议稿**：§11/27。

### U6 · Goals CRUD + My Learner + Evidence（目标层与自我认知层）
- **目标**：回答「为什么学（Goals，多目标 CRUD）」与「系统怎么理解我（My Learner）」。
- 落地：
  1. 新 `/goals`：ACTIVE 目标卡（type 徽标 + readiness + 缺口/掌握计数 + `[打开 →]`）+ COMPLETED；`[+ 新建目标]` → `/goals/new`（表单：title/type/description/importance/deadline/范围=章节多选 from Library）；行 = ActionCard 变体。
  2. 新 `/goals/:goalId`：READINESS 头 + KNOWLEDGE（章行 KnowledgeRow）/ GAPS（低于 0.6 章，点去学）+ LEARNING PATH（✓ 掌握 / ● 学习中 / ○ 未开始）+ `[编辑] [删除]`（删除 = 二次确认，activeGoal 被删回退到首个剩余目标）。type=career 额外渲染 TARGET ROLE / REQUIREMENTS / EVIDENCE 卡。
  3. 编辑复用 new 表单（`/goals/:goalId/edit` 或同页 modal）。
  4. 新 `/learner`（My Learner）：KNOWLEDGE 计数（来自 learner.byUnit 与 chapter 状态）、STRENGTHS/GAPS 两列、MISCONCEPTIONS（UnitMastery.misconceptions 聚合）、LEARNING PATTERNS（由 session records 汇总：平均时长/对错比，标注启发式）。纯视图。
  5. §7.1 evidence log 薄层落地后：Today Recent Evidence 改为读 log；可选独立 /evidence 简单流。
  6. `/career` 重定向 `/goals`（历史链接保留）。
- **U6b（同批小步）· Settings 分区**：左分区骨架（AI/Storage/Learning/Appearance/Shortcuts/About）+ 顶部 Local-first 摘要卡（内置本地 Qwen 状态）；现有 AI 模型中心内容并入 AI 分区，无功能回退。
- **验收**：Goals 页可完成「新建 → 选章范围 → 看就绪度 → 删」全流程；My Learner 页所有数字都能指到对应 domain 字段（验收抽查 3 个）；activeGoal 删除/切换无脏状态。
- **涉及建议稿**：§20/21/22/23/24/25/26。

> **视觉收尾说明**：B 案视觉系统已在 U0 落地，U1–U6 每页自带 §5.5 验收，**不再设独立的「U8 视觉翻新里程碑」**。若 U6 后仍想做一次全局视觉 diff 审查（截图并排清单），作为低成本 QA 追加即可，不入路线图主线。

---

## 7. 数据与引擎支撑（薄层清单，不绑架 Domain）

| # | 新增能力 | 形态 | 依赖 | 里程碑 |
|---|---|---|---|---|
| 7.1 | Evidence log | storage 新表（或扩展 local.ts）：`{at, kind, subjectId, verdict?, delta, source?}`；写入口：gradePaper 完成 / review 要点提交时追加（store action 内一行调用） | useLoopStore / local storage | U6（U1 前用会话 records 临时组装） |
| 7.2 | **Goal repo（多目标，评审 D3）** | storage 增加 `listGoals / saveGoal / removeGoal / getActiveGoal / setActiveGoal`；空库 seed `DEFAULT_GOAL` + activeGoalId 持久化（settings store 或 goal repo）；`schemaVersion` 迁移钩子补 default | V2 N4 schemaVersion 基建 | **U0（数据准备）**；CRUD UI U6 |
| 7.3 | **activeGoal 作用域裁剪** | `runChapterLoop` / Home / Plan 传入 activeGoal：有 `requiredChapterIds` 时章计划只覆盖该目标章范围；无目标数据回退全库章（现状行为） | loop.ts 调用参数化（不改算法） | U1 起（随 goal repo） |
| 7.4 | Reader ETA | chapter 字数启发式 → `etaMin`（组件内计算即可，不进 domain） | — | U2 |
| 7.5 | Recommended 直推 | /quiz 复用 recommendation/topN 或「最近报告最弱章」；无需新引擎 | 已有引擎 | U4 |
| 7.6 | My Learner 聚合 | `features/learner/aggregate.ts`（纯函数：byUnit → 强弱/误解/计数） | domain 字段 | U6 |

> 约束：以上全部向后兼容——无新数据时各页面按现有逻辑回退，绝不因 UI 里程碑引入数据迁移风险（7.2 仅在 schemaVersion 钩子补 default seed，无破坏性变更）。

---

## 8. 路线图与并行策略

```
现在 ────────────────────────────────────────────►
功能闭环（V2 N 系列）：N0…N5（继续，独立轨道）
UI 工作台（U 系列，本方案）：
  U0 视觉系统+AppShell+goal repo ─► U1 Today（多目标上下文）
                                   ─► U2 Plan ─► U3 Learn/Reader
                                   ─► U4 Assessment（评审 D5：U0–U4 批审连开）
                                   ─► U5 Library/Import
                                   ─► U6 Goals CRUD / My Learner / Evidence / Settings
```

- **U0–U4 按评审 D5 批审后连续开工**，是 P0（让「Today→Learn→Assess→Report→Plan」闭环漂亮）。
- U5（Library）与 U6（Goals/Learner/Settings）可并行/插空，不阻塞 P0；其中 **goal repo（U0 数据准备）必须先于 U1** 落地，否则 Today 无法多目标。
- 每 U 评审通过即合入 master 并递增 patch 版本（沿用现有发布习惯）。
- 建议稿 P4（Graph 全局回归 / Agent / Research / Plugins）不排期，等概念层（N5）与用户反馈。

---

## 9. 风险矩阵

| 级别 | 风险 | 说明与缓解 |
|---|---|---|
| P0 | B 案全站翻新导致「半新半旧」 | 缓解：token 在 **U0 一次性落地**、页面随里程碑逐页完成并带 §5.5 验收清单；U0 结束壳层 0 slate 残留，U6 结束全站 0 残留；不做跨月拖尾式重画 |
| P0 | 多目标前置（goal repo）扰动现有 Home/Plan 数据流 | 缓解：7.3 只做「读取路径参数化」（activeGoal 无 requiredChapterIds 时回退现状），不改 planner 算法；goal repo 单测 + U0 门禁独立验证 |
| P0 | 改名/换组的导航让老用户找不到功能 | 缓解：路由全部保留 + `/career→/goals`、`/knowledge→/learn` 等重定向先行；侧栏改版一次评审通过再合入；i18n 双语同步改 |
| P1 | U1 首页塞进 4 个信息块导致「什么都不突出」 | 缓解：首屏只放 1 CTA + 就绪度 + why-now；Today 清单折叠；Evidence 默认折叠（建议稿 §36 克制版为准） |
| P1 | /assessment 概念级与 /quiz 章级双轨混淆 | 缓解：U4 导航收敛唯一入口（D4）；文档注明 N5 概念回归后再启用概念自检 |
| P1 | 多目标删除/切换产生脏状态（activeGoal 指向已删目标） | 缓解：删除二次确认；删除 active 后自动回退首个剩余目标；setActiveGoal 越界保护 |
| P2 | 为对齐「Library vs Learn」反复改路由 | 缓解：已裁决 A 案（升级 /learn），无新路由；Library 深化列入 backlog |
| P2 | 三大组件过早抽象（ActionCard 依赖 meta 类型未定） | 缓解：U0 只建轻量形态 + 类型放 features/plan/chapter-action 复用，禁止 UI 自造领域类型 |

---

## 10. 决策记录（2026-09-08 评审定稿）

| # | 决策点 | 选项原文 | 定稿 | 影响落点 |
|---|---|---|---|---|
| D1 | 视觉方向 | A：IA 优先 + 层级化微调 / B：Linear 风格 token 全面翻新 / A→B 渐进 | **B：Linear 风格翻新** | §5 定稿；U0 落地 token；全站随里程碑翻新；原「U8 可选翻新」取消 |
| D2 | Library 与 Learn 的关系 | A：升级 /learn 为资料库观感 / B：新增 /library 文档列表页 | **A：升级 /learn 观感** | §4.3；U5；/library 入 backlog |
| D3 | 目标模型 | 单目标聚焦（U1–U5 后 U6 多目标）/ 直接多目标 | **直接多目标 CRUD** | §7.2 goal repo 提前到 U0；U1 Today 起 activeGoal 上下文；U6 Goals CRUD 页 |
| D4 | /assessment 概念级测评 | 移除导航入口（路由保留）/ 保留入口改名「概念自检」 | **移除导航入口（默认）** | U4 落地；N5 概念回归后再启用 |
| D5 | 里程碑节奏 | 逐 U 评审 / 批审 P0 连续开工 | **U0–U4 批审后连续开工（默认）** | §8 路线图按连续开工编排 |

**历史备注**：v1.0（评审前）将视觉 A 案设为默认、B 案为「U8 可选」；Goals 多目标排在 U6 才决策。v1.1 按本次评审调整为以上定稿。

---

## 附：建议稿逐节索引（38 节 → 本方案落点）

§1–3 产品叙事与视觉方向 → §2/§5；§3–4 全局 Layout/Header → §4.1/4.2 + U0；§5–7 首页 Today → U1；§8–9 Plan → U2；§10–13 Learn/Reader → U3；§14–15 Graph → 延后（§4.3）；§16–19 Assessment → U4；§11/27 Library/Import → U5（A 案）；§20–22 Goals/Career → U6（多目标 CRUD）；§23–24 My Learner/Evidence → U6 + §7.1；§25–26 Settings/Local-first → U6b；§28 ⌘K → U0；§29 Mobile → Out of scope；§30–31 IA 终态与映射 → §4；§32–35 视觉层级/Token/三大组件 → §5（B 案定稿）；§36 克制首页 → U1 默认稿；§37 优先级 → §6 里程碑顺序；§38 心智模型 → §2.2 设计原则。
