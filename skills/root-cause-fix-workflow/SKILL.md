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

### 1c. Read the *shape* of the data, not just its content

Aggregate form is itself evidence, and it's often the cheapest way to separate
"flaky" from "deterministic". Before theorizing, count and group:

- **Perfect pairing / 100% duplication** ⇒ deterministic double-write, not a race
  the user happened to hit. (Case: all 12 `plos.evidence` rows were `assessment`
  and formed **exactly 6 identical pairs** — 5 pairs with byte-identical `at`, 1
  pair 1 ms apart. That rules out "occasionally runs twice" and points straight at
  an effect that fires twice by construction, e.g. `<React.StrictMode>`.)
- **"Field missing" beats "field empty"** as proof of never-written (see the
  `keyPointRefs` case: `noField=44`, not `refs=0`).
- **Orphans / dangling ids** after a delete tell you which cleanup paths don't exist.

### 1d. Never trust a doc's own status claim — re-measure it

Planning/design docs in this repo carry "现状证据 / 缺口清单 / 未接线 / 未实现" claims
that **go stale silently** the moment the feature ships. (Case: `business-flow-end-to-end`
listed **7 of 11 gaps as open that were already delivered**; `roadmap` §F8's "0-char PDF
silently saves a doc with no chapters" had already become an explicit error + UI prompt.
Following those claims cost a whole detour.) Before planning, quoting, or "fixing" one:

- **"no UI / zero call sites"** → grep for the **consumer**, not the definition.
  Only-hits-the-definition is the real signal; hits in a service/component mean it's wired.
- **"X moves Y"** → read the **function body**, not the comment. Comments survive the
  change that invalidated them (3 source headers here still justified a ban by a
  behaviour that had been removed).
- **"zero consumers"** → full-repo Grep, not one directory (`cognitiveLevel` was written
  and aggregated but never read as an input).
- **User-visible copy** → i18n tests only check zh/en **structure**; a value can stay
  structurally "valid" and still assert something false.
- **Fix the claim, keep the conclusion.** When the conclusion still holds, re-state the
  reason **from zero** — don't write "no longer moves mastery", write what it *is* now
  (card-level `CardState` vs chapter-level `byUnit[chapterId]`). Deleting the sentence
  loses the invariant; keeping the old reason keeps the bug.
- **Lock it by asserting the OLD phrasing** (a negative assertion survives refactors;
  asserting the new wording will misfire), and **disprove the lock first** — run it against
  `git show HEAD:<file>`. If one regex only catches 1 of N files, the old text had more
  than one shape; add a pattern per shape rather than loosening the one.
- **Rescan across modules, not just the changed one.** A口径 change invalidates reasoning
  *elsewhere*; the two classes most often missed are **"why this API is banned" comments**
  and **user-facing copy**.

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

**Two root-cause families that hide behind plausible-looking call sites** — check
for these explicitly before settling:

1. **Check-then-act across an `await` (TOCTOU).** `read()` → `some()` → `write()`
   looks atomic in review but spans two awaits; concurrent callers both read the
   pre-write snapshot and both write. In single-threaded JS the fix is not a lock:
   put the check and the write in **one synchronous stretch** (no `await` in
   between). (Case: `listEvidence()` → `some()` → `appendEvidence()` in
   `QuizReportPage`; the atomic primitive landed as
   `StorageAdapter.appendEvidenceUnless(entry, predicate)`, implemented once in the
   in-memory base class so both subclasses inherit it via dynamic dispatch.)
2. **A derived index that was silently scoped.** Snapshot fields like
   `chaptersByDoc` / `titleOf` may be **filtered** by an active scope upstream
   (`engine/loop.ts:270` keeps only `requiredChapterIds`). Any "does this entity
   still exist?" question answered from that index misreports **out-of-scope live
   entities as deleted**. Existence checks must always go back to the full source.
   (Case: `HomePage` resolved evidence-row subjects through `plan.chaptersByDoc`;
   switching to `loadChapterIndex(plan.docs)` covered both "live but out of scope"
   and "genuinely deleted" with one rule.)

**Same-family siblings are the usual second victim.** When a decision rule ("never
render a raw id when the subject can't be resolved") was implemented only for one
entity kind, go check every sibling kind before closing. (Case: the rule landed for
goals via `capability.evidenceFallback` but **not** for chapters — chapters fell
through to the raw `entry.subjectId`, which is why `/` showed `chp-1e79433b` in 4 of
its 6 most recent rows.)

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
- **Should the invariant live one layer down?** If *every caller must remember* a
  guard, the third caller will forget it. Push the guarantee into a primitive and
  state its contract in the interface doc. (Case: rather than each writer doing
  check-then-write, one `appendEvidenceUnless(entry, predicate)`.)
  ⚠️ An atomic primitive is only correct if its dedupe key is **supplied by the
  caller** — don't let the storage layer guess one, because "the same key" means
  different things per kind (`card` evidence for one card is legitimately written
  many times, one per rating).
- **Does the new test prove the old code was broken?** For concurrency/idempotency
  fixes, a one-sided assertion ("writes once") is green even if the primitive was
  never needed. Add the **counter-assertion on the old shape** — re-implement the
  previous three-step code in the test and assert it produces **two** rows. That is
  what turns "looks fixed" into "was demonstrably broken".
- **Watch for the assertion pinning a *name* instead of a *rule*.** If the source
  assertion regex hard-codes a local identifier that a later refactor renames, it
  fails while the invariant still holds. Ask: *did the name change, or the rule?*

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
