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

### 5.1 回归缺陷：加「源码级断言」锁写方

当缺陷形态是「**同一动作、两个入口、两种后果**」（某处调了错的函数），行为测试很难覆盖所有入口 —— 补 **源码级断言**：读取生产文件文本，断言错函数名不再出现、正确判据必须存在。已落地样件：`tests/session-rating.test.ts`（TC-RATE-01~09）。

⚠️ **含 `stripComments()` 剥注释再正则**。注释里常出现**反面引用**（如「禁用 `delta >= 0`」把错误判据原样写进注释），会被正则命中造成假失败。断言目标只能是代码，不是注释。

### 5.2 断言只锁方案要求，不给生产代码加束缚

断言范围超出方案要求时，会诱导下一次改动去改生产代码来「喂测试」。只锁本次真正要保证的不变量。

## 6. Verification

- [ ] Docs read match the resolved area
- [ ] Behavior matches updated requirement bullets
- [ ] Visual changes respect existing tokens
- [ ] Tests or a manual checklist cover the regression risk
- [ ] 分层提交时**逐提交可编译**抽查：`git worktree add --detach $WT <sha>` + `ln -s` 主仓 `node_modules` + `npx tsc --noEmit` 数 `error TS` 条数，逐条与基线（改动前的 sha）持平 = 零新增；查完 `git worktree remove --force $WT`
