# AGENTS.md — Personal Learning OS (PLOS)

> 给所有在本仓库工作的 AI 助手（Cursor / Claude Code / CodeBuddy / WorkBuddy 等）的**加载引导**。
> 一句话模型：**`rules/` 是约束（违背需用户豁免），`skills/` 是流程（按需加载），本文件是二者的索引与路由。**
> 新增/删除 rule 或 skill 后必须同步更新本文件（见文末「维护约定」），避免索引漂移。

## 仓库事实（改代码前先建立这些认知）

本地优先（local-first）、隐私优先的个人 AI 学习系统桌面应用：

- 前端：React 19 + Vite 8 + TypeScript（`strict` + `verbatimModuleSyntax`）+ Tailwind CSS 4 + Zustand 5 + react-router-dom 7；UI Kit = shadcn/ui 风格（Base UI 底层，代码入库，见 `docs/ui-component-system-shadcn-design-2026-09.md`）
- 桌面壳：Tauri 2（Rust），Rust 侧仅 `vault`（Keychain 密钥）与 `llm`（本地模型 sidecar / 下载 / 生成）
- 环境：Node ≥ 22；**相对导入为主**，`@/*` alias 仅豁免给 shadcn 生成层（`src/components/ui/*`、`src/lib/utils.ts`）；无 ESLint/Prettier 配置（跟随文件风格）
- 领域：知识 → 章节 → 学习循环（掌握度 mastery band）→ 目标（goal）→ 计划；核心域逻辑全部纯 TS

## 目录地图

| 路径 | 内容 |
|------|------|
| `src/domain` | 领域类型 / 常量 / 阈值（如 `MASTERY_THRESHOLD`）——纯 TS，不依赖 React |
| `src/engine` | 学习循环纯逻辑（band、forgetting、plan ETA 等） |
| `src/ai` | AI 供应商适配（含 `vault.ts` 密钥、`builtin.ts` 本地模型 invoke 封装） |
| `src/storage` | 持久化适配层（`local.ts` / `memory.ts`）；组件不得直接碰 localStorage |
| `src/stores` | Zustand store（`useLoopStore`、`useSessionStore`…） |
| `src/features` | 业务页面/组件，按域分（home、plan、learn、assessment、quiz、goals、learner、knowledge、spaces、study、settings） |
| `src/components` | 共享 UI：`ui/`（UI Kit 生成层：button/dialog…，可改自有）、`primitives.tsx`（PLOS 领域原语）、`layout/AppShell.tsx`（`PageContainer`） |
| `src/lib` | `utils.ts`（`cn` = clsx + tailwind-merge），供 ui 层使用 |
| `src/i18n` | 双语字典 `messages/zh.ts` + `messages/en.ts`（**UI 文案必须成对新增**） |
| `src/styles/main.css` | `:root` PLOS 语义值 + `@theme inline`（PLOS token 原名 + shadcn 角色桥接）**唯一出处** |
| `components.json` | shadcn CLI 配置（根；`style: base-*` Base UI 版式） |
| `src-tauri/src` | `lib.rs`（`generate_handler!`）、`vault.rs`、`llm/` |
| `docs/` | 方案/计划/设计文档，命名如 `docs/ui-workbench-plan-2026-09.md` |
| `tests/` | node 直跑纯逻辑单测（`npm run test:*`） |
| `rules/` | 仓库约束（`*.mdc`，Cursor 兼容格式） |
| `skills/` | 流程型知识（`*/SKILL.md`，见下方路由表） |
| `AGENTS.md` | 本文件：rules/skills 索引 + 加载策略 |

## 会话工作流（每个实质任务都走一遍）

```
1. 意图    复述目标 + Done 标准；关键歧义先问（AskUserQuestion，带推荐项）
2. 分流    → skills/tiered-change-workflow（A ≤30 行直改 / B 先澄清 / C 完整方案）
3. 预匹配  （可选）用 skills/task-preflight-skill-match 扫 skills/ 匹配相关流程
4. 方案    C 路径 → skills/pre-task-technical-design（12 章中文方案，写 docs/），用户确认前不写代码
5. 执行    按 skills/docs-task-runbook 建 runbook，逐任务 in_progress→done+outcome
6. 同步    行为变更后最小化更新 docs/ 对应方案；提交按 rules/commit-conventions
```

## Rules：约束如何加载

Cursor / Claude 系工具会按 frontmatter 自动注入：`alwaysApply: true` 全量生效；`globs` 命中对应文件时生效。不支持的工具体验更差——把下表的「要点」当会话检查清单即可。

| Rule 文件 | 触发 | 核心要点 |
|-----------|------|----------|
| `code-structure-and-dependencies` | always | 文件 ≤700 行；≥10 行×≥3 处先抽取；依赖单向（domain→engine/ai/storage→stores→features） |
| `commit-conventions` | always | Conventional Commits，scope 取 PLOS 域（`ui` `i18n` `engine` `docs` `tauri` …） |
| `docs-task-runbook` | always | 实质任务：意图 → 读 docs → 写 runbook → 逐任务执行 → 收尾同步文档 |
| `pre-task-technical-design` | always | 实质任务先澄清 + 完整中文技术方案，用户确认后才写生产代码 |
| `engineering-code-style` | always | 相对导入（`@/*` 仅豁免 ui/lib 层）、中文注释、i18n 双语、Tailwind 4 token、`import type` |
| `layer-import-boundaries` | always | src ↔ src-tauri 只走 IPC；UI → stores/storage；纯逻辑不依赖 React |
| `no-headless-browser-validation` | always | 禁止主动启动无头/任何浏览器校验样式/布局/功能（截图、DOM、视觉检查）；校验走 typecheck + node 单测 + 代码自审；仅用户显式要求浏览器级/E2E 时放行 |
| `react.mdc` | globs `src/**/*.tsx` | Tailwind 4 + 语义 token + UI Kit（`components/ui`）优先 + primitives 原语；状态色仅 dot/徽标 |
| `rust.mdc` | globs `src-tauri/**/*.rs` | 模块 vault/llm → lib.rs 注册；命令 `Result<T,String>`；macOS-only vault |

## Skills：按任务类型按需加载

**原则：不要全量加载**（共 15 个）。改代码类任务以 `tiered-change-workflow` 为入口，或在任务开头用 `task-preflight-skill-match` 扫描 `skills/*/SKILL.md` 的 `description` 做窄匹配。

| Skill | 何时加载 | 一句话职责 |
|-------|----------|-----------|
| **工作流（入口/执行）** | | |
| tiered-change-workflow | 任何改代码请求开头 | A/B/C 复杂度分流；C → 技术方案 → runbook |
| pre-task-technical-design | 新功能/重构/多文件改动/Bug 修复 | 澄清 → 12 章中文技术方案 → 用户确认 → 实施 |
| docs-task-runbook | 多步/跨文件执行 | runbook 化任务并逐项记录状态/outcome，收尾同步文档 |
| task-preflight-skill-match | 任务开头（可选） | 扫描 skills/ 按 description 匹配子任务流程 |
| **诊断** | | |
| root-cause-fix-workflow | Bug/回归/异常调查 | 先证根因（具体代码证据）再改；给最小正确修复与备选 |
| **UI** | | |
| ui-impl-tokens | 在 `src/` 新增/改动 React UI | token-first + Tailwind 4 + UI Kit/primitives 复用（含 ui/ 新建规范）；默认不加 useCallback |
| style-optimization-workflow | 样式优化/一致性审计/设计语言提炼 | 读 token 与 UI 方案 → 短方案 → 实现 → 对抗性自审 → 按需持久化审计 |
| **桌面/Rust** | | |
| tauri-ipc | 涉及 `invoke`/命令注册/事件 | vault/llm 命令契约、lib.rs 注册、serde 镜像、isTauri 守卫 |
| **文档与变更配套** | | |
| package-docs-driven-change | 功能/重构按文档驱动 | 按 area 读 docs → 对齐实现 → 产出测试（node tests/manual；浏览器级需用户显式要求） |
| **测试** | | |
| webapp-testing | **仅用户显式要求**的浏览器级校验/截图/调试 | 起 `npm run dev`(1420) + Python Playwright 脚本（受 no-headless-browser-validation 约束，默认禁用） |
| playwright-test-ids | E2E 可测性 / data-testid（写 testid 不启动浏览器） | 交互元素加稳定 `data-testid`，重构成熟后保持稳定 |
| **通用工具（与 PLOS 主题无关，跨项目用）** | | |
| skill-creator | 创建/维护 SKILL.md | 高质量 skill 编写指南 |
| install-skills-from-url | 从 URL/GitHub 安装 skill | 装到仓库 `skills/<name>/` 或个人技能目录，装前安全审查 |
| mcp-builder | 构建 MCP server | FastMCP / MCP SDK 指南 |
| frontend-design | 高质量 UI 生成类请求 | 避免泛化 AI 审美的前端设计 |

## 编码速记（改代码前过一遍）

- **导入**：相对导入为主；仅 `components/ui` 与 `lib/utils` 允许 `@/*`；external（`react` 在前）→ parent → sibling → `import type`
- **文案**：一律 `useI18n` + `messages/zh.ts`/`en.ts` 成对；不硬编码
- **样式**：Tailwind 4 utility + token（`--color-surface` `ink-1..3` `line` `primary` `state-*`，加 shadcn 角色 `background/card/muted/accent/border/ring`）；新 hex 只允许进 `main.css`
- **UI 原语**：优先 `components/ui`（Button/Dialog…）与 `primitives.tsx`（Section/KnowledgeRow/EvidenceRow/ActionCard/Card/Stat/DeltaBadge）及 `AppShell.PageContainer`
- **数据流**：组件 → `src/stores` → `src/storage`；桌面能力（Keychain/本地模型）→ `invoke("vault_*"|"llm_*")`，纯浏览器预览用 `isTauri()` 守卫
- **Rust**：新命令在属主模块实现 → `lib.rs` `generate_handler!` 注册 → 前端封装进 `src/ai/*`
- **测试**：`npm run typecheck`；纯逻辑单测写 `tests/*.test.ts`（`npm run test:i18n|goal|scope|eta`）；dev 端口 1420
- **文档**：新增方案落 `docs/<AREA>-<title>-design-YYYY-MM.md`，沿用 `docs/*-plan-*.md` 命名风格

## 维护约定（改 rules / skills 时强制执行）

- 新增、删除或重命名 rule → 更新上表 + 检查受影响 skill 的相对链接（`skills/*/SKILL.md` 与 `rules/*.mdc` 互链）
- 新增、删除或重命名 skill → 更新上表；skill frontmatter 必须含 `name` 与 `description`（`description` 是匹配触发词）
- 删除文件前先备份（`git add` 后提交，或先复制到 /tmp）
- 冲突仲裁：**约束以 `rules/` 为准，加载策略以本文件为准，具体流程以 `skills/` 为准**；三者描述同一事实，不得互相矛盾
