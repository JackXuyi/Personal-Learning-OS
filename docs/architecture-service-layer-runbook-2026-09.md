# 分层归位实施 runbook（2026-09-24 · 第 3 批）

## Goal

把 `stores → features`（6 行，含 1 处真 ESM 环）与 `engine → i18n`（2 文件值导入 + 4 处 `= zh` 默认值）两条反向依赖**清零**；新建 `src/services/` 层并在 `rules/` + `AGENTS.md` 固化层序；新增可执行门禁 `npm run layer:check`。**纯结构重构，零行为 / 零 UI / 零持久化格式变化。**

## Context

- **方案（唯一真源）**：`docs/architecture-service-layer-design-2026-09.md` —— §8 逐文件伪代码 · §10 提交分组 · §11.3 通过标准
- **决策**：D1 新建 services 层 · D2 去默认值 + type-only · D3 报告范围 5 模块 · D4 加脚本门禁（均已于 2026-09-24 确认）
- **门禁命令**：`npm run typecheck` · 全部 `test:*` · `npm run layer:check`（T7 起） · `npm run build`（**需绕沙箱**）
- **提交纪律**：只按精确路径 `git add`；逐提交可编译且相关套件绿；只落本地不 push

## Tasks

### T1 — 新增 `scripts/layer-boundary-scan.mjs`（报告模式）+ 记录红基线

- **Status:** done
- **Outcome:** 脚本入库（**报告模式**，`--fail-on-violation` 留到 T7）。修复前红基线（`node scripts/layer-boundary-scan.mjs`）：**违规 9 条** = 6 条 `stores → features`（`useLoopStore` ×4 / `useIndexStore` ×2）+ 2 条 `engine` 值导入 i18n（`loop.ts:26` / `learning-planner.ts:44`）+ 1 条 `components → features`（`CommandPalette.tsx:10 → index-service`，随本批下沉消除）；**新增环 1 组** = `features/learn/index-service ⇄ stores/useIndexStore`（真 ESM 环）。基线豁免：边 3 条 + 环 2 组。提交 `3eeaaf4`。
- **Notes:** ⚠️ 两处**实测偏离**方案（已写入方案「实现偏离记录」）：① §4.1 断言 A5 现状 `0`，实测有 **2 组既存环**（`engine/profile-band ⇄ quiz-engine`、`AppShell ⇄ CommandPalette ⇄ ImportModal`）；② §2 目标②提「components → features 归零」但任务清单未排，实测 `components/` 有 **4 条**。处置：脚本 A3 扩为含 `components ↛ features`，两处既存债务入基线（检测全量、只禁新增）。

### T2 — `domain/embedding.ts` 接收 3 类型；`useIndexStore` 纯化

- **Status:** done
- **Outcome:** `domain/embedding.ts` +3 类型（`IndexProgress` / `IndexCoverage` / `IndexOffReason`，含「为何归 domain」的理由注释）；`useIndexStore` 删 `refreshCoverage` 与 `await import()`，加纯 setter `setCoverage`，导入清单只剩 `zustand` + `domain` 类型。提交 `1c17499`。
- **Notes:** 实施中一次手滑把 `const refreshCoverage = useIndexStore(...)` 误替换成**重复的** `coverage` 声明；已在跑 `typecheck` 前当场发现并删除（下一个动作就是 typecheck，未流入提交）。

### T3 — `services/learn/index-service.ts` 移动 + `refreshCoverage()`；消费方改路径

- **Status:** done
- **Outcome:** `git mv` → `src/services/learn/index-service.ts`（git 显示 `R090`；内容改动仅三处：删 3 个类型定义、新增 `refreshCoverage()`、`rebuildIndex` 内部改调它）；9 处 src 消费方改导入路径/调用；**测试侧 3 个文件 5 处旧路径同批修正**。提交 `1c17499`。门禁：违规 9→6、**新增环 1→0**。
- **Notes:** 实测 src 消费方 **9 处**（方案 §8.13 列了 7 处，另有 `CommandPalette.tsx` 与 `VectorIndexCard.tsx`）；`DataPortabilityCard` / `KnowledgePackCard` 改后不再使用 `useIndexStore` ⇒ 顺带删掉该导入（否则 TS6133）。
  ⚠️ **方案 §8.24 的测试改动清单不完整**，本提交必须自行补齐（详见 T9 Notes 的漏报明细）—— 若不补，本条 `test:retrieval` / `test:embed` / `test:rag` 三红。

### T4 — memory 4 模块移到 `services/memory/`；引用改路径

- **Status:** done
- **Outcome:** `git mv` 4 个文件（git 显示 **`R100`** —— 内容零改动，客观佐证了「纯移动」这一设计前提）；9 个 src 文件改引用，另 `tests/learner-memory.test.ts` 6 处路径同步。提交 `dfc5a29`。`test:memory` **64/64**。
- **Notes:** ⚠️ 一处**提交分组微调**：方案 §8.24 把 `learner-memory.test.ts` 的路径修正列在 T6，但它是**被 T4 直接推翻**的断言（不同批则本条 `test:memory` 必红）⇒ 按仓库定则提前并入本条提交。其余 4 个测试文件仍留 T6（它们依赖 T5 的签名变化）。

### T5 — `engine` 去 i18n 值依赖与 4 处默认值；`useLoopStore` 补 `m ?? zh`；`ReviewSession` 传 `m`

- **Status:** done
- **Outcome:** `loop.ts` / `learning-planner.ts` 的两行 i18n 导入合并为 `import type { Messages } from "../i18n/types"`；删 4 处 `= zh`（`runLearningLoop` 的 `goalId` 同时改 `string | undefined`，`m` 保持第 3 位）；`useLoopStore.refresh` 补 `const msg = m ?? zh`；`ReviewSession` 传 `m`。提交 `dab24d9`。
- **Notes:** `typecheck` **零错误** —— src 侧只有方案列的两处调用点，实测即全部（方案预期「错误点应只在 engine 的调用方」，实际是「已无错误点」）。

### T6 — 5 个测试文件同步

- **Status:** done
- **Outcome:** `learner-memory`（6 处路径，已在 T4 同批）· `planner-prereq`（7 处补 `, zh`）· `learner-profile`（3 处 + 新增 zh 导入）· `chapter-scope`（3 处补 `zh`）· `i18n-alignment`（重写 2 条被推翻的「默认中文」用例 + 头注第 4 条）。提交 `dab24d9`（与 T5 同条）。五个套件全绿。
- **Notes:** ⚠️ 实测发现方案 §8.24 **漏报 2 处**：`chapter-scope.test.ts:121,132` 的 `runChapterLoop(s, undefined, "g-scope")` —— 旧签名下 `undefined` 会触发默认值，新签名下 `m` 收 `undefined` 直接崩（`Cannot read properties of undefined (reading 'engine')`）；首轮 `test:scope` **1/3** 暴露，改为 `(s, zh, "g-scope")` 后 3/3。⚠️ **提交分组微调**：T5 推翻了这 4 个文件的断言 ⇒ 与 T5 合成同一条提交（方案 §10 原把二者分列第 4、第 5 条，会让第 4 条的相关套件必红）。

### T7 — 规则与索引 + `package.json` 启用 `layer:check`（严格档）

- **Status:** done
- **Outcome:** `rules/code-structure-and-dependencies.mdc` §3 重写（层序含 `services` · `stores`/`services`/`components` ↛ `features` · `engine`/`ai` 禁值导入 i18n · **明文写「不要用 `await import()` 打断环，实测无效」**）· `rules/layer-import-boundaries.mdc` 表格 +2 行、数据流补 services · `AGENTS.md` 4 处（目录地图 / Rules 表两行 / 编码速记两条）· `package.json` 加 `layer:check`。提交 `50234ad`。`npm run layer:check` → **exit 0**（违规 0 条 / 新增环 0 组）。

### T8 — 文档回扫：`code-gap-review` §三/§七 · `learner-memory-design` §8 位置注记

- **Status:** done
- **Outcome:** `docs/code-gap-review-2026-09.md` §零 B 类标收口 · §三重写 + 新增 §3.1（规则盲区）/ §3.2（顺带发现：`components → features` 4 条、2 组既存环）· §五两行 · §七第 3 批标完成 · §附补判据与教训 · 回扫口径表补第 3 批行；`docs/learner-memory-design-2026-09.md` §8 开头加**位置注记**（不逐条改写 20 余处旧路径）。落于本 runbook 所在的 docs 提交。
- **Notes:** 回扫口径＝**只改被推翻的事实**；设计文档里「当时写在 `features/memory/`」属历史快照，用一条位置注记收口而非逐行改写。

### T9 — 全量门禁 + 逐提交实测 + 提交

- **Status:** done
- **Outcome:** 见下方「通过标准」与「提交重排记录」。`typecheck` **exit 0** · `layer:check` **exit 0**（严格档）· `build` **exit 0**（绕沙箱，`✓ built in 3.09s`；本批相关 `INEFFECTIVE_DYNAMIC_IMPORT` 警告已消除，余 1 条既有的 `resume-import.ts → import/pdf.ts` 不属本批）· **全量 47 个套件 47/47 绿（`TOTAL_FAIL=0`）**。
- **Notes:** ⚠️ **方案 §8.24 漏报 3 个测试文件 5 处旧路径**（首轮 `test:retrieval` / `test:embed` / `test:rag` 三红，`ERR_MODULE_NOT_FOUND: src/features/learn/index-service.ts`）：

  | 文件 | 行 | 形态 |
  |---|---|---|
  | `tests/rag-wiring.test.ts` | 22 | import |
  | `tests/retrieval.test.ts` | 18, 20 | import |
  | `tests/embedding-local.test.ts` | 25 | import |
  | `tests/embedding-local.test.ts` | 267 | **`codeOf("src/features/learn/index-service.ts")` —— 静态边界断言里的字符串路径，非 import** |

  已改为 `src/services/learn/index-service.ts` ⇒ `test:retrieval` 21/21 · `test:embed` 18/18 · `test:rag` 10/10。同批回扫 `src/` 源码注：`features/settings/VectorIndexCard.tsx:14` 的「数据流」注释路径亦已过时，一并改正（已并入 T3 提交）。
  ⚠️ **根因**：`tsconfig` 只 `include: ["src"]` ⇒ `tests/` 不进 typecheck，测试里的路径错误**只能靠实跑发现**；方案期用「逐行 grep 谁 import 了被迁模块」排测试改动清单，必然漏掉**非 import 形态的字符串路径**（`:267` 那处）。
  **教训（可直接复用）**：迁移模块时，测试改动清单必须从 **`tests/` 全目录 grep 被迁模块名**产出，而非从「谁 import 了它」产出。
  ⚠️ 另一条定则的印证：首轮 3 红时 `typecheck` 仍是 **0 error**（它只覆盖 `src/`）⇒ **不能以 typecheck 绿推断测试绿**。

## 提交重排记录（历史重写）

**起因**：上述 §8.24 漏报导致 `1c17499` 的前身（`a6f262f`）落盘时 `test:retrieval` / `test:embed` / `test:rag` 三红，且其后的 4 条提交**继续继承该红**（共 5 条中间提交的套件是红的），违反「逐提交可编译**且相关套件绿**」。未 push ⇒ 按仓库定则 `git reset` 重排，不新开「修测试」提交掩盖。

**手法**：`git reset 3eeaaf4`（mixed，工作树不动）→ 按目标分组重新 `git add -A -- <精确路径>`；跨组共享文件用 **blob 级隔离**避免把后续组的改动提前带入：

| 共享文件 | 涉及组 | 手法 |
|---|---|---|
| `src/features/learn/chapter-qa-service.ts` | T3（`index-service` 行）、T4（`memory-service` 行） | `git show a6f262f:<path>` → `git hash-object -w` → `git update-index --cacheinfo` 覆盖暂存内容 |
| `src/stores/useLoopStore.ts` | T4（memory 导入路径）、T5（`refresh` 内 `msg` 兜底） | 同上，取 `3229c65` 版本 |

**结果**：7 条 → **6 条**（原 `3b4a655 fix(test)` 的内容并入 T3；其余一一对应），`git status --short` 全程只涉及本批文件，无并行会话文件被裹入。安全分支 `backup/batch3-pre-rewrite` 指向重写前的 `3b4a655`。

| 序号 | sha | 说明 |
|---|---|---|
| 1 | `3eeaaf4` | chore(scripts)：分层扫描器（修复前红基线） |
| 2 | `1c17499` | refactor(stores,domain,services)：useIndexStore 纯化 + index-service 下沉（含测试路径修正） |
| 3 | `dfc5a29` | refactor(services)：memory 四模块下沉 |
| 4 | `dab24d9` | refactor(engine)：去 i18n 值依赖（含 T6 测试同步） |
| 5 | `50234ad` | chore(rules)：固化层序规则 + 启用 layer:check |
| 6 | 本提交 | docs：回扫第 3 批 + 方案与台账落档 |

## 逐提交实测（§11.3 条 7）

手法：`git worktree add /tmp/plos-verify --detach <sha>` + `node_modules` 软链，逐个 checkout 实跑，**不扰动主工作树**。

| sha | typecheck | 相关套件 | 结果 |
|---|---|---|---|
| `3eeaaf4` | exit 0 | —（仅新增 `scripts/`） | ✅ |
| `1c17499` | exit 0 | `test:retrieval` 21/21 · `test:embed` 18/18 · `test:rag` 10/10 · `test:memory` 64/64 | ✅ |
| `dfc5a29` | exit 0 | `test:memory` 64/64 · 上述 3 个绿 | ✅ |
| `dab24d9` | exit 0 | `test:prereq` ALL PASS · `test:profile` ALL PASS · `test:i18n` ALL PASS · `test:scope` 3/3 · `test:memory` 64/64 | ✅ |
| `50234ad` | exit 0 | `layer:check` exit 0（违规 0 / 新增环 0） | ✅ |

## 通过标准（方案 §11.3）

1. ✅ `stores → features` 6 行清零；`engine → i18n` 值导入清零
2. ✅ 新增环 0；既存环 2 组入基线（检测全量、只禁新增）
3. ✅ 全部 `test:*` 套件 → **0 fail**（47/47）
4. ✅ `npm run typecheck` → exit 0
5. ✅ `npm run layer:check`（严格档）→ exit 0
6. ✅ `npm run build` → exit 0（绕沙箱）
7. ✅ 每条 commit 单独 checkout 后 typecheck exit 0、相关套件绿

## Handoff

- [x] §11.3 七条通过标准全部满足
- [x] 每条 commit 单独 checkout 后 `typecheck` exit 0、相关套件绿
- [x] 文档已同步（缺口在本 runbook 显式登记）
- [x] 安全分支 `backup/batch3-pre-rewrite` 保留（重写前状态，确认无误后可删）
- [ ] **未 push** —— 按用户节奏只落本地
