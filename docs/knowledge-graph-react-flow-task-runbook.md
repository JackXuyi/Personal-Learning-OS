# 概念图谱改用 React Flow —— 执行 runbook

> 隶属方案：[`docs/knowledge-graph-react-flow-design-2026-09.md`](./knowledge-graph-react-flow-design-2026-09.md)（已确认，决策 D1/D2/D3）。
> 规范：[`skills/docs-task-runbook`](../skills/docs-task-runbook/SKILL.md)。

## Goal

把概念图谱的绘制层从自研 SVG（`GraphView.tsx`）换成 `@xyflow/react` v12，获得内置平移 / 缩放 / 适配视图能力；**完整保留**现有三态语义（Overview / Focus / Detail）、节点视觉语言与两个调用方（`ChapterGraphPage` / `KnowledgeTab`）的 props 契约。可测逻辑抽成纯函数模块并以 node 直跑单测覆盖。

**Done 标准**：`npm run typecheck` 本任务文件 0 error；`npm run test:flow` 全绿；`test:render` / `test:graph` / `test:library` 回归全绿；`GraphViewProps` 未变（两个调用方零改动）；所触及文件 ≤700 行；用户手工在 `npm run dev` 中确认渲染与手感。

## Context

- 改动范围：`src/features/knowledge/`（3 文件）+ `src/styles/main.css` + `package.json` + `tests/`
- **唯一被修改的既有源文件**是 `GraphView.tsx`；`layout.ts` 与两个调用方零改动 → 回滚面极小
- 必读约束：`rules/react.mdc`（token 优先、禁 UI 组件库）、`rules/no-headless-browser-validation`（**不做浏览器校验**）、`rules/code-structure-and-dependencies`（≤700 行）、`rules/engineering-code-style`（相对导入 / `import type` / 中文注释）
- 关键不变量（方案 §4.3）：① 坐标「中心点 → 左上角」；② `node.width` 与布局估算强一致；③ `nodeTypes` 必须定义在组件外；④ 禁止原地修改 nodes/edges；⑤ `VISIBLE_LINK` 移到模型层
- 硬约束：`graph-flow-model.ts` 对 `@xyflow/react` **只能 `import type`**（拉入运行时值会带 DOM 依赖，单测跑不起来）

## Tasks

### T1 — 安装 `@xyflow/react`；`main.css` 引入库样式 + token 对齐
- **Status:** done
- **Outcome:** 装得 `@xyflow/react@^12.11.6`（方案写 ^12.11.2，装到当时最新 minor）。`main.css` 顶部新增 `@import "@xyflow/react/dist/style.css"`（置于 tailwind / tw-animate 之后，保证其中性规则可覆盖库默认）；末尾新增 `.react-flow__attribution` / `__controls-button`（含 hover、svg fill）/ `__node` 字体继承共四组 token 对齐规则。CSS 解析以 `vite build` 实证（见 T6）。
- **Notes:** 库 CSS 实际类名已 grep `node_modules/@xyflow/react/dist/style.css` 核对，与方案预写的一致。

### T2 — 新增 `graph-flow-model.ts`（映射纯函数 + 视觉判定 + 边分派）
- **Status:** done
- **Outcome:** 新增 240 行纯函数模块：`isVisibleLink`（`VISIBLE_LINK` 迁入）、`nodeWidth`（原样迁移）、`nodeVisualOf`（band → token 视觉档位）、`buildFlowNodes`（中心点→左上角、`node.width` 与布局估算强一致、focus 淡化、`draggable/selectable=false`）、`buildFlowEdges`（悬空边丢弃 + 按类型分派样式）、`edgeVisualOf`。对 `@xyflow/react` 仅 `import type`。
- **Notes:** 与方案的三处偏差（均为更优解）：① `NodeVisual` 返回 CSS 值（`fill`/`stroke`）而非 Tailwind class —— 节点主体用内嵌 SVG 精确复刻「宽 w × 高 32」的扁菱形，旋转方块做不到等宽高，SVG 属性吃 CSS 值；浅填充用 `color-mix(in srgb, var(--plos-state-*) 10%, white)` 由 token 派生，颜色值仍只在 main.css 定义；② 箭头 marker 改为 `BuildEdgesOptions.arrowMarker` 由组件层注入 —— `MarkerType` 是运行时值，模型层一旦 import 单测即拉入 DOM 依赖；③ `UnitNodeData` 用 `type` 而非 `interface extends Record<string, unknown>` —— interface 无隐式索引签名，不满足 React Flow 的 `NodeData` 约束。

### T3 — 新增 `UnitNode.tsx`（自定义节点，token 化视觉）
- **Status:** done
- **Outcome:** 新增 74 行自定义节点：内嵌 `<svg overflow-visible>` 画缺口脉冲圈（`var(--plos-primary)`）/ 导入琥珀虚线框（`var(--plos-state-weak)`）/ 主体（菱形 polygon 或圆角 rect，fill/stroke 由 `nodeVisualOf` 给 token 派生值），标题用绝对定位居中 + truncate；`memo` 包裹；不挂 `<Handle>`（`nodesConnectable={false}`）。

### T4 — 改造 `GraphView.tsx` 画布层（ReactFlow + Background + Controls + 空态兜底）
- **Status:** done
- **Outcome:** 394 → 285 行。画布层整体换成 `<ReactFlow>`（`fitView` padding 0.15、`minZoom 0.35 / maxZoom 2.4`、`nodesDraggable/nodesConnectable/elementsSelectable` 全 false）+ `Background`（点阵，色 `var(--plos-line)`）+ `Controls`（`showInteractive=false`，Tailwind 任意变体对齐 token）；`proOptions.hideAttribution` 隐藏水印。`nodeTypes` / `FIT_VIEW_OPTIONS` / `PRO_OPTIONS` / `ARROW_MARKER` / `CANVAS_HEIGHT` 全部定义在模块顶层。删除自研 `view {k,tx,ty}` 状态、`onWheel`、marker `<defs>` 及全部 SVG 绘制；`VISIBLE_LINK` / `BAND_SVG` / `TEXT_COLOR` / `nodeWidth` / `nodeKindShape` 迁出。focus / 侧栏 / 关系清单 JSX 原样保留，新增防护：焦点单元不在当前图谱时 `focusSet` 置 undefined（方案 §5.2）。空图早返回等高虚线占位框。
- **Notes:** props 契约零变化（TC-EDGE-06 由 typecheck 自证）；侧栏沿用 slate/indigo 调色板 class（方案「原样保留」，token 化不在本次范围）。

### T5 — 新增 `tests/graph-flow-model.test.ts` + `test:flow` 脚本
- **Status:** done
- **Outcome:** 新增 18 项单测（TC-FLOW-01~10 + TC-EDGE-01~08），`npm run test:flow` 全绿。首跑 17/18：TC-FLOW-09 用例取 3 字样本双双触底钳制（61→64 / 44.5→64），换 5 字未钳样本后通过 —— 断言取值问题，非实现缺陷。

### T6 — 全量验证（typecheck + `test:flow` + 既有回归）
- **Status:** done
- **Outcome:** `npm run typecheck` 通过（仅剩 `AIModelsSection.tsx` 的 3 条 HEAD 既存 TS6133，与本任务无关）；`test:flow` 18/18；回归 `test:render`（20/20）/ `test:graph` / `test:library`（7 组串联）/ `test:i18n` / `test:prereq` 全部 exit 0。另跑 `npx vite build` 成功（1.4s）—— 实证 `main.css` 的 `@import "@xyflow/react/dist/style.css"` bare specifier 可解析（方案标记的风险点排除），构建告警均为既有项（chunk 体积 / dynamic import），与本次无关。

### T7 — 文档同步（方案状态改「已实施」+ 详情页设计文档图谱段）
- **Status:** done
- **Outcome:** 方案文档状态改「已实施」+ 变更记录追加实施偏差三处；`docs/library-detail-page-design-2026-09.md` 变更记录加一行并新增 §14（概念 Tab 图谱渲染层变更：新增能力 / 不变量 / token 化 / 测试）。
- **Notes:** 详情页设计文档此前并无图谱细节段落，故用 §14 简述而非改写旧章节。

### T8 — 提交（`feat(knowledge)` + `docs(knowledge)`）
- **Status:** done
- **Outcome:** 两条本地提交（未 push）：`0f6efab` feat(knowledge)（7 文件，+807/−219，依赖仅新增 `@xyflow/react` / `@xyflow/system` / `classcat` 及 xyflow 内嵌 zustand 副本）、`2dcb610` docs(knowledge)（3 文档）。提交前核对依赖 diff 只含 xyflow 相关包；两次提交后暂存区均为空、工作树干净。ahead 23 → **25**。

## 收尾核对

| 项 | 结果 |
|----|------|
| `npm run typecheck` | ✅ 本任务文件 0 error（仅剩 `AIModelsSection.tsx` 的 HEAD 既存 TS6133） |
| `npm run test:flow` | ✅ 18/18 |
| 回归 render / graph / library / i18n / prereq | ✅ 全部 exit 0 |
| `vite build`（CSS @import 风险点） | ✅ 通过（1.4s） |
| `GraphViewProps` 契约 | ✅ 未变，两个调用方零改动 |
| 触及文件 ≤700 行 | ✅ 由 TC-EDGE-08 断言 |
| 浏览器视觉确认 | ⏳ 待用户在 `npm run dev` 中自查（rules 禁止 AI 主动起浏览器） |

## 变更记录

| 日期 | 变更 | 作者 |
|------|------|------|
| 2026-09-13 | 建立 runbook（T1~T8），源自已确认方案 §9 | Agent |
