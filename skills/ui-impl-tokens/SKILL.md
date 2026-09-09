---
name: ui-impl-tokens
description: PLOS UI 实现规范——先读语义 token（src/styles/main.css @theme）与现有 primitives（src/components/primitives.tsx），再以 Tailwind 4 utility 实现新改 UI；默认不引入 useCallback、不引入额外组件库。Use when building or editing React UI in src/, when the user asks for Tailwind-first / token-first implementation, when optimizing components for visual consistency, or when the user mentions 样式实现, Tailwind, or useCallback.
---

# Token-first、Tailwind-first UI 实现

本 skill 是 **PLOS 前端 UI 实现规范**（对应 `rules/react.mdc` 与 `rules/engineering-code-style.mdc`）。任何在 `src/` 下新增或改动的 React UI 都遵守它。

## 动手前

1. **读 token**：`src/styles/main.css` 的 `@theme` 块是语义 token 唯一来源（`--color-app-bg`、`--color-surface`、`--color-subtle`、`--color-line`、`--color-ink-1..3`、`--color-accent`、`--color-state-*`）。设计意图见 `docs/ui-workbench-plan-2026-09.md` §5。
2. **读 primitives**：先看 `src/components/primitives.tsx`（`Section`、`KnowledgeRow`、`EvidenceRow`、`ActionCard`、`Card`、`Stat`、`DeltaBadge` 等）与 `src/components/layout/AppShell.tsx`（`PageContainer`）。能用现有原语表达的，**不得**另起炉灶。
3. **扫描被改文件**：只对**新增/改动**的 UI 应用 Tailwind；不顺手重写无关标记。
4. **UI 文案**：一律走 `src/i18n`（`messages/zh.ts` 与 `messages/en.ts` 成对新增），经 `useI18n` 取词；不硬编码展示文案。

## Tailwind 用法（本仓库）

- **Tailwind 4（CSS-first）**：由 `@tailwindcss/vite` 接入，无 `tailwind.config.js`。
- Utility 直接引用 token 生成的类：`bg-surface`、`text-ink-2`、`border-line`、`bg-accent`、`text-state-weak` 等（`@theme` 里定义即可生成）。
- **禁止**散落一次性 hex：`#6366f1` 只在 `main.css` 定义一次；组件内一律用 token 类或 `text-(--color-*)` 风格取值。
- 状态语义色（mastered/learning/weak/idle/failed）只作用于 **dot / 徽标**，不染整块背景（见 primitives `StatusTone`）。
- 布局、排版、边框、状态用 utility（`hover:`、`focus-visible:`）；保持与 globals 一致的 focus ring 与对比度。

## 组件策略

- 复用 `primitives.tsx` / `AppShell.tsx` 导出的原语，优先于新造。
- 业务组件按 feature 归置：`src/features/<feature>/`；跨 feature 的共享 UI 提升到 `src/components/`。
- **不引入** antd、Radix、shadcn、ahooks、Emotion、styled-components。
- hooks：优先项目现有 hooks 与 `src/stores/*`（zustand）；不造通用 hook 库。

## `useCallback`

- **默认不加** `useCallback`。
- 仅当满足以下之一才加：另一个 hook 的依赖数组需要稳定函数引用；或 handler 传入 `React.memo` 子组件且重渲染成本真实可测。
- 否则用普通函数或内联 handler。

## 优先级

1. 匹配现有 token 与原语模式，胜过个人审美。
2. 触达文件的新增/改动部分一律 Tailwind-first。
3. Diff 局限在声明的改动面；不顺手重排无关 JSX。

## Cross-references

- 样式整体优化 / 一致性审计流程：[style-optimization-workflow](../style-optimization-workflow/SKILL.md)
- 约束（always apply）：[rules/engineering-code-style.mdc](../../rules/engineering-code-style.mdc)、[rules/react.mdc](../../rules/react.mdc)
- E2E 可测性（data-testid）：[playwright-test-ids](../playwright-test-ids/SKILL.md)
