---
name: pre-task-technical-design
description: 在每个实质性任务执行前，先澄清需求、输出完整中文技术方案（背景、目标、现状、架构、交互、用例、线框、文件伪代码、任务、步骤、测试方案与用例），经用户确认后再动手实现。Use before any feature, refactor, bug fix, or multi-file change; when the user asks for a technical plan, design doc, or 技术方案; or when requirements are ambiguous and need confirmation before coding.
---

# 任务前技术方案设计

在**编写或修改代码之前**执行本流程。与 [docs-task-runbook](../docs-task-runbook/SKILL.md) 配合：本 skill 负责**技术方案**；runbook 负责**执行与状态跟踪**。

## 何时执行

| 场景 | 是否执行 |
|------|----------|
| 新功能、重构、多文件改动、Bug 修复（需改代码） | **必须** |
| 用户明确要求「直接改」「跳过方案」 | 跳过，在回复中注明豁免 |
| 纯问答、单行查阅、无后续实现 | 仅澄清意图，不写完整方案 |
| 用户已提供经确认的完整方案 | 对照补齐缺口；无缺口则直接进入 runbook |

## 工作流（顺序固定）

```
澄清需求 → 调研现状 → 输出技术方案 → 用户确认 → runbook 执行 → 实现
```

### 第 1 步：理解需求并列出待澄清项

1. 用一段话复述：**用户要什么**、**完成标准（Done）**、**约束**（路径、技术栈、不可改动范围、截止时间等）。
2. 扫描需求中的**模糊点、冲突点、未决决策**，归类为：
   - **产品/交互**：行为、文案、权限、边界条件
   - **技术**：依赖选型、兼容性、性能、数据模型
   - **范围**：做/不做的边界
3. **存在任一待澄清项时，必须先向用户确认**，不得自行假设产品或安全边界。
   - 优先使用 `AskQuestion` 给出具体选项
   - 问题应**可决策**（带推荐项），一次聚焦 1–3 个最关键问题
4. 待澄清项全部有答案后，再进入第 2 步。

### 第 2 步：调研项目现状

1. 定位相关 **区域**（`src/features`、`src/{domain,engine,ai,storage,stores}`、`src-tauri/src/`、`docs/`；参考 [package-docs-driven-change](../package-docs-driven-change/SKILL.md)）。
2. 阅读**索引与领域文档**（`README.md`、`AGENTS.md`、`docs/` 下目标域方案/设计文档，如 `docs/ui-workbench-plan-2026-09.md`），再按需阅读代码与 `rules/`。
3. 记录：已有能力、缺口、可复用组件/模式、风险点。

### 第 3 步：输出技术方案文档

1. 将方案写入用户指定路径；未指定时默认：
   - `docs/<AREA>-<title>-design-YYYY-MM.md`（沿用仓库 `docs/*-plan-2026-09.md` 命名风格），或
   - 用户已有的 `*DESIGN*.md` / `*PLAN*.md`（如 `docs/ui-workbench-plan-2026-09.md`）
2. **严格按** [TECHNICAL_PLAN_TEMPLATE.md](TECHNICAL_PLAN_TEMPLATE.md) 的 12 个章节填写；不得省略章节（可写「不适用」并说明原因）。
3. 在对话中给出**摘要**（目标 + 架构要点 + 主要文件 + 风险），并附方案文档路径。

### 第 4 步：等待用户确认

- 在方案未经用户明确同意前，**不得**开始写生产代码（调研、读文件除外）。
- 用户提出修改意见时：**更新方案文档** → 再次确认。
- 确认后：创建或更新 [docs-task-runbook](../docs-task-runbook/SKILL.md) 中的 runbook，将方案中的「任务清单」「实施步骤」同步为 runbook 任务项。

### 第 5 步：按方案实施

- 实现时以方案为唯一依据；偏离方案须先更新文档并告知用户。
- 每完成一个 runbook 任务，核对方案中的测试用例是否可执行。

## 方案质量要求

### 必须具体

- **架构**：组件/模块边界、数据流、状态管理、API / Tauri 契约（含请求/响应形状）。数据读写须符合 [rules/layer-import-boundaries.mdc](../../rules/layer-import-boundaries.mdc)：UI → stores/storage，桌面能力仅经 `invoke`（vault/llm）。
- **交互流程**：逐步描述用户操作与系统响应；复杂流程用 Mermaid `sequenceDiagram` 或 `flowchart`。
- **用例**：每条含前置条件、步骤、期望结果、异常分支。
- **线框**：用 ASCII 或 Mermaid 描述布局、关键控件、状态（空/加载/错误）；标明与现有设计 token / 组件的对应关系。
- **文件与伪代码**：列出**每个**将改动的文件；伪代码需体现导出、props、核心逻辑分支，而非「在此实现功能」式空话。
- **测试**：区分单元 / 集成 / E2E / 手工；用例需可追溯到用例章节编号。

### 禁止

- 在关键决策未确认时直接写代码
- 省略章节或只用「待定」占位（除非该章标注 N/A 并解释）
- 方案与 runbook 任务描述不一致

## 与其他 skill 的协作

| 场景 | 额外读取 |
|------|----------|
| UI / Tailwind 实现 | [ui-impl-tokens](../ui-impl-tokens/SKILL.md)、[package-docs-driven-change](../package-docs-driven-change/SKILL.md) |
| 数据读写 / 持久化 / 桌面能力 | [rules/layer-import-boundaries.mdc](../../rules/layer-import-boundaries.mdc) — 方案第 4 章须写清 UI → stores/storage；Tauri 仅 vault/llm 命令经 invoke |
| Tauri 命令 / 事件 | [tauri-ipc](../tauri-ipc/SKILL.md) |
| Bug 修复 | [root-cause-fix-workflow](../root-cause-fix-workflow/SKILL.md) — 方案中「背景」「现状」须含根因证据 |
| E2E 可测性 | [playwright-test-ids](../playwright-test-ids/SKILL.md) — 线框与文件中注明 `data-testid` |
| 任务前 skill 匹配 | [task-preflight-skill-match](../task-preflight-skill-match/SKILL.md) |

## 对话输出格式（方案提交时）

```markdown
## 技术方案摘要

- **目标**：（一句话）
- **待确认项**：无 / 已确认列表
- **文档**：`<path>`

### 架构要点
（3–5 条）

### 主要改动文件
| 文件 | 改动类型 | 说明 |
|------|----------|------|

### 风险与未决项
（如有）

---
请确认以上技术方案；确认后我将按 runbook 开始实施。
```

## 检查清单（提交方案前自检）

- [ ] 所有待澄清项已向用户确认
- [ ] 12 个章节均已填写或标注 N/A
- [ ] 交互流程与用例、测试用例可相互引用
- [ ] 每个改动文件有伪代码
- [ ] 线框覆盖主要状态（默认、空、错、加载）
- [ ] 若涉及数据读写 / 桌面能力：第 4 章已按 [rules/layer-import-boundaries.mdc](../../rules/layer-import-boundaries.mdc) 写清读/写路径
- [ ] runbook 任务与方案「任务清单」「实施步骤」一致
- [ ] 用户尚未确认前未写生产代码
