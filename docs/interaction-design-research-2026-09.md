# Personal Learning OS · 交互设计调研与优化建议

> 调研日期：2026-09-07 · 阶段：Phase 0（Foundation Scaffold）
> 范围：竞品交互范式研究 → 现状诊断 → P0/P1/P2 优化建议 → 落地路线
> 结论先行，可直接作为交互 backlog 输入

---

## 一、TL;DR（结论先行）

当前基座 UI 是 **「侧边栏 + 静态数据展示」** 形态：所有引擎能力已经跑通，但交互停留在「看状态」，没有进入 **「做动作 → 拿反馈 → 看变化」** 的学习闭环节奏。参考 2025–2026 头部学习/知识产品，最大的结构性差距有四条：

| # | 核心差距 | 参考范式 | 建议动作 | 级别 |
|---|---|---|---|---|
| 1 | Home 只展示「下一步推荐」，没有「开始」入口与完成反馈 | Duolingo 单课聚焦 / RemNote Daily Goal | 把 Next best action 升级为**主 CTA + 完成态回路**，进入测评/复习即为闭环动作 | **P0** |
| 2 | Study 页只是占位；计划列表无评分动作 | Anki FSRS / RemNote 四档评分 | 落地 **复习评分环（忘记/困难/记得/轻松）**，评分回写 Learner Model | **P0** |
| 3 | Knowledge 页是「列表」，图谱关系（八类 relation）没有可视化 | Obsidian Graph / Heptabase / Tana | 图谱页做 **Overview→Focus→Detail 三态**可视化，替代纯列表 | **P1** |
| 4 | 全应用无「捕获」入口；文档导入/AI 抽取管道是空白 | Readwise / Mem / NotebookLM 锚定引用 | Knowledge 页顶部加**导入 + 抽取 CTA**，抽取结果带 Evidence 溯源可点回原文 | **P1** |

次要但性价比高的优化（P2 群）：设置页 Provider「连接测试」即时反馈、键盘命令面板（桌面端 Tauri 高价值）、就绪度进度条语义化（目标梯度）、空状态引导。

**设计护栏**：本产品定位是 local-first 个人效率工具，不是成瘾型消费应用——借鉴 Duolingo 的**节奏与反馈机制**，但**不做**连击惩罚、能量消耗、社交排行等操纵性设计。

---

## 二、调研方法与来源

- 横向拆解产品 12 款，覆盖三类：**自适应学习**（Duolingo、RemNote、Anki、Mochi、Brainscape、SuperMemo、Quizlet）、**知识管理/第二大脑**（Readwise Reader、Mem、Notion AI、Obsidian、Capacities、Heptabase、Tana、Logseq）、**AI 研究型学习**（NotebookLM、Recall）
- 六维评估框架：① 主流程焦点 ② 复习/巩固交互 ③ 捕获与导入 ④ 图谱/结构可视化 ⑤ 反馈与激励 ⑥ AI 能力呈现方式
- 来源类型：行业拆解报告（多邻国 1.5 万字拆解）、厂商博客/ML 架构文章（Duolingo Birdbrain）、SRS 对比评测、PKM 工具年度对比、AI 学习工具评测
- 局限：公开资料为主，未做一手用户访谈；单条建议的收益为定性估计 + 公开数据（如 FSRS 降 20–30% 复习量、多邻国 80% 正确率目标）支撑

---

## 三、竞品横向拆解（六维对比）

### 3.1 全景对比表

| 产品 | 主流程焦点 | 复习交互 | 捕获/导入 | 图谱可视化 | 反馈激励 | AI 呈现 | 对本项目最值得迁移的点 |
|---|---|---|---|---|---|---|---|
| **Duolingo** | 单条路径+地图，一课一屏 | Birdbrain 半衰期模型，答对 80% 校准 | 无（内容内置） | 路径图 | 进度条/能量/连续打卡/XP | AI 拟人对话（Lily） | ①「一个动作聚焦一屏」② 80% 难度校准目标 ③ 即时对错反馈 |
| **RemNote** | 笔记即卡片 | SM-2/FSRS，四档评分，Exam Scheduler | 笔记语法即卡片 | 双向链接 | Daily Goal 每日张数承诺 | AI 生成卡片 | ① 四档评分与下次间隔可视化 ② 考试日期倒排计划 |
| **Anki (FSRS)** | 复习队列 | FSRS 机器学习调度，目标留存率 90% | 手动/AnkiConnect | 无 | 统计曲线 | 插件生态 | ① 留存率目标 = 可解释的引擎参数 ② 队列 = 今日待办数 |
| **Mochi / Brainscape** | 卡片复习流 | Mochi=FSRS；Brainscape=1–5 置信度自评 | Markdown 即卡 / 高亮即卡 | 无 | 简洁节奏 | 无 | ① 自评按钮质感与排版 ② 最小摩擦外观 |
| **Readwise** | Daily Review 每日回流 | 间隔重复回流高亮 | 浏览器/Kindle/PDF 高亮同步 | 无 | 每日一次仪式感 | AI 摘要 | ①「高亮 → 自动成为复习卡」捕获管道 ② Daily Review 节奏 |
| **Mem / Capacities** | 免维护投喂 | 语义召回 | 自动整理/对象模型 | 对象关系图 | 轻 | 自动标签/问答 | 「丢进去自动连」的零摩擦捕获心智 |
| **Obsidian / Logseq** | 每日笔记 → 常青笔记 | 插件 | Markdown 本地 | **图谱三态（全局/局部/单点）** | 无 | Smart Connections 语义链接 | 图谱可视化的标杆交互 |
| **Heptabase / Tana** | 白板空间 / 大纲节点 | — | 卡片/节点 | 空间化布局 | 轻 | 卡片间建议连线 | 空间记忆：同类概念聚类摆放 |
| **NotebookLM** | 来源绑定问答 | 测验/闪卡（弱调度） | 50 sources 上传 | 思维导图 | 无 | **答案内联引用锚定原文** | 「每个结论可点回原文段落」= Evidence 链 UI 化 |
| **Recall** | 全能聚合 | 原生 SRS | 网页抓取 | 有 | — | 多模问答 | 学习对象不限于「导入文档」 |

### 3.2 提炼出的六大流行交互范式（2025–2026）

**范式 A · 每日一个主行动（Single Daily Action）**
把无限内容收敛为「今天做这一件事」。Duolingo 一课、RemNote Daily Goal、Anki 今日队列，都是把复习系统输出物化为一个**聚焦屏 + 明确完成态**。核心价值：降低每天打开应用后的决策成本，靠「完成即正反馈」维持习惯。
→ **本项目对应点**：Recommendation Engine 已经算出 `Next best action`——它天生就是这个主行动的候选，缺的只是把它做成全屏聚焦入口。

**范式 B · 评分即学习（Rate-to-Learn 闭环）**
SRS 类产品最成熟的交互：作答后给出 **4 档自评（忘记/困难/记得/轻松）或 1–5 置信度**，评分决定下次出现间隔。FSRS 在此基础上用机器学习拟合个人遗忘曲线，公开数据表明较 SM-2 **减少 20–30% 复习量且留存不降**。评分按钮是「引擎可解释性」的最佳落点：用户能看到「这次间隔为什么是 3 天」。
→ **本项目对应点**：Mastery Engine 的 forgetting decay 与 domain 的 `lastReviewedAt` 已就绪，缺 UI 评分环与间隔可视化。

**范式 C · 捕获→抽取→连接 的零摩擦管道**
Readwise「高亮即捕获」、RemNote「笔记即卡片」、NotebookLM「上传即研究」：核心是**把导入动作前置到内容发生处、把整理成本后置给 AI**。知识产品留存的头号杀手不是算法差而是「素材永远没进去」。
→ **本项目对应点**：Knowledge Engine 契约与 Provider 骨架已建，缺「导入文档 → 抽取 → 确认落图」的 UI 管道与 Evidence 溯源。

**范式 D · 图谱三态可视化（Overview → Focus → Detail）**
Obsidian 确立了标准：先看全局图（Overview），点击节点聚焦其邻域（Focus），双击进入原文（Detail）。Heptabase/Tana 补足**空间化**（同一主题聚类摆放）。图谱不是装饰——它让「知识缺口」变得可见（一个孤立节点 = 未连接的知识）。
→ **本项目对应点**：KnowledgeGraph 八类 relation 已建模（prerequisite/related/child/…），Graph Engine 已有遍历逻辑，缺可视化层。

**范式 E · 可解释性与来源锚定（Explainable & Cited）**
两个层次：推荐层「为什么建议我学这个」（本项目 reasons 已做）；答案层「每个结论有出处可点回」（NotebookLM 内联引用）。后者把「AI 生成」变成「AI 从你的资料中生成」，直接服务于本项目的 Evidence 链哲学。

**范式 F · 目标梯度与轻量反馈（Goal-Gradient & Micro-feedback）**
Duolingo 顶部进度条、段位、XP 都在制造「离下一个里程碑还差多少」的拉力。对本项目有用的只是其中**克制的一半**：就绪度进度条语义化、掌握度变化的即时 +N 反馈、完成一次复习后的可见衰减停止——不需要连击、能量、排行榜。

---

## 四、现状诊断（逐页 · 对照代码）

### 4.1 Home（src/features/home/HomePage.tsx）—— 数据正确，动作缺失

现状：顶部 6 段流水线标签（装饰性）、Active Goal 卡（title/type/importance）、就绪度 Bar、Next best action 卡（kind/unit/reasons）、Learning plan 列表。全部只读展示。

诊断：
1. **Next best action 卡是「静态信息」，不是「可执行动作」**——没有「开始复习」按钮、没有完成后状态翻转、没有进入 Study/Assessment 的路径。用户看完不能做任何事。
2. 就绪度 33% 的 Bar 没有「还差哪 2 个单元到 80%」的拆解——目标梯度缺失。
3. Learning plan 列表与 Study 页无关联（Study 页是占位），闭环断在「计划」与「执行」之间。
4. 六段流水线 pills 与内容重复，占据首屏视觉但无信息增量。

### 4.2 Study（占位页）—— 核心复习场景缺失

整个「复习/练习」交互为空白：无今日队列、无评分动作、无间隔展示。**这是整个闭环最该有 UI 的地方**。

### 4.3 Assessment（占位页）—— 引擎已就绪、UI 未接

Assessment Engine（含本地确定性题目、AI 生成、Bloom 分层、答错降级）与 Learner Model applyEvaluation 都已实现且类型检查通过，但页面只声明 nextSteps。**测评交互是全项目 ROI 最高的待建面**：一次作答 → 即时对错 → 评分 → mastery 变化可见，能立刻让「掌握度数字」活起来。

### 4.4 Knowledge —— 列表不是图谱

列表形态让 8 类 relation 完全不可见；`sourceDocumentId`（Evidence 链）没有展示与回链。作为「Knowledge OS」的招牌页面，说服力弱。

### 4.5 Settings —— 缺「连接测试」

Provider 配置后无法验证：无连通性检测按钮、无已配置 Provider 的就绪状态（如「已连接 qwen2.5:7b」）。首次配置者无法确认自己的 Ollama/DeepSeek 配置是否真的可用，AI 类能力的第一信任缺口在此。

### 4.6 全局

- **无命令面板/键盘路径**：Tauri 桌面壳下，键盘优先是桌面应用的基本盘（参考 Notion Cmd+K、Obsidian Cmd+O）。
- **无空状态设计**：若用户清空 demo 数据，各页直接空白，无引导。
- **导航 7 项平级**：Home/Spaces/Knowledge/Assessment/Career/Study/Settings 平铺，无主次；Career/Study 概念重叠（Career = Goal readiness，Study = plans/sessions），导航信息架构可收敛。

---

## 五、优化建议清单（P0 / P1 / P2）

> 每项含：问题 → 建议 → 主要改动点 → 预期收益。改动点映射到 Phase 0 已落盘代码，便于直接派 task。

### P0-1 · 复习评分闭环（把 Study 页从占位变成闭环执行点）

- **问题**：计划与执行断裂，无任何「评分 → 更新掌握度」的 UI。
- **建议**：实现**单一复习会话屏**：展示一个 NextAction 的知识单元 → 用户选择「自评」或先作答 → 四档评分（忘记/困难/记得/轻松）→ 调 `applyEvaluation`/更新 `lastReviewedAt` → 展示掌握度变化动画（+0.08 / −0.12 → 生效）→ 自动进入下一项。可先做「自评快照」模式（Brainscape 式 1–5），AI 判分留待 Provider 就绪。
- **改动点**：新建 `src/features/study/ReviewSession.tsx`；接入 `applyEvaluation`（src/engine/learner-model.ts）+ `applyForgetting`；StudyPage 改为「今日队列（N 项）+ 开始复习 CTA」；完成后回 Home 展示就绪度变化。
- **预期收益**：让 Home 的「Next best action」成为真的入口（点击 → 开始复习）；掌握度从「静态数字」变成「你操作的结果」。这是让 demo 数据动起来的最小闭环。
- **参考**：RemNote 四档评分、Anki FSRS、Brainscape 自评。

### P0-2 · Home 主行动升级（Next best action → 主 CTA）

- **问题**：推荐卡不可执行。
- **建议**：把「最佳下一步」卡升级为页内**主行动块**：大号「开始学习/开始复习」按钮 + reasons 折叠展示 + 完成后自动刷新就绪度。同时把顶部流水线 pills 收敛为单行状态条（当前阶段高亮），释放首屏空间给主行动。
- **改动点**：HomePage 结构微调 + 路由跳转到 Study 会话；点击后回写 store（`refresh()`）。
- **预期收益**：首屏从「看板」变成「启动器」，达成范式 A。
- **参考**：Duolingo 一课一屏、RemNote Daily Goal。

### P0-3 · Assessment 最小可答 UI（一次作答循环）

- **问题**：Assessment Engine 已可用但页面占位，测评能力 0 暴露。
- **建议**：在 Assessment 页实现「测一道题」的本地模式：从缺口单元取题（Recall→理解→应用按认知层级递进）→ 作答 → 即时对错反馈（绿色/红色 + 正确解释）→ 「再来一题/结束」→ 结果写回 Learner Model。
- **改动点**：接 `createAssessmentEngine()`（src/engine/assessment-engine.ts）本地降级路径；复用 P0-1 的评分回写。
- **预期收益**：闭环中最有「学习感」的交互先落地，demo 即可完整体验 Document→Knowledge→Assess→Mastery。
- **参考**：Duolingo 即时反馈、80% 难度校准目标（作答太顺自动加难）。

### P1-1 · 知识图谱可视化（Overview → Focus → Detail）

- **问题**：Knowledge 页列表，八类关系不可见。
- **建议**：引入轻量 SVG/Canvas 图渲染（无第三方重依赖优先，或 d3-force 单依赖）：节点=KnowledgeUnit（颜色=掌握度档位，大小=出度），边=relation（prerequisite 虚线箭头/related 实线）。三态交互：全局视图 → 点击节点聚焦邻域（连带前置依赖）→ 点击「原文」跳转 Evidence。同屏附当前目标的 requiredUnitIds 高亮，让「缺口在图上的位置」一目了然。
- **改动点**：新增 `src/features/knowledge/GraphView.tsx`（纯组件，喂 graph+learnerState）；KnowledgePage 分栏：图 + 侧栏选中单元详情。
- **预期收益**：招牌页面成立；缺口可视化支撑 P0-2 的「为什么学这个」。
- **参考**：Obsidian 三态、Heptabase 空间聚类。

### P1-2 · 导入与抽取管道（捕获 → Evidence 落图）

- **问题**：无任何内容导入/抽取入口，Knowledge Engine 无处可用。
- **建议**：Knowledge 页顶部放「导入资料」区：粘贴文本/Markdown →（若已配 Provider）调 `extractKnowledge` 出候选 KnowledgeUnit → 确认列表 → 写入图谱（自动建八类关系候选 + 保留 `sourceDocumentId`）→ 列表项可点回原文片段。
- **改动点**：接 Knowledge Engine（src/engine/knowledge-engine.ts）与 Graph Engine 的 relation 建议；未配 Provider 时提供「手动建单元」降级。
- **预期收益**：从「演示数据」走向「自己的资料」，Evidence 链哲学有了 UI。
- **参考**：NotebookLM 锚定引用、RemNote 笔记即卡片。

### P2 群（低成本高确定性，可随版本分批）

| 编号 | 建议 | 改动点 | 收益 |
|---|---|---|---|
| P2-1 | **Settings Provider「连接测试」**：点击后调 `chat(ping)` 并回显 已连接 qwen2.5:7b / 失败原因 | SettingsPage + openai-compatible 的 baseUrl/鉴权校验 | 首次配置信任闭环；失败反馈带出诊断信息 |
| P2-2 | **命令面板 Cmd+K**（Tauri 桌面高价值）：跳转页面/开始复习/导入 | 新增 CommandPalette 组件 + 全局快捷键 | 桌面端键盘流；Phase 1 加「问知识库」命令 |
| P2-3 | **就绪度目标梯度**：Bar 标注目标 80% 刻度线，下方列出「还差：重排序(+37%)、评估(+52%)」 | HomePage Stat/Bar 扩展 | 目标梯度拉力（范式 F 克制版） |
| P2-4 | **导航收敛**：7 项分组（学习流：Home/Study/Assessment；内容：Spaces/Knowledge；规划：Career；系统：Settings），弱化平铺 | AppShell NAV 分组 | 信息架构主次分明 |
| P2-5 | **空状态设计**：清空数据后 Home/Knowledge 显示「导入第一份资料」引导而非空白 | 各页 empty 分支 | 新用户 onboarding |
| P2-6 | **掌握度变化即时反馈**：复习/测评后 +0.08/−0.12 徽标动画与「下次复习：3 天后」提示 | ReviewSession 完成态 | 评分动作的可见结果（范式 B 可解释性） |

---

## 六、分阶段落地路线

```
Phase 0.5（交互闭环最小集 · 建议 1–2 周）
  P0-1 复习评分闭环  ──┐
  P0-2 Home 主行动升级 ├─ 让 demo 数据「可操作」
  P0-3 最小作答循环  ──┘

Phase 1（真实内容 + 视觉招牌）
  P1-1 图谱三态可视化
  P1-2 导入/抽取管道（Provider 就绪后） + Evidence 溯源
  P2-1 Provider 连接测试

Phase 1.5（桌面化打磨）
  P2-2 命令面板 · P2-3 目标梯度 · P2-4 导航分组 · P2-6 即时反馈动画
```

依赖关系：P0-1/P0-3 共享「评分回写」模块，建议先行抽取 `applyEvaluation` 的 store action（`submitAnswer(unitId, evaluation)`）一次落地，两页复用。P1-1 的缺口高亮依赖 P0-2 的 reasons 结构（已存在）。P1-2 依赖 Provider 真接入。

---

## 七、反模式提醒（设计护栏）

1. **不做操纵性游戏化**：能量条、连击惩罚、限时焦虑、社交排行——与本项目「你的知识属于你」的价值观冲突，也与 README 的产品原则相悖。
2. **避免「仪表盘化」**：信息密度高 ≠ 学习产品；每屏只承载一个主行动。
3. **掌握度数字诚实**：本地确定性引擎的 ±0.08 步进是启发式，UI 展示时标注「启发式估计」，避免给用户虚假精确感（呼应 Learner Model 代码注释中的定位）。
4. **AI 结论必须可溯源**：抽取/测评的每条结论带 `sourceDocumentId` 回链，是 NotebookLM 式信任的基础，不能省。

---

*下一步建议：从 P0-1/P0-2 出一版 Home+Study 的交互原型（含具体线框与组件拆分），确认后进入实现。*
