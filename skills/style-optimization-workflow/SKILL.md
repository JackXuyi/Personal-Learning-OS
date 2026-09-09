---
name: style-optimization-workflow
description: Runs a structured UI/style optimization workflow for the PLOS desktop app—reads the semantic token source (src/styles/main.css) and UI plans (docs/*plan/design*.md), analyzes the target screen, applies a design-system lens (including spotting generic AI-slop patterns), documents intent before coding, implements changes, self-reviews, and syncs docs. Also covers design-language auditing: inferring visual/interaction rules from code and persisting them to a user-specified doc when asked. Use when the user asks for 样式优化, visual polish, UI refinement, interaction quality, 一致性审计, design audit, or improving a page/component's look and feel.
---

# Style optimization & design-language audit

适用于**视觉 / 交互 / 样式**类工作（非纯逻辑）。大改动时与 [ui-impl-tokens](../ui-impl-tokens/SKILL.md)、[package-docs-driven-change](../package-docs-driven-change/SKILL.md) 配合。

## 1. 读设计事实（唯一来源）

1. Token：`src/styles/main.css` 的 `@theme`（语义 token 唯一出处；含 UI Workbench 语义 token，见 `docs/ui-workbench-plan-2026-09.md` §5）。
2. UI 方案/计划：`docs/*-plan-2026-09.md`、`docs/*-design-*.md`（按域找，如 `docs/ui-workbench-plan-2026-09.md`）。
3. 原语：`src/components/primitives.tsx` 与 `src/components/layout/AppShell.tsx`。
4. 同级参考屏：同 feature 下的兄弟页面（home、plan、learn、assessment、settings）。

**不要**凭记忆引入本仓库不存在的 token / 组件 / 颜色；一切以第 1-3 步读到的为准。

## 2. 理解当前面

| 层 | 看什么 |
|----|--------|
| 产品 | 文案（走 i18n 吗）、空/错/权限态、导航上下文 |
| 代码 | 组件树、Tailwind 类 vs 内联样式、primitives 使用、zustand store 依赖 |

改样式时不得破坏学习循环（storage / stores / engine）行为与 Tauri IPC。

## 3. 设计透镜

用一句话复述用户目标。对齐 type / color / spacing / radius / motion 到现有 token 与兄弟屏模式。

**识别 AI-slop**：泛化紫渐变、无理由毛玻璃、超大圆角、装饰性色块、缺失 focus 态、散落 hex。一律替换为 token 化样式与仓库既有模式。

## 4. 短方案（编码前）

1. 问题  2. 原则（2–4 条）  3. 具体改动  4. 非目标（不做哪些）

## 5. 范围清单

涉及文件、token 变更、行为风险（IPC、store 数据流）、明确不做项。

## 6. 实现

遵循 [ui-impl-tokens](../ui-impl-tokens/SKILL.md)。匹配周围 import。可测性：[playwright-test-ids](../playwright-test-ids/SKILL.md)。

## 7. 对抗性自审

> ⛔ **PLOS rule — [no-headless-browser-validation](../../rules/no-headless-browser-validation.mdc)**：不得启动浏览器（截图 / DOM / 视觉检查）来"验证"样式效果。样式正确性以代码审查判定；需肉眼确认时把 `npm run dev` 的 `http://localhost:1420` 交给用户查看。

- [ ] 各窗口尺寸布局正常；无裁切 / 溢出
- [ ] focus 可见、对比度达标
- [ ] token 化，无一次性 hex
- [ ] 无纯样式改动引发的多余重渲染
- [ ] Diff 限制在声明的表面

## 8. 文档同步

- 仅当出现**新模式**时：最小化更新最近的域文档（`docs/*plan*.md` / 相关 canonical doc）。
- 仅当用户要求「输出/更新设计语言规范」时，才把审计结论**持久化**到用户指定路径（默认建议 `docs/<AREA>-design-language-<YYYY-MM>.md`，不默认创建 DESIGN_LANGUAGE.md）。不要求时不新建文档，结论放对话。

## 9. 设计语言审计模式（从代码提炼规则）

读码 → 提炼 → 必要时持久化：

1. 确认目标（feature 页面 / 全局 shell / 跨页模式）。
2. Token 来源：`src/styles/main.css`；原语：`primitives.tsx`；文案：`src/i18n/messages/*.ts`。
3. 输出结构：概览、技术栈（React + Tailwind 4 + zustand）、tone、规则、token 摘要、代码锚点、已知漂移、更新方式、审阅日期。
4. 规则：引用真实文件与 token 名，禁止臆造调色板；优先既有原语；结束前交付写入或更新的文档（用户要求持久化时）。

## Cross-references

- 实现约束：[ui-impl-tokens](../ui-impl-tokens/SKILL.md)、[rules/react.mdc](../../rules/react.mdc)
- 大改动流程：[tiered-change-workflow](../tiered-change-workflow/SKILL.md)、[package-docs-driven-change](../package-docs-driven-change/SKILL.md)
