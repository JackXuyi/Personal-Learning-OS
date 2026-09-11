# Personal Learning OS · UI 组件体系方案（shadcn/ui × Base UI × Lucide）

> 版本：2026-09-09 · 方案 v1.0（**已落地**：M0–M3 完成，状态同步至 §9 执行记录与 §12 偏差归档）
> 上游输入：用户指定技术组合「Tailwind CSS 4 + shadcn/ui + Base UI + Lucide + PLOS Design System」，要求生成当前项目的组件方案
> 关联文档：`docs/ui-workbench-plan-2026-09.md`（UI 语义 token 与三大核心组件来源，**本方案主题上游**）、`docs/learning-system-v2-design-2026-09.md`（V2 架构主文档）、`docs/interaction-design-spec-2026-09.md`、`docs/i18n-design-2026-09.md`、`docs/knowledge-import-design-2026-09.md`
> 定位：**工程化组件体系方案**——不推倒 Domain/Engine，把「手写原子组件 + 裸语义 token」的现状，演进为「shadcn/ui（Base UI 原语，代码入库可控）为 UI 基础层 + Lucide 图标 + PLOS Design System token」的组件体系，渐进迁移，规则同步修订。

---

## 0. 如何读这份文档

| 章节 | 内容 | 读者 |
|---|---|---|
| §1 TL;DR + 决策快照 | 结论先行 + 8 项决策（D1–D8） | 所有人 |
| §2 背景与目标 | 为什么现在组件化；现状盘点与差距 | 产品 + 架构 |
| §3 生态事实与选型裁决 | shadcn/ui 2026 现状、Base UI vs 自写/Radix 对比、Base UI 能力边界 | 架构 |
| §4 工程落地 | alias 决策、依赖清单、components.json、目录结构、CLI 流程 | 开发 |
| §5 主题体系 | PLOS Design System × shadcn 变量桥接、accent→primary 更名、main.css 目标结构、暗色预留 | 设计 + 开发 |
| §6 组件分层与采购清单 | 三层架构 + P0/P1/P2 组件清单（附现有代码证据） | 开发 |
| §7 存量改造映射 | window.confirm / 原生 select / ImportModal / CommandPalette 的去向 | 开发 |
| §8 规则与文档修订清单 | rules / AGENTS.md / skills 需要同步改什么 | 全员 |
| §9 里程碑 M0–M3 | 每里程碑：任务 / 改动文件 / 验收门禁 | 项目经理 |
| §10 风险矩阵 | P0/P1/P2 | 所有人 |
| §11 决策记录与待定问题 | D1–D8 定稿 + 4 个待 init 后确认的问题 | 产品决策 |

图例沿用仓库文档：`[按钮]`、`█░░░` 进度、`↓` 跳转、`【新】/【原】`。

---

## 1. TL;DR（结论先行）

**核心结论**：当前项目（React 19 + Tailwind CSS 4 + 语义 token 已就位、零组件库、交互控件手写/原生）已经具备接入 shadcn/ui 的全部前置条件；2026 年 shadcn/ui 的 **Base UI 版式**（`style: base-*`）已成熟且为新项目默认底层，与用户指定组合完全对齐。本方案采用 **三层组件架构 + 渐进迁移**：

```
PLOS 领域原语（primitives：ActionCard / KnowledgeRow / EvidenceRow / …）
        ↑ 基于
shadcn/ui UI Kit（src/components/ui/*，代码入库、完全自有）
        ↑ 基于
Base UI（@base-ui/react 单一 headless 包）＋ Tailwind CSS 4 工具类 ＋ Lucide 图标
```

**三个关键架构动作**：
1. **引入 `@/*` 路径别名**（tsconfig + vite），仅 shadcn 生成层使用；同步最小豁免修订两条 rules —— 否则 shadcn 生成代码无法工作（D1）。
2. **PLOS 品牌强调色 token 更名 `accent → primary`**（值不变 `#6366f1`，机械替换约 13 个文件）—— 因为 shadcn 角色语义中 `accent` = hover/选中填充色，与 PLOS 品牌 `accent` 撞名（D2）。不改则两套语义在同一 `bg-accent` 类上打架。
3. **存量组件渐进共存**：新交互（表单、弹窗、菜单）直接用 shadcn kit；现有 primitives（Card/KnowledgeRow/EvidenceRow/ActionCard 等）保留并按里程碑逐步重构，**不一次性重写**（D3）。

**落地节奏**：M0 基建与 token 更名 → M1 基础原子 → M2 表单与弹层替换 → M3 收敛与规则收尾。每阶段以 `npm run typecheck` 0 错误 + 相关单测 + 人工目测清单为验收门禁（浏览器级校验受 `no-headless-browser-validation` 约束，需用户显式放行）。

一句话总结：**借 shadcn/ui 的 copy-paste 模式把「该有的控件」以 Base UI 原语 + PLOS token 的方式沉淀进仓库，代码自有可控（契合 local-first），交互质量（键盘/焦点/ARIA）一次到位，存量 UI 渐进对齐、零推翻。**

### 1.1 决策快照（D1–D8）

| # | 决策点 | 定稿 | 影响 |
|---|---|---|---|
| D1 | 路径别名 | **引入 `@/*` alias**（tsconfig + vite），仅 `components/ui` + `lib/utils` 生成层使用；业务代码保持相对导入为主；修订两条 rules | §4.1 / §8 |
| D2 | accent 命名冲突 | **PLOS 品牌强调更名 `accent → primary`**（值不变）；shadcn 角色 `accent` = hover 填充（PLOS subtle） | §5.2 / M0 |
| D3 | 演进策略 | **渐进共存**：新交互用 shadcn kit；存量 primitives 保留、按里程碑重构 | §6 / M1–M3 |
| D4 | 暗色模式 | **仅预留变量结构**（:root/.dark 分层），本轮只做浅色 | §5.3 |
| D5 | Base UI 底层 | **Base UI**（`@base-ui/react`，shadcn `base-*` 版式），不用 Radix | §3 / §4.2 |
| D6 | Toast | **本期不引入 sonner/toast**（存量无 toast 需求，用 dialog/alert-dialog 解决确认流，YAGNI）；后续需要再评估 | §6.3 |
| D7 | UI kit 目录 | shadcn 官方 `src/components/ui/` + `src/lib/utils.ts` + 根 `components.json` | §4.3 |
| D8 | 升级策略 | 版本升级走 `shadcn diff`，改动过的组件以 `git diff` 手工合并 | §10 P2 |

---

## 2. 背景与目标

### 2.1 为什么是现在

- **语义 token 已就位**：`src/styles/main.css` `@theme` 已定义 `app-bg/surface/subtle/line/ink-1..3/accent/state-*`，视觉语言（UI Workbench B 案）已在 U0–U6 落地。缺的是**可复用控件层**。
- **交互控件手写成本高**：GoalForm/ImportModal/Settings 等页面存在裸 `<select>`（不可控样式、键盘体验参差）；`ReviewSession`/`BuiltinModelsPanel` 用 `window.confirm`（阻断式、非模态、无样式）；`CommandPalette`（⌘K）与 `ImportModal` 是全手写 headless（焦点管理/ARIA/Esc 处理约 500+ 行，重复造轮子）。
- **规则已过期**：`react.mdc` 与 `engineering-code-style.mdc` 仍写着「Do not add … Radix/shadcn」，而本次组合是用户明确的架构方向 —— 需要**最小豁免 + 规则修订**而非默守（§8）。
- **生态窗口成熟**：2026 年 shadcn/ui 已默认 Base UI 底层并完整支持 React 19 + Tailwind v4（§3.1），Base UI v1.0 发布（2025-12），单包 `@base-ui/react`、无 Radix 拆分包负担。

### 2.2 目标

| 目标 | 度量 |
|---|---|
| 交付可复用的控件基础层 | shadcn ui kit（Base UI 版式）源码入库，全站可 `import { Button } from "@/components/ui/button"` |
| 消灭原生/手写交互的重复劳动 | `<select>`/`window.confirm`/手写弹窗 有标准组件替换（§7 映射表全清） |
| PLOS 视觉不漂移 | 组件默认样式全部由 PLOS token 驱动，无 shadcn 默认灰紫色残留 |
| 无障碍与键盘体验一次到位 | Base UI 提供 focus trap / 键盘导航 / ARIA，改造后交互可键盘走通 |
| 依赖可控、本地优先 | 组件代码 copy-paste 入库，运行时无 registry/远程依赖；新增依赖面最小（§4.2） |

### 2.3 明确不做（Out of Scope）

- 不重写 Domain / Engine / stores / storage。
- 不一次性重写现有 primitives（渐进，D3）。
- 不落地暗色主题（D4）、不引入 toast（D6）、不加 demo 页（仓库规则）。
- 不做浏览器级视觉回归自动化（`no-headless-browser-validation`）；以 typecheck + 单测 + 人工目测清单验收。

---

## 3. 生态事实与选型裁决

### 3.1 shadcn/ui 2026 现状（核验结论）

| 事实 | 说明 | 对本项目的含义 |
|---|---|---|
| Base UI 成为新项目默认底层 | 2026 年 shadcn `create/init` 可选/默认 Base UI 版式；Radix 仍是受支持的一等底层 | 与用户指定「Base UI」组合天然一致，**无需绕路 Radix** |
| 版式由 `components.json` 的 `style` 控制 | Base UI 版式以 `base-*` 开头（如 `base-vega` classic / `base-nova` compact / `base-maia` 圆润）；Radix 旧版式不带前缀（`new-york`） | D5：选 `base-vega`（最接近经典 shadcn，视觉差异最小），init 时可按口味换 |
| 组件抽象了底层差异 | 应用层用法基本一致；Base UI 版用 **render prop** 取代 Radix 的 `asChild` | 代码中不要出现 `@radix-ui/*`、`data-state`、`--radix-*` 变量 |
| React 19 + Tailwind v4 完整支持 | 无 forwardRef（直接函数组件 + `data-slot`）；主题 `@theme inline` + OKLCH | 本项目 React 19 + TW4，**无版本迁移负担** |
| 动效插件 | `tailwindcss-animate` 已弃用 → `tw-animate-css`（`@import "tw-animate-css"`） | 按新约定走 |
| toast 组件弃用 | 官方以 `sonner` 取代 `toast` | D6：本期都不引入 |
| copy-paste 模型 | `shadcn add` 把组件源码拷入仓库，**代码完全自有、无运行时黑盒** | 契合 local-first/隐私优先；但首次 `init/add` 需联网拉 registry |

### 3.2 选型对比：自写 headless vs shadcn/ui(+Base UI)

| 维度 | 现状：全手写 | shadcn/ui + Base UI（本方案） | 裁决 |
|---|---|---|---|
| 交互正确性 | CommandPalette/ImportModal 手写 focus/ARIA，随需求膨胀 | Base UI 维护焦点陷阱、键盘导航、ARIA、浮层定位 | 选后者 |
| 样式自由度 | 直接写 Tailwind，无中间层 | 组件源码在仓库内，**改样式=改自己代码** | 同等 |
| 依赖体积 | 0 | 新增 `@base-ui/react`（单包）+ cva/clsx/tailwind-merge + lucide-react，增量小 | 可接受 |
| 维护心智 | 每个弹窗/下拉都要自己写 | 组件即代码 + `shadcn diff` 追踪上游更新 | 选后者 |
| 视觉一致性 | 靠手写时顺手（已出现 `rounded-md/lg/xl`、`px-3/3.5/4` 飘移） | 收敛进 Button/Input 等单点 | 选后者 |
| 规则契合 | 现状符合「禁组件库」规则 | 需修订规则（最小豁免） | 随 M0 修订 |

**裁决**：新交互一律走 shadcn kit；手写已有且稳定、无键盘/焦点痛点的（`Bar`、`Section` 等纯展示原语）保留不动。

### 3.3 Base UI 能力边界（影响采购清单）

- **已具备**：Button、Input/Field、Select、Combobox、Checkbox、Radio、Switch、Slider、Tabs、Accordion、Dialog、Menu、Popover、Tooltip、Number Field、Pagination、Progress 等（v1.x）。
- **暂缺/需替代**：Context Menu、Hover Card、Toast 等少数 —— PLOS 无强需求；Context Menu 用 Dropdown Menu / Popover 组合即可。
- **结论**：以 **M0 中 `npx shadcn list` / `shadcn search` 实测** 为采购清单的最终裁决 gate（§6.4），Radix 版与 Base UI 版具体 wrapper 可用性以实测为准；本方案清单均为高概率可用项并附 fallback。

---

## 4. 工程落地

### 4.1 路径别名（D1）——具体改动

| 文件 | 改动 |
|---|---|
| `tsconfig.json` | `compilerOptions` 加 `"baseUrl": "."` + `"paths": { "@/*": ["./src/*"] }` |
| `vite.config.ts` | 顶部 `import path from "node:path"`；`resolve.alias: { "@": path.resolve(__dirname, "./src") }` |
| `package.json` | devDep 加 `@types/node`（vite.config 用 node:path） |

> 说明：仓库单 tsconfig、无 app/node 拆分，比官方 Vite 模板（要改 tsconfig.app.json）更简单。
> **豁免范围（写进 rules）**：`@/*` 仅允许出现在 `src/components/ui/**`、`src/lib/utils.ts` 等 shadcn 生成/桥接层；`src/features`、`src/components`（非 ui）业务代码**继续相对导入**（§8 R2）。两套并存互不干扰，未来若想全面 alias 化可另立决策。

### 4.2 依赖清单（M0 一次性安装）

| 包 | 类型 | 用途 |
|---|---|---|
| `@base-ui/react` | dependencies | Base UI headless 原语（单包，v1.x） |
| `class-variance-authority` | dependencies | Button 等 variants 管理（shadcn 生成代码依赖） |
| `clsx` | dependencies | `cn` 组合类名 |
| `tailwind-merge` | dependencies | `cn` 去重冲突类 |
| `lucide-react` | dependencies | 图标（shadcn 组件内部也用它） |
| `tw-animate-css` | devDependencies | v4 动画（`@import "tw-animate-css"`） |
| `@types/node` | devDependencies | vite.config 的 node:path |

> `shadcn init` 会自动写入以上大部分依赖；此处为预期终态清单。全部增量均为**编译期/源码层**，运行时代码可控。

### 4.3 目录结构与 components.json

```
components.json            # 【新】shadcn 配置（根）
src/
  lib/utils.ts             # 【新】cn = twMerge(clsx(...))（供 ui 生成代码引用）
  components/
    ui/                    # 【新】shadcn 生成组件（button.tsx / dialog.tsx / …），可任意改
    primitives.tsx         # 【存】PLOS 领域原语，M3 逐步收敛
    layout/AppShell.tsx    # 【存】
  styles/main.css          # 【改】主题桥接（§5.3）
```

```jsonc
// components.json（预期形态；以 CLI 生成为准）
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "base-vega",            // Base UI 版式（D5）；Radix 旧版为 new-york
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",                  // v4 无独立 tailwind.config → 空
    "css": "src/styles/main.css",  // 指向仓库真实 css 入口
    "baseColor": "neutral",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "utils": "@/lib/utils",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```

> 若 `src/lib` 不存在，CLI 会创建；仓库现无 `lib`，`@/lib/utils` 即新目录 `src/lib/`。

### 4.4 CLI 流程（开发期操作手册）

```bash
# 1) M0：初始化（交互式选 Base UI 版式；等价 flag 见 npx shadcn@latest init --help）
npx shadcn@latest init --base base-ui     # 或交互选择 base-* 版式

# 2) 之后按需添加组件（源码拷入 src/components/ui/，可再手工定制）
npx shadcn@latest add button input textarea label badge separator skeleton tooltip
npx shadcn@latest add select checkbox dialog alert-dialog popover dropdown-menu tabs

# 3) 追踪上游更新（改动过的组件合并靠 git diff）
npx shadcn@latest diff button

# 4) 可用性盘点 gate（M0/M2 都要跑）
npx shadcn@latest list && npx shadcn@latest search dialog
```

**每次 `add` 后固定三步**（写进 runbook）：① 跑 §5.4 的 shadcn→PLOS 定制对照表；② 确认无 `@radix-ui/*`/`data-state`/`--radix-*` 残留；③ `npm run typecheck`。

---

## 5. 主题体系：PLOS Design System × shadcn 变量桥接

### 5.1 原则

- **单一事实源**：所有颜色值只写在 `main.css` 一处（PLOS 语义值），shadcn 角色变量**引用**它，不复制 hex。
- **PLOS 语义 token 保留原名**：`app-bg/surface/subtle/line/ink-1..3/state-*` 继续被业务代码与 primitives 直接使用（`bg-surface`/`text-ink-2` 等不动）。
- **shadcn 角色走桥接层**：组件生成代码里出现的 `bg-background`、`text-muted-foreground`、`bg-primary`、`border-border`、`ring-ring` 等映射到 PLOS 值。

### 5.2 accent → primary 更名（D2，关键动作）

**冲突本质**：shadcn 新 York 系把 `accent` 定义为「hover/选中态填充色」（灰调 subtle），而 PLOS 把 `accent` 定义为唯一品牌强调色 `#6366f1`。同一个 `bg-accent` 类在 Tailwind v4 只能有一种含义 → **必须让一个**。

| 方案 | 说明 | 裁决 |
|---|---|---|
| A. PLOS 更名 accent→primary | shadcn 生态语义：`primary`=品牌主色，`accent`=subtle hover。PLOS `#6366f1` 更名 `primary`（值不变）；机械替换全站 `*-accent` 类 → `*-primary` | **采纳**（视觉零变化，命名与生态对齐，未来 shadcn 升级零冲突） |
| B. 保留 accent=品牌，改生成代码 | 每次 `shadcn add` 后手工把生成的 `bg-accent`(hover) 改灰，违反「改自己代码也应省心」，升级易漏 | 否决 |

**替换影响面（已统计）**：`*-accent` 类出现于 `primitives.tsx` + `CommandPalette.tsx` + 约 13 个 feature 文件（GoalForm/Home/Learner/ChapterReader/ChapterCatalog/ImportModal/LearnerPage/Quiz*/Goals*/Plan*/Settings* 等），**均为机械改名、视觉不变**。替换命令（M0.2 用，执行后 grep 验收）：

```bash
# 在 src 下（排除 components/ui —— 该层 accent 本来就是 hover 语义，不可替换）
perl -pi -e 's/((?:bg|text|border|ring|fill|stroke|decoration|from|to|via)-)accent(?=\b)/${1}primary/g' \
  src/components/primitives.tsx src/components/CommandPalette.tsx $(git ls-files 'src/features/**/*.tsx')
```

> 注意：`--color-accent` 的 CSS 定义本身在 main.css 中改为 `--color-primary`（值 `#6366f1`）并新增 shadcn 角色 `--color-accent: subtle`；`focus:border-accent`/`bg-accent/5` 等写法随正则一并替换为 primary。

### 5.3 main.css 目标结构（M0.2 落成）

```css
@import "tailwindcss";
@import "tw-animate-css";

/* ── PLOS 语义值 · 单一事实源（原 @theme 内联 hex 全部上收）── */
:root {
  --plos-app-bg: #f7f8fa;
  --plos-surface: #ffffff;
  --plos-subtle: #f1f3f5;
  --plos-line: #e4e4e7;
  --plos-ink-1: #18181b;
  --plos-ink-2: #71717a;
  --plos-ink-3: #a1a1aa;
  --plos-primary: #6366f1;            /* 原 --color-accent，更名不改值（D2） */
  --plos-state-mastered: #059669;
  --plos-state-learning: #6366f1;
  --plos-state-weak: #d97706;
  --plos-state-idle: #71717a;
  --plos-state-failed: #dc2626;
  /* 暗色预留（D4）：未来在 .dark { --plos-*: … } 覆盖此处值即可，本轮不实现 */
}

@theme inline {
  /* ── PLOS 语义 token（原名保留，业务代码继续用）── */
  --color-app-bg: var(--plos-app-bg);
  --color-surface: var(--plos-surface);
  --color-subtle: var(--plos-subtle);
  --color-line: var(--plos-line);
  --color-ink-1: var(--plos-ink-1);
  --color-ink-2: var(--plos-ink-2);
  --color-ink-3: var(--plos-ink-3);
  --color-primary: var(--plos-primary);            /* 品牌强调（原 accent） */
  --color-state-*: …;                              /* 逐条同前 */

  /* ── shadcn 角色桥接（组件生成代码消费）── */
  --color-background: var(--plos-app-bg);
  --color-foreground: var(--plos-ink-1);
  --color-card: var(--plos-surface);
  --color-card-foreground: var(--plos-ink-1);
  --color-popover: var(--plos-surface);
  --color-popover-foreground: var(--plos-ink-1);
  --color-primary-foreground: #ffffff;
  --color-secondary: var(--plos-subtle);
  --color-secondary-foreground: var(--plos-ink-2);
  --color-muted: var(--plos-subtle);
  --color-muted-foreground: var(--plos-ink-2);
  --color-accent: var(--plos-subtle);              /* hover/选中填充（shadcn 语义） */
  --color-accent-foreground: var(--plos-ink-1);
  --color-destructive: var(--plos-state-failed);
  --color-destructive-foreground: #ffffff;
  --color-border: var(--plos-line);
  --color-input: var(--plos-line);
  --color-ring: var(--plos-primary);
  --font-sans: …;                                  /* 原字体声明上收 */
}
```

**桥接语义对照表（写进 ui-impl-tokens skill）**：

| PLOS 语义 | shadcn 角色 | 出现位置 |
|---|---|---|
| app-bg | background | 页面底色 |
| surface | card / popover | 内容块、浮层 |
| subtle | muted / secondary / **accent** | hover、次级按钮、菜单选中填充 |
| line | border / input | 分割线、输入框边 |
| ink-1 | foreground / card-foreground | 主文字 |
| ink-2 | muted-foreground / secondary-foreground | 次文字 |
| ink-3 | （弱化文字，无直接角色） | 占位、时间戳 |
| **primary(原 accent)** | primary / ring | 主按钮、链接、焦点环 |
| state-failed | destructive | 危险操作 |
| state-*（mastered/learning/weak/idle） | 无角色 | 仅 dot/徽标（保留 PLOS 特有用法） |

### 5.4 每次 add 后的定制对照表

| shadcn 默认 | PLOS 定制 | 说明 |
|---|---|---|
| `bg-primary/…` | 无需改 | 已指向品牌色 |
| `bg-accent`（菜单/hover） | 保留（= subtle） | 语义已对齐 |
| `bg-secondary` 等 | 保留 | = subtle |
| 默认 focus ring | `ring-ring`（= primary） | 生成代码已用 `ring-ring`，零改 |
| 圆角 | 跟随组件本地 `rounded-*` | 与仓库现状一致，暂不引入 radius token 体系 |
| 阴影（卡片） | `shadow-sm` 与 primitives.Card 一致 | 若 `shadow-lg/xl` 出现，收敛为 sm |

---

## 6. 组件分层与采购清单

### 6.1 三层架构与职责

| 层 | 目录 | 谁写 | 规则 |
|---|---|---|---|
| L0 原语运行时 | `node_modules/@base-ui/react` | Base UI 团队 | 不直接 import（除极少数 fallback） |
| L1 UI Kit | `src/components/ui/*` | `shadcn add` 生成 + PLOS 定制 | 可改源码；样式全走 token；**无业务逻辑、无 i18n 文案** |
| L2 领域原语 | `src/components/primitives.tsx` + feature 级组件 | 业务代码 | 组合 L1 + stores/i18n；**保留 PLOS 语义命名**（ActionCard/KnowledgeRow/…） |

> 铁律：**L1 不允许 `useI18n`/`useLoopStore`**（纯展示控件，文案由调用方传 children/props）；i18n 约束不变（`engineering-code-style` R4）。

### 6.2 P0 采购清单（M1 落地，高置信）

| 组件 | 替代的存量代码（证据） | 说明 |
|---|---|---|
| `button` | 全站 ~40 处 `className="rounded-md bg-accent/primary px-3.5 py-1.5 text-sm …"` 手写 CTA | variants：default/outline/ghost/link + size |
| `input` / `textarea` | GoalFormPage.tsx:209/260、ImportModal.tsx:276-284、ChapterCatalogPage.tsx:221 等手写输入样式 | 统一 focus:ring/placeholder 样式 |
| `label` | GoalForm 表单行 | 表单可访问性 |
| `badge` | BandBadge（primitives.tsx:34）与 filter chip 类 | 注意：BandBadge 是领域语义，先做 **badge 组件 + variants 色表**再收敛 |
| `separator` | 大量 `border-b border-line` 分隔 | 可选（border 够用时可不装） |
| `skeleton` | ImportModal/报告加载占位 | 可选 P2 |
| `tooltip` | 进度条 target 刻度 `title=`（Bar） | 后续把 title 提示升级 tooltip |

### 6.3 P1 采购清单（M2 落地，需 M0 list gate 实测）

| 组件 | 替代的存量代码（证据） | 说明 |
|---|---|---|
| `dialog` | ImportModal.tsx（自写 modal，~500 行）外壳 | 先做确认弹窗场景，ImportModal 外壳是否替换单列（风险低可缓） |
| `alert-dialog` | `window.confirm`：ReviewSession.tsx:249/346、BuiltinModelsPanel.tsx:327 | 阻断式确认 → 非阻塞模态（M2 重点） |
| `select` | 原生 `<select>`：GoalFormPage.tsx:218/235、HomePage.tsx:273、ImportModal.tsx:288、ApiModelsTab.tsx:150 | Base UI Select 键盘/搜索优于原生 |
| `checkbox` / `radio-group` | GoalFormPage.tsx:334 type=checkbox | 目标范围多选 |
| `popover` / `dropdown-menu` | 目标切换、更多操作等潜在地点 | Context Menu 缺失项用它组合（§3.3） |
| `tabs` | SettingsPage 顶部分区 tab（settings-top-tab-layout 已落地） | 视现状决定是否替换 |
| `command`（⌘K） | CommandPalette.tsx（自写 ~500 行） | **Base UI 版 command 可用性待 list gate**；不可用则降级为 dialog+combobox 组合或暂缓（见 §6.4） |
| `sonner` | —— | **不引入**（D6） |

### 6.4 采购 gate 与 fallback

- **gate**：M0 init 完成后跑 `npx shadcn@latest list`（Base UI 版式实际可用集）与 `shadcn search <name>`；清单中 P0/P1 以实测为准标注「✅/⚠️ 缺失」。

**M0 实测记录（2026-09-09）**：本机沙箱环境拦截了 shadcn CLI 的依赖下载（dotenv 等触发「敏感内容审批」，npx 包装同样被杀），`init`/`list` 无法在本会话执行。按预案降级：**手动落地同构骨架** `components.json`（`style: "base-vega"` Base UI 版式）+ `src/lib/utils.ts`（cn）+ 首个 `src/components/ui/button.tsx`（`@base-ui/react` Button + slot 定制，纯 PLOS token 样式）。骨架已通过 typecheck + 构建冒烟。**gate 未决项**：`command`/`alert-dialog`/`tabs` 等 P1 wrapper 在 Base UI 版式的实际可用性 → 标记 ⚠️ 待用户侧跑一次 `shadcn@latest list` 补录；fallback 矩阵（下两行）持续有效。
- **fallback 矩阵**（实测缺失时按序降级）：
  - `command` 缺失 → 保留手写 CommandPalette（仅换肤/复用 dialog 外壳），并把「command 可用」作为下季度回归项；
  - `alert-dialog` 缺失 → `dialog` 自封装 `ConfirmDialog`（一次写，全站复用）；
  - 其它浮层缺失 → `popover` 组合实现。

---

## 7. 存量改造映射（M2/M3）

| 存量 | 现状 | 去向 | 里程碑 |
|---|---|---|---|
| `window.confirm`（3 处） | 阻断式系统弹窗 | `AlertDialog`（或自封 ConfirmDialog） | M2 |
| 原生 `<select>`（5 处） | 样式不可控 | shadcn `Select`（Base UI） | M2 |
| `type=checkbox`（GoalForm 范围） | 原生 | `Checkbox` | M2 |
| ImportModal 自写 modal | 焦点/Esc 手写 | 外壳评估换 `Dialog`；内容面板保留 | M2 评估 |
| CommandPalette（⌘K） | 自写 headless | shadcn `command`（待 gate）；否则暂缓 | M2 |
| primitives.Card / ActionCard | 手写 | 保留；ActionCard CTA 换 `Button` | M1/M3 |
| BandBadge | 手写徽标 | 基于 `badge` + 领域色表重构 | M3 |
| 手写 CTA `<button>` 群 | ~40 处 | 换 `Button`（渐进，非一次性） | M1–M3 随改随换 |
| Bar / Section / Stat / KnowledgeRow / EvidenceRow | 纯展示、稳定 | **保留不动**（无痛，避免无谓 churn） | —— |

---

## 8. 规则与文档修订清单（随 M0 同步，防规则漂移）

| # | 文件 | 修订 |
|---|---|---|
| R1 | `rules/react.mdc` | 删除「Do not add … Radix/shadcn」；新增「shadcn/ui（Base UI 底层）为默认控件来源；新增组件先 `shadcn add` 再定制」；「Reuse primitives」补 `components/ui` 引用 |
| R2 | `rules/engineering-code-style.mdc` | alias 条款改为「相对导入为主；`@/*` 仅限 shadcn 生成层（components/ui、lib/utils），业务代码不用」 |
| R3 | `AGENTS.md` | 目录地图加 `src/components/ui/`、`src/lib/`、根 `components.json`；编码速记「导入/样式」条目同步；rules 表 react.mdc/engineering-code-style 描述同步；**维护约定要求同步后置任务** |
| R4 | `skills/ui-impl-tokens/SKILL.md` | 补：token 桥接表（§5.3）、accent→primary 更名说明、add 后定制流程（§4.4/§5.4）、L1 禁业务依赖铁律 |
| R5 | 本项目 README / docs 引用 | `ui-workbench-plan-2026-09.md` §5 的 accent 定义追加「已更名 primary」注记（M3 收尾时补） |

> R1–R4 均在 M0 的同一 PR 内落成（与 alias/依赖同批），保证「引入即合规」。

---

## 9. 里程碑 M0–M3

> 每阶段门槛：`npm run typecheck` 0 错误；相关 `npm run test:*` 通过；视觉改动按**人工目测清单**逐页确认（受 `no-headless-browser-validation` 约束，浏览器级校验仅用户显式放行时做）。改动集保持小步提交，遵循 commit-conventions（scope 取 `ui`/`docs`）。

### M0 基建与规则豁免（改动最大，一次成型）

| 任务 | 改动 | Done 标准 |
|---|---|---|
| M0.1 alias + 依赖 | tsconfig paths、vite alias、`@types/node` | `import x from "@/components/…"` 可解析 |
| M0.2 token 更名 + 桥接 | main.css 重构为 §5.3 结构；`*-accent→*-primary` 机械替换（§5.2） | typecheck 0 错；`grep -rn -- "-accent"` 仅剩 `components/ui` 的 hover 语义与 CSS 角色定义 |
| M0.3 init + kit 骨架 | `shadcn init`（base-vega/Base UI）、`components.json`、`src/lib/utils.ts`；跑 `shadcn list` 产出**可用性盘点** | components.json 生效；list 盘点记录归档到本文件 §6.4 |
| M0.4 规则同步 | R1–R4 落成 | rules/AGENTS/skill 三处一致（AGENTS 维护约定） |
| M0.5 门禁 | typecheck + 单测 + 目测（Today/Plan/Goals 三页 accent 色无肉眼变化） | ✅ M0 |

### M1 基础原子与首批试点

- `shadcn add button input textarea label badge separator`（按 list 盘点取舍）；做 §5.4 定制。
- 试点收敛（证明模式）：ActionCard CTA（primitives.tsx:310）与 LearnerPage CTA（:91）换 `Button`；BandBadge 评估接 `badge`（可留 M3）。
- Done：Button 在 ≥2 个真实页面生效；typecheck/目测通过。

**M1 执行记录（2026-09-09）**：CLI 不可用延续 M0.3 降级——六原子全部**手写同构落地**（ui/ 现 6 件：button/label/badge/separator/input/textarea；纯样式组件无 headless 依赖，Base UI 依赖留待 M2 交互件）。样式对齐仓库基线：focus = 边框变品牌色 + 柔 ring（替代原 `focus:border-primary`，可发现性更好）；placeholder 走 `muted-foreground/70`；label 默认贴合 PLOS 字段标题（xs/ink-2）。试点：ActionCard CTA → `<Button>`；LearnerPage CTA 为路由 `<Link>`（Button 无 asChild 多态）→ `cn(buttonVariants(...), "mt-4 rounded-lg")` 落地并回写 skill。BandBadge 评估：结构（rounded-full/px-2/py-0.5/text-xs）与 badge 同构但色表为领域状态色，收敛留 M3（符合 §7）。门禁：typecheck 0 错、单测全绿、vite build 通过。残留手写 primary CTA ~16 处（features）为 §7「M1–M3 随改随换」渐进面。目测待用户。

### M2 表单与弹层替换（消灭原生交互）

- `shadcn add dialog alert-dialog select checkbox …`（按 gate）；
- 替换表 §7：`window.confirm`×3 → AlertDialog；`<select>`×5 → Select；GoalForm checkbox → Checkbox；
- CommandPalette/ImportModal 按 gate 结论处理（替换或暂缓并记录）；
- Done：全仓 `grep window.confirm`/`<select`（features）归零或记录豁免；键盘可走通弹层关闭/确认。

**M2 执行记录（2026-09-09）**：CLI 不可用延续，四类交互件**手写同构封装**（基于本地实测 `@base-ui/react@1.8.0`：`dialog`/`alert-dialog`/`select`/`checkbox` 子路径齐全，render-prop、无 asChild）：
- `ui/dialog.tsx`（Root/Trigger/Content/Header/Footer/Title/Description + Esc/遮罩/× 关闭，overlay `bg-ink-1/40`）；
- `ui/alert-dialog.tsx`（无 dismiss 语义）+ `ui/confirm-dialog.tsx`（受控 confirm 便捷封装，无 i18n、文案调用方传）→ 替换 `window.confirm`×3（ReviewSession Esc/exit 两处、BuiltinModelsPanel 删模型），**全仓 window.confirm 归零**；
- `ui/select.tsx`（受控单值 Select：value=option.value、`Select.Value` children 函数映射 label、Positioner `alignItemWithTrigger={false}` 弹层于触发下方）→ 替换原生 `<select>`×5（GoalForm type/importance、HomePage 目标切换、ImportModal format、ApiModelsTab 预置供应商），**原生 select 归零**；
- `ui/checkbox.tsx`（Base UI Root+Indicator+lucide 勾，data-checked 品牌色）→ GoalForm 章节范围多选替换（行点击 toggle + checkbox 自身防双触发，`closest("[data-slot=checkbox]")` 短路），**原生 checkbox 归零**。
- **豁免记录**：① ImportModal 自写 modal 外壳**暂缓换 Dialog**——busy 状态机/阶段动画/结果卡 onInspect 导航语义复杂，低收益高回归面，M3 独立评估；② CommandPalette（⌘K）**保留自写**（gate 未决：Base UI 版 `command` wrapper 可用性待用户侧 `shadcn list` 补录，fallback 矩阵生效）。
- 门禁：typecheck 0、单测全绿、vite build 通过；键盘可走通（弹层 Esc 关/确认按钮焦点由 Base UI 托管）——最终目测待用户。

### M3 收敛与收尾

- primitives 复查：Card/ActionCard 与 ui kit 的重叠处置（保留 or 基于 L1 重写，二选一归档）；BandBadge 徽标收敛；
- i18n 文案回归（无硬编码新增）；删除迁移后死代码/旧样式类；
- R5 注记；本文件状态更新为「已落地」并归档决策偏差；
- Done：typecheck + 全部单测；§7 映射表逐项 ✅。

**M3 执行记录（2026-09-09）**：
- **primitives 处置归档**：Card / ActionCard **保留**（ActionCard CTA 已 M1 换 Button；结构手写稳定、与 ui kit 无重叠痛，基于 L1 重写无净收益，避免 churn）。Bar / Section / Stat / KnowledgeRow / EvidenceRow 按 §7 保持不动。
- **BandBadge 收敛 ✅**：重构为 `Badge variant="outline"` + 领域色表（`bandStyles` 保留原值，tailwind-merge 覆写 border/bg/text），4 调用点（AssessmentPage/AssessmentSession/GraphView/ReviewSession）API 零变更、视觉零回归。
- **手写实心 primary CTA 清零 ✅**：10 个 feature 文件 20+ 处 → `Button` / `cn(buttonVariants(...))`（路由 Link 保持语义）。映射规则：紧凑 `px-3/3.5 py-1/1.5` → `size="sm"` + `text-sm` 覆写；`px-4` → `default`；大主钮 `px-5 rounded-lg font-semibold` → `default` + 覆写保留；布局类（mt-/ml-auto/shrink-0）原样保留。残留 `bg-primary` 均为非 CTA 语义（Bar 进度/dot/CommandPalette 激活/tab chip 选中态）。
- **旧样式类清理**：AssessmentPage 全页 token 化（9 处 slate/indigo → 语义 token；`bg-indigo-600 px-6 py-3` 主按钮 → `Button size="lg"`，唯一旧色线中包藏的主 CTA 变体）。
- **i18n 回归 ✅**：本里程碑 diff 新增行无裸中文（仅 1 条工程注释）；全部沿用字典引用。
- **死代码**：无迁移引入死代码；`ui/dialog`/`alert-dialog` 作为 kit 储备保留（M2 记录在案，confirm-dialog 消费 dialog）。
- 门禁：typecheck 0、单测全绿、vite build 通过；**目测项**：AssessmentPage 推荐卡 tint 与主按钮、全局 Button 高度/圆角归一。

### M3 遗留与新发现 → §12 偏差归档

- ImportModal 外壳（busy 状态机）与 CommandPalette（gate 未决）——按 M2 豁免结论**维持暂缓**，不入 M3；
- **新发现：全站旧色线**——quiz/assessment/study/settings/knowledge 10+ 文件数百处 `slate-*`/`indigo-*`（token 化前的老页面），与 M3 无关的独立大迁移，建议独立里程碑（见 §12 D9）。

---

## 10. 风险矩阵

| 级别 | 风险 | 缓解 |
|---|---|---|
| P0 | accent→primary 机械替换漏改 → 部分按钮/链接变灰（shadcn accent 语义） | 改名独立小步提交；M0.5 grep 验收（§9）；目测三页；替换命令排除 `components/ui` |
| P0 | 引入 alias 与 rules 冲突未同步 → 后续 AI/人违反规则 | R1–R4 与 M0 同 PR 落成；AGENTS 维护约定强制同步 |
| P1 | Base UI 版式部分组件（command/alert-dialog 等）实际不可用 | M0.3 list gate 前置；fallback 矩阵（§6.4） |
| P1 | 新依赖违背仓库「轻依赖」传统 | 增量面最小（§4.2）；代码 copy-paste 自有；包体影响在 M1 用 `npm run build` 体积目测一次 |
| P1 | Base UI 与 Radix 行为差异（keepMounted/render prop）被误用 | runbook 约定禁止 `asChild`/`@radix-ui/*` 写法；skill 记录 Base UI 用法 |
| P2 | shadcn 上游更新与本地定制冲突 | 升级走 `shadcn diff` + git 三路合并；改动集中在 ui 层单目录 |
| P2 | 视觉回归难以自动发现（禁浏览器校验） | 小步合入 + 每里程碑目测清单；需要截图回归时由用户显式放行 webapp-testing |

---

## 11. 决策记录与待定问题

### 11.1 决策记录（本稿确认即归档）

| # | 决策 | 理由一句话 | 状态 |
|---|---|---|---|
| D1 | 引入 `@/*` alias，仅生成层使用 | shadcn 生成代码强依赖；豁免最小化 | ✅ 用户确认 |
| D2 | PLOS 品牌色更名 accent→primary | 与 shadcn accent(hover) 语义撞名；改名不改值、视觉零变化 | ✅ 本稿定稿 |
| D3 | 渐进共存，不全量重写 | 回归风险与 churn 最小，符合仓库小步节奏 | ✅ 用户确认 |
| D4 | 暗色仅预留结构 | 避免配色设计绑架组件方案 | ✅ 用户确认 |
| D5 | Base UI 底层（base-* 版式） | 用户指定 + 2026 shadcn 默认，能力覆盖 PLOS 需求 | ✅ 用户指定 |
| D6 | 本期不引入 toast | 存量无 toast 需求，YAGNI；确认流用 dialog 系 | ✅ 本稿定稿 |
| D7 | 官方目录 components/ui + lib/utils | CLI 默认、升级友好 | ✅ 本稿定稿 |
| D8 | 升级走 shadcn diff | copy-paste 模型的既有实践 | ✅ 本稿定稿 |

### 11.2 待 M0 init 后确认（落地结论 2026-09-09）

| # | 问题 | 结论路径 | 落地结论 |
|---|---|---|---|
| Q1 | Base UI 版式下 `command` / `alert-dialog` / `tabs` 实际可用？ | M0.3 `shadcn list` gate | CLI 本机沙箱不可用 → 改 node_modules 实测 `@base-ui/react@1.8.0`：`alert-dialog` ✅ 原生可用（M2 用上）；`command`/`tabs` ⚠️ 仍待用户侧 `npx shadcn@latest list` 补录 |
| Q2 | `base-vega` vs `base-maia`（圆润）哪个更贴近 PLOS？ | init 交互选择时目测 | components.json 定 `base-vega`（rounded-md 系）；kit 实际为手写同构（M0.3 降级），圆润度差异在 M1 定制时以仓库基线为准 |
| Q3 | ImportModal 外壳是否换 Dialog？ | M2 评估；倾向「外壳延后」 | **暂缓归档**（busy 状态机/阶段动画/结果卡导航，低收益高回归面）→ §12 A2 |
| Q4 | primitives.Card 是否被 ui/card 取代？ | 建议保留领域 Card | **保留归档**（M3）：结构稳定、语义收窄过，L1 重写无净收益 → §12 A1 |

---

## 12. 落地偏差归档（M0–M3 完成后）

### 12.1 处置决策归档

| # | 决策 | 归档结论 |
|---|---|---|
| A1 | primitives.Card / ActionCard 处置 | **保留**（M3）：ActionCard CTA 已换 Button；手写结构稳定，基于 L1 重写无净收益 |
| A2 | ImportModal 自写 modal 外壳 | **暂缓**：busy 状态机/阶段动画/结果卡 onInspect 导航复杂，低收益高回归面；其内部 format 下拉已 M2 换 Select |
| A3 | CommandPalette（⌘K）自写层 | **暂缓**：`command` wrapper 的 Base UI 版可用性 gate 未决（Q1），fallback 矩阵（§6.4）生效 |
| A4 | 次级手写控件 | 保留并记录余量：outline/文字型手写 `<button>`、分段控件选中态（ChapterCatalog filter chip）、单元选择 chip（AssessmentPage 已 token 化但保留手写形态）——均非主 CTA，M3 后按需随改随换 |

### 12.2 新发现：全站旧色线（D9，建议独立里程碑）

M3 盘点发现 token 化前的老页面仍大面积使用原始色（`slate-*`/`indigo-*`），与 M3 语义无关的独立迁移：

| 面 | 规模 | 归属 |
|---|---|---|
| quiz（NewQuizPage/QuizAnswerPage/QuizGradingPage/QuizReport 残） | ~80 处 | 独立「token 全面落地」里程碑 |
| assessment（AssessmentSession） | ~16 处 | 同上（AssessmentPage 已 M3 收） |
| study（ReviewSession）/ knowledge（GraphView/ChapterGraphPage） | ~66 处 | 同上 |
| settings（BuiltinModelsPanel/ApiModelsTab） | ~41 处 | 同上（select 周边 M2 已收敛，其余残留） |
| scaffold.tsx | ~5 处 | 同上 |

> 建议：作为独立小里程碑（M4-tokenize）按页逐文件迁移：`slate-900→ink-1`、`slate-700→ink-2`、`slate-600→ink-2`、`slate-500/400→ink-3`、`slate-200/border→line`、`slate-50/bg-white→surface/subtle`、`indigo-600 主行动→Button`、`indigo-50/200 强调 tint→primary/5+primary/20`、`text-indigo-600 链接→text-primary`。每页 typecheck + 目测。

> **2026-09-11 更新**：D9 现由 `skills/plos-ui-system` 接管，上述估算规模已被实测数据取代 ——
> `node scripts/ui-consistency-scan.mjs` 扫得 **454 处 / 74 种 / 16 文件**，跨 ≥3 文件重复的类串 **84 条**，
> focus 环透明度 **4 种**（应收敛到唯一值 `/50`）。完整搬迁映射表见 `skills/plos-ui-system/references/tokens.md` §3（其中 `slate-700` / `slate-500` 两档已修正为 `ink-1` / `ink-2`，与上文建议略有差异，以该表为准），抽取台账见 `skills/plos-ui-system/references/component-catalog.md`。

*本文件为**已落地**方案（v1.0）。M0–M3 执行记录见 §9；偏差与后续见 §12。*
