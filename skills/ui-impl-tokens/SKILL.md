---
name: ui-impl-tokens
description: PLOS UI 实现规范——先读语义 token（src/styles/main.css :root 语义值 + @theme inline 桥接）与现有 UI Kit（src/components/ui/*）及 primitives（src/components/primitives.tsx），再以 Tailwind 4 utility 实现新改 UI；默认不加 useCallback。Use when building or editing React UI in src/, when adding new ui/ components, when the user asks for Tailwind-first / token-first implementation, when optimizing components for visual consistency, or when the user mentions 样式实现, Tailwind, Button/Dialog 组件, or useCallback.
---

# Token-first、Tailwind-first UI 实现

本 skill 是 **PLOS 前端 UI 实现规范**（对应 `rules/react.mdc` 与 `rules/engineering-code-style.mdc`）。任何在 `src/` 下新增或改动的 React UI 都遵守它。组件体系方案见 `docs/ui-component-system-shadcn-design-2026-09.md`（三层架构、token 桥接表 §5.3、采购清单 §6）。

## 动手前

1. **读 token**：`src/styles/main.css` 是颜色值唯一出处——`:root` 存 PLOS 语义值（`--plos-*`），`@theme inline` 暴露两类 token：
   - PLOS 语义：`bg-surface` `bg-subtle` `text-ink-1..3` `border-line` `bg-primary`（品牌强调，**注意已由 accent 更名**）`state-*`；
   - shadcn 角色（ui/ 生成组件消费）：`bg-background` `bg-card` `text-foreground` `bg-muted` `text-muted-foreground` `bg-primary` `bg-accent`（= subtle hover 填充，非品牌色）`border-border` `ring-ring` `destructive`。
   - 品牌强调色 = **`primary`**（#6366f1）；`accent` 在本仓库专指 shadcn 的 hover/选中填充灰。
2. **读 UI Kit 与 primitives**：先查 `src/components/ui/*`（button/dialog/…，shadcn 风格代码、可自由修改）；再查 `src/components/primitives.tsx`（`Section`、`KnowledgeRow`、`EvidenceRow`、`ActionCard`、`Card`、`Stat`、`DeltaBadge` 等）与 `src/components/layout/AppShell.tsx`（`PageContainer`）。能用现有组件表达的，**不得**另起炉灶。
3. **扫描被改文件**：只对**新增/改动**的 UI 应用 Tailwind；不顺手重写无关标记。
4. **UI 文案**：一律走 `src/i18n`（`messages/zh.ts` 与 `messages/en.ts` 成对新增），经 `useI18n` 取词；不硬编码展示文案。**`ui/` 层是纯展示控件，不含文案/状态逻辑**；文案由调用方传 children/props。

## Tailwind 用法（本仓库）

- **Tailwind 4（CSS-first）**：由 `@tailwindcss/vite` 接入，无 `tailwind.config.js`；主题经 `@theme inline`。
- Utility 直接引用 token 生成的类：`bg-surface`、`text-ink-2`、`border-line`、`bg-primary`、`text-state-weak` 等。
- **禁止**散落一次性 hex：颜色值只在 `main.css` 定义一次；组件内一律用 token 类。
- 状态语义色（mastered/learning/weak/idle/failed）只作用于 **dot / 徽标**，不染整块背景（见 primitives `StatusTone`）。
- 布局、排版、边框、状态用 utility（`hover:`、`focus-visible:`）；focus 环统一 `focus-visible:ring-2 ring-ring/50`。

## 导入与别名

- 业务代码（`features/`、`components/` 非 ui、`primitives`）：**相对导入**。
- `@/*` alias **仅**允许出现在 `src/components/ui/*` 与 `src/lib/utils.ts`（shadcn 生成层，`engineering-code-style` 最小豁免）。业务代码 import ui 组件时用相对路径（如 `../components/ui/button`）。

## 组件策略

### 使用（调用方）
- 受控交互控件（button/input/dialog/menu 等）优先 `src/components/ui/*`；跨页面展示原语用 `primitives.tsx`。
- **不要**在业务代码里用裸 `<select>` / `window.confirm` / 手写浮层绕过 UI Kit（M2 起逐项替换，见方案 §7）。
- 需要「按钮外观的路由跳转」时：UI Kit `Button` 只渲染 `<button>`（无 asChild 多态）——用 `className={cn(buttonVariants({ variant }), "你的附加类")}` 套在 `<Link>` 上（相对导入 `ui/button` 的 `buttonVariants` 与 `lib/utils` 的 `cn`）。
- 业务组件按 feature 归置：`src/features/<feature>/`；跨 feature 的共享 UI 提升到 `src/components/`。

### 新增/扩展 ui/ 组件（维护方）
1. 首选 `npx shadcn@latest add <name>`（Base UI 版式；components.json `style: base-*`）。CLI 不可用时（如网络内容审批受限），**手写同构实现**，约定如下。
2. 手写约定（与 shadcn new-york / React 19 对齐）：
   - `cva` 管理 variants + `cn`（`src/lib/utils`）组合类名；根元素带 `data-slot="<name>"`；
   - **无 `forwardRef`**——函数组件直接收 `props`（含 `ref`，React 19）；
   - **Base UI 底层**（`@base-ui/react`）：组合用 **render prop**，不要出现 `asChild`、`@radix-ui/*`、`data-state`、`--radix-*` 变量；
   - 样式全走 PLOS/shadcn 角色 token，`add`/自建后按方案 §5.4 定制表复查一遍；
   - **不引入** antd、Radix UI、MUI、Emotion、styled-components、ahooks；Base UI 由 `ui/` 层封装，业务代码不直接 import。
3. hooks：优先项目现有 hooks 与 `src/stores/*`（zustand）；不造通用 hook 库。

## `useCallback`

- **默认不加** `useCallback`。
- 仅当满足以下之一才加：另一个 hook 的依赖数组需要稳定函数引用；或 handler 传入 `React.memo` 子组件且重渲染成本真实可测。
- 否则用普通函数或内联 handler。

## 优先级

1. 匹配现有 token、UI Kit 与原语模式，胜过个人审美。
2. 触达文件的新增/改动部分一律 Tailwind-first。
3. Diff 局限在声明的改动面；不顺手重排无关 JSX。

## Cross-references

- 组件体系方案（三层架构 / token 桥接 / 采购清单）：[docs/ui-component-system-shadcn-design-2026-09.md](../../docs/ui-component-system-shadcn-design-2026-09.md)
- 样式整体优化 / 一致性审计流程：[style-optimization-workflow](../style-optimization-workflow/SKILL.md)
- 约束（always apply）：[rules/engineering-code-style.mdc](../../rules/engineering-code-style.mdc)、[rules/react.mdc](../../rules/react.mdc)
- E2E 可测性（data-testid）：[playwright-test-ids](../playwright-test-ids/SKILL.md)
