# 📚 Personal Learning OS（个人学习操作系统）

> **一个开源、Local-first 的个人 AI 学习系统，把你的知识转化为自适应的学习体验。**

[简体中文](README.zh-CN.md) · [English](README.md)

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)
![Status](https://img.shields.io/badge/Status-Pre--MVP-orange)
![PRs Welcome](https://img.shields.io/badge/PRs-Welcome-brightgreen)

一个**开源、免费、Local-first、Privacy-first** 的个人 AI 学习操作系统。

它不是单纯的 AI 知识库，也不是传统 AI Tutor。

它的目标是：

> **让 AI 理解你的知识、学习目标和掌握程度，并持续决定"你下一步应该学什么"。**

---

## 目录

- [✨ 愿景](#-愿景)
- [🎯 产品定位](#-产品定位)
- [🧠 核心概念](#-核心概念)
- [🔄 学习闭环](#-学习闭环)
- [🎓 学习模式](#-学习模式)
- [🧪 自适应测评](#-自适应测评)
- [🧠 学习者模型](#-学习者模型)
- [🗺️ 产品架构](#️-产品架构)
- [💻 技术栈](#-技术栈)
- [🔐 隐私优先 & Local-first](#-隐私优先--local-first)
- [🔌 模型无关的 Provider 架构](#-模型无关的-provider-架构)
- [📦 开源与 Pro 策略](#-开源与-pro-策略)
- [🛣️ 路线图](#️-路线图)
- [📐 产品原则](#-产品原则)
- [📊 成功指标](#-成功指标)
- [🏁 项目状态](#-项目状态)
- [🚀 快速开始](#-快速开始)
- [🤝 参与贡献](#-参与贡献)
- [📄 许可证](#-许可证)

---

## ✨ 愿景

传统知识库解决的是：

```text
我把资料存在哪里？
        ↓
我如何找到它？
        ↓
我如何询问 AI？
```

Personal Learning OS 希望解决的是：

```text
我有什么知识？
        ↓
我想学什么？
        ↓
我已经掌握了什么？
        ↓
我还缺什么？
        ↓
为什么没掌握？
        ↓
我下一步应该学什么？
        ↓
我真的学会了吗？
        ↓
下一步是什么？
```

最终形成一个持续运行的学习闭环：

```text
        ┌──────────────┐
        │  Knowledge   │
        └──────┬───────┘
               ↓
        ┌──────────────┐
        │  Understand  │
        └──────┬───────┘
               ↓
        ┌──────────────┐
        │   Practice   │
        └──────┬───────┘
               ↓
        ┌──────────────┐
        │    Assess    │
        └──────┬───────┘
               ↓
        ┌──────────────┐
        │ Learner State│
        └──────┬───────┘
               ↓
        ┌──────────────┐
        │ Next Action  │
        └──────┬───────┘
               │
               └──────────────→ Learn
```

---

## 🎯 产品定位

核心**不是**：

- AI Knowledge Base（AI 知识库）
- AI Chatbot（AI 聊天机器人）
- AI Tutor（AI 家教）
- AI Resume Builder（AI 简历生成器）
- AI Job Search（AI 求职工具）

而是：

> **Personal Learner Model（个人学习者模型）+ Knowledge Graph（知识图谱）+ Adaptive Learning（自适应学习）**

产品围绕一个核心问题构建：

> **"基于我已有的知识、目标和学习历史，我现在最应该学什么？"**

---

## 🧠 核心概念

产品由五个核心对象组成：

### 1. Document（文档）

用户自己的知识来源。

支持格式：**PDF · Markdown · TXT · DOCX · EPUB · 网页 · 笔记 · 代码 · 图片 / OCR · 自定义文本**

原则：

> **原始资料永远属于用户。**

### 2. Knowledge（知识）

从 Document 中提取的结构化知识。例如 RAG 领域的知识树：

```text
RAG
├── Retrieval
├── Embedding
├── Chunking
├── Reranking
├── Evaluation
└── Generation
```

Knowledge 不只是文本 Chunk，而是具有语义和关系的知识单元。

### 3. Knowledge Graph（知识图谱）

描述知识之间的关系：

```text
Concept
├── prerequisite（前置知识）
├── related（相关）
├── parent（父级）
├── child（子级）
├── example（示例）
├── contrast（对比）
├── application（应用）
└── source（来源）
```

例如：

```text
Reranking
    │
    ├── prerequisite → Retrieval
    ├── prerequisite → Embedding
    ├── related → Vector Search
    └── application → RAG
```

### 4. Learner State（学习者状态）

描述**"用户现在到底掌握了什么"**。

例如 RAG 知识树的掌握度：

```text
RAG
├── Retrieval        82%
├── Embedding        76%
├── Chunking         71%
├── Reranking        43%
├── Evaluation       28%
└── Production       36%
```

不仅记录分数，还记录：

- Mastery（掌握度）· Confidence（置信度）· Attempts（尝试次数）· Correctness（正确率）
- Cognitive Level（认知层级）· Misconceptions（误解）· Last Reviewed（最近复习）· Forgetting（遗忘）
- Application Ability（应用能力）· Interview Ability（面试能力）

### 5. Learning Goal（学习目标）

学习目标是整个系统的重要入口：

```text
Career（职业）· Study（学习）· Exam（考试）· Personal（个人）· Research（研究）· Project（项目）
```

例如：

| 类型     | 目标                     |
| -------- | ------------------------ |
| 职业     | AI 应用工程师            |
| 学习     | 计算机网络期末考试       |
| 个人     | 深入学习 RAG             |
| 研究     | 理解 Agent Architecture  |

底层全部进入**同一个 Learning Engine**。

---

## 🔄 学习闭环

系统的核心工作方式：

```text
Learning Goal
      ↓
Required Knowledge
      ↓
Knowledge Graph
      ↓
Assess Current State
      ↓
Learner State
      ↓
Identify Gap
      ↓
Generate Learning Action
      ↓
Learn
      ↓
Practice
      ↓
Assessment
      ↓
Update Mastery
      ↓
Select Next Action
```

最终形成：

> **Learn → Prove → Adapt**

---

## 🎓 学习模式

### 自主学习（Self Learning）

```text
PDF / 书籍 / 笔记 → 知识图谱 → 学习计划 → 自适应练习
```

适合：编程 · 技术学习 · 阅读书籍 · 新领域探索

### 学生模式（Student Mode）

```text
教材 → 课程知识 → 知识点 → 章节掌握度
→ 错题 → 自适应练习 → 考试准备
```

### 考试模式（Exam Mode）

```text
考试大纲 → 知识图谱 → 覆盖度分析
→ 自适应测评 → 薄弱知识 → 针对性复习
```

### 职业模式（Career Mode）

```text
岗位描述 → 技能要求 → 个人技能 → Evidence（证据）
→ 技能差距 → 学习计划 → 面试测评
```

> 岗位分析只是产品的一种 Learning Goal，而不是产品本身。

---

## 🧪 自适应测评

Assessment 是产品的核心能力之一。支持的题型：

```text
Recall（回忆）· Understanding（理解）· Comparison（对比）· Application（应用）
· Debugging（调试）· Design（设计）· Case Study（案例）· Coding（编码）· Interview（面试）
```

认知层级参考布鲁姆分类法：

```text
Remember（记忆）→ Understand（理解）→ Apply（应用）
→ Analyze（分析）→ Evaluate（评价）→ Create（创造）
```

系统根据用户状态动态决定下一道题：

```text
回答正确
   ↓
提高难度

回答错误
   ↓
降低难度
   ↓
检查 prerequisite（前置知识）
   ↓
发现基础知识缺失
   ↓
生成 remediation（补救学习）
```

---

## 🧠 学习者模型

长期目标不是保存：

```text
Quiz Score = 72
```

而是形成持续演化的个人模型：

```text
Personal Learner Model
├── Knowledge（知识）
├── Skills（技能）
├── Mastery（掌握度）
├── Confidence（置信度）
├── Misconceptions（误解）
├── Learning History（学习历史）
├── Evidence（证据）
├── Experience（经验）
├── Goals（目标）
└── Preferences（偏好）
```

最终回答：

> **"这个人现在知道什么、不知道什么、容易在哪些地方犯错，以及下一步应该学什么。"**

---

## 🗺️ 产品架构

```text
┌──────────────────────────────────────────────┐
│                 Tauri App                    │
│   React + TypeScript + Vite + TailwindCSS    │
│                   Zustand                    │
├──────────────────────────────────────────────┤
│             Application Layer                │
│   Learning Spaces · Knowledge · Assessment   │
│   Career · Study                             │
├──────────────────────────────────────────────┤
│               Core Engine                    │
│   Knowledge Engine · Knowledge Graph         │
│   Learner Model · Mastery Engine             │
│   Assessment Engine · Learning Planner       │
│   Recommendation Engine                      │
├──────────────────────────────────────────────┤
│                Local Data                    │
│   SQLite · Local Files · Vector Index        │
├──────────────────────────────────────────────┤
│                AI Layer                      │
│   Built-in Local LLM (llama-helper)          │
│   Ollama · llama.cpp · OpenAI-compatible     │
└──────────────────────────────────────────────┘
```

---

## 💻 技术栈

| 分层       | 技术                                                         |
| ---------- | ------------------------------------------------------------ |
| 桌面端     | Tauri · Rust                                                  |
| 前端       | React · TypeScript · Vite · TailwindCSS · Zustand            |
| 存储       | SQLite · 本地文件系统 · 本地向量索引                          |
| AI         | 内置本地模型（builtin，llama-helper 推理）· Ollama · llama.cpp · LM Studio · OpenAI · Anthropic · Gemini · DeepSeek · 自定义 OpenAI-compatible |

**默认内置 Qwen3.5 本地模型**（应用自带下载与加载，开箱即用、完全离线；也可切换 Ollama / llama.cpp / 云端服务）。

---

## 🔐 隐私优先 & Local-first

产品默认：

> **No Account. No Cloud. No Required Backend.**

用户的数据默认保存在本机：

```text
Documents（文档）· Resume（简历）· Notes（笔记）· Knowledge（知识）· Skills（技能）
Learning History（学习历史）· Assessment（测评）· Interview Answers（面试回答）· Learner State
```

全部属于用户。

核心能力不依赖云端：

```text
下载 → 安装 → 导入文档 → 配置 AI Provider → 开始学习
(默认启用内置本地 Qwen3.5 模型 —— 无需额外安装任何东西)
```

无需：注册账号 · 上传数据 · 云端数据库 · 强制 API Key

---

## 🔌 模型无关的 Provider 架构

AI 能力与业务逻辑解耦：

```ts
interface AIProvider {
  chat(input: ChatInput): Promise<ChatOutput>

  extractKnowledge(
    document: Document
  ): Promise<Knowledge[]>

  generateAssessment(
    context: AssessmentContext
  ): Promise<Question>

  evaluateAnswer(
    question: Question,
    answer: Answer
  ): Promise<Evaluation>
}
```

这样 Local AI、Cloud AI、Community Provider、Pro Provider 都可以独立实现同一接口。

---

## 📦 开源与 Pro 策略

采用 **Open Core + Local-first**，核心学习能力保持开源。

**开源部分：**

```text
Knowledge Engine · Knowledge Graph · Learner Model · Mastery Engine
Assessment Engine · Learning Planner · Career Engine · Local Storage
AI Provider SDK · Import / Export
```

任何用户都可以**免费、离线、完整**地使用核心学习闭环。

**Pro 部分**不出售数据，也不锁定核心学习能力，主要提供：

```text
Cloud AI · 加密同步 · 高级 AI 模型 · Deep Research
自动岗位监控 · 高级测评
多模型编排 · 高级分析 · 跨设备同步
```

原则：

> **OSS owns the engine. Pro sells the service.**

---

## 🛣️ 路线图

### Phase 0 — 基础（Foundation）
建立稳定的 Local-first Desktop 基础：Tauri Desktop · React + TypeScript · SQLite · 本地文件 · AI Provider 抽象 · Ollama · OpenAI-compatible Provider · 导入/导出 · 基础设置

### Phase 1 — MVP
**完成第一个真正可用的个人知识学习闭环。**

Document → Knowledge → Knowledge Graph → Learning Goal → Assessment → Mastery → Next Learning Action

- 知识库：创建 Learning Space、导入 PDF/MD/TXT、文档解析、Chunk、知识提取、来源引用
- 知识图谱：知识点、父子关系、前置关系、相关关系、图谱可视化
- 学习者状态：掌握度、置信度、尝试次数、正确率、最近复习、学习历史
- 测评：自动生成题目、多种题型、AI 答案评估、掌握度更新
- 学习规划：差距检测、下一步最优动作、学习会话、复习

**MVP 成功标准** —— 用户可以：导入一本技术书 → 自动生成知识体系 → 开始学习 → 回答问题 → 系统判断掌握程度 → 发现薄弱知识 → 自动推荐下一步学习内容。

### Phase 2 — Personal Learning OS
从"知识库"升级为"个人学习系统"：

- 学习者模型：误解识别、认知层级、遗忘曲线、间隔重复、应用能力、置信度校准
- 自适应学习：动态题目难度、前置知识诊断、补救学习、个性化学习路径、下一步最优动作
- 个人知识：多知识库、跨库关联、个人技能图谱、知识时间线

### Phase 3 — 学习模式（Learning Modes）
用同一个 Learning Engine 服务不同场景：学生（课程/考试/错题）· 职业（简历/JD/面试）· 研究（论文/引用图谱）· 个人（书籍/项目/爱好）

### Phase 4 — AI 学习 Agent
从"等待用户学习"升级为"AI 主动帮助用户学习"：监控学习者状态 → 发现知识缺口 → 规划学习 → 生成材料与测评 → 评估 → 更新模型 → 安排复习。

### Phase 5 — 个人 AI 知识图谱
建立长期 Personal Knowledge Graph（知识 + 技能 + 经验），让系统理解：**你是谁、你知道什么、你做过什么、你想成为什么、你还缺什么。**

### Phase 6 — 社区知识生态（Community Ecosystem）
从一个 App 发展成开放的知识/学习生态，允许社区贡献 Knowledge Packs、Skill Graphs、Career Paths、课程结构、考试知识、题库、学习策略、AI Provider 与插件。

```text
community/
├── ai-engineer
├── frontend-engineer
├── backend-engineer
├── data-scientist
├── aws-certification
├── computer-science
├── mathematics
└── english
```

安装一个 `AI Engineer Knowledge Pack`，然后直接开始学习。

---

## 📐 产品原则

1. **User Owns the Data** —— 用户的数据属于用户。
2. **Local-first** —— 联网是增强，而不是依赖。
3. **Open Source** —— 核心学习引擎开放。
4. **Model Agnostic** —— 不绑定任何 AI 模型。
5. **Evidence-based** —— 学习判断应该有依据：

```text
Source → Knowledge → Question → Answer → Evaluation → Mastery
```

6. **Adaptive** —— 不是所有人学习同样的内容，而是**根据每个人的 Learner State 决定下一步**。
7. **Explainable** —— 系统推荐必须能够回答"为什么让我学习这个？"：

```text
推荐学习：RAG Evaluation

原因：
1. 目标要求重要度为 High
2. 当前掌握度 28%
3. 相关 prerequisite 已掌握
4. 最近 3 次 Assessment 表现较差
5. 它是当前 Knowledge Graph 的关键瓶颈
```

---

## 📊 成功指标

产品不以 Chat 次数作为核心指标，更重要的是：

- **Knowledge（知识）** —— 知识覆盖率、图谱完整度、来源覆盖
- **Learning（学习）** —— 掌握度提升、学习效率、留存率、测评准确度
- **Learner（学习者）** —— 差距缩小、误解减少、置信度校准
- **Goal（目标）** —— 目标就绪度、必备知识覆盖率、达到就绪的时间

> **最终核心指标：用户是否越来越接近自己的 Learning Goal。**

---

## 🏁 项目状态

> **Early Stage / Pre-MVP**

当前重点：

1. Core Domain Model（核心领域模型）
2. Knowledge Graph（知识图谱）
3. Learner State（学习者状态）
4. Adaptive Assessment（自适应测评）
5. Next Best Learning Action（下一步最优学习动作）
6. Local-first Architecture（本地优先架构）

暂不追求功能数量。

> **先证明 Learning Loop，再扩展 Learning OS。**

**短期目标**只做一件事：证明"个人知识库可以变成一个真正会自主调整的学习系统"。

MVP 明确不需要：求职、简历生成、社交、云同步、团队功能、移动端、自动投递、大量第三方集成。

```text
Import → Knowledge → Graph → Assess → Mastery → Learn → Re-assess → Next Action
```

如果这个闭环成立，产品就成立。

**中期目标**：建立完整的 **Personal Learner Model**，让系统逐渐知道用户知道什么、不知道什么、容易错什么、学得快不快、多久会遗忘、擅长什么、正在学什么、想成为什么。

**长期目标**：成为**开源的 Personal Learning OS**，让 Personal Knowledge Graph + Personal Learner Model + Learning History + Goals 长期陪伴用户，并由 AI 持续维护。

---

## 🚀 快速开始

> ⚠️ **Phase 0 —— 基座脚手架**：五核心对象、AI Provider 抽象层、存储适配层、
> 七大引擎骨架与 UI 壳已可端到端运行。AI 生成能力（知识抽取、自适应测评）
> 尚未接入 Provider —— 引擎未配置时优雅降级为启发式逻辑，可完全离线运行。

### 环境要求

- **Node.js ≥ 22**（npm 10+）
- Rust 工具链 —— `cargo` ≥ 1.77 —— 仅在运行 / 打包 Tauri 桌面壳时需要

> Rust 通过 rustup 安装后，新终端默认已加载 `~/.cargo/env`；若出现
> `cargo: command not found`，先执行 `. "$HOME/.cargo/env"`（或把 `$HOME/.cargo/bin`
> 加入 PATH）。

### 运行 Web 应用（浏览器形态）

```bash
npm install     # 安装依赖
npm run dev     # 启动 Vite 开发服务器 → http://localhost:1420
```

打开输出的地址。**首页**会基于示例职业目标运行学习闭环 demo，展示引擎层
计算出的下一步推荐动作。此形态不依赖 Rust 工具链，改动 HMR 实时生效，
适合纯前端调试。

### 前端 + 桌面客户端本地联调

```bash
. "$HOME/.cargo/env"   # 确保 cargo 在 PATH（rustup 用户）
npm run tauri dev      # 一条命令：自动拉起 Vite → 编译 Rust → 打开原生窗口
```

机制：`src-tauri/tauri.conf.json` 中 `beforeDevCommand: "npm run dev"`、
`devUrl: "http://localhost:1420"`，因此 `tauri dev` 会**先自动启动 Vite dev
server（固定端口 1420），原生窗口再加载该地址** —— 前端与桌面端天然一起联调，
无需手动开两个终端：

| 改动位置 | 联调效果 |
| --- | --- |
| `src/`（React / TS / Tailwind） | 页面 HMR 实时刷新 |
| `src-tauri/`（Rust：IPC command / sidecar 等） | 自动重新编译并重启窗口 |

若先手动 `npm run dev` 再跑 `tauri dev`，会因 1420 端口 `strictPort` 冲突而失败。
仓库内置本地推理 sidecar `llama-helper`（Rust workspace 成员，`tauri dev` 时会一并
编译），首次编译耗时较长属正常现象。

### 打包构建（生产版桌面应用）

```bash
. "$HOME/.cargo/env"   # 确保 cargo 在 PATH（rustup 用户）
npm run tauri build    # 先 typecheck + vite build → dist/，再 cargo build --release
```

产物位置（均在 `src-tauri/target/release/`）：

| 产物 | 路径 |
| --- | --- |
| 可执行文件 | `target/release/personal-learning-os` |
| 本地推理 sidecar | `target/release/llama-helper` |
| 安装包（启用后） | `target/release/bundle/`（macOS `.app`/`.dmg` · Windows `.msi` · Linux `.deb`/`.AppImage`） |

> 当前为 Pre-MVP 阶段，`tauri.conf.json` 中 `bundle.active = false` 且未配置应用
> 图标，`tauri build` 只产出 release 二进制、跳过安装包生成。准备对外分发时，
> 需先配置 `bundle.icon` 并启用 bundle（将 `active` 置为 `true`）。

### 质量门禁

```bash
npm run typecheck   # tsc --noEmit 类型检查
npm run build       # 类型检查 + 生产构建 → dist/
```

### 仓库结构

```text
src/
  domain/      五核心对象 + goal/assessment/plan 类型（纯 TS）
  ai/          AI Provider 抽象 —— builtin（内置本地模型）· Ollama · OpenAI 兼容 …
  storage/     StorageAdapter —— 内存 + localStorage（SQLite/Tauri 预留）
  engine/      七大引擎 + loop.ts 学习闭环编排 demo
  stores/      zustand 状态 —— 闭环快照、Provider 配置
  components/  AppShell 布局 + 通用 UI 原语
  features/    页面骨架 —— home · spaces · knowledge · assessment · career · study · settings
src-tauri/     Tauri v2 壳 —— Cargo.toml · tauri.conf.json · capabilities · icons
  llama-helper/  本地推理 sidecar（Rust workspace 成员，llama.cpp 推理进程）
```

### MVP 验收目标

**MVP 发布后**，用户应能：

```text
导入一本技术书
        ↓
自动生成知识体系
        ↓
开始学习
        ↓
回答问题
        ↓
系统判断掌握程度
        ↓
发现薄弱知识
        ↓
自动推荐下一步学习内容
```

---

## 🤝 参与贡献

欢迎任何形式的贡献 —— 项目正处于奠定基础的最佳阶段。

- **想法与反馈** —— 通过 issue 讨论领域模型、学习闭环或路线图。
- **设计** —— 参与知识图谱建模、测评设计或学习者模型设计。
- **代码** —— 查看路线图，认领一个未启动的 Phase 并提交 PR。
- **文档** —— 改进本 README 或补充设计文档。

请遵循标准 GitHub 流程：fork → 分支 → PR。友善且有建设性。

---

## 📄 许可证

[MIT](LICENSE) © 2026 JackXuyi

你的知识属于你。你的学习历史属于你。你的学习者模型属于你。AI 应该帮助你理解自己知道什么——以及下一步该学什么。
