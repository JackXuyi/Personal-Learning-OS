---
name: root-cause-fix-workflow
description: Guides thorough debugging before coding fixes—confirm concrete causes in specific code, challenge root-cause assumptions, compare solution options, and consider higher-level prevention. Use when fixing bugs, investigating failures, troubleshooting regressions, or when the user asks for careful diagnosis before changing code.
---

# Root Cause and Solution Design

## When This Applies

Use this workflow for **bug fixes, incident follow-ups, flaky tests, unexpected behavior, and performance issues**—any time a change is meant to **correct** behavior rather than add a feature.

## Workflow (Do This in Order)

### 1. Establish observable facts

- Reproduce the issue when possible (steps, environment, inputs).
- Separate **symptom** (what users see) from **failure mode** (what actually breaks).

### 1b. Ground facts in the app's own data (PLOS-specific)

Symptom-level UI reports ("the list looks empty") are frequently **data-shape**
problems, not missing data. Read the real store before theorizing — a 3-second
SQLite query beats a paragraph of plausible reasoning.

- Tauri persists to localStorage on disk:
  `~/Library/WebKit/personal-learning-os/WebsiteData/Default/<origin>/<origin>/LocalStorage/localstorage.sqlite3`
- Copy the snapshot **together with `-wal` and `-shm`** (otherwise you read a stale page cache), then decode:
  `sqlite3 <copy>/localstorage.sqlite3 "select writefile('./x.bin', value) from ItemTable where key='plos.chapters';"`
  → the blob is **UTF-16LE**; decode via `readFileSync(p).toString("utf16le")` (Node) or `.decode("utf-16-le")` (Python).
- `plos.*` keys are the source of truth for chapters / documents / evidence / goals / learner.

Then **reproduce the rendering offline** instead of launching a browser
(`rules/no-headless-browser-validation.mdc`): in a throwaway script, re-implement
the relevant `components` overrides, run it with
`node --experimental-strip-types --no-warnings --import ./tests/register-loader.mjs`,
and print before/after HTML side by side. One SSR line is decisive evidence —
e.g. it proved that the fragment `"4."` renders as **two** lines, one blank bullet each.

⚠️ A probe script written into the repo must be deleted **in the same command**
(`… ; rm -f ./.probe.tmp.ts ; git status --short`) — never leave temp files behind.

### 2. Locate concrete code

- Name **specific files, functions, hooks, configs, or build steps** tied to the failure.
- Prefer evidence: stack traces, logs, failing tests, network traces, git blame for recent changes.
- Do not stop at the first suspicious line; trace **call chain / data flow** until the mechanism is clear.

### 3. Challenge root cause

Before editing, explicitly ask:

- **Is this the root cause, or a downstream effect?** If fixing here might mask a deeper bug upstream, keep tracing.
- **Would the same inputs still break elsewhere?** If yes, the fix may belong at a different layer (validation, API contract, shared util).
- **Is this a regression?** If so, what change introduced it—fix intent vs. accidental breakage.

Use a short “so what causes that?” loop (like 5-whys) until you can state one sentence: *“X happens because Y in Z.”*

### 4. Propose solutions (then pick)

- Offer **at least one alternative** when tradeoffs exist (quick patch vs. structural fix, local guard vs. shared invariant).
- For each option, note: **correctness**, **risk of regressions**, **maintainability**, **scope of change**.

### 5. Ask whether the chosen fix is the best

Before implementing, sanity-check:

- **Is this the minimal correct fix**, or are we papering over bad API/design?
- **Is there a better place** to enforce the rule (types, schema, lint, build, docs, tests)?
- **Can we prevent recurrence** (assertion, test, monitoring, clearer error message)?
- **Are duplicate rules the actual root cause?** If the same cleaning/validation
  logic exists in 2–3 places with silently drifting options, the fix is to extract
  **one shared function with explicit options** and let each call site declare only
  its differences. Patching N of N+1 sites guarantees the bug returns.
  (Case: key-point cleaning lived in `cleanRefinedKeyPoints` / `mergeChapterRange` /
  `mergeShortChapters` — the third one had **no gate at all**, which is exactly how
  dirty fragments reached a user-visible chapter.)

### 6. Raise dimension when useful

Escalate the framing when local patches repeat or conflict:

| Level | Examples |
|-------|----------|
| **Code** | Wrong branch, off-by-one, missing null check |
| **Module/API** | Unclear ownership, leaky abstraction, inconsistent contracts |
| **System** | Race conditions, caching, deployment, env drift |
| **Process** | Missing tests for critical path, no rollout checklist |

If two “obvious” local fixes fight each other, **pause** and ask whether the **contract or architecture** should change instead.

## Output Expectations

When reporting to the user, briefly include:

1. **Root cause** (one sentence, tied to specific code locations).
2. **Why this is root** (not just symptom)—or what remains uncertain.
3. **Recommended fix** and **one alternative** if relevant.
4. **Follow-up** (test, guard, doc) if it materially reduces future risk.

## Anti-Patterns

- Applying a fix before reproducing or before naming the failing mechanism.
- Stopping at the first error message without tracing **who produced it and why**.
- “Fixing” by silencing errors, widening catches, or disabling checks without addressing the cause.
- Large refactors bundled with a small bugfix without explicit user agreement.

## Concision

The agent should **think through** all steps; **user-facing** explanations stay short unless the user asks for depth.
