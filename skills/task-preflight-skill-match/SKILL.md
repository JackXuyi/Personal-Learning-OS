---
name: task-preflight-skill-match
description: Before executing work, discovers matching skills under the repository `skills/` (reading each SKILL.md YAML `name` and `description`) and any skills already injected in context, outputs matched skills with one-line reasons, decomposes long work into subtasks and repeats matching per subtask, summarizes each subtask after completion, then re-matches skills to update project docs or artifacts when appropriate. Use when the user asks for skill matching, preflight, task breakdown, subtask skill selection, handoff summaries, or post-task documentation updates driven by skills.
---

# Task preflight: skill matching and handoff

Use this **before** substantial work and **after** completion when the user wants explicit skill discovery, decomposition, and summaries.

## 1. Where to look for skills

1. **In-repo (required when available):** enumerate `<repo-root>/skills/*/SKILL.md`. Read the YAML frontmatter of each (at least `name` and `description`). Match the user request and file scope against `description` and `name`.
2. **In context:** If the environment lists attached or available skills (names, paths, descriptions), **merge** them with the repo scan. Prefer repo skills when paths overlap.
3. **Personal skills (`~/.cursor/skills/`, `~/.claude/skills/`, `~/.workbuddy/skills/`):** Include them only if they appear in context or the user explicitly references them; do not assume filesystem access to the home directory.

If no `SKILL.md` files exist under `skills/`, state that and proceed from context-listed skills only.

## 2. Matching rules

- Map **keywords** (e.g. Tauri, vault, llm, Tailwind, Playwright, MCP, i18n) and **intent** (e.g. refactor UI, fix bug, add store, style polish) to each skill’s `description`.
- Map **paths in scope** (e.g. `src-tauri/src/**` → [tauri-ipc](../tauri-ipc/SKILL.md); `src/features/**` UI work → [ui-impl-tokens](../ui-impl-tokens/SKILL.md); styles → [style-optimization-workflow](../style-optimization-workflow/SKILL.md)).
- Order matches by **relevance** (direct hit first, adjacent second).
- Cap the list at **~8** unless the user wants an exhaustive catalog; mark secondary matches as “optional”.

## 3. Output before execution

Print a short block **up front**:

```markdown
## Matched skills
| Skill `name` | Path (if repo) | Why it matches |
|--------------|----------------|----------------|
| … | `skills/…/SKILL.md` | … |
```

For **each line**, one concrete reason (keyword, path, or workflow fit). If nothing fits well, say **No strong match** and proceed with general practices.

## 4. Long tasks: subtasks

If the request is **multi-step, cross-cutting, or estimated to need many file edits**:

1. Split into **ordered subtasks** with a clear **done** condition each (aim 3–7 items).
2. For **each subtask**, repeat **§2–§3** (mini table or bullet: matched skills + why for *that* slice only).
3. Execute subtasks in order; avoid scope creep between subtasks unless the user expands scope.

## 5. After completion: summaries

For **each subtask**, provide a **brief summary**: outcome, key files touched, open risks or follow-ups.

Then an **overall summary**: goal, what shipped, what was deferred.

## 6. Post-task updates using skills

Re-run **§2** against the **actual** changes (diff intent: new UI? new route? config change?).

- **Area docs / design / tests** in `src/` or `docs/` → apply [package-docs-driven-change](../package-docs-driven-change/SKILL.md) when behavior or requirements changed.
- **Design audit / style patterns** → [style-optimization-workflow](../style-optimization-workflow/SKILL.md).
- **rules/*.mdc or AGENTS.md updates** → edit the file directly, then keep the skills index and rule cross-links in sync (see AGENTS.md「维护约定」).

Only **edit files the user allows**; if updates are optional, list recommended doc updates in the reply instead of editing.

## 7. Anti-patterns

- Do not claim a skill was “followed” without **reading** its `SKILL.md` when executing that workflow.
- Do not list every skill in the repo; **match narrowly** to the task.
- Do not split trivial one-file requests into artificial subtasks.
