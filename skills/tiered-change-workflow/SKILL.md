---
name: tiered-change-workflow
description: >-
  Entry skill that routes work by complexity: unambiguous changes ≤30 lines of code
  may be implemented directly (exempt from full pre-task technical design); ambiguous
  requests must be clarified first; complex or substantive work must go through
  pre-task-technical-design and docs-task-runbook. Also enforces ≥3×/≥10-line
  extraction, ≤700-line files, Tailwind-first styling, and post-change doc sync.
  Use at the start of any code change, feature, refactor, or bug fix; when deciding
  whether to skip a design doc; or when the user asks for tiered / lightweight /
  complexity-gated workflow.
---

# Tiered change workflow（复杂度分流入口）

本 skill 是**任务入口**：先判断走哪条路径，再交给对应流程。不替代现有 always rule 中的结构约束；只负责分流与路径内的强制检查。

## 何时使用

- 任何将改代码的请求（功能、重构、Bug、样式）
- 需要判断「能否跳过完整技术方案」时
- 用户提到轻量改动、复杂度分流、tiered workflow 时

## 分流决策（先做这一步）

```text
收到请求
  → 描述有歧义？ ──是──→【路径 B：先澄清】→ 澄清后再重新分流
  │
  └─否──→ 预估改动 ≤30 行代码，且范围清晰？
            ├─是──→【路径 A：直接修改】（豁免完整技术方案）
            └─否──→【路径 C：复杂/实质性】→ pre-task-technical-design →（确认后）docs-task-runbook
```

| 路径 | 条件 | 动作 |
|------|------|------|
| **A 简单直改** | 描述**无歧义**，且预估生产代码改动 **≤30 行**（含新增与删除的净相关行，不含纯空行/纯注释无关改动） | 直接改代码；**豁免**完整 [pre-task-technical-design](../pre-task-technical-design/SKILL.md) 的 12 章方案；回复中注明「路径 A / 已豁免完整方案」 |
| **B 先澄清** | 产品行为、范围、边界、选型或安全相关存在任一歧义 | **停止实施**；向用户确认后再重新走分流。不得自行假设产品或安全边界 |
| **C 复杂方案** | 新功能、多文件/大范围改动、架构影响、或预估 **>30 行** | 完整走 [pre-task-technical-design](../pre-task-technical-design/SKILL.md)（模板：[TECHNICAL_PLAN_TEMPLATE.md](../pre-task-technical-design/TECHNICAL_PLAN_TEMPLATE.md)）；用户确认后接 [docs-task-runbook](../docs-task-runbook/SKILL.md) |

### 路径判定细则

- **30 行**：按「完成本次诉求所需的生产代码行数」预估；若实施中发现将明显超过 30 行，**立刻停手**，改走路径 C（补方案并确认），不得悄悄扩大。
- **无歧义**：目标、改哪些文件/行为、完成标准均可从用户描述直接推出，且无冲突选项。
- **用户显式「直接改 / 跳过方案」**：可按路径 A 处理（仍受下方硬性约束），并在回复中注明豁免来源。
- **路径 A 仍要做的事**：必要的最小调研（读相关文件）、实现、验证、以及下方硬性约束与文档同步。

### 澄清时（路径 B）

- 一次聚焦 1–3 个可决策问题；带推荐项。
- 有结构化提问工具时优先使用；否则对话中列出选项。
- 澄清完成前**不写生产代码**（读码调研除外）。

---

## 全路径硬性约束（A / B 后实施 / C 均适用）

这些与仓库 [code-structure-and-dependencies](../../rules/code-structure-and-dependencies.mdc) 一致；本 skill 在分流后仍须检查。

### 1. 复用抽取

当**相同或近相同逻辑**同时满足：

- 每处 **≥ 10 行**，且
- 出现 **≥ 3 次**（含即将新增的这一次），

**必须**先抽取为公共方法、组件或 hooks，再继续复制式改动。禁止为省事再贴第四份。

### 2. 单文件行数

- 任意源文件 **≤ 700 行**（含空行与注释）。
- 写入前若目标文件已接近或超过上限：先按职责拆分，再改。
- 禁止在已超限文件上继续堆代码。

### 3. 样式优先 Tailwind（token-first）

- 组件与页面样式**优先** Tailwind 4 utility（复用 `src/styles/main.css` 语义 token 与 `src/components/primitives.tsx` 原语）。
- UI 相关实现再读 [ui-impl-tokens](../ui-impl-tokens/SKILL.md)。
- 仅在现有设计体系明确要求、或无法用 utility 表达时，才使用其他样式方式，并说明原因。

### 4. 实施后文档同步（必须）

方案或代码落地后，**及时**更新相关文档，使文档与代码一致：

| 路径 | 文档义务 |
|------|----------|
| **A** | 行为或对外约定有变：最小更新 `docs/` 对应方案/设计文档；无行为变化可只在回复中说明「无需改文档」 |
| **C** | 按 [docs-task-runbook](../docs-task-runbook/SKILL.md) 第 4 步刷新 canonical docs；方案文档与 runbook 状态保持最新 |

优先更新已有文档（`README.md`、`AGENTS.md`、`docs/` 下对应领域的方案文档）；不要为了版本目录而新建 `docs/<domain>/<version>/`，除非用户要求。

---

## 路径 C 产出要求（摘要）

详细章节以 [TECHNICAL_PLAN_TEMPLATE.md](../pre-task-technical-design/TECHNICAL_PLAN_TEMPLATE.md) 为准。方案中须覆盖用户关心的块，至少包括：

1. 需求背景  
2. 需求目标与完成标准  
3. 架构方案  
4. 代码改动方案  
5. **每个文件**的具体改动内容（含伪代码级说明）  
6. 拆分后的详细 task（并同步到 runbook）  
7. 测试方案与可执行用例  

用户确认前不写生产代码。

---

## 与其他 skill / rule 的关系

| 能力 | 负责方 |
|------|--------|
| **先判断 A / B / C** | **本 skill（入口）** |
| 完整 12 章技术方案 | [pre-task-technical-design](../pre-task-technical-design/SKILL.md)（路径 C） |
| 任务状态与执行跟踪 | [docs-task-runbook](../docs-task-runbook/SKILL.md)（路径 C；路径 A 可选极简勾选） |
| 700 行 / 复用 / 无环依赖 | always rule `code-structure-and-dependencies`（全路径） |
| 包内文档与设计语言 | [package-docs-driven-change](../package-docs-driven-change/SKILL.md) |
| 数据读写 / 桌面能力 | [rules/layer-import-boundaries.mdc](../../rules/layer-import-boundaries.mdc)（全路径；路径 A 也不豁免：UI → stores/storage，Tauri 仅 vault/llm） |

路径 A 对 `pre-task-technical-design` 的豁免**仅限完整 12 章方案**；不豁免文件行数、复用抽取、Tailwind 优先、文档一致性。

---

## 执行检查清单

开始改代码前：

- [ ] 已判定路径 A / B / C，并在回复中写明
- [ ] 路径 B：歧义已澄清；否则未改生产代码
- [ ] 路径 C：方案已确认；runbook 已挂上 task

合并或交付前：

- [ ] 无「≥10 行 × ≥3 处」未抽取的重复逻辑
- [ ] 所触及源文件均 ≤700 行
- [ ] 新增/改动 UI 优先使用 Tailwind
- [ ] 若加载或变更业务数据 / 桌面能力：符合 [rules/layer-import-boundaries.mdc](../../rules/layer-import-boundaries.mdc)
- [ ] 相关文档已与代码对齐（或已注明无需更新及原因）
