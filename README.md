# Personal Learning OS

> **An open-source, local-first AI learning system that turns your knowledge into an adaptive learning experience.**

一个 **开源、免费、Local-first、Privacy-first 的个人 AI 学习操作系统**。

它不是单纯的 AI 知识库，也不是传统 AI Tutor。

它的目标是：

> **让 AI 理解你的知识、学习目标和掌握程度，并持续决定“你下一步应该学什么”。**

---

## ✨ Vision

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
        │   Knowledge  │
        └──────┬───────┘
               ↓
        ┌──────────────┐
        │   Understand │
        └──────┬───────┘
               ↓
        ┌──────────────┐
        │   Practice   │
        └──────┬───────┘
               ↓
        ┌──────────────┐
        │   Assess     │
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

# 🎯 Product Positioning

## Open-source Personal Learning OS

核心不是：

* AI Knowledge Base
* AI Chatbot
* AI Tutor
* AI Resume Builder
* AI Job Search

而是：

> **Personal Learner Model + Knowledge Graph + Adaptive Learning**

产品围绕一个核心问题构建：

> **“基于我已有的知识、目标和学习历史，我现在最应该学什么？”**

---

# 🧠 Core Concept

产品由五个核心模型组成：

```text
┌───────────────────────────────────────┐
│             Personal Model            │
│                                       │
│  Knowledge                            │
│  Skills                               │
│  Experience                           │
│  Evidence                             │
│  Learning History                     │
└───────────────────┬───────────────────┘
                    ↓
             Knowledge Graph
                    ↓
             Learner State
                    ↓
              Skill / Gap
                    ↓
           Adaptive Learning
                    ↓
              Assessment
                    ↓
             Mastery Update
                    │
                    └──────→ Next Action
```

---

# 🧩 Core Objects

## 1. Document

用户自己的知识来源。

支持：

* PDF
* Markdown
* TXT
* DOCX
* EPUB
* Web Page
* Notes
* Code
* 图片 / OCR
* 自定义文本

原则：

> **原始资料永远属于用户。**

---

## 2. Knowledge

从 Document 中提取结构化知识。

例如：

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

---

## 3. Knowledge Graph

描述知识之间的关系：

```text
Concept
├── prerequisite
├── related
├── parent
├── child
├── example
├── contrast
├── application
└── source
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

---

## 4. Learner State

描述：

> **“用户现在到底掌握了什么？”**

例如：

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

* Mastery
* Confidence
* Attempts
* Correctness
* Cognitive Level
* Misconceptions
* Last Reviewed
* Forgetting
* Application Ability
* Interview Ability

---

## 5. Learning Goal

学习目标是整个系统的重要入口。

支持：

```text
Career
Study
Exam
Personal
Research
Project
```

例如：

### Career

```text
目标：
AI Application Engineer
```

### Student

```text
目标：
计算机网络期末考试
```

### Personal

```text
目标：
深入学习 RAG
```

### Research

```text
目标：
理解 Agent Architecture
```

底层全部进入同一个 Learning Engine。

---

# 🔄 Learning Loop

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

# 🎓 Learning Modes

## Self Learning

```text
PDF / Book / Notes
        ↓
Knowledge Graph
        ↓
Learning Plan
        ↓
Adaptive Practice
```

适合：

* 编程
* 技术学习
* 阅读书籍
* 新领域探索

---

## Student Mode

```text
教材
 ↓
课程知识
 ↓
知识点
 ↓
章节掌握度
 ↓
错题
 ↓
自适应练习
 ↓
考试准备
```

---

## Exam Mode

```text
Exam Syllabus
      ↓
Knowledge Graph
      ↓
Coverage Analysis
      ↓
Adaptive Assessment
      ↓
Weak Knowledge
      ↓
Targeted Review
```

---

## Career Mode

```text
Job Description
       ↓
Requirements
       ↓
Personal Skills
       ↓
Evidence
       ↓
Skill Gap
       ↓
Learning Plan
       ↓
Interview Assessment
```

岗位分析只是产品的一种 Learning Goal，而不是产品本身。

---

# 💼 Career Example

目标：

```text
AI Application Engineer
```

系统分析：

| Skill         | Importance | Mastery | Gap |
| ------------- | ---------: | ------: | --- |
| React         |       High |     92% | 🟢  |
| TypeScript    |       High |     89% | 🟢  |
| Python        |     Medium |     73% | 🟢  |
| RAG           |       High |     72% | 🟡  |
| Vector Search |       High |     61% | 🟡  |
| Reranking     |       High |     43% | 🔴  |
| Evaluation    |       High |     28% | 🔴  |
| Agent         |       High |     35% | 🔴  |

系统不会简单告诉用户：

> “你缺少 Reranking。”

而是继续判断：

```text
Reranking
   ↓
Knowledge       48%
Application     32%
Interview       21%
Evidence        Weak
```

最终给出：

> **Reranking 是当前最值得学习的知识点。**

---

# 🧪 Adaptive Assessment

Assessment 是核心能力之一。

支持：

* Recall
* Understanding
* Comparison
* Application
* Debugging
* Design
* Case Study
* Coding
* Interview

认知层级可以参考：

```text
Remember
   ↓
Understand
   ↓
Apply
   ↓
Analyze
   ↓
Evaluate
   ↓
Create
```

系统根据用户状态动态决定下一道题。

例如：

```text
回答正确
   ↓
提高难度

回答错误
   ↓
降低难度
   ↓
检查 prerequisite
   ↓
发现基础知识缺失
   ↓
生成 remediation
```

---

# 🧠 Learner Model

长期目标不是保存：

```text
Quiz Score = 72
```

而是形成：

```text
Personal Learner Model

Knowledge
Skills
Mastery
Confidence
Misconceptions
Learning History
Evidence
Experience
Goals
Preferences
```

最终回答：

> **“这个人现在知道什么、不知道什么、容易在哪些地方犯错，以及下一步应该学什么。”**

---

# 🗺️ Product Architecture

```text
┌─────────────────────────────────────────────┐
│                 Tauri App                   │
│                                             │
│ React + TypeScript + Vite + TailwindCSS    │
│ Zustand                                     │
├─────────────────────────────────────────────┤
│              Application Layer              │
│                                             │
│ Learning Spaces                             │
│ Knowledge                                   │
│ Assessment                                  │
│ Career                                      │
│ Study                                       │
├─────────────────────────────────────────────┤
│                Core Engine                  │
│                                             │
│ Knowledge Engine                            │
│ Knowledge Graph                             │
│ Learner Model                               │
│ Mastery Engine                              │
│ Assessment Engine                           │
│ Learning Planner                            │
│ Recommendation Engine                       │
├─────────────────────────────────────────────┤
│                 Local Data                  │
│                                             │
│ SQLite                                      │
│ Local Files                                 │
│ Vector Index                                │
├─────────────────────────────────────────────┤
│                 AI Layer                    │
│                                             │
│ Ollama                                      │
│ llama.cpp                                   │
│ LM Studio                                   │
│ OpenAI-compatible APIs                      │
│ Custom Providers                            │
└─────────────────────────────────────────────┘
```

---

# 💻 Technology Stack

## Desktop

* Tauri
* Rust

## Frontend

* React
* TypeScript
* Vite
* TailwindCSS
* Zustand

## Storage

* SQLite
* Local Filesystem
* Local Vector Index

## AI

Provider abstraction：

```text
AIProvider
├── Ollama
├── llama.cpp
├── LM Studio
├── OpenAI
├── Anthropic
├── Gemini
├── DeepSeek
└── Custom OpenAI-compatible
```

用户可以完全使用本地模型。

---

# 🔐 Privacy First

产品默认：

> **No Account. No Cloud. No Required Backend.**

用户的数据默认保存在本机：

```text
Documents
Resume
Notes
Knowledge
Skills
Learning History
Assessment
Interview Answers
Learner State
```

全部属于用户。

---

# 🌐 Local-first

核心能力不依赖云端：

```text
Download
   ↓
Install
   ↓
Import Documents
   ↓
Configure Ollama
   ↓
Start Learning
```

无需：

* 注册账号
* 上传数据
* 云端数据库
* 强制 API Key

---

# 🔌 Provider Architecture

AI 能力必须与业务逻辑解耦。

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

这样：

```text
Local AI
Cloud AI
Community Provider
Pro Provider
```

都可以独立实现。

---

# 📦 Open Source Strategy

采用：

> **Open Core + Local-first**

核心学习能力保持开源。

## Open Source

```text
Knowledge Engine
Knowledge Graph
Learner Model
Mastery Engine
Assessment Engine
Learning Planner
Career Engine
Local Storage
AI Provider SDK
Import / Export
```

任何用户都可以：

> 免费、离线、完整使用核心学习闭环。

---

# ⭐ Pro Strategy

Pro 不出售数据，也不锁定核心学习能力。

Pro 主要提供：

```text
Cloud AI
Encrypted Sync
Advanced AI Models
Deep Research
Automatic Job Monitoring
Advanced Assessment
Multi-model Orchestration
Advanced Analytics
Cross-device Sync
```

原则：

> **OSS owns the engine. Pro sells the service.**

---

# 🛣️ Roadmap

## Phase 0 — Foundation

目标：

> 建立稳定的 Local-first Desktop 基础。

### 功能

* [ ] Tauri Desktop
* [ ] React + TypeScript
* [ ] SQLite
* [ ] Local Files
* [ ] AI Provider abstraction
* [ ] Ollama
* [ ] OpenAI-compatible Provider
* [ ] Import / Export
* [ ] 基础设置

---

# 🚀 Phase 1 — MVP

目标：

> **完成第一个真正可用的个人知识学习闭环。**

核心流程：

```text
Document
   ↓
Knowledge
   ↓
Knowledge Graph
   ↓
Learning Goal
   ↓
Assessment
   ↓
Mastery
   ↓
Next Learning Action
```

### P0

#### Knowledge Base

* [ ] 创建 Learning Space
* [ ] 导入 PDF / Markdown / TXT
* [ ] 文档解析
* [ ] Chunk
* [ ] Knowledge Extraction
* [ ] Source Citation

#### Knowledge Graph

* [ ] Knowledge Point
* [ ] Parent / Child
* [ ] Prerequisite
* [ ] Related
* [ ] Graph Visualization

#### Learner State

* [ ] Mastery
* [ ] Confidence
* [ ] Attempts
* [ ] Correctness
* [ ] Last Reviewed
* [ ] Learning History

#### Assessment

* [ ] 自动生成题目
* [ ] 多种题型
* [ ] AI Answer Evaluation
* [ ] Mastery Update

#### Learning Planner

* [ ] Gap Detection
* [ ] Next Best Action
* [ ] Learning Session
* [ ] Review

### MVP 成功标准

用户可以：

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

# 🚀 Phase 2 — Personal Learning OS

目标：

> 从“知识库”升级为“个人学习系统”。

### Learner Model

* [ ] Misconception
* [ ] Cognitive Level
* [ ] Forgetting Curve
* [ ] Spaced Repetition
* [ ] Application Ability
* [ ] Confidence Calibration

### Adaptive Learning

* [ ] 动态题目难度
* [ ] Prerequisite Diagnosis
* [ ] Remediation
* [ ] Personalized Learning Path
* [ ] Next Best Action

### Personal Knowledge

* [ ] 多 Knowledge Base
* [ ] 跨 Knowledge Base 关联
* [ ] Personal Skill Graph
* [ ] Knowledge Timeline
* [ ] Learning History

目标状态：

```text
                     YOU
                      │
        ┌─────────────┼─────────────┐
        ▼             ▼             ▼
    Knowledge       Skills       Experience
        │             │             │
        └─────────────┼─────────────┘
                      ▼
                Learner Model
                      │
             ┌────────┴────────┐
             ▼                 ▼
           Goals            Mastery
             │                 │
             └────────┬────────┘
                      ▼
              Next Best Action
```

---

# 🚀 Phase 3 — Learning Modes

目标：

> 让同一个 Learning Engine 服务不同场景。

### Student

* [ ] Course
* [ ] Syllabus
* [ ] Exam
* [ ] Homework
* [ ] Wrong Answers
* [ ] Exam Readiness

### Career

* [ ] Resume
* [ ] JD
* [ ] Skill Requirements
* [ ] Evidence
* [ ] Skill Gap
* [ ] Interview
* [ ] Career Readiness

### Research

* [ ] Papers
* [ ] Research Notes
* [ ] Citation Graph
* [ ] Concept Graph
* [ ] Research Questions

### Personal

* [ ] Books
* [ ] Articles
* [ ] Projects
* [ ] Hobbies
* [ ] Personal Goals

---

# 🚀 Phase 4 — AI Learning Agent

目标：

> 从“等待用户学习”升级为“AI 主动帮助用户学习”。

AI Agent 可以：

```text
Monitor Learner State
        ↓
Detect Knowledge Gap
        ↓
Plan Learning
        ↓
Generate Material
        ↓
Generate Assessment
        ↓
Evaluate
        ↓
Update Learner Model
        ↓
Schedule Review
```

例如：

> 发现用户连续三次在 Reranking 的 Application 类问题上失败。

系统主动：

```text
1. 分析错误
2. 判断 prerequisite
3. 生成针对性解释
4. 生成实例
5. 出一道基础题
6. 再出一道应用题
7. 更新 Mastery
8. 安排复习
```

---

# 🚀 Phase 5 — Personal AI Knowledge Graph

目标：

> 建立长期 Personal Knowledge Graph。

```text
                         YOU
                          │
         ┌────────────────┼────────────────┐
         ▼                ▼                ▼
      Knowledge         Skills          Experience
         │                │                │
         ▼                ▼                ▼
      Concepts         Evidence         Projects
         │                │                │
         └────────────────┼────────────────┘
                          ▼
                    Learner Model
                          │
              ┌───────────┼───────────┐
              ▼           ▼           ▼
            Career      Study      Personal
              │           │           │
              └───────────┼───────────┘
                          ▼
                    Learning Goals
```

最终让系统理解：

> **“你是谁、你知道什么、你做过什么、你想成为什么、你还缺什么。”**

---

# 🚀 Phase 6 — Community Knowledge Ecosystem

目标：

> 从一个 App 发展成开放的 Knowledge / Learning Ecosystem。

允许社区贡献：

```text
Knowledge Packs
Skill Graphs
Career Paths
Course Structures
Exam Knowledge
Assessment Sets
Learning Strategies
AI Providers
Plugins
```

例如：

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

用户可以直接安装：

```text
AI Engineer Knowledge Pack
```

然后开始学习。

---

# 🌍 Long-term Vision

最终形成：

```text
                   Personal Learning OS
                            │
          ┌─────────────────┼─────────────────┐
          │                 │                 │
          ▼                 ▼                 ▼
       Knowledge          Learner           Goals
        Engine             Model           Engine
          │                 │                 │
          └─────────────────┼─────────────────┘
                            ▼
                    Adaptive Learning
                            │
                            ▼
                     AI Learning Agent
                            │
                            ▼
                  Personal Knowledge Graph
                            │
                            ▼
                     Lifelong Learning
```

最终产品不是：

> 一个 AI 学习 App。

而是：

> **一个属于用户自己的长期 Learning Model。**

---

# 🧭 Product Principles

## 1. User Owns the Data

用户的数据属于用户。

---

## 2. Local-first

联网是增强，而不是依赖。

---

## 3. Open Source

核心学习引擎开放。

---

## 4. Model Agnostic

不绑定任何 AI 模型。

---

## 5. Evidence-based

学习判断应该有依据：

```text
Source
 ↓
Knowledge
 ↓
Question
 ↓
Answer
 ↓
Evaluation
 ↓
Mastery
```

---

## 6. Adaptive

不是：

> 所有人学习同样的内容。

而是：

> **根据每个人的 Learner State 决定下一步。**

---

## 7. Explainable

系统推荐：

> “为什么让我学习这个？”

必须能够回答。

例如：

```text
推荐学习：

RAG Evaluation

原因：

1. 目标要求 High
2. 当前 Mastery 28%
3. 相关 prerequisite 已掌握
4. 最近 3 次 Assessment 表现较差
5. 它是当前 Knowledge Graph 的关键瓶颈
```

---

# 📊 Success Metrics

产品不以：

> Chat 次数

作为核心指标。

更重要的是：

### Knowledge

* Knowledge Coverage
* Graph Completeness
* Source Coverage

### Learning

* Mastery Improvement
* Learning Efficiency
* Retention
* Assessment Accuracy

### Learner

* Gap Reduction
* Misconception Reduction
* Confidence Calibration

### Goal

* Goal Readiness
* Required Knowledge Coverage
* Time-to-Readiness

最终核心指标：

> **用户是否越来越接近自己的 Learning Goal。**

---

# 🏁 Short-term Goal

短期只做一件事：

> ## **证明“个人知识库可以变成一个真正会自主调整的学习系统”。**

MVP 不需要：

* Job Search
* Resume Builder
* 社交
* 云同步
* Team
* 移动端
* 自动投递
* 大量第三方集成

只需要做好：

```text
Import
  ↓
Knowledge
  ↓
Graph
  ↓
Assess
  ↓
Mastery
  ↓
Learn
  ↓
Re-assess
  ↓
Next Action
```

如果这个闭环成立，产品就成立。

---

# 🔭 Medium-term Goal

建立完整的：

> **Personal Learner Model**

让系统逐渐知道：

```text
用户知道什么
用户不知道什么
用户容易错什么
用户学得快不快
用户多久会遗忘
用户擅长什么
用户正在学习什么
用户想成为什么
```

并能够主动决定：

> **下一步最值得做什么。**

---

# 🌌 Long-term Goal

成为：

> ## **Open-source Personal Learning OS**

让用户拥有一个长期存在的：

```text
Personal Knowledge Graph
+
Personal Learner Model
+
Personal Learning History
+
Personal Goals
```

并通过 AI 持续维护。

最终：

```text
                 Your Knowledge
                       +
                 Your Experience
                       +
                  Your Goals
                       +
                 Your Learning
                       ↓
              ┌────────────────┐
              │ Personal AI    │
              │ Learning OS    │
              └───────┬────────┘
                      ↓
              Understand Yourself
                      ↓
                Learn Anything
                      ↓
                 Master More
                      ↓
              Achieve Your Goals
```

---

# 📝 Status

> **Early Stage / Pre-MVP**

当前重点：

1. Core Domain Model
2. Knowledge Graph
3. Learner State
4. Adaptive Assessment
5. Next Best Learning Action
6. Local-first Architecture

暂不追求功能数量。

**先证明 Learning Loop，再扩展 Learning OS。**

---

# 🤝 Philosophy

> **Your knowledge should belong to you.**
>
> **Your learning history should belong to you.**
>
> **Your learner model should belong to you.**
>
> **AI should help you understand what you know — and what you should learn next.**

---
