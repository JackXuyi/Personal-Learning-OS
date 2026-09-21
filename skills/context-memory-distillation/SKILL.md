---
name: context-memory-distillation
description: Keeps the project's long-term agent memory (`.workbuddy/memory/MEMORY.md`) from outgrowing its injection limit — measures it per section, moves already-documented mechanics into their design docs behind grep-verified pointers, keeps only "change this and something breaks" red lines, and re-measures every number. Use when MEMORY.md is truncated on load, has visibly grown after several rounds, or when you are about to add another invariant to an already-large memory file.
---

# Context memory distillation

## When this applies

- A session opens with a "MEMORY.md … was truncated during injection" notice.
- MEMORY.md has grown over several rounds (rule of thumb: a pass is worth it past ~8 000 chars).
- You are about to append a new invariant and the file is already near the cap.

## Why it matters

MEMORY.md is loaded **in full** at every session start, so it competes with the actual task. Two failure modes cost more than the bulk:

1. **Truncation silently drops the tail** — whatever you put last is what you lose.
2. **A stale invariant is worse than a missing one** — it makes the next session re-schedule already-delivered work, or edit unrelated code for a reason that no longer holds.

## Workflow (do this in order)

### 1. Measure, don't estimate

```bash
node -e "const s=require('fs').readFileSync('.workbuddy/memory/MEMORY.md','utf8');console.log('bytes',Buffer.byteLength(s),'chars',s.length);for(const p of s.split(/\n(?=## )/))console.log(String(p.length).padStart(5),p.split('\n')[0].slice(0,30))"
```

Section-level counts show where the bulk actually is — nearly always the "architecture invariants" and "feature invariants" blocks, not the workflow/discipline sections.

### 2. For each long block, find its authoritative doc — and **verify the pointer lands**

Anything you compress must have a home. Grep for **mechanical identifiers** (function names, storage keys, decision ids, test ids), never for prose:

```bash
for p in safe_save_name lastMergedPrefixOf externalChangeAt; do echo "--- $p"; grep -rln "$p" docs/*.md src/ | head -4; done
```

⚠️ **A pointer that points nowhere is a net loss** — worse than the bulk you removed. Anything without a home stays in MEMORY.md and keeps its detail.

### 3. Keep red lines, drop rationale

Test each line: *"if the next session ignores this, does something break?"*

- **Keep**: "must go through X", "never rewrite this", "these two whitelists are deliberately separate", "this is deliberately **not** unified", "the doc still contains a superseded draft — don't implement it".
- **Move to the doc**: why it was decided, what was tried first, the full algorithm, the alternative options.

Keep the trap, not the story.

### 4. Put an entry checklist first, and synthesise it from real misses

The highest-value section is a short *"questions to ask before touching anything"* list built from mistakes that actually happened this month. Place it at the **top** — truncation eats the end.

### 5. Re-measure every number you keep

Counts, line numbers, file paths, test-suite sizes and "there are N of these" statements are invalidated by concurrent commits. Either re-measure now, or write the invariant so it survives change (*"the chain's length and last entry move with parallel commits — measure, don't recall"*).

### 6. Re-check the dropped set

After rewriting, walk the removed items once more. If an item's only home was MEMORY.md, re-add it (compressed), even if that pushes the file a little over your target.

### 7. Record the pass

Append to the daily log: before/after size, what moved where, what has no home yet. Daily logs are **append-only** — never rewrite an earlier entry.

## Anti-patterns

- **Deleting before verifying a doc home.** Verify first; the file is the only copy of some knowledge.
- **"Cleaning up" by paraphrasing.** Paraphrase drifts and the bytes reappear next round as re-derived prose. Point instead of paraphrasing.
- **Negation-only rules** ("no longer writes mastery"). State what is true **now**; nobody can act on a negation.
- **Keeping fixed-defect narratives at full length.** Collapse to one line plus the commit that closed them.
- **Touching other agents' in-flight files.** Memory lives in the same working tree as concurrent work — edit only the memory paths, and check `git status` before and after.
- **Trusting a count in a governing doc.** Those go stale too (e.g. a "N skills" line no longer matching the directory listing) — re-measure and fix while you are there.
