---
name: plos-ui-system
description: PLOS 前端一致性闸门——基于新侧栏样件的 Tailwind 4 组件规范、壳层布局常量、「同一视觉模式跨 ≥3 个文件必须抽取公共组件」的可执行规则与扫描器。Use when adding or editing React UI in src/, writing Tailwind classNames, building rows/badges/buttons/empties/tooltips, repeating a className across files, refactoring shell or layout, auditing visual consistency, or when the user mentions 组件规范, 设计样式, Tailwind 规范, UI 一致性, 抽取公共组件, 收敛样式, 设计系统.
---

# PLOS UI System：样子从哪来，第三次出现时该怎么做

本 skill 是**跨文件一致性**的闸门。它管的是「同一个视觉模式为什么在全站有 4 种写法」和「第 3 次出现时该被抽走」；单个组件怎么写由 [`ui-impl-tokens`](../ui-impl-tokens/SKILL.md) 管，一屏怎么优化由 [`style-optimization-workflow`](../style-optimization-workflow/SKILL.md) 管。

**为什么是本 skill 而不是一篇文档**：本仓库禁止主动起浏览器做视觉校验（`rules/no-headless-browser-validation`），一致性只能靠静态扫描 + 代码审查保证。所以规则必须是可被脚本判定的，否则等于没规则。

## 三条硬法则

1. **Token 唯一出处**：颜色、圆角、阴影的值只出现在 `src/styles/main.css`。业务代码里出现 `#rrggbb` 或 `text-slate-*` 一律退回。
2. **Tailwind utility only**：Tailwind 4 是 CSS-first，无 `tailwind.config.js`，「新 utility」只能在 `main.css` 的 `@theme inline` 里定义。不写内联 style、不写 CSS Modules、不引额外 UI 依赖。
3. **第三次出现必须抽取**：同一视觉模式跨 **≥3 个文件**重复 → 抽成公共组件。第 2 处允许复制但必须在 PR 声明「待抽」并登记台账。口径见 `references/extraction-playbook.md` §1。

## 动手前四问

1. **这个视觉模式仓库里已有吗？** → `references/component-catalog.md`
2. **命中数多少？** → `node scripts/ui-consistency-scan.mjs --top=30`
3. **落点是哪一层？** → UI Kit `src/components/ui/`（禁 i18n/store）· 领域原语 `primitives.tsx` · 壳层 `layout/`。三层架构见 `docs/ui-component-system-shadcn-design-2026-09.md` §6.1
4. **动了壳层/布局吗？** → `references/shell-and-layout.md`（两条 CSS 坑必读）

## 规则快查

| 要什么 | 去哪 |
|---|---|
| token 允许取值 + 硬编码→token 映射表 + 漂移基线 | `references/tokens.md` |
| 现有组件清单 + 抽取台账（30 条候选） | `references/component-catalog.md` |
| 侧栏/Header/PageContainer 常量 + 两条 CSS 坑 | `references/shell-and-layout.md` |
| 抽取 5 步 + 命名 + 例外条款 + 审稿清单 | `references/extraction-playbook.md` |
| 单个组件怎么实现（cva / Base UI / 按钮外观的 Link） | [`ui-impl-tokens`](../ui-impl-tokens/SKILL.md) |
| `data-testid` 命名 | [`playwright-test-ids`](../playwright-test-ids/SKILL.md) |

## 最高频的四条（记住这四条就能挡住大部分漂移）

- **focus 环只有一种**：`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50`。存量还有 `/25` `/40` `/60` 三种，**新增代码不许再添第四种**。
- **必有组件别手写**：`Button` / `Badge` / `Input` / `Textarea` / `Select` 在 `ui/` 里齐全。台账 30 条里 **22 条是「组件已有但没人用」**，不是缺组件。
- **一行只允许一个名称文本**：「图标 + 文本 + 常驻第二行描述」的做法已被侧栏重构废弃。第二信息走浮层（`role="tooltip"` + `pointer-events-none` + `group-hover`）或下沉到页面标题区。
- **状态色只染 dot / 徽标**：`bg-red-50` 那种整块状态底色是违反既有规则的技术债，不是可选风格（`tokens.md` §4）。

## 扫描器

```bash
node scripts/ui-consistency-scan.mjs                    # 出报告，退出码恒 0
node scripts/ui-consistency-scan.mjs --top=30 --min-files=4
node scripts/ui-consistency-scan.mjs --fail-on=3        # 当有 ≥3 文件重复 → 退出码 1
node scripts/ui-consistency-scan.mjs --json             # 机器可读
```

扫描 157 个源文件，输出四类：重复类串候选 / 硬编码调色板色 / focus 环透明度分布 / 裸 px 字号分布。
**基线（2026-09-11）**：454 处硬编码色（16 文件）· 84 条跨 ≥3 文件重复模式 · focus 环 4 种透明度 · 83 处裸 px 字号。
`--fail-on=3` 当前必然失败 —— 这是真实状况，不是脚本有问题。台账清到阈值以下之后再把它接进 CI。

## 审稿门禁（改 UI 的 PR 必须逐条回答）

- [ ] 新增/修改的行里没有调色板色，没有一次性 hex
- [ ] focus 环 = 标准值（唯一）
- [ ] 新增视觉模式跨文件命中 ≤2，或已在本次 PR 抽取并复跑扫描器
- [ ] 未给壳层容器引入新的 `overflow-*`
- [ ] `data-testid` 已加、`messages/{zh,en}.ts` 成对同步

## Cross-references

- 侧栏重构（黄金样件的来源）：[docs/nav-sidebar-redesign-design-2026-09.md](../../docs/nav-sidebar-redesign-design-2026-09.md)
- 三层架构与 token 桥接：[docs/ui-component-system-shadcn-design-2026-09.md](../../docs/ui-component-system-shadcn-design-2026-09.md)
- 单个组件实现：[ui-impl-tokens](../ui-impl-tokens/SKILL.md)
- 样式优化流程：[style-optimization-workflow](../style-optimization-workflow/SKILL.md)
- 约束：[rules/react.mdc](../../rules/react.mdc)、[rules/engineering-code-style.mdc](../../rules/engineering-code-style.mdc)
