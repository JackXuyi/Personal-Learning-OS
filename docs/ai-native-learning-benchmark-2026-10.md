# AI Native 学习类产品 · 10 个可对照应用与设计方案

> 用途：为 Personal Learning OS（PLOS）的首页与整体交互寻找可借鉴的成熟设计范式。
> 检索日期：2026-10-21 ｜ 来源均为各家公开页面 / 官方公告（二手来源已标注，见 §5）。
> 全文用中文；产品名与接口名保留英文原文，便于回表检索。

---

## 1. 结论先行

1. **「AI native」的分水岭不在功能，在决策权**：这批产品里真正算 AI native 的，都是把「下一步做什么、以什么形式呈现、什么时候再来」这三件事交给模型/算法实时决定；只把 AI 放在「生成题目/生成摘要」按钮上的，都还属于 AI-augmented。
2. **最强的两条主线已经跑通：Grounded（答案必须挂到源）与 Fallback-by-representation（换表征而非重复原文）**。Google 系的 NotebookLM / Learn About / Learn Your Way，和 Recall / Heptabase 都在这两条线上——而 PLOS 的 `evidence anchor` 与「复述」，`chapter-qa` 已经站在同一条河里，缺的是把它做成**主线而非分支**。
3. **所有严肃玩家都收敛到「不直接给答案」**：ChatGPT Study Mode、Claude Learning Mode、Khanmigo 三家独立地选择了苏格拉底式引导。这不是文案洁癖，是产品定位——给答案的那一刻产品价值归零。PLOS 的 `reasons`（why-now）已经是同一思路的一半（说清为什么），还差另一半（问你打算怎么想）。
4. **「出错/卡住的瞬间」是唯一高价值的 AI 触发点**：Duolingo Max 的 Explain My Answer、Khanmigo 的练习内 hint，都长在做题流里而非独立聊天页。
   PLOS 的情况要说清楚：**AI 批语其实已经有了**（`quiz-engine.ts::feedback` → `assessment.feedback` → `QuizReportPage` 的 `aiFeedback` + `point` + 定位要点，且未配置 AI 时不伪造）——真正差的不是「有没有解释」，而是**时机与位置**：解释只出现在交卷后的整卷报告页，而不是作答流里「这题刚答错」的那一刻。这属于**同一能力换个落点**，改造成本远低于新建。
5. **本地优先是这个赛道越来越稀有的东西**：这批里只有 Heptabase（离线可用 + 全量导出）和 Recall（browsing 本地优先 + Markdown 导出 + MCP）部分押注本地/可携带。**PLOS 的 local-first + Keychain + 可导出包（F4/F10）不该当成合规成本，它是这批产品最花钱也最难补的差异点。**

---

## 2. 速览表

| # | 产品 | 类型 | AI 承担的核心决策 | 一句话设计主张 |
|---|---|---|---|---|
| 1 | NotebookLM（Google） | 有源研究台 | 答什么 + 从哪段原文答 | 见源，不见答案 |
| 2 | Google Learn About | 主题讲解器 | 讲多深 / 先讲什么 | 空手来，被带着走 |
| 3 | Learn Your Way（Google Research） | 教材重铸 | 同一内容用哪种表征呈现 | 不换内容，换表达 |
| 4 | ChatGPT Study Mode | 通用陪练 | 何时给答案 vs 何时追问 | 只引导，不代做 |
| 5 | Claude Learning Mode | 通用陪练 | 用什么脚手架带推理 | 上下文在 Projects，方法在模板 |
| 6 | Khanmigo（Khan Academy） | 课程内导师 | 卡住时给到哪一档 hint | 嵌在题库里，不在侧边 |
| 7 | Duolingo Max | 语言陪练 | 何时扮像真人对练 | 错误解释 + 弱点聚合双出口 |
| 8 | Quizlet（Learn / Q-Chat） | 卡片练习层 | 下一个题型 / 时间间隔 | 给截止日，排到 100% |
| 9 | Recall | 第二大脑 | 是否该重浮一张旧卡片 | 边浏览边被旧知识打断 |
| 10 | Heptabase | 视觉知识库 | 用哪张卡回答 / 要不要改写卡片 | 空间即结构，AI 会动笔 |

---

## 3. 逐篇：设计与可借鉴点

### 3.1 NotebookLM（Google，2023 至今）

- **定位**：「以你上传的资料为唯一事实源」的研究/思考伙伴。支持 PDF / 网页 / YouTube / 音频 / Docs / Slides，产出 Quiz、思维导图、数据表、音频概览、视频概览，并有**行内引用**（每条回答挂到原文确切片段）。2025 年 9 月起强调 verifiable inline citations 以压幻觉；有二手汇总称其近期以 Gemini Notebook 之名出现（**未官方确认，待核**）。
- **AI native 判据**：答案的来源范围由 AI 在**受限语料**内决定；不受限于关键词检索，但也不允许超出你给的库。
- **可复用的界面模式**
  - **Citation-first**：回复里每个断言都是可点回原文的 chip；
  - **源 → 多形态产出**：同一库一键生成 mind map / audio overview / quiz / 数据表；
  - **Notebook = 作用域**：语料边界显式为一个对象（这与 PLOS 的 `goal → 章范围` 是同构概念）。
- **PLOS 可落地处**
  - `evidence-anchor.ts::bestOccurrence` 已经是行内锚点的地基，**但首页只把 evidence 当历史流水账**。可引入「带锚点的知识点卡」：最近证据行的每条都能点开原文片段——把「曾发生过」升级为「可回看」。
  - F10 知识包已送出的「多形态产出」可以比照它补齐缺失的 mind map / 音频概览两档。
- **照搬风险**：它是**无状态的研究台**，答完即走，没有掌握度。PLOS 不能因为加多了「生成形态」而弱化「掌握度必录」这条主线。

---

### 3.2 Google Learn About

- **定位**：无需上传资料、输入主题即开讲的「精简版 NotebookLM」。结构为：文字块 + 图片 + 交互列表 + **词汇表** + **常见误解** + 推荐延伸问题 + 内嵌视频。
- **AI native 判据**：由 AI 决定「这个主题该分解成哪几个疑问点」，而不是由作者写大纲。
- **可复用的界面模式**
  - **Misconceptions 区**（常见误解单独成区）——学习产品里极少被单独做成一个模块的诚实设计；
  - **Vocabulary 提取**：概念维护随学习产出，而不是事后补。
- **PLOS 可落地处**：`restatement`（复述）与 `flashcard`（自测卡）现在是孤立动作，可由复述结果**反哺出一个概念列表**：「你最近三次复述里混淆的概念」= PLOS 版的 misconceptions 区。（注意：F5 的 `D1-C`/`D5-C` 是定案「不预先实现」，这条应排在 P2。）
- **照搬风险**：Learn About 刻意**不做产出、只做消费**，也没有账号内的持久学习记录（对话刷新可能丢失，实验阶段）。PLOS 反过来，别被它的轻量化带偏。

---

### 3.3 Learn Your Way（Google Research 实验）

- **定位**：把教科书 PDF 重铸为个性化多形态：沉浸式文本、带旁白的幻灯片、音频课、思维导图、随章节测验；先让用户设定**年级**与**兴趣**，示例与解释随之改写，核心内容不变。
- **效果（Google 自述，非独立复现）**：相较标准数字阅读器，即时测评高约 9 个百分点，**3–5 天后的保持测评高 11 个百分点**；另有报道称 60 名芝加哥地区 15–18 岁学生的随机研究中，保留率 78% vs 67%。
- **AI native 判据**：模型决定「同一个知识点该用哪种表征重讲一遍」——这是**表征决策**，不是内容生成。
- **可复用的界面模式**：**同一内容的多表征切换条**（文本 / 幻灯片 / 音频 / 导图 / 测验），且切换不改变内容本体。
- **PLOS 可落地处**：这是对 `restatement`（复述）最直接的一记印证——现在 PLOS 的复述只回文本，**多加一档「换表征」的产出形态（大纲 / 对比表 / 口播稿）成本低于收益**；这也与「T4 空态原语」同期可做的低成本改动冲突不大。
- **照搬风险**：Google 的研究无法分离出「多形态」与「随学习测验」各自的贡献。PLOS 若要搬，必须**只搬多形态，把测验留在既有 `applyPaperResult` 单一写方**，否则会违反 F3 三口径不得统一的硬约束。

---

### 3.4 ChatGPT Study Mode（OpenAI，2025 起）

- **定位**：不是模型，是一套由教师与教育学专家参与撰写、**目前挂在系统指令层**（官方坦言会带来行为不一致，目标是后续训练进主干模型）的学习体验。五项能力：
  1. **交互式提示**（苏格拉底提问 + 提示 + 自我反思）
  2. **支架式回复**（分块、标注主题间联系、控制信息量降认知负荷）
  3. **个性化支持**（凭既往回答与记忆判断水平）
  4. **知识检查**（开放题/测验 + 个性化反馈）
  5. **可随时开关**（在一次对话中途切换目标）
- **AI native 判据**：AI 决定「这一刻给不给答案」——把「给答案」降级为一种特殊 Action。
- **可复用的界面模式**
  - **Mode-as-switch**：learning mode 是一个可在会话中途开关的模式，不是独立 App；
  - **Socratic-first 的默认回复形状**：先问「你已经知道什么 / 卡在哪」，再给解释。
- **PLOS 可落地处**：`ChapterQaPanel`（问这一章）现在是**问答形态**，建议加一个默认姿态：先问 1 句诊断性问题（「你觉得卡在哪？」），再作答。这是**极低改动、极高感知价值**的一项，且不动任何既有 mastery 口径，风险很低。
- **照搬风险**：它的 memory-based 个性化依赖云端长记忆，与 PLOS 的 F9「一份 md，无 pending 队列」口径不同，**别引入第二份学习者画像**。

---

### 3.5 Claude Learning Mode（Anthropic）

- **定位**：挂在 **Projects** 内的一个学习项目类型（Study / Career / Research 三类模板），官方口径是「引导推理过程而不是给答案」：用「你会怎么下手？」替代直接求解，用「什么证据支持你的结论？」深化；强调**底层核心概念**与**结构化模板**（论文结构、学习指南、大纲）。
- **AI native 判据**：AI 决定「用哪种脚手架带你走完推理」，且脚手架由可选的专家模板承载。
- **可复用的界面模式**
  - **Projects = 课程级上下文**：把资料、偏好、历史收在一个可命名的作用域里；模板是**可读可改的起点**，不是黑盒；
  - **模板可编辑**：专家默认指令对用户可见（官方样例提供下载）。
- **PLOS 可落地处**：对齐 PLOS 的 `goal`（目标）概念 —— 现在 goal 只做「章范围过滤」，缺少「这个目标下的学习风格/偏好」这一层。若做，**必须挂在 F9 学习者记忆 md 里**，不得新建存储实体。
- **照搬风险**：它偏重「如何写好一篇东西」，偏 high-level reasoning；PLOS 的练习是客观题 + 掌握度，**把「Socratic」搬过来要限定在 `chapter-qa` 与 `restatement` 两处**，别铺到 `assessment`（会影响 mastery 单一写方口径）。

---

### 3.6 Khanmigo（Khan Academy，2023 至今）

- **定位**：嵌进 Khan Academy 内容库的 AI 导师 + 教师助教。学生侧：不做「给答案」，是**练习/视频/文章任一处的上下文答疑**；另有写作教练（辩论、Writing Workshop、创意写作）、代码实时反馈、大学申请/职业辅导、历史人物角色扮演（按文献观点生成角色回复）。教师侧：**备课 / 量规 / 出口小测（exit ticket）/ 学生 misconception 汇总 / 进度摘要**。
- **规模化（二手来源）**：2024–25 学年活跃学生约 40k → 700k，2025–26 预计超百万；Common Sense Media 给 4 星并高于通用 chatbot；定价 $4/月（年付）/$9（月付），教师版多国免费。
- **AI native 判据**：AI 决定「卡住时给到第几层 hint」，并且 hint 与当前那道题/那段视频强绑定。
- **可复用的界面模式**
  - **Misconceptions（教师视角）工具**：把全班的常见误解聚合出来——这是「证据」从个人侧走到群体侧的样本；
  - **刻意不做规划层**：不像 Duolingo / Quizlet 那样倒排时间、催节点，它只在「卡住」这件事上发力。
- **PLOS 可落地处**：PLOS 的**薄弱排名（ weaknesses）目前只展示个人**，而 Khanmigo 的 misconception 聚合告诉我们「按**概念**归类错误」比「按**章**归类」更 actionable。录入可选：把 `quiz` 判卷的结果按「错因概念」打标签（P2，排在靠后）。
- **照搬风险**：教师/家长/域管理多角色带来的 account 复杂度，PLOS 是单人守护进程本地应用，**不要引进任何角色系统**。

---

### 3.7 Duolingo Max

- **定位**：Super Duolingo 之上加了 AI 层。官方口径含 **Roleplay**（跟 Lily 等角色扮演实景对话）与 **Video Call with Lily**（实时视频通话练口语）。「Explain My Answer」在部分区域的官方说明里仍列为 Max 能力，另有二手评测称其已于 2026 被下放到免费层、Max 改为「Deep Dive」追问式讲解（**区域与版本口径不一致，需自测**）。
- **AI native 判据**：AI 决定「什么时候由 AI 扮演一个真人」，把「仿真对话练习」做成可批量复制的高频产品线。
- **可复用的界面模式**
  - **错误瞬间解释**：每道题之后即时给出「为什么这句里是这个」——解释挂在**你自己的句子**上而不是通用规则；
  - **Mistakes Hub**：按「虚拟语气 / 性数一致」等**概念**聚类错题，然后给定向训练；
  - **Report Card**：每次 Roleplay 后出一张「这次卡在哪」的结构化反馈。
- **PLOS 可落地处**：**这一条对 PLOS 价值最高**。PLOS 的测评（`quiz`）已有判卷，也已有每题 AI 批语+定位要点，但落在**交卷后的整卷报告页**；Duolingo 的做法是把解释**就地挂在答错的那一瞬间**。建议动作是把既有批语前移到作答流，形式可复用 `QuizReportPage` 那个批语槽的样式，不需要新组件、不新增 mastery 写方。
- **照搬风险**：Duolingo 的语言目标是**可机械化的琐碎技能**，练的是「肌肉记忆」；PLOS 是**理解性内容**。别把它的打卡/连胜/排行榜节奏搬进来。

---

### 3.8 Quizlet（Learn / Q-Chat）

- **定位**：全球最大的卡组平台（月活 6000 万量级）。**Learn** 依据「你的目标 + 你对这组的熟悉度」生成**个性化学习路径**：先跑一轮快测摸底，问你要一个**考试日期**，然后按 spaced repetition 调节题型（卡片 / 判断 / 选择 / 书写）、难度与间隔，目标是考试日达到 100%。**Q-Chat**（二手来源）是以对话形式考你并按你的掌握情况调题 + 答错即时讲解；**Memory Score**（二手来源）预测每条术语你何时会忘，用以优化复习时机。
- **AI native 判据**：AI 决定「下一题是什么题型、间隔多久」——即 PLOS 的 pace 层的成熟形态。
- **可复用的界面模式**
  - **目标倒排**（考试日 → 每日清单）+ **诚实的进度语义**（完成后才填进度条，开始看一眼不算）；
  - **忘记曲线单独成为一个可展示的数字**（Memory Score）——「你知道自己什么时候会忘」被显式化。
- **PLOS 可落地处**：PLOS 的 `plan-quota` / `paceOf` 已经是同一事但**没有展示面**。可以借鉴 Memory Score 的思路，把 F3 趋势里的数据转成一句人话：「这条知识点 **预计 N 天后你会忘**」。
- **照搬风险**：Quizlet 的内容单元是**用户自备的离散术语**，不是连续文档。PLOS 的章是长文本，别引进 Flashcard-first 的录入心智（不要让 Chunk/Deck 抢了 `Chapter` 的位置）。

---

### 3.9 Recall（getrecall.ai）

- **定位**：面向「不绑定课程体系的长期学习」的第二大脑。一键保存文章 / YouTube / 播客 / PDF / Docs / Slides / TikTok / 自己的笔记 → 即时 AI 摘要 → **自动打标签并自动连入知识图** → 可以在「全库 / 选定源 / 单卡 / 联网」之间切换提问，回答引用你自己的源。含 **Augmented Browsing**：浏览时实时重浮旧相关卡片。内置 **Quiz + 间隔重复**，并把 cards 从 new → mastered 分级；有 API / MCP 输出；浏览层本地优先，可全库导出为 Markdown。
- **AI native 判据**：AI 决定「此刻该把哪张旧卡片重浮到你眼前」——把被动浏览变成主动重逢。
- **可复用的界面模式**
  - **Augmented Browsing（旧知识在浏览时的实时重浮）**——这是「**不涉及模型也能讲清楚 AI native**」的最佳样例：不是问答，是**时机**；
  - **Knowledge graph 自动生成 + 可手工改写**的平衡点。
- **PLOS 可落地处**：这是与 PLOS 首页 `Next Best Action` 最像的一个产品——区别在于 PLOS 的 NBA 只在**首页**出现，而 Recall 把它铺到**所有浏览场景**。可以考虑在 `ChapterReaderPage` 里加一层「读到这里，你之前存过相关的 X」的轻量提示（排在 P2——需要先把 embedding 的检索延迟实测清楚）。
- **照搬风险**：Recall 的数据仓库在云端（只有浏览层本地优先），PLOS 是 SQLite 全本地。**可以搬它的重浮时机，不能搬它的存储假设。**

---

### 3.10 Heptabase

- **定位**：视觉化第二大脑。卡片 + 无限白板；**AI 可以改你的库**（2026-05 的 **Agent Mode**：编辑已有卡、建新卡、读卡内图片与提及链接、递归读取父白板下的子白板；后续计划编辑白板布局、连线、加标签管属性）。**AI Tutor** 提供结构化的个性化辅导会话（例如「古代到现代哲学」这类完整历史 + 主题学习路径）。**Heptabase CLI** 反向让 Claude Code / Codex / Cursor 直接读写知识库，并配官方 CLI Skills 让 agent 少产生幻觉。支持离线访问、全量导出含附件。
- **AI native 判据**：AI 不仅读你的库，还**写**你的库；并且把双向链接给到外部 agent。
- **可复用的界面模式**
  - **AI 写权限作为显式开关**（Agent Mode 是要打开的）；
  - **给外部 agent 提供受约束的命令 + Skills**，而不是给它自由 API。
- **PLOS 可落地处**：PLOS 目前**没有任何 AI 写资产的路径**（刻意如此，见 F9「无 pending 队列」结案）。Heptabase 说明「AI 可写」不是原罪，关键是**把写动作变成可见、可撤销的编辑对象**。可以作为后续讨论 `ChapterPrereqOverride` 那一层 AI 建议的参考（**不建议本轮动**）。
- **照搬风险**：白板 + 卡片的隐喻会直接冲突 PLOS 的线性教材隐喻。Heptabase 自己的短板也很诚实：无永久免费层、白板在大规模下会失控、AI 按信用点计费——**这些都是 PLOS 不该踩的商业模式坑**。

---

## 4. 提炼：AI native 学习产品的 6 条设计范式

| 范式 | 含义 | 代表产品 | PLOS 现状 |
|---|---|---|---|
| **P1 有源（Grounded）** | 答案必须能点回源 | NotebookLM、Recall、Heptabase | 有（`evidence-anchor`），但未成主线 |
| **P2 换表征不换内容** | 卡住时换一种表达重讲 | Learn Your Way | 部分（`restatement` 仅文本） |
| **P3 不给答案** | 默认先问，实在不行再解释 | Study Mode、Learning Mode、Khanmigo | `chapter-qa` 直答 |
| **P4 错误瞬间才是入口** | 解释长在做题流里，而非事后报告 | Duolingo Max、Khanmigo | 有 AI 批语，但**只在交卷后的报告页**（`QuizReportPage`） |
| **P5 时机 > 检索** | AI 决定「何时重浮」 | Recall、Quizlet | 有基线（`plan-quota`）但无展示面 |
| **P6 作用域显式化** | 「这一个 notebook / goal / class」是一个对象 | NotebookLM、Claude Projects | 有（`goal`→章范围） |

---

## 5. 事实核验说明

**一手来源（官方页面 / 公告）**
- OpenAI：ChatGPT 学习模式官方介绍与帮助文档（五项能力、记忆个性化、可开关）
- Anthropic：Claude for Education 公告（Learning mode、Projects、三类模板）
- Google NotebookLM 官网（上传源类型、行内引用、Audio Overview）
- Duolingo 帮助中心（Roleplay、Video Call with Lily）
- Quizlet 帮助中心 + 官方博客（Learn：目标、考试日、间隔重复、Learning Assistant Platform）
- Recall 官网与定价页（摘要、知识图、Augmented Browsing、Quiz + 间隔重复、导出、MCP）
- Heptabase 官网 + 官方 Update（Agent Mode、AI Tutor、CLI、离线、导出）
- Khanmigo 官网（$4/月年付、不给答案、内容库集成）

**二手来源（评测站 / 媒体聚合，需自测）**
- Learn Your Way 的效果数据（Google Research 自述，非独立复现；两组数字来自不同二手转载）
- Khanmigo 的活跃用户 40k→700k、教师版覆盖国数
- Duolingo Max 的定价与「Explain My Answer 下放免费层」口径
- Quizlet 的 Q-Chat / Memory Score 细节
- NotebookLM 更名为 Gemini Notebook 的说法

**本轮未覆盖、建议后续单独查的**：Anki 生态的 AI 插件、**RemNote**（层级笔记 + AI 卡片 + 间隔重复，与 PLOS 形态最接近）、**Synthesis Tutor**（K-5，视觉教具向）、**Speak**（口语向，对 PLOS 无帮助）。

**文档内的 PLOS 现状均为本次实读源码核对**（涉及：`src/engine/quiz-engine.ts`、`src/domain/assessment.ts`、`src/features/quiz/QuizReportPage.tsx`、`src/engine/loop.ts`、`src/components/primitives.tsx`）；若后续有提交改动，本表需重跑一次核对。

---

## 6. 给 PLOS 的落地清单（按优先级）

| 优先级 | 动作 | 借鉴来源 | 关联 PLOS 模块 / 任务 |
|---|---|---|---|
| ~~**P0-A**~~ ✅ **已交付** | ~~把已有的每题 AI 批语（`aiFeedback` / `point`）**前移到作答流中**~~ | Duolingo Max P4 | 定义已修正并实施：见下方 ⚠️ 与 `docs/ai-immediate-explain-design-2026-10.md` |
| ~~**P0-B**~~ ✅ **已交付** | ~~`ChapterQaPanel` 默认先问一句诊断问题再作答~~ | Study Mode P3 | 定义已修正并实施：改为「掌握度驱动档位 + 追问线程」，见下方 ⚠️ |

> ⚠️ **上面两条 P0 的原始定义在落地时被修正**（2026-10-21，读源码后），**不要照原话实施**：
>
> 1. **P0-A** 原话「把已有批语前移到作答流」不成立 —— 主观题批语由 `gradeSubjectiveWithAi`
>    在**判卷页**才产生，用户答第 1 题时后面几题的作答还不存在；客观题**根本没有解释数据**
>    （`PaperQuestion` 只有 `answer` 做比对）。真正缺的是「解释」，不是「搬运」。
>    改为**三层解释**：本地判定 → AI 有源提示（`ai/explain-question.ts`）→ 本地参考答案。
> 2. **P0-B** 原话「默认先抛诊断句」与既有的「讲给我听」（费曼复述）**功能重叠**；
>    真实缺口是 `askChapter` **严格单轮、无上下文**。改为掌握度驱动档位 + 最多 3 轮线程。
>
> 完整方案与实施记录：`docs/ai-immediate-explain-design-2026-10.md` /
> `docs/ai-immediate-explain-runbook-2026-10.md`。
| **P1** | 最近证据行支持点开原文片段（锚点回原文） | NotebookLM P1 | `evidence-anchor.ts` + 首页 evidence 区 |
| **P1** | 把 `paceOf` / `plan-quota` 的输出翻成一句人话（「N 天后你会忘」） | Quizlet Memory Score P5 | F2 pace / F3；**不改变任何单一口径** |
| **P2** | `restatement` 增加「换表征」产出档（大纲 / 对比表 / 口播稿） | Learn Your Way P2 | F5 `restatement`；测验部分仍走既有写方 |
| **P2** | 按「错因概念」归类测评错误（概念标签） | Khanmigo misconceptions | 需先定义概念标签来源，可能与 F7-c 联动 |
| **P2** | 阅读页内「你之前存过相关的 X」轻量重浮 | Recall P5 | 需先实测本地 embedding 检索延迟 |

> 约束提醒：以上**均与正在进行的设计系统整改（T1–T12）不冲突**——T1/T4 做完 token 与空态原语后，这些新增界面天然走新 token；反过来若现在就加，会再次产生新的硬编码色。
