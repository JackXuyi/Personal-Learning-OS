---
name: docs-task-runbook
description: Clarifies user intent, reads project documentation, decomposes work into ordered tasks recorded in a markdown runbook, executes tasks sequentially while updating per-task status and outcomes in that document, then refreshes related package or repo docs so key references stay current. Use for multi-step work, refactors, features spanning several files, doc-driven execution, runbooks, task checklists in docs, or when the user asks to split work into tasks and track progress in writing.
---

# Documentation-driven task runbook

Use this workflow **before writing substantial code**. It keeps execution aligned with written intent and leaves an auditable trail in markdown.

For **area-scoped implementation details, design tokens, and test deliverables**, combine with [package-docs-driven-change](../package-docs-driven-change/SKILL.md). For **skill matching and subtask preflight**, optionally start with [task-preflight-skill-match](../task-preflight-skill-match/SKILL.md).

## 0. Understand intent

- Restate the goal in one short paragraph (what “done” looks like).
- If scope, owners, or success criteria are ambiguous, **ask once** with concrete options; do not guess on product or security boundaries.
- Note constraints from the user (no new files, no tests, specific paths, deadlines).

## 1. Read current project documentation

- Resolve the relevant **area** (see [package-docs-driven-change](../package-docs-driven-change/SKILL.md)).
- Open **index or map docs first** (`README.md`, `README.zh-CN.md`, `AGENTS.md`, then `docs/*.md` for the target domain).
- Skim only what is needed for **this** request; do not read unrelated trees.

## 2. Create or open the runbook document

**Pick one primary doc** the user named, or default:

- User-specified markdown path, **or**
- An existing `*TASKS*.md` / plan under `docs/` for that area, **or**
- New file only when needed: `docs/<AREA>_TASK_RUNBOOK.md` (avoid duplicates if a suitable file exists).

### Runbook template (copy into the doc)

Use stable task ids so updates stay grep-friendly.

```markdown
# <Short title>

## Goal
<One paragraph>

## Context
- Package / paths:
- Docs read (links):

## Tasks

### T1 — <short title>
- **Status:** pending | in_progress | done | blocked | cancelled
- **Outcome:** <filled when done; include PR/commit notes, commands, or “N/A”>
- **Notes:** <optional>

### T2 — …
…
```

**Status rules**

- Set **in_progress** before starting a task; set **done** only after verification for that task (build, targeted test, or explicit user waiver).
- **blocked** must name the dependency or decision needed.

## 3. Execute tasks in order

For each task **T1, T2, …**:

1. Set **Status: in_progress** in the runbook (same edit session as starting work).
2. Implement or investigate **only** that task’s scope.
3. Verify (minimal: relevant command or manual check the docs expect).
4. Set **Status: done** and fill **Outcome** (what changed, where, how verified). Add **Notes** for follow-ups.
5. Proceed to the next task; **do not skip** reordering without updating the doc (explain why if the order changed).

If new work appears mid-flight: **append** new tasks to the runbook instead of silently expanding scope.

## 4. After all runbook tasks are done — refresh key docs

- Update **canonical docs** affected by the change: requirements, architecture, governance, INDEX links, or design language—**only** where behavior or structure actually changed.
- Keep edits **minimal and accurate**; no drive-by rewrites of unrelated sections.
- If behavior changed but no doc exists, add a short subsection to the closest owning doc **or** add a single line to an index pointing to the runbook—per user scope.

## 5. Handoff checklist

- [ ] Intent and goal still match the final diff.
- [ ] Runbook lists every task with terminal **Status** and **Outcome**.
- [ ] Related package/repo docs reflect the new reality (or the gap is explicitly noted in the runbook).
- [ ] No task left **in_progress** if work stopped.

## Cross-references

- Pre-task technical design (方案确认后再执行): [pre-task-technical-design](../pre-task-technical-design/SKILL.md)
- Package docs order and test outputs: [package-docs-driven-change](../package-docs-driven-change/SKILL.md)
- Skill discovery preflight: [task-preflight-skill-match](../task-preflight-skill-match/SKILL.md)
- UI polish and doc sync for styling work: [style-optimization-workflow](../style-optimization-workflow/SKILL.md)
