# 📚 Personal Learning OS

> **An open-source, local-first AI learning system that turns your knowledge into an adaptive learning experience.**

[English](README.md) · [简体中文](README.zh-CN.md)

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)
![Status](https://img.shields.io/badge/Status-Pre--MVP-orange)
![PRs Welcome](https://img.shields.io/badge/PRs-Welcome-brightgreen)

**Personal Learning OS (PLOS)** is an open-source, free, **local-first** and **privacy-first** personal AI learning operating system.

It is not just an AI knowledge base. It is not a traditional AI tutor.

Its mission:

> **Let AI understand your knowledge, your learning goals, and your level of mastery — and continuously decide what you should learn next.**

---

## Table of Contents

- [✨ Vision](#-vision)
- [🎯 Product Positioning](#-product-positioning)
- [🧠 Core Concept](#-core-concept)
- [🔄 Learning Loop](#-learning-loop)
- [🎓 Learning Modes](#-learning-modes)
- [🧪 Adaptive Assessment](#-adaptive-assessment)
- [🧠 Learner Model](#-learner-model)
- [🗺️ Product Architecture](#️-product-architecture)
- [💻 Tech Stack](#-tech-stack)
- [🔐 Privacy & Local-first](#-privacy--local-first)
- [🔌 Model-Agnostic Providers](#-model-agnostic-providers)
- [📦 Open Source & Pro Strategy](#-open-source--pro-strategy)
- [🛣️ Roadmap](#️-roadmap)
- [📐 Product Principles](#-product-principles)
- [📊 Success Metrics](#-success-metrics)
- [🏁 Status](#-status)
- [🚀 Getting Started](#-getting-started)
- [🤝 Contributing](#-contributing)
- [📄 License](#-license)

---

## ✨ Vision

A traditional knowledge base answers:

```text
Where do I store my material?
            ↓
How do I find it?
            ↓
How do I ask AI?
```

Personal Learning OS answers a much deeper chain:

```text
What do I know?
      ↓
What do I want to learn?
      ↓
What have I already mastered?
      ↓
What am I still missing?
      ↓
Why haven't I mastered it?
      ↓
What should I learn next?
      ↓
Did I really learn it?
      ↓
What comes next?
```

This forms a continuously running learning loop:

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
        │  Practice    │
        └──────┬───────┘
               ↓
        ┌──────────────┐
        │   Assess     │
        └──────┬───────┘
               ↓
        ┌──────────────┐
        │Learner State │
        └──────┬───────┘
               ↓
        ┌──────────────┐
        │ Next Action  │
        └──────┬───────┘
               │
               └─────────────→ Learn
```

---

## 🎯 Product Positioning

**Not:**

- AI Knowledge Base
- AI Chatbot
- AI Tutor
- AI Resume Builder
- AI Job Search

**But:**

> **Personal Learner Model + Knowledge Graph + Adaptive Learning**

The product is built around one core question:

> **"Based on my existing knowledge, goals, and learning history — what should I learn right now?"**

---

## 🧠 Core Concept

The product is made of five core objects:

### 1. Document

The user's own knowledge sources.

Supported formats: **PDF · Markdown · TXT · DOCX · EPUB · Web pages · Notes · Code · Images / OCR · Custom text**

> **Your raw material always belongs to you.**

### 2. Knowledge

Structured knowledge extracted from documents. Example — the domain tree of RAG:

```text
RAG
├── Retrieval
├── Embedding
├── Chunking
├── Reranking
├── Evaluation
└── Generation
```

Knowledge is not a plain text chunk — it is a semantic knowledge unit with meaning and relationships.

### 3. Knowledge Graph

Describes the relationships between knowledge:

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

Example:

```text
Reranking
    │
    ├── prerequisite → Retrieval
    ├── prerequisite → Embedding
    ├── related → Vector Search
    └── application → RAG
```

### 4. Learner State

Describes **"what the user actually masters right now"**.

Example — mastery of the RAG tree:

```text
RAG
├── Retrieval        82%
├── Embedding        76%
├── Chunking         71%
├── Reranking        43%
├── Evaluation       28%
└── Production       36%
```

Beyond a single score, it tracks:

- Mastery · Confidence · Attempts · Correctness
- Cognitive Level · Misconceptions · Last Reviewed · Forgetting
- Application Ability · Interview Ability

### 5. Learning Goal

The goal is the main entry point to the whole system:

```text
Career · Study · Exam · Personal · Research · Project
```

Examples:

| Type     | Goal                          |
| -------- | ----------------------------- |
| Career   | AI Application Engineer       |
| Study    | Computer Network final exam   |
| Personal | Deep dive into RAG            |
| Research | Understand Agent architecture |

Every goal flows into the **same Learning Engine**.

---

## 🔄 Learning Loop

How the system works:

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

Ultimately: **Learn → Prove → Adapt**

---

## 🎓 Learning Modes

### Self Learning

```text
PDF / Book / Notes → Knowledge Graph → Learning Plan → Adaptive Practice
```

For: programming · technical learning · reading books · exploring new domains

### Student Mode

```text
Textbook → Course knowledge → Knowledge points → Chapter mastery
→ Wrong answers → Adaptive practice → Exam preparation
```

### Exam Mode

```text
Exam syllabus → Knowledge Graph → Coverage analysis
→ Adaptive assessment → Weak knowledge → Targeted review
```

### Career Mode

```text
Job description → Requirements → Personal skills → Evidence
→ Skill gap → Learning plan → Interview assessment
```

> Job analysis is just one kind of Learning Goal — not the product itself.

---

## 🧪 Adaptive Assessment

Assessment is one of the core capabilities. Supported question types:

```text
Recall · Understanding · Comparison · Application · Debugging · Design
Case Study · Coding · Interview
```

Cognitive levels follow Bloom's taxonomy:

```text
Remember → Understand → Apply → Analyze → Evaluate → Create
```

The system picks the next question dynamically based on the learner's state:

```text
Answered correctly → raise difficulty

Answered incorrectly → lower difficulty
    ↓
check prerequisites
    ↓
foundational knowledge missing
    ↓
generate remediation
```

---

## 🧠 Learner Model

The long-term goal is not to store:

```text
Quiz Score = 72
```

but to build a persistent model:

```text
Personal Learner Model
├── Knowledge
├── Skills
├── Mastery
├── Confidence
├── Misconceptions
├── Learning History
├── Evidence
├── Experience
├── Goals
└── Preferences
```

Which answers:

> **"What this person knows, doesn't know, commonly gets wrong — and what they should learn next."**

---

## 🗺️ Product Architecture

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

## 💻 Tech Stack

| Layer       | Technology                                                  |
| ----------- | ----------------------------------------------------------- |
| Desktop     | Tauri · Rust                                                 |
| Frontend    | React · TypeScript · Vite · TailwindCSS · Zustand           |
| Storage     | SQLite · Local Filesystem · Local Vector Index              |
| AI          | Built-in local model (builtin, llama-helper inference) · Ollama · llama.cpp · LM Studio · OpenAI · Anthropic · Gemini · DeepSeek · Custom OpenAI-compatible |

**A Qwen3.5 local model is bundled by default** — the app downloads and loads it itself (out-of-the-box, fully offline); Ollama / llama.cpp / cloud providers remain switchable.

You can run the whole product on **fully local models**.

---

## 🗄️ Storage Layer (RAG)

Everything stays on your machine. Storage sits behind a single `StorageAdapter` (`src/storage/types.ts`) with three backends picked from the runtime — business code never knows which one it got:

| Backend | Environment | Persisted to | Notes |
| ------- | ----------- | ------------ | ----- |
| `tauri` | Desktop (production) | `app_data_dir/plos.db` (SQLite) | Section / Chunk / KnowledgeUnit / Relation / Embedding land here, FTS5 full-text search |
| `local` | Browser preview | localStorage | Survives reloads; doubles as the desktop fallback |
| `memory` | Tests / SSR | in-process `Map` | No side effects, inject and assert |

**Data hierarchy**: `Document → Chapter → Section → Chunk`. A Chunk is the smallest unit for embedding and retrieval; knowledge units and relations hang off it and form the basis for search and recommendations.

- **Degradation** — if any `db_*` command fails on desktop, calls silently fall back to localStorage. The app never becomes unusable because of a storage fault.
- **Auto migration** — the first time SQLite proves available, legacy RAG data in localStorage is moved over once (idempotent; a failure retries on the next launch).
- **Manual import** — `node scripts/migrate-rag-to-sqlite.mjs --in export.json --db plos.db` (or emit a `.sql` file instead).
- **Schema** — see `src-tauri/src/db/schema.sql` for per-column comments and known limitations.

---

## 🔐 Privacy & Local-first

The product defaults to:

> **No Account. No Cloud. No Required Backend.**

Your data lives on your machine by default:

```text
Documents · Resume · Notes · Knowledge · Skills
Learning History · Assessment · Interview Answers · Learner State
```

All of it belongs to you.

Core capabilities never depend on the cloud:

```text
Download → Install → Import Documents → Configure AI Provider → Start Learning
(the built-in local Qwen3.5 model is active by default — nothing else to install)
```

No account registration · No data upload · No cloud database · No mandatory API key

---

## 🔌 Model-Agnostic Providers

AI capabilities are decoupled from business logic:

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

So local AI, cloud AI, community providers and Pro providers can each implement the interface independently.

---

## 📦 Open Source & Pro Strategy

**Open Core + Local-first.** The core learning capabilities stay open source.

**Open source:**

```text
Knowledge Engine · Knowledge Graph · Learner Model · Mastery Engine
Assessment Engine · Learning Planner · Career Engine · Local Storage
AI Provider SDK · Import / Export
```

Anyone can use the full core learning loop — **free, offline, complete**.

**Pro** does not sell your data or lock away the core. Pro mainly adds:

```text
Cloud AI · Encrypted Sync · Advanced AI Models · Deep Research
Automatic Job Monitoring · Advanced Assessment
Multi-model Orchestration · Advanced Analytics · Cross-device Sync
```

> **OSS owns the engine. Pro sells the service.**

---

## 🛣️ Roadmap

### Phase 0 — Foundation
Stable local-first desktop base: Tauri Desktop · React + TypeScript · SQLite · Local Files · AI Provider abstraction · Ollama · OpenAI-compatible Provider · Import/Export · Settings

### Phase 1 — MVP
**The first truly usable personal knowledge learning loop.**

Document → Knowledge → Knowledge Graph → Learning Goal → Assessment → Mastery → Next Learning Action

- Knowledge Base: Learning Space, import PDF/MD/TXT, parsing, chunking, knowledge extraction, source citation
- Knowledge Graph: knowledge points, parent/child, prerequisite, related, graph visualization
- Learner State: mastery, confidence, attempts, correctness, last reviewed, history
- Assessment: auto-generated questions, multiple question types, AI evaluation, mastery update
- Learning Planner: gap detection, next best action, learning session, review

**MVP success criteria** — a user can import a technical book → auto-build a knowledge system → start learning → answer questions → the system judges mastery → finds weak knowledge → recommends the next step.

### Phase 2 — Personal Learning OS
From "knowledge base" to "personal learning system":

- Learner Model: misconceptions, cognitive level, forgetting curve, spaced repetition, application ability, confidence calibration
- Adaptive Learning: dynamic difficulty, prerequisite diagnosis, remediation, personalized learning path, next best action
- Personal Knowledge: multiple knowledge bases, cross-base links, personal skill graph, knowledge timeline

### Phase 3 — Learning Modes
Serve different scenarios with one engine: Student (course/exam/wrong answers) · Career (resume/JD/interview) · Research (papers/citation graph) · Personal (books/projects/hobbies)

### Phase 4 — AI Learning Agent
From "waiting for the user to learn" to "AI proactively helps the user learn": monitor learner state → detect gaps → plan → generate material & assessment → evaluate → update the model → schedule review.

### Phase 5 — Personal AI Knowledge Graph
Build a long-term personal graph of Knowledge + Skills + Experience so the system understands: **who you are, what you know, what you've done, what you want to become, and what you still lack.**

### Phase 6 — Community Knowledge Ecosystem
From an app to an open knowledge/learning ecosystem where the community contributes Knowledge Packs, Skill Graphs, Career Paths, Course Structures, Exam Knowledge, Assessment Sets, Learning Strategies, AI Providers and Plugins.

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

Install an `AI Engineer Knowledge Pack` and start learning right away.

---

## 📐 Product Principles

1. **User owns the data** — your data belongs to you.
2. **Local-first** — connectivity is an enhancement, not a dependency.
3. **Open source** — the core learning engine stays open.
4. **Model agnostic** — never locked to any single AI model.
5. **Evidence-based** — every learning judgment has a traceable basis:

```text
Source → Knowledge → Question → Answer → Evaluation → Mastery
```

6. **Adaptive** — not everyone learns the same content; the next step is decided by each person's Learner State.
7. **Explainable** — the system can always answer *"why am I learning this?"*:

```text
Recommended: RAG Evaluation
Reasons:
1. Goal requires High importance
2. Current mastery is 28%
3. Prerequisites are already mastered
4. Last 3 assessments were weak
5. It is the key bottleneck in the current Knowledge Graph
```

---

## 📊 Success Metrics

The core metric is not "chat count". What matters more:

- **Knowledge** — coverage, graph completeness, source coverage
- **Learning** — mastery improvement, efficiency, retention, assessment accuracy
- **Learner** — gap reduction, misconception reduction, confidence calibration
- **Goal** — goal readiness, required-knowledge coverage, time-to-readiness

> **The ultimate metric: is the user getting closer to their Learning Goal?**

---

## 🏁 Status

> **Early Stage / Pre-MVP**

Current focus:

1. Core Domain Model
2. Knowledge Graph
3. Learner State
4. Adaptive Assessment
5. Next Best Learning Action
6. Local-first Architecture

We are not chasing feature count.

> **Prove the Learning Loop first, then scale the Learning OS.**

Short-term goal — prove one thing: a personal knowledge base can become a learning system that truly adjusts itself.

MVP explicitly excludes: job search, resume builder, social features, cloud sync, team features, mobile, auto-applying, and large third-party integrations.

```text
Import → Knowledge → Graph → Assess → Mastery → Learn → Re-assess → Next Action
```

If this loop works, the product works.

Medium-term: build a complete **Personal Learner Model** — the system gradually learns what you know, don't know, get wrong, learn fast/slow, forget quickly/slowly, what you're good at, what you're learning, and who you want to become.

Long-term: become an **open-source Personal Learning OS** where a Personal Knowledge Graph + Personal Learner Model + Learning History + Goals live with you for life, continuously maintained by AI.

---

## 🚀 Getting Started

> ⚠️ **Phase 0 — Foundation scaffold.** The five core objects, AI provider
> abstraction, storage adapters, seven engine skeletons and the UI shell run
> end-to-end. AI-backed generation (knowledge extraction, adaptive assessment)
> is not wired to a provider yet — engines degrade gracefully to heuristics.

### Prerequisites

- **Node.js ≥ 22** (npm 10+)
- Rust toolchain — `cargo` ≥ 1.77 — only when running / bundling the Tauri desktop shell

> If Rust was installed via rustup, new shells load `~/.cargo/env` automatically; if
> you hit `cargo: command not found`, run `. "$HOME/.cargo/env"` first (or add
> `$HOME/.cargo/bin` to your PATH).

### Run the web app (browser mode)

```bash
npm install     # install dependencies
npm run dev     # start the Vite dev server → http://localhost:1420
```

Open the printed URL. The **Home** page runs the learning-loop demo against a
sample career goal and shows the recommended next action computed by the
engine layer. This mode does not require the Rust toolchain and hot-reloads on
every change — great for frontend-only work.

### Frontend + desktop shell local dev

```bash
. "$HOME/.cargo/env"   # make sure cargo is on PATH (rustup users)
npm run tauri dev      # one command: starts Vite → compiles Rust → opens the native window
```

How it works: `src-tauri/tauri.conf.json` sets `beforeDevCommand: "npm run dev"`
and `devUrl: "http://localhost:1420"`, so `tauri dev` **starts the Vite dev server
(fixed port 1420) first, then the native window loads that URL** — frontend and
desktop shell are wired up for local dev by default, no need for two terminals:

| What you change | Effect during dev |
| --- | --- |
| `src/` (React / TS / Tailwind) | Page hot-reloads via HMR |
| `src-tauri/` (Rust: IPC commands / sidecar, etc.) | Recompiles and restarts the window automatically |

Running `npm run dev` manually and then `tauri dev` fails on a `strictPort`
conflict for port 1420. A local-inference sidecar `llama-helper` (Rust workspace
member) is compiled together with `tauri dev`; the first compile takes a while —
that is expected.

### Build a production desktop app

```bash
. "$HOME/.cargo/env"   # make sure cargo is on PATH (rustup users)
npm run tauri build    # typecheck + vite build → dist/, then cargo build --release
```

Artifacts land in `src-tauri/target/release/`:

| Artifact | Path |
| --- | --- |
| Executable | `target/release/personal-learning-os` |
| Local inference sidecar | `target/release/llama-helper` |
| Installers (once enabled) | `target/release/bundle/` (macOS `.app`/`.dmg` · Windows `.msi` · Linux `.deb`/`.AppImage`) |

> The project is pre-MVP: `tauri.conf.json` has `bundle.active = false` and no app
> icon configured, so `tauri build` currently emits the release binaries only and
> skips installer generation. Before distributing, configure `bundle.icon` and
> enable bundling (set `active` to `true`).

### Quality gates

```bash
npm run typecheck     # tsc --noEmit
npm run build         # typecheck + production build → dist/
npm run test:storage  # RAG storage layer unit tests (in-memory backend)
```

### Repository layout

```text
src/
  domain/      five core objects + goal/assessment/plan types (pure TS)
  ai/          AI Provider abstraction — builtin (local model) · Ollama · OpenAI-compatible …
  storage/     StorageAdapter — in-memory / localStorage / SQLite (Tauri) backends
  engine/      seven engines + loop.ts orchestration demo
  stores/      zustand state — loop snapshot, provider settings
  components/  AppShell layout + shared UI primitives
  features/    page skeletons — home · spaces · knowledge · assessment · career · study · settings
scripts/       migration scripts — migrate-rag-to-sqlite.mjs (localStorage export → SQLite)
src-tauri/     Tauri v2 shell — Cargo.toml · tauri.conf.json · capabilities · icons
  db/            SQLite backend — schema.sql · models.rs · commands.rs (db_* commands)
  llama-helper/  local-inference sidecar (Rust workspace member, llama.cpp)
```

### MVP acceptance target

After the MVP ships, a user should be able to:

```text
Import a technical book
        ↓
Auto-generate a knowledge system
        ↓
Start learning
        ↓
Answer questions
        ↓
System judges mastery
        ↓
Discover weak knowledge
        ↓
Get a recommended next step automatically
```

---

## 🤝 Contributing

Contributions are welcome — this project is at the ideal stage to shape its foundations.

- **Ideas & feedback** — open an issue to discuss the domain model, learning loop or roadmap.
- **Design** — help with knowledge graph modeling, assessment design or learner model.
- **Code** — check the roadmap for an unclaimed phase and open a PR.
- **Documentation** — improve this README or add design docs.

Please follow standard GitHub flow: fork → branch → PR. Be kind and constructive.

---

## 📄 License

[MIT](LICENSE) © 2026 JackXuyi

Your knowledge belongs to you. Your learning history belongs to you. Your learner model belongs to you. AI should help you understand what you know — and what you should learn next.
