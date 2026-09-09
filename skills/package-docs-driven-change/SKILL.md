---
name: package-docs-driven-change
description: Resolves the PLOS area from the open file (feature/store UI, Tauri Rust, repo docs), reads the matching docs, aligns code with those docs, and outputs test cases (node tests under tests/, manual QA, or Playwright). Use when implementing or refactoring features, when the user asks to follow project documentation, or when pairing code changes with doc and test deliverables.
---

# Area docs–driven change

End-to-end: **understand docs → refine requirements in writing → implement → test artifacts**.

If the user asks for preflight skill matching, follow [task-preflight-skill-match](../task-preflight-skill-match/SKILL.md) first.

## 1. Resolve area root

| Paths in scope | Area root / docs |
|----------------|------------------|
| `src/features/**` | feature module + domain docs（`src/features/<feature>/` 兄弟文件；`docs/*plan/design*.md`） |
| `src/{domain,engine,ai,storage,stores}/**` | 对应模块 + `docs/*` 相关方案 |
| `src-tauri/src/**` | `src-tauri/` + `docs/local-llm-loading-plan-2026-09.md`（llm）等 |
| Repo-wide / unclear | repository `docs/` + `README.md` / `README.zh-CN.md` + `AGENTS.md` |

If several areas are in scope, prefer the one the user named; if unclear, ask once.

## 2. Read documentation (in order)

1. `README.md` / `README.zh-CN.md` for product facts
2. `AGENTS.md` + `rules/*.mdc` for conventions that apply
3. Domain docs under `docs/` (e.g. `docs/ui-workbench-plan-2026-09.md`, `docs/local-llm-loading-plan-2026-09.md`) — pick by area, not all

If an expected doc is missing, note the gap. For UI token questions, read `src/styles/main.css` per [ui-impl-tokens](../ui-impl-tokens/SKILL.md).

## 3. Requirements and doc updates

- Extract acceptance criteria from the request and from those docs.
- If behavior, IPC contracts, or store/storage contracts change, update the closest canonical markdown — minimal and scoped.
- Do not expand unrelated docs.

## 4. Design and implementation

- **UI**: [ui-impl-tokens](../ui-impl-tokens/SKILL.md)
- **Logic / data flow**: follow `rules/layer-import-boundaries.mdc`（UI → stores/storage；desktop only via `invoke`）
- **Tauri commands/events**: [tauri-ipc](../tauri-ipc/SKILL.md)
- Match surrounding naming; no drive-by refactors.
- Interactive UI: consider [playwright-test-ids](../playwright-test-ids/SKILL.md)

## 5. Test deliverables

This repo has **no Vitest runner**. Pure-logic unit tests live in `tests/*.test.ts` and run via `node --experimental-strip-types`:
`npm run test:i18n` / `test:goal` / `test:scope` / `test:eta`（见 package.json）。Playwright is optional for browser-level checks（[webapp-testing](../webapp-testing/SKILL.md)）。

1. **Manual QA** — always valid（空态 / 错误态 / 边界 / 纯浏览器预览）。
2. **node unit test** — pure logic in `tests/*.test.ts`（register-loader.mjs 载入 TS）。
3. **Browser/E2E sketch** — only if the user wants Playwright / `data-testid`.

If the user forbids new test files, put cases in the reply or an existing plan doc.

## 6. Verification

- [ ] Docs read match the resolved area
- [ ] Behavior matches updated requirement bullets
- [ ] Visual changes respect existing tokens
- [ ] Tests or a manual checklist cover the regression risk
