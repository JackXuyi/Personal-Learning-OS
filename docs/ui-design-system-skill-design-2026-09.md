# PLOS UI 设计系统 Skill 技术方案（以侧栏为基准的样子系统）

| 字段 | 内容 |
|------|------|
| 作者 | Agent |
| 日期 | 2026-09-11 |
| 状态 | **已实施**（2026-09-11 落盘；D1/D2/D3/D4 均取推荐项 A） |
| 关联需求 | 用户口述：基于本次左侧菜单栏改造，重立项目设计样式 skill —— ①组件规范 ②Tailwind 实现 ③全局布局/交互一致性 ④复用 >2 处必须抽取公共组件 |
| 前置改动 | `c905b5e feat(ui): 侧边导航改为平铺图标列表`、`cca696c docs(nav)`（新侧栏 = 本方案的基准样件） |
| 关联文档 | `docs/ui-component-system-shadcn-design-2026-09.md`（三层架构/采购清单）、`docs/nav-sidebar-redesign-design-2026-09.md`（样件方案）、`docs/ui-workbench-plan-2026-09.md` §5 |

---

## 1. 背景

本次侧栏改造（五分组 → 平铺图标列表）落地后，做了针对性扫描，**发现规范本身缺失，而不是某几处写错**：

| 现象 | 证据（2026-09-11 全仓扫描） |
|---|---|
| 颜色绕过 token | 硬编码 Tailwind 调色板色分布在 **16 个文件**：`text-slate-400`×47、`border-slate-200`×41、`text-slate-500`×32、`bg-slate-50`×26、`bg-indigo-50`×21、`text-indigo-600`×17、`bg-indigo-600`×17……**连 `primitives.tsx` 自己都在用** |
| focus 环不统一 | `focus-visible:ring-2` 共 6 处，透明度却有 **4 种**：`/25`×3、`/40`×3、`/50`×1（UI Kit button 标准值）、`/60`×1（**本次侧栏引入的漂移**） |
| 重复类串无对应组件 | 跨 ≥3 文件重复出现的 4 元类序列 **65 条**，Top5 命中 7–11 个文件：`px-4 py-2 text-sm font-medium`(11)、`flex flex-wrap items-center justify-between`(11)、`flex flex-wrap items-center gap-2`(8)、`border-line bg-subtle px-1.5 py-0.5`(7)、`text-sm font-semibold text-white shadow-sm`(6) |
| 字号漂移 | `text-[10px]` 28 处 / 16 文件；`text-[11px]` 39 处 / 15 文件 —— 同一「元信息」层级两种裸值，无 token |
| 有原语没人用 | `ui/button.tsx` 已含完整 variants 与标准 focus 环，但全站仍有 `px-4 py-2 text-sm font-medium` 之类的手写 CTA |
| hover 语义散写 | `hover:bg-subtle` 33 处 / 17 文件，全部手写、无处定义 |

根因是**「规范写在多篇 design 文档里，但没有一条能被 AI/开发者执行的一致性闸门」**：`ui-impl-tokens` 讲「怎么用一个 token」，`style-optimization-workflow` 讲「怎么优化一屏」，中间缺一层——**「怎么保证全仓同一模式只有一种写法，且第三次出现时必须被抽走」**。这就是本 skill 要补的位。

---

## 2. 方案目标

| 类型 | 描述 |
|------|------|
| **主要目标** | 产出可执行 skill `plos-ui-system`：以本次侧栏为「黄金样件」，把 PLOS 的布局/交互/组件规范固化为 ①一套 Tailwind 组件规范 ②一条「**复用 > 2 处必抽取**」的硬规则与抽取流程 ③一个可跑的一致性扫描器基线。 |
| **非目标** | ① 不一次性治理 300 处存量硬编码色（只出基线 + 台账 + 分期表）；② 不改主题配色（仍为亮色单套 token）；③ 不替代 `ui-impl-tokens`（token 用法）与 `style-optimization-workflow`（优化流程）；④ 不引入新的 UI 依赖；⑤ 不动 Tauri / 存储 / 引擎层。 |
| **成功标准** | A1–A8 全绿（§2.1）。 |

### 2.1 验收清单

| # | 验收项 |
|---|--------|
| A1 | `skills/plos-ui-system/SKILL.md` 存在，frontmatter 含 `name`/`description`（含触发词），正文 ≤ 180 行 |
| A2 | 组件规范覆盖：布局容器 / 图标-文本行 / 徽标 / 按钮 / 浮层 / 空态 / 状态点，每类给出「token + 类名 + 何时抽組件」 |
| A3 | 「复用 > 2 处抽取」规则可执行：给出计数口径、阈值、抽取落点目录、例外条款 |
| A4 | 提供 `scripts/ui-consistency-scan.mjs`：输出重复类串 Top N、硬编码色清单、focus 环分布，退出码可被 CI/门禁使用 |
| A5 | 以新 skill 反审新侧栏 → **修正其 `ring-ring/60` 漂移**为标准 `/50`，其余项全通过 |
| A6 | `AGENTS.md` skills 路由表与 rules 引用同步更新；与既有 skill 无职责冲突描述 |
| A7 | 全仓库 grep：`skills/` 下无重复同名职责 skill；文档交叉引用链接有效（相对路径可开） |
| A8 | `npm run typecheck`、`npm run build` 通过（本改动若涉及源码） |

---

## 3. 项目现状

### 3.1 现有 Skill 版图与空白

| Skill | 职责（现状） | 与本方案关系 |
|---|---|---|
| `ui-impl-tokens` | token-first / Tailwind-first 的**单点实现**约束；UI Kit 与 primitives 用法；导入别名；useCallback | **保留**；本 skill 引用它处理「单个组件怎么写」，自己负责「跨文件同一模式只能有一种写法」 |
| `style-optimization-workflow` | 样式优化 / 一致性审计 / 设计语言提炼的一次性**流程** | **保留**；本 skill 提供它第 7 步「对抗性自审」的可执行判据（扫描器 + 台账） |
| `frontend-design` | 高质量 UI 生成的审美约束 | 无关补充 |
| `playwright-test-ids` | `data-testid` 命名与可测性 | 本 skill 的组件规范**引用**其命名约定，不重复定义 |
| `pre-task-technical-design` / `tiered-change-workflow` / `docs-task-runbook` | 方案与执行分派 | 本 skill 在新 UI 类任务中被它们前置调用 |

**空白确认**：没有 skill 回答「第 3 次出现要不要抽」「全仓 focus 环为什么有 4 种」「这行 className 应该去哪个组件」。这正是本方案填补的位置。

### 3.2 现有资产（新 skill 要能查得到的清单）

| 资产 | 路径 | 形态 |
|---|---|---|
| 语义 token（唯一出处） | `src/styles/main.css` | `--plos-*` + `@theme inline`（PLOS 语义 + shadcn 角色桥接） |
| L1 UI Kit | `src/components/ui/`（button/dialog/select/tabs/badge/input/…13 个） | `cva` + `cn`，无业务依赖 |
| L2 领域原语 | `src/components/primitives.tsx`（Card/Section/SectionTitle/Bar/Stat/KnowledgeRow/EvidenceRow/ActionCard/BandBadge/SegmentedTabs，359 行） | 组合层，含 PLOS 语义 |
| 布局壳 | `src/components/layout/{AppShell,NavSidebar}.tsx`、`layout/nav-items.ts` | **新样件**：142/97/72 行，本次改造产出 |
| 零散资产 | `src/components/{CommandPalette,DeltaBadge}.tsx` | 独立于 ui/primitives，命名位置不统一（漂移点） |

### 3.3 约束与依赖

- Tailwind **4 CSS-first**（无 `tailwind.config.js`，经 `@tailwindcss/vite` + `@theme inline`）——「新 utility」只能在 `main.css` 定义，不存在 JS 配置兜底。
- 三层架构铁律（`ui-component-system-shadcn-design-2026-09.md` §6.1）：L1 禁 `useI18n`/store；L2 才允许组合业务。
- `Material/icon`：图标库仅 `lucide-react@1.43.0`（`LucideProps = RefAttributes<SVGSVGElement> & SVGAttributes`，故 `className`/`strokeWidth`/`aria-hidden` 均可用）。
- 禁止主动起浏览器做视觉校验（`rules/no-headless-browser-validation`）——一致性**只能靠静态扫描 + 代码审查**保证，这也是本 skill 必须自带扫描器的直接原因。
- 新增/删除 skill 必须同步 `AGENTS.md` 路由表（本仓库维护约定）。

---

## 4. 决策点（需用户确认）

| ID | 决策点 | 建议（A） | 备选（B） | 备选（C） |
|----|--------|-----------|-----------|-----------|
| **D1** | skill 形态 | **新建 `skills/plos-ui-system/`**（SKILL.md ≤180 行 + `references/` 4 篇 + `scripts/` 1 个），职责=「一致性 + 抽取」；`ui-impl-tokens` 保持不变，仅加一行交叉引用 | 把内容塞进 `ui-impl-tokens`（该文件将从 77 行膨胀到 250+ 行，职责混杂，**不推荐**） | 只写一份 docs 设计语言文档、不建 skill（无法被任务自动加载触发，**不推荐**） |
| **D2** | 历史漂移治理深度 | **本轮只修「本次引入」的漂移**：侧栏 `ring-ring/60` → `/50`；300 处硬编码色只出**基线清单 + 分期台账**（按文件/组件分组，P0=被 UI Kit 已覆盖的场景） | 本轮一次性替换全部 300 处（跨 16 文件大 diff，违背渐进原则，**不推荐**） | 完全不治理，只写规则（无基线 = 无法验证改进，**不推荐**） |
| **D3** | 是否带扫描脚本 | **提供 `scripts/ui-consistency-scan.mjs`**（零依赖 node 脚本，输出 Markdown 报告 + 退出码），使「>2 处抽取」可被机器判定 | 只写人工检查清单（依赖自觉，易腐化） | 用现成的 eslint-plugin-tailwindcss（需新增依赖 + 配置，**不推荐**） |
| **D4** | 抽取规则强度 | **双轨**：①新增/改动的代码面——第 3 处出现强制抽取；②存量——入台账 + 扫描器 Top N 排序，随改随抽（M1/M2/M3 渐进） | 存量一次性全量抽取（风险大） | 只建议不强制（等于没规则） |

---

## 5. 技术架构（skill 交付物）

### 5.1 目录结构

```
skills/plos-ui-system/
├── SKILL.md                          # 触发词 + 三大法则 + 规则快查 + 抽取决策树（≤180 行）
├── references/
│   ├── tokens.md                     # token 表 + 硬编码色 → token 对照（含本次扫描基线）
│   ├── component-catalog.md          # 组件台账：模式串 / 命中文件数 / 现落点 / 目标 API / 抽取状态
│   ├── shell-and-layout.md           # 黄金样件拆解：侧栏、Header、PageContainer；两个 CSS 坑
│   └── extraction-playbook.md        # 抽取 5 步 + 命名/data-testid/审稿清单
└── scripts/
    └── ui-consistency-scan.mjs       # 重复类串 / 硬编码色 / focus 环 扫描器
scripts/ui-consistency-scan.mjs       # （可选）仓库级入口，转发到 skill 内脚本
```

### 5.2 模块职责

| 组成 | 职责 | 不被加载时的影响 |
|---|---|---|
| `SKILL.md` | 任何 UI 任务的第一步检查表与抽取决策树；指出何时去读哪份 reference | 元数据在上下文中，触发后加载 |
| `references/tokens.md` | 颜色/字号/圆角/间距的**唯一允许取值**与漂移对照表 | 需要查具体值时按需读 |
| `references/component-catalog.md` | 现有组件清单 + 候选抽取台账（附证据计数） | 判断「要不要新建/复用」时读 |
| `references/shell-and-layout.md` | 壳层（侧栏/Header/PageContainer）的结构常量与已知坑 | 改壳层时读 |
| `references/extraction-playbook.md` | 抽取步骤、命名、测试与审稿清单 | 执行抽取时读 |
| `scripts/ui-consistency-scan.mjs` | 机器判定一致性 + 生成台账数据 | 门禁/CI 用 |

### 5.3 数据流与副作用

**N/A**。本交付物是知识与脚本，不写业务数据、不动 store、不走 IPC。扫描器只读源码并向 stdout 输出报告。

---

## 6. 组件规范（skill 的核心内容）

> 以下为 `SKILL.md` + `references/tokens.md` 将固化的规则（草案，待确认后落盘）。

### 6.1 Token 允许取值表

| 类别 | 允许 | 禁止 |
|---|---|---|
| 背景 | `bg-surface`（主面）/ `bg-subtle`（hover·次级块）/ `bg-app-bg`（窗外留白） | 任意 `-slate-*`、`-gray-*`、`-zinc-*` |
| 文字 | `text-ink-1`（主）/ `text-ink-2`（次）/ `text-ink-3`（弱·占位） | `text-slate-400/500/600/700/800/900` |
| 边框 | `border-line` | `border-slate-200` |
| 品牌强调 | `bg-primary` / `text-primary` / `ring-ring` | `bg-indigo-600/700`、`text-indigo-600/700` |
| 状态 | `state-mastered/learning/weak/idle/failed`，**仅 dot / 徽标** | 状态色染整块背景 |
| 圆角 | `rounded-md`（8px 控件/卡片默认）、`rounded-lg`（12px 容器） | ≤`rounded-sm`、≥`rounded-2xl`（AI-slop 特征） |
| 字号 | `text-xs`(12) / `text-sm`(14) / `text-[13px]`(正文) 与两个**新增别名**：`text-micro`(10，仅徽标/角标)、`text-meta`(11，元信息行) | 裸写 `text-[10px]` / `text-[11px]`（若要消除裸值，在 `main.css` 的 `@theme` 里定义一次，见 D2） |
| focus 环 | **`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50`**（= UI Kit button 标准值） | `/25` `/40` `/60` 任一其他透明度 |
| hover 填充 | `hover:bg-subtle` + `hover:text-ink-1` | `hover:bg-slate-50` |

> `text-micro` / `text-meta` 是否新增到 `@theme` 属于 D2 范围；若暂不新增，则在规范中明确「允许 `text-[10px]`/`text-[11px]`，但只允许出现在 Primitives/UI Kit 内」。

### 6.2 布局与壳层常量（黄金样件）

| 项 | 值 | 依据 |
|---|---|---|
| 侧栏宽度 | `w-60`（240px） | `NavSidebar.tsx` |
| 侧栏结构 | `aside.flex.flex-col` → brand（`px-5 py-3.5` + `border-b`）→ `nav.flex-1.p-3.space-y-0.5` → footer（`px-4 py-2.5` + `border-t`） | 同上 |
| 导航行 | `flex items-center gap-2.5 rounded-md px-3 py-2`；图标 `h-4 w-4 shrink-0` `strokeWidth={1.75}` `aria-hidden`；名称 `text-sm truncate` | 同上 |
| 选中态 | 容器 `bg-subtle text-ink-1` + 图标 `text-primary` | 同上（D2-A 裁决） |
| 页面容器 | `PageContainer`（default = `max-w-5xl px-8 py-8`；wide = `max-w-[1600px] px-4…`） | `AppShell.tsx` |
| Header | `h-12` + `border-b` + 居中搜索 ≤`max-w-md` | 同上 |

**两条写入 `references/shell-and-layout.md` 的硬坑**（本次实踩）：

1. **浮层溢出**：`<nav>`/任何祖先不得设 `overflow-y-auto|hidden` —— CSS 规范中一个方向非 visible 会把另一个方向的 visible 计算成 auto，右侧浮层（tooltip）必被裁。侧栏项数固定时不要内部滚动。
2. **NavLink 图标着色**：要给 children 内部的图标按 `isActive` 着色，必须走**函数式 children**（`({ isActive }) => <>…</>`），`className` 回调拿不到 children 内部。

### 6.3 「图标 + 文本行」原子（新侧栏沉淀）

```
NavItemRow / IconTextRow
  ├── icon: LucideIcon（size 16 / strokeWidth 1.75 / aria-hidden）
  ├── 名称：单行 truncate，永不带第二行常驻描述
  ├── 描述：一律走浮层（role="tooltip" + pointer-events-none + group-hover/focus-visible）
  │        并同时挂 title 兜底（触屏 / 无 hover）
  └── 右侧槽：状态点 / 徽标（ml-auto，绝不用空格占位）
```

规则：**任何一行只允许一个名称文本**；第二信息只能进浮层或页面标题区。

### 6.4 复用 > 2 处抽取规则（可执行口径）

```
计数口径  ：同一「视觉模式」（= 相同结构 + 相同 token 意图），以文件为单位去重计数
           例：同一串 className 在 1 个文件里出现 5 次 = 1 处；跨 3 个文件出现 = 3 处
阈值      ：≥3 处 → 必须抽取（用户要求「超过 2 处」）
           第 2 处 → 允许复制，但必须在 PR 描述里声明「第 2 处，待抽」并进台账
抽取落点  ：纯展示复用 → src/components/ui/<kebab>.tsx（L1，禁 i18n/store）
           含业务语义 → src/components/primitives.tsx（L2）或 src/components/<Name>.tsx
           壳层相关   → src/components/layout/
例外条款  ：一次性首屏视觉（hero/brand block）、第三方组件必需的内联包裹，
           需在文件顶部注释写明「一次性，不抽取」才能豁免
验收      ：抽取后扫描器对该模式的命中数应降为 ≤2；PR 必附扫描器 diff
```

当前扫描结果（≥3 文件命中）即为首批台账：见 §8.3。

### 6.5 交互一致性

| 交互 | 规范 |
|---|---|
| 键盘可达 | 所有可点元素必须有 `focus-visible:ring-2 ring-ring/50`；禁用项用 `<div aria-disabled cursor-not-allowed>`，不进 Tab 序列 |
| 浮层 | 统一 `overlayBase`/`contentBase`（`ui/dialog.tsx` 导出）或自身纯 CSS 方案；必须 `pointer-events-none`（提示型）或可聚焦（操作型）二选一，不混用 |
| 状态点 | AI 就绪 = `h-1.5 w-1.5 rounded-full bg-state-mastered`（侧栏）/ `h-2 w-2`（Header），**同一状态在同层级尺寸必须一致** |
| `data-testid` | 沿用 `playwright-test-ids` 约定：`<区域>-<语义>`，如 `nav-settings`、`nav-graph-placeholder` |

---

## 7. 涉及文件与改动

### 7.1 `skills/plos-ui-system/SKILL.md`（新增）

```markdown
---
name: plos-ui-system
description: PLOS 前端一致性闸门——Tailwind 4 组件规范、壳层布局常量、「同一模式出现 ≥3 处必须抽取公共组件」规则与抽取决策树、UI 一致性扫描器。Use when adding or editing React UI in src/, writing Tailwind classNames, building lists/rows/badges/empties/tooltips, refactoring shell/layout, repeating a className across files, or when the user mentions 组件规范, 设计样式, 一致性, 抽取公共组件, Tailwind 规范, UI 收敛.
---

# PLOS UI System：一致性 + 抽取

## 三条硬法则
1. Token 唯一出处 …
2. Tailwind utility only …
3. **第三次出现必须抽取**（口径见 references/extraction-playbook.md §计数口径）…

## 动手前四问
1. 这个视觉模式**仓库里已有**吗 → references/component-catalog.md
2. 命中数 ≥3 吗 → node scripts/ui-consistency-scan.mjs
3. 落点是 UI Kit（L1，`src/components/ui/`）还是领域原语（L2，`primitives.tsx`）→ 三层架构见 `docs/ui-component-system-shadcn-design-2026-09.md` §6.1
4. 会改动壳层/布局吗 → `references/shell-and-layout.md`（两条 CSS 坑必读）

## 规则快查
- Token 表 → references/tokens.md
- 组件台账 → references/component-catalog.md
- 抽取步骤 + 命名 + 审稿清单 → references/extraction-playbook.md
- 单个组件怎么实现（UI Kit / cva / Base UI）→ ui-impl-tokens（../ui-impl-tokens/SKILL.md）

## 审稿门禁（改 UI 的 PR 必须全部回答）
- [ ] 无一次性 hex / 调色板色（text-slate-* / indigo-* 等）
- [ ] focus 环 = focus-visible:ring-2 ring-ring/50（唯一值）
- [ ] 新增视觉模式的命中数 ≤2，否则已抽取
- [ ] 壳层容器未引入新的 overflow（浮层会被裁）
- [ ] data-testid 已加、i18n 双语已同步

## Cross-references
…
```

### 7.2 `skills/plos-ui-system/references/tokens.md`（新增）

内容 = §6.1 表格 + **本次扫描基线**（16 文件、slate/indigo 逐项计数）+ 「硬编码 → token」映射操作表 + `@theme` 扩展 `text-micro`/`text-meta` 的方法（如 D2 采纳）。

### 7.3 `skills/plos-ui-system/references/component-catalog.md`（新增）

| 模式串（4-gram 代表） | 命中文件数 | 现有落点 | 目标组件 | 状态 |
|---|---|---|---|---|
| `flex flex-wrap items-center justify-between` | 11 | 无 | `RowHeader` / `SectionHeader`（primitives） | 待抽 |
| `px-4 py-2 text-sm font-medium` | 11 | `ui/button` 已有 | 强制走 `Button` / `buttonVariants` | 待治理 |
| `flex flex-wrap items-center gap-2` | 8 | 无 | `Toolbar` / `ActionsRow` | 待抽 |
| `border-line bg-subtle px-1.5 py-0.5` | 7 | `ui/badge` 已有 | 强制走 `Badge` | 待治理 |
| `text-sm font-semibold text-white shadow-sm` | 6 | `ui/button` default | 同上 | 待治理 |
| `rounded-lg border-line bg-surface p-3` | 6 | `primitives.Card` | 收敛 Card 用法 | 待治理 |
| `border-line bg-surface p-6 text-center` / `border-dashed … p-6` | 6 / 5 | 无 | `EmptyState`（title/desc/action 三插槽） | 待抽 |
| `mx-auto max-w-3xl px-8 py-16` | 5 | 无 | `EmptyState`（居中变体） | 待抽 |
| **图标 + 文本行 / 侧栏项** | 1（新） | `NavSidebar` 内联 | `NavItemRow`（≥3 处时抽） | **基线 ≤2** |
| `hover:bg-subtle` | 17 | 无定义 | 写入 tokens.md「hover 令牌」 | 待规范 |

### 7.4 `skills/plos-ui-system/references/shell-and-layout.md`（新增）

= §6.2 全量常量表 + 两条 CSS 坑 + 「侧栏 = 黄金样件」的代码锚点（`NavSidebar.tsx` 行号指针）+ 「什么时候允许打破常量」的豁免条件。

### 7.5 `skills/plos-ui-system/references/extraction-playbook.md`（新增）

抽取 5 步：① 用扫描器拿到证据（命中文件列表）→ ② 定 `props` 契约（children 优先、`className` 只做追加合并经 `cn`）→ ③ 定落点层（L1/L2/layout 判定表）→ ④ 替换全部调用点（**含 testid 平移**）→ ⑤ 复跑扫描器，命中数 ≤2 并在 PR 附 diff。附：命名约定、禁止把 i18n/store 引入 L1、例外条款写法。

### 7.6 `skills/plos-ui-system/scripts/ui-consistency-scan.mjs`（新增）

```js
// 伪代码 — 仅表达意图
// 用法：node scripts/ui-consistency-scan.mjs [--top=25] [--fail-on=3] [--json]
// 输出三类问题 + 退出码（有 ≥fail-on 命中的模式 → exit 1）
const SPEC = {
  bannedPalette: /(text|bg|border)-(slate|gray|zinc|indigo|emerald|rose|amber)-\d{2,3}/g,
  focusRing: /focus-visible:ring-ring\/(\d+)/g,          // 期望唯一值 50
  ignore: ["/components/ui/", "node_modules", ".test."],  // L1 生成层豁免第 1 类
};
// 1) 扫 src/**/*.{ts,tsx} 提取字符串字面量 → 拆 punk → 取 tailwind-like token
// 2) n-gram(=4) 跨文件计数 → 报 Top N（已在本次调研中验证可行：65 条 ≥3 文件）
// 3) 硬编码色 → 按文件汇总计数
// 4) focus 环透明度分布
// 打印 Markdown 报告：| 模式 | 命中文件数 | 建议落点 |；退出码按阈值
```

### 7.7 其余改动

| 文件 | 改动 |
|---|---|
| `src/components/layout/NavSidebar.tsx` | `focus-visible:ring-ring/60` → `/50`（D2 采纳时执行） |
| `skills/ui-impl-tokens/SKILL.md` | Cross-references 加一行「跨文件一致性与抽取 → plos-ui-system」 |
| `AGENTS.md` | skills 路由表新增一行（工作流或 UI 组）；编码速记补「第三次出现必抽取」；维护约定已满足 |
| `docs/ui-component-system-shadcn-design-2026-09.md` | §7 存量改造映射追加「重复类串台账」指向 component-catalog.md |
| `package.json` | 若采纳 D3：`"lint:ui": "node scripts/ui-consistency-scan.mjs --fail-on=3"`（可选） |

---

## 8. 任务清单

| ID | 任务 | 依赖 | 复杂度 |
|----|------|------|--------|
| T1 | 撰写 `SKILL.md`（frontmatter + 三法则 + 动手前四问 + 规则快查 + PR 门禁） | — | M |
| T2 | `references/tokens.md`（含 2026-09-11 漂移基线） | — | M |
| T3 | `references/component-catalog.md`（由扫描 Top N 生成台账） | T6 | M |
| T4 | `references/shell-and-layout.md`（常量表 + 两条 CSS 坑 + 代码锚点） | — | S |
| T5 | `references/extraction-playbook.md`（抽取 5 步 + 命名 + 例外） | — | M |
| T6 | `scripts/ui-consistency-scan.mjs`（零依赖 + 退出码） | — | M |
| T7 | 修正 `NavSidebar.tsx` focus 环 `/60` → `/50`；复跑 typecheck + build | T6 | S |
| T8 | 同步 `AGENTS.md` + `ui-impl-tokens` 交叉引用 + `ui-component-system` §7 指向 | T1–T5 | S |
| T9 | 自验收：以新 skill 反审新侧栏与 variant（A1–A8）+ 扫描器首份基线报告入库 | T1–T8 | M |

**实施顺序**：T6（先有数据）→ T2/T3 → T1 → T4/T5 → T7 → T8 → T9。

**回滚**：全部为新增文件 + `NavSidebar.tsx` 一行 focus 环改动；一次 `git revert` 可完整回滚，无数据迁移、无路由变更。

---

## 9. 测试方案

| 层级 | 方式 | 覆盖 |
|---|---|---|
| 静态 | `node scripts/ui-consistency-scan.mjs` | 重复类串 Top N、硬编码色清零（新增文件）、focus 环唯一值 |
| 编译 | `npm run typecheck` / `npm run build` | T7 源码改动无破坏 |
| 单测 | `npm run test:i18n` | 若涉及 i18n（本任务不变） |
| 自审 | A1–A8 逐项勾验 + 用新 skill 反向审查 `NavSidebar.tsx` | 规则可被执行、不空转 |
| E2E/视觉 | **不做**（`rules/no-headless-browser-validation`）；需肉眼确认时交 `npm run dev` → `http://localhost:1420` | — |

**通过标准**：T1–T9 完成；扫描器自身在干净仓库跑出与本文 §1 一致的基线；focus 环分布报告中 `/50` 之外项数为 0（或全部被标注为历史例外）。

---

## 10. 测试用例

| ID | 场景 | 期望 | 类型 |
|----|------|------|------|
| TC-01 | 新 skill frontmatter | 含 name/description，description 含触发词（组件规范/一致性/抽取/Tailwind 规范） | 自审 |
| TC-02 | 在 `src/` 任意位置新写 `text-slate-500` | 审稿门禁第 1 条拦截；扫描器 bannedPalette 命中 | 静态 |
| TC-03 | 某个 className 串第 3 次出现在新文件 | 抽取流程触发，扫描器 n-gram 命中 ≥3；抽取后复跑命中 ≤2 | 静态 |
| TC-04 | 改侧栏后 | `ring-ring` 透明度只有 50；`<nav>` 无 overflow；NavLink 用函数式 children | 自审 |
| TC-05 | 新增 L1 组件 | 无 `useI18n`/store 引用，根目录相对路径、`data-slot` 存在 | 自审 |
| TC-06 | 扫描器在忽略 `components/ui/` 后 | L1 生成层的 shadcn 角色 token 不误报 | 静态 |
| TC-07 | 文档链接 | `AGENTS.md`、两份既有 skill 的相对链接均可打开 | 自审 |
| TC-EDGE-01 | 仓库无任何 UI 改动时 | 扫描器输出基线报告、退出码 0 | 静态 |
| TC-EDGE-02 | `--fail-on=3` 且存在 ≥3 文件命中模式 | 退出码 1，报告列出模式与文件清单 | 静态 |

---

## 11. 实施结果（2026-09-11）

### 11.1 交付物

| 文件 | 行数 / 体积 | 说明 |
|---|---|---|
| `skills/plos-ui-system/SKILL.md` | 70 行 / 5.6 KB | 三法则 + 动手前四问 + 规则快查 + 最高频四条 + 审稿门禁 |
| `skills/plos-ui-system/references/tokens.md` | 131 行 / 8.4 KB | 允许取值表 + 硬编码→token 映射（Top 23）+ 状态色口径 + 基线 + 校验陷阱 |
| `skills/plos-ui-system/references/component-catalog.md` | 86 行 / 7.6 KB | 现有资产清单 + 30 条抽取台账（含证据文件） |
| `skills/plos-ui-system/references/shell-and-layout.md` | 83 行 / 4.9 KB | 布局常量表 + 图标文本行原子 + 两条 CSS 坑 + 浮层写法 |
| `skills/plos-ui-system/references/extraction-playbook.md` | 96 行 / 6.7 KB | 计数口径 + 抽取 5 步 + 命名 + 例外条款 + 审稿清单 |
| `scripts/ui-consistency-scan.mjs` | 393 行 | 零依赖扫描器，`--top/--min-files/--gram/--fail-on/--json`，退出码 0/1/2 |

### 11.2 验收（A1–A8）

| # | 结果 | 证据 |
|---|------|------|
| A1 | ✅ | SKILL.md 70 行（≤180），frontmatter 含 name + description（含中英触发词） |
| A2 | ✅ | 覆盖布局容器 / 图标-文本行 / 徽标 / 按钮 / 浮层 / 空态 / 状态点七类，各类给出 token + 类名 + 抽取阈值 |
| A3 | ✅ | 计数口径「按文件去重、≥3 必抽、第 2 处须声明」+ 落点三层判定表 + 4 条例外条款 |
| A4 | ✅ | 扫描器实跑：157 文件 / 84 条 ≥3 文件重复 / 454 处硬编码色 / focus 环 4 种 / 83 处裸字号；`--fail-on=3` 退出码 1 已验证 |
| A5 | ✅ | `NavSidebar.tsx` `ring-ring/60` → `/50`；复跑分布为 `/25`×3 · `/40`×3 · `/50`×2（`/60` 已清零，残余为存量） |
| A6 | ✅ | `AGENTS.md` 路由表新增一行 + 编码速记新增「一致性」条；`ui-impl-tokens` Cross-references 加交叉引用；与既有 skill 无职责冲突 |
| A7 | ✅ | 10 个相对链接全部可达；无同名职责 skill |
| A8 | ⚠️ | `npm run typecheck` 的 3 条报错全在 `src/features/settings/AIModelsSection.tsx`（`bannerTitle/bannerDesc/bannerTone` 未使用），**该文件不在本任务改动面**（`git diff HEAD` 为空，来自并行会话已提交的 `a230655`）。按仓库纪律不越界修他人文件。绕开该文件单独 `npx vite build` **通过**，本任务零报错。 |

### 11.3 实施中发现并已入册的事实

1. **Tailwind 4 会把 `docs/**/*.md` 正文里的类名编进产物 CSS**（实测：`bg-[#010203]` 写在 md 里即出现在 dist CSS）。这解释了「源码已无 `ring-ring/60`、dist CSS 仍有 4 处」的现象。已写入 `tokens.md` §7，并纠正了「grep 产物 CSS 验证 utility」这一旧做法的适用边界。
2. **`ui-component-system-shadcn-design-2026-09.md` §12.2（D9）** 早有 token 迁移建议，但 `slate-700`/`slate-500` 的档位映射与本次口径不同。已在 `tokens.md` §3 显式标注差异与理由，并回指该文档，避免两份打架的表。
3. **状态色不是待决分歧**：`rules/react.mdc` 与 `ui-impl-tokens` 早已规定「状态色仅 dot/徽标」，存量约 90 处整块状态底色是**违规技术债**。已改写`tokens.md` §4 定性，不留模棱两可空间。
4. **没加 `lint:ui` 到 package.json**：`--fail-on=3` 当前必然失败（84 条），现在接进去只会产出恒红门禁。台账清到阈值以下后再接。

### 11.4 遗留（不在本轮）

- 454 处硬编码色迁移（已出基线台账 + 映射表，按文件分批）
- 84 条重复类串抽取（首批建议：`RowHeader` 与 `EmptyState` 两个新建 + 22 条已有组件替换）
- focus 环残余 `/25`×3 · `/40`×3
- `--fail-on=3` 接 CI：待台账收敛后

---

## 变更记录

| 日期 | 变更 | 作者 |
|------|------|------|
| 2026-09-11 | 初稿（含 D1–D4 决策点 + 全仓漂移基线） | Agent |
| 2026-09-11 | D1/D2/D3/D4 均取推荐项；T1–T9 实施落地，状态转「已实施」，见 §11 | Agent |
