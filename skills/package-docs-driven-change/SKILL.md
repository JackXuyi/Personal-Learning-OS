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
- ⚠️ **更正文档里的计数 / 行号前，先确认原数字的「口径」**：`docs/…` 里的「44 章」曾被判为「42 章写错了」，复测才发现它是**两份资料合计**（42 + 2）—— 差点把对的改成错的。同理，行号会漂移（引 `:154` 实测已是 `161`）。**改数前先测，测完连同口径与实测日期一起写进文档**（计数会随重新切分 / 重新生成漂移，如要点 135 → 147）。

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

### 5.3 「在循环体内 / 不在循环体内」类断言：花括号块提取

有些不变量是**位置**而非行为 —— 例如「每章成功都得写库」= `saveChapters` 必须在 `for` **体内**；「跑一半不许写时间戳」= `saveDocument` 必须在 `for` **体外**。正则全文匹配区分不了这两者。

手法：先剥注释，再从锚点字符串起找第一个 `{`，按花括号深度配对切出整个块，**只在这个块里**断言。样件：`tests/keypoint-persist.test.ts::bracedBlockOf`（TC-KP-WIRE-01/03）。

```ts
function bracedBlockOf(src: string, anchor: string): string {
  const at = src.indexOf(anchor);          // 锚点找不到就 assert 失败 —— 防「锚点失效后静默通过」
  const open = src.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}" && --depth === 0) return src.slice(open, i + 1);
  }
  throw new Error(`代码块未闭合：${anchor}`);
}
```

⚠️ 锚点要选**改动后会跟着变**的那行（如 `for (let i = 0; i < targets.length; i++)`），
并在断言里附带「该锚点必须存在」——否则重构后锚点消失，测试会以「找不到锚点」失败而非静默通过。

### 5.4 别用「假 provider 跑真实管道」做行为测试

管道对**单块失败**的处理常常是「计数并继续」而非抛错（如 `ai/chapter-map-reduce.ts`
把失败块计入 `skippedBlocks`）。用假 provider 反推上层 `failed[]` 会**与管道的错误语义耦合**：
管道一调整错误分类，测试就以「假失败」报警，把注意力从真实回归上引开。

正确做法：**把判据 / 选择逻辑抽成纯函数直测**（如
`features/learn/keypoint-coverage.ts::keyPointsTargets(chapters, onlyMissing)`），
接线事实（谁调谁、写在哪个块里）交给 §5.1 / §5.3 的源码级断言。两层合起来覆盖同一组
不变量，且**都不依赖真实 AI / 真实 storage**。

顺带收益：判据抽成纯函数后，「一把尺子」本身也可断言 ——
`coverage.missing === keyPointsTargets(set, true).length`（若判据被拆成两份，最可能的漂移就在这里）。

## 6. Verification

- [ ] Docs read match the resolved area
- [ ] Behavior matches updated requirement bullets
- [ ] Visual changes respect existing tokens
- [ ] Tests or a manual checklist cover the regression risk
- [ ] 分层提交时**逐提交可编译**抽查：`git worktree add --detach $WT <sha>` + `ln -s` 主仓 `node_modules` + `npx tsc --noEmit` 数 `error TS` 条数，逐条与基线（改动前的 sha）持平 = 零新增；查完 `git worktree remove --force $WT`
