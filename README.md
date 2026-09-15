# Personal Learning OS

**An open-source, local-first self-assessment learning system.**

Import your own documents → they become chapters → chapters become quizzes →
your scores become a mastery model that tells you what to study next.

[English](README.md) · [简体中文](README.zh-CN.md)

<div align="center">

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Status](https://img.shields.io/badge/status-pre--MVP-orange)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)
![Local-first](https://img.shields.io/badge/local--first-no%20account%20required-blue)
![Node](https://img.shields.io/badge/node-%E2%89%A522-brightgreen)
![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)

</div>

---

> **Not another AI chat-with-your-PDF app.** Most tools stop at "here is a summary."
> PLOS asks the harder question: **did you actually learn it?** — and then proves it with a quiz.

---

## What is this?

Personal Learning OS (PLOS) is a desktop app that turns your own material into a **closed
learn → test → review loop**, and keeps a persistent model of what you have actually mastered.

It is built around one question:

> **"Based on what I already know and where I'm trying to get — what should I do right now?"**

Everything runs on your machine. No account, no cloud, no required backend. A local model is
bundled and active by default, so the app is useful the moment it opens.

---

## ✨ Features

### 📥 Bring in your own material

Import **PDF** (with column and running-header layout repair), **Markdown**, **plain text**,
**pasted notes / web excerpts**, or **Markdown straight from a public GitHub repository**.
Text encoding is auto-detected (BOM / UTF-8 / GB18030), and re-importing the same source is
detected and merged rather than duplicated.

### ✂️ Chapters, not chunks

Documents are split into **chapters** using heading structure (Markdown) or paragraph
clustering (plain text), with short chapters automatically merged so you never get a
200-character "chapter". An optional AI pass then refines titles and boundaries — but
splitting is deterministic code, never a model call you have to trust.

### 📖 Study a chapter, then prove it

Read the original text next to AI-extracted **key points**, and explore the **concept graph**
for each chapter. When you're done, mark it ready — or go straight to the quiz. Order is yours.

### 📝 Quizzes that adapt to your level

Four paper modes, generated from your own chapter content:

| Mode | Scope | Questions | When to use |
| --- | --- | --- | --- |
| **Unit test** | 1 chapter | 3 objective + up to 2 subjective | After finishing a chapter |
| **Stage test** | 2–3 chapters | ~3–4 per chapter | After a run of chapters |
| **Final test** | Whole book | 15–20 (~60% objective) | Goal readiness check |
| **Retake** | Weak chapters only | 3 per chapter, one level easier | After scoring under 60% |

Difficulty is picked from your current mastery band — below 40% you get recall and
comprehension questions; above 70% the paper shifts toward application and analysis.

### 🤖 Grading that refuses to fake it

Objective questions are graded locally and instantly. Subjective answers go to AI for a score,
written feedback, and a pointer back to the source chapter. **If no model is configured,
subjective questions stay `pending` — the app will not invent a score for you.** That honesty
is a design rule, not a missing feature.

### 📊 A mastery model, not a score history

A quiz result doesn't just overwrite your progress. Chapter mastery is smoothed as
`0.65 × paper score + 0.35 × previous mastery`, so a single bad day doesn't erase a month of work.
Mastery then **decays over time** along a forgetting curve (30-day half-life), and the home
screen always shows your *current* estimated mastery — not the number from your last session.

### 🔁 Spaced repetition that actually fires

Every graded paper and every self-rating writes a `nextReviewAt` timestamp. When that time
arrives, the chapter re-enters your plan with a review action. "Come back in 4 days" is a
real scheduled event here, not a piece of UI copy.

### 🎯 Goals that scope the whole loop

Create a learning goal (career / study / exam / personal / research / project) and select the
chapters that count toward it. The planner then ranks your next actions by six priority classes —
weak chapter to re-study, retake, key point review, chapter to test, due review, next new chapter —
and every recommendation carries its reason ("current mastery is 28%, prerequisites are already
met"). **Goal readiness = the share of in-scope chapters at or above 80% mastery.**

### 🔍 Hybrid retrieval over everything you've imported

Full-text search (SQLite FTS5) fused with local vector search via reciprocal rank fusion. Ask a
question, get answers anchored back to the exact source passage. If the embedding model isn't
available, search degrades silently to full-text rather than failing.

### 🔒 Local-first, by default

No account. No telemetry. No mandatory API key. Documents, chapters, embeddings, quiz history
and your learner model all live in a SQLite database on your machine. Cloud providers are
optional, not required.

---

## 🚀 Quick Start

### Prerequisites

- **Node.js ≥ 22** (npm 10+)
- **Rust toolchain** (`cargo` ≥ 1.77) — only needed for the desktop shell

> Installed Rust via rustup? New shells load `~/.cargo/env` automatically. If you see
> `cargo: command not found`, run `. "$HOME/.cargo/env"` first.

### Run the web app (no Rust needed)

```bash
git clone https://github.com/JackXuyi/Personal-Learning-OS.git
cd Personal-Learning-OS
npm install
npm run dev          # → http://localhost:1420
```

Browser mode is the fastest way to work on the frontend. It hot-reloads on every change and
persists to localStorage.

### Run the full desktop app

```bash
. "$HOME/.cargo/env"   # if cargo isn't on PATH yet
npm run tauri dev
```

One command starts Vite, compiles Rust, and opens the native window. Editing `src/` hot-reloads
the page; editing `src-tauri/` recompiles and restarts the window. The first Rust build takes a
while — that's expected.

> Don't run `npm run dev` and `npm run tauri dev` at the same time. Both want port 1420, and the
> second one will fail on a `strictPort` conflict.

### Build a release binary

```bash
. "$HOME/.cargo/env"
npm run tauri build
```

Artifacts land in `src-tauri/target/release/`. Installer bundling is currently disabled
(`bundle.active = false` in `tauri.conf.json`), so you get the executables only.

### Your first ten minutes

```
1. Import a document      →  PDF, Markdown, or paste some notes
2. Review the chapters    →  re-split or AI-refine if the boundaries look off
3. Read a chapter         →  then hit "Finish chapter"
4. Take the chapter quiz  →  objective questions grade instantly
5. Read the report        →  see per-chapter mastery with a before/after delta
6. Follow the plan        →  the app tells you what's next, and why
```

---

## 📖 How it works

### The assessment loop

```text
Chapter
   │
   ├── createPaper(scope)          local deterministic questions
   │        └── AI rewrites the wording only — never the question mix
   │
   ├── answer                      draft auto-saved; keyboard-driven
   │
   ├── gradePaper
   │        ├── objective  → graded locally, instantly
   │        └── subjective → AI score + feedback + source pointer
   │                          (stays "pending" if no model is configured)
   │
   ├── PaperResult
   │        ├── per-chapter score, before → after mastery
   │        ├── wrong answers with AI commentary
   │        └── weak point list
   │
   └── applyPaperResult
            ├── mastery  = 0.65 × score + 0.35 × previous
            ├── confidence, attempts, correctness updated
            └── nextReviewAt scheduled
```

### Chapter state machine

```text
not-started ──open──▶ learning ──mark ready──▶ ready
                                                │
                          score ≥ 0.8 ──────────┼──────▶ mastered
                                                │
                          score < 0.6 ──────────┴──────▶ retake
                                                           │
                                        0.6–0.8 (was retake)┘──▶ ready
```

### Plan priorities

The planner ranks every candidate action into six classes:

```text
0  Re-study a weak chapter      (lowest mastery, highest urgency)
1  Retake a failed quiz
2  Review key points
3  Test a chapter you've studied
4  Due spaced-repetition review
5  Advance to the next new chapter
```

Within a class, actions are ordered by blocked-by-prerequisite status, due date, mastery, and
document order. Every action carries a human-readable reason.

### The goal loop

```text
Learning Goal  →  select chapters  →  buildChapterPlan
                                            │
                                     actions[0] = "today's next action"
                                            │
                                     quiz → mastery → readiness
                                            │
                              readiness = share of chapters ≥ 80%
                                            │
                                        back to the plan
```

The two loops meet at `LearningGoal.requiredChapterIds` — the chapters your import pipeline
produced are exactly the chapters the goal scopes.

---

## 🏗️ Architecture

```text
┌───────────────────────────────────────────────────────┐
│  Tauri 2 desktop shell (Rust)                         │
│  vault (Keychain) · llm (local model sidecar) · db    │
│  SQLite: FTS5 + vector index                          │
├───────────────────────────────────────────────────────┤
│  React 19 + TypeScript + Vite + Tailwind 4 + Zustand  │
├───────────────────────────────────────────────────────┤
│  features/   learn · quiz · report · plan · goals     │
│              assessment · learner · home · settings   │
├───────────────────────────────────────────────────────┤
│  engine/     splitter · chunk · graph · knowledge     │
│              learner-model · mastery · quiz           │
│              assessment · learning-planner            │
│              recommendation · loop (orchestration)    │
├───────────────────────────────────────────────────────┤
│  domain/     pure TS types & thresholds (no React)    │
│  ai/         provider abstraction + local pipelines   │
│  storage/    StorageAdapter → sqlite / local / memory │
└───────────────────────────────────────────────────────┘
```

Dependencies flow one way only: `domain → engine/ai/storage → stores → features`.
The `engine/` layer is pure functions — no React, no I/O — which is why it's fully unit-testable.

### Repository layout

```text
src/
  domain/      core types + thresholds, pure TS
  engine/      10 pure-logic engines + loop orchestration
  ai/          provider abstraction, embedding, map-reduce pipelines
  storage/     StorageAdapter (sqlite / local / memory)
  stores/      Zustand stores
  features/    pages, grouped by domain
  components/  app shell + shared UI primitives
  i18n/        bilingual dictionaries (zh + en)
tests/         25 pure-logic test files, run directly with node
docs/          design documents and architecture decisions
rules/         repo constraints for AI assistants
skills/        reusable workflows for AI assistants
src-tauri/     Rust shell — vault · llm · db (SQLite, FTS5, embeddings)
scripts/       migration & consistency tooling
```

### Storage backends

Storage sits behind a single `StorageAdapter` (`src/storage/types.ts`). Business code never
knows which backend it got:

| Backend | Environment | Persisted to | Notes |
| --- | --- | --- | --- |
| `tauri` | Desktop | `app_data_dir/plos.db` | SQLite; chunks, embeddings, FTS5 |
| `local` | Browser preview | localStorage | Survives reloads; desktop fallback |
| `memory` | Tests / SSR | in-process `Map` | No side effects |

Data hierarchy: `Document → Chapter → Section → Chunk`. Chunks are the unit of embedding and
retrieval; chapters are the unit of learning and assessment.

If a `db_*` command fails on desktop, calls fall back to localStorage — the app never becomes
unusable because of a storage fault.

---

## 🧪 Development

```bash
npm run typecheck        # tsc --noEmit — must be 0 errors
npm run build            # typecheck + production build
npm run test:library     # chapter, key point, overview & AI map-reduce tests
npm run test:rag         # retrieval wiring
npm run test:ai          # AI pipeline
npm run test:graph       # graph split & prerequisite planner
npm run test:i18n        # bilingual dictionary alignment
```

Run a single suite directly:

```bash
node --experimental-strip-types --no-warnings \
  --import ./tests/register-loader.mjs tests/rag-wiring.test.ts
```

Rust side:

```bash
cd src-tauri && cargo test --lib
```

There is **no ESLint or Prettier** — the codebase follows file-local style. `npm run typecheck`
is the gate that matters.

---

## 🔌 AI Providers

AI is decoupled from business logic behind one interface, so providers can be swapped freely:

```ts
interface AIProvider {
  readonly kind: ProviderKind
  isConfigured(): boolean
  chat(input: ChatInput): Promise<ChatOutput>
}
```

The interface is deliberately thin. Embeddings always run on-device (`ai/embedding.ts`),
concept extraction lives in `ai/pipelines.ts`, and goal-level capability assessment lives in
`ai/capability.ts` — none of them hang off `AIProvider`, so switching chat to a cloud API
cannot silently drop them.

**Bundled and active by default — nothing to install:**

| Model | Purpose |
| --- | --- |
| `qwen3.5:4b` (default) | text generation, grading, extraction |
| `qwen3.5:2b` / `0.8b` / `9b` | smaller / larger alternatives |
| `qwen3-embed:0.6b` | local embeddings, 1024 dims |

The app downloads and runs the model itself via a bundled `llama-helper` sidecar — fully offline.
Ollama, llama.cpp, LM Studio, and OpenAI-compatible endpoints (OpenAI, Anthropic, Gemini,
DeepSeek, custom) remain switchable from Settings.

> API keys are stored in the OS keychain, never in localStorage.

---

## 🔒 Privacy & local-first

The default posture is **no account, no cloud, no required backend**.

```text
Documents · Chapters · Notes · Embeddings
Quiz history · Learner model · Mastery data
```

All of it stays on your machine. Core capabilities — import, split, study, quiz, grade, plan —
never depend on a network call.

### Product principles

1. **You own the data** — export and walk away whenever you want.
2. **Local-first** — connectivity is an enhancement, not a dependency.
3. **Model-agnostic** — never locked to one vendor.
4. **Evidence-based** — every mastery number traces back through
   `Source → Knowledge → Question → Answer → Evaluation → Mastery`.
5. **Honest numbers** — if the app can't judge something, it says so instead of guessing.

---

## 🗺️ Feature checklist

Every capability the project intends to ship — this doubles as the roadmap.
`[x]` = shipped · `[ ]` = not yet · `P0` / `P1` / `P2` = priority of the unshipped items.

**31 shipped · 14 not yet.**

### 📥 Ingestion

- [x] PDF / Markdown / TXT / pasted notes / GitHub-repository import
- [x] Encoding sniffing (BOM / UTF-8 / GB18030) and duplicate-safe re-import
- [x] AI enrichment after import — the document title (titles you typed are kept) and a whole-document overview are generated in the background
- [ ] OCR fallback for scanned PDFs `P2` — pdfjs returns 0 characters on image-only PDFs
- [ ] DOCX parsing `P2`
- [ ] EPUB parsing `P2`
- [ ] Fetch a web page by URL `P2`

### ✂️ Splitting & structure

- [x] Deterministic chapter splitting (heading tree / paragraph clustering) with short-chapter merge
- [x] Optional AI refinement of chapter titles and boundaries
- [x] Rename / merge / drag-reorder chapters — edit mode on the chapter list, saved on every action
- [ ] Manually split a chapter in two `P2`
- [ ] Cross-document study unit / learning path `P2`
- [ ] Manual override of chapter prerequisites `P2`

### 📖 Study

- [x] Chapter reader — original text beside AI key points
- [x] Per-chapter concept graph
- [x] In-chapter Q&A grounded in your own text — every citation jumps back to the source passage
- [ ] Highlights and notes `P1`
- [x] Feynman restatement — explain a chapter in your own words; the AI diffs it against the chapter text (covered / missed / got wrong, each anchored back to the source) and can schedule a review without moving mastery
- [x] Flashcards from key points — one click sends a chapter's quoted key points into a card-level spaced-repetition queue (four-grade self-rating, 1/2/4/7-day intervals, no mastery change, **works fully offline / without AI**)
- [ ] Cross-document concept graph `P2`

### 📝 Assessment

- [x] 4 paper modes — unit / stage / final / retake, with adaptive difficulty
- [x] Local objective grading, instant
- [x] AI subjective grading with feedback and a source pointer
- [x] Report — per-chapter mastery deltas, wrong answers, weak points
- [x] Mastery smoothing: `0.65 × score + 0.35 × previous`
- [x] Forgetting curve — 30-day half-life
- [x] Spaced repetition: `nextReviewAt` → review queue
- [x] Goal-level capability assessment — an objective baseline paper (reference score only) plus scenario tasks scored by AI against a rubric, every citation anchored back to your own answer; produces an append-only capability report and never moves mastery
- [x] Capability item list — the AI proposes 3–6 items from the goal and its chapters, and you can add, edit or drop them; each item's pass threshold is adjustable

### 🎯 Goals & planning

- [x] Six goal types with chapter scoping (`requiredChapterIds`)
- [x] Six-class priority planner; every action carries its reason
- [x] Readiness = share of in-scope chapters at or above 80% mastery
- [x] Learner profile — self-reported level, weekly time budget, preferences; drives paper difficulty, the finish-date estimate, and the AI prompt context
- [x] Résumé import — parse a PDF or pasted résumé into a background summary + a level suggestion (PII is masked on-device before sending; the raw text is never stored)
- [x] Time-aware planning — with a deadline set, "N min suggested today · M items" and a today / this week / later split of the queue; a behind-schedule warning on home, **without touching planner priority**
- [ ] Progress analytics — activity heatmap, mastery trend, weak-point ranking `P1`

### 🔍 Retrieval

- [x] Hybrid search — SQLite FTS5 + local vectors, fused with RRF; results anchored back to the exact source passage
- [x] Silent degradation to full-text when the embedding model is unavailable

### 🔒 Data & portability

- [x] One `StorageAdapter` over SQLite / localStorage / in-memory
- [x] Bundled local model — fully offline, no account, no telemetry, no mandatory API key
- [x] Append-only evidence stream (`EvidenceEntry`)
- [ ] Full export / import / backup `P0` — this README promises "export and walk away", but the storage layer has no export method yet
- [ ] Markdown export of a single chapter `P0`
- [ ] Community knowledge packs `P2`
- [ ] Encrypted sync *(pro tier)* `P2`

---

## 🤝 Contributing

Contributions are welcome — the foundations are still being shaped, which is the best time
to weigh in.

- **Ideas & feedback** — open an issue to discuss the mastery model, quiz design, or roadmap.
- **Design** — help with concept graph modeling, assessment design, or the learner model.
- **Code** — pick any unchecked item from the feature checklist above and open a PR.
- **Docs** — improve this README or add a design doc under `docs/`.

**Before opening a PR:**

```bash
npm run typecheck    # must be 0 errors
npm run test:library # and whichever suites your change touches
```

Standard GitHub flow: fork → branch → PR. Conventional Commits for messages. Be kind.

If you're using an AI assistant, point it at [`AGENTS.md`](AGENTS.md) — it indexes the repo
constraints in `rules/` and the workflows in `skills/`.

---

## 📄 License

[MIT](LICENSE) © 2026 JackXuyi

Your knowledge belongs to you. Your learning history belongs to you. Your mastery model
belongs to you.

<div align="center">

**If this project is useful to you, a ⭐ helps other learners find it.**

</div>
