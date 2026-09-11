# Token 规范：唯一允许取值

> 单一事实源：`src/styles/main.css` 的 `:root`（`--plos-*`）+ `@theme inline`（Tailwind 颜色角色桥接）。
> 任何新颜色值只能加在那里，业务代码里出现 `#rrggbb` 一律退回。

## 1. 允许取值表

| 类别 | 允许 | 禁止 |
|---|---|---|
| 底色 | `bg-app-bg`（窗外留白）· `bg-surface`（主内容面）· `bg-subtle`（hover / 次级块） | 任意 `slate-*` / `gray-*` / `zinc-*` / `neutral-*` / `stone-*` |
| 文字 | `text-ink-1`（主）· `text-ink-2`（次）· `text-ink-3`（弱 / 占位） | `text-slate-400/500/600/700/800/900` |
| 边框 | `border-line` | `border-slate-200` |
| 品牌强调 | `bg-primary` · `text-primary` · `ring-ring` · `hover:bg-primary/90`（降低亮度用透明度，**不换色号**） | `bg-indigo-600/700` · `text-indigo-600/700` |
| 状态色 | `state-mastered/learning/weak/idle/failed`，**仅 dot / 徽标** | 状态色染整块背景（见 §4 未决项） |
| 圆角 | `rounded-md`（8px：控件 / 导航行 / 卡片）· `rounded-lg`（12px：容器块）· `rounded-full`（仅 dot / 头像） | ≤ `rounded-sm`、≥ `rounded-2xl`（AI-slop 特征） |
| 阴影 | `shadow-sm`（浮层唯一值） | `shadow` / `shadow-md` 及以上 |
| focus 环 | **`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50`** | `/25` `/40` `/60` 等任何其他透明度 |
| hover 填充 | `hover:bg-subtle` + `hover:text-ink-1` | `hover:bg-slate-50` / `hover:bg-indigo-700` |
| 禁用 | `disabled:pointer-events-none disabled:opacity-50` | `cursor-not-allowed` 单独用（应配 `aria-disabled`，且不可点元素不进 Tab 序列） |

## 2. 字号（本轮不新增 token，按语义层收敛）

Tailwind 4 无 `tailwind.config.js`，扩展 `@theme` 属 D2 决策范围，**本轮不新增**。当前口径：裸 px 字号**只允许出现在 `src/components/ui/` 与 `primitives.tsx` 内**，业务页面一律用语义类。

| 语义层 | 取值 | 2026-09-11 实测 | 应落在 |
|---|---|---|---|
| 阅读正文（长文 / markdown 渲染） | `text-[15px] leading-7` | 11 处 | `markdown-core` / `PlainTextRenderer`（渲染层，可接受） |
| 元信息行 | `text-[11px]` | 39 处 | primitives / ui 内 |
| 徽标 / 角标 | `text-[10px]` | 28 处 | primitives / ui 内 |
| 正文标准 | `text-sm`（14）· `text-[13px]` | 3 处 `[13px]` | 业务层允许 `text-sm` |

> **业务页面出现 `text-[Npx]` = 违反本表**，应回落到 `text-xs` / `text-sm` 或把该样式收进原语。

## 3. 硬编码 → token 映射表

按 2026-09-11 全仓扫描的出现频次排序（合计 **454 处 / 74 种 / 16 文件**）。改到哪个文件就先查这张表：

| 硬编码 | 次数 | 替换为 | 备注 |
|---|---|---|---|
| `text-slate-400` | 47 | `text-ink-3` | 占位 / 弱化文本 |
| `border-slate-200` | 41 | `border-line` | |
| `text-slate-500` | 32 | `text-ink-2` | |
| `bg-slate-50` | 22 | `bg-subtle` | hover 态与次级块同色，合并后不再区分 |
| `text-slate-600` | 19 | `text-ink-2` | |
| `bg-indigo-600` | 17 | `bg-primary` | |
| `text-indigo-600` | 17 | `text-primary` | |
| `bg-indigo-50` | 17 | `bg-subtle` | 浅底强调块：见下方裁决口径 |
| `text-slate-700` | 14 | `text-ink-1` | |
| `bg-indigo-700` | 13 | `hover:bg-primary/90` | 出现在 `hover:` 变体里 |
| `text-slate-900` | 13 | `text-ink-1` | |
| `text-slate-800` | 11 | `text-ink-1` | |
| `border-indigo-200` | 10 | `border-line` | |
| `text-indigo-700` | 10 | `text-primary` | |
| `bg-red-50` | 9 | `bg-subtle`（状态改由 dot/徽标） | 见 §4 |
| `text-emerald-700` | 9 | 见 §4 | |
| `bg-amber-50` | 8 | 见 §4 | |
| `bg-emerald-50` | 8 | 见 §4 | |
| `border-amber-200` | 8 | 见 §4 | |
| `text-amber-700` | 8 | 见 §4 | |
| `text-red-600` | 8 | 见 §4 | |
| `bg-slate-100` | 7 | `bg-subtle` | |
| `border-indigo-400` / `border-indigo-300` | 12 | `border-primary` | 仅当该边框表达「选中」语义；否则回落 `border-line` |

**全覆盖口径**：上述映射把 Tailwind 的灰阶三档整体对应到 PLOS 的三档文字层级（`400→ink-3` / `500·600→ink-2` / `700·800·900→ink-1`），保证「同一个视觉层级只有一个 token」。

> **与 `ui-component-system-shadcn-design-2026-09.md` §12.2（D9）的差异**：该处的建议映射是
> `slate-700 → ink-2`、`slate-500 → ink-3`，本表收紧为 `slate-700 → ink-1`、`slate-500 → ink-2`。
> 理由：`ink-2` 已是 `slate-600` 的对应档，若 500/600/700 三档全压到 ink-2，正文层级只剩 ink-1/ink-2 两档，
> 反而丢失了「弱提示 vs 真正的次文字」的区分。
> **以本表为准**（本文件是 operating reference，那份是已完成方案）。

**浅底强调块的裁决口径**：`bg-indigo-50 + border-indigo-200 + text-indigo-700` 这种「品牌色 50 号底 + 200 号边 + 700 号字」三件套，在 PLOS token 里没有等价物。统一裁决为 **`bg-subtle` + `border-line` + `text-ink-1`**，把「强调」降级为「次级块」；确需强调时在块内加一个 `text-primary` 的图标或 `dot`，而不是染底。

## 4. 状态色：规则已定，存量违反了它

`rules/react.mdc` 与 `ui-impl-tokens` §Tailwind 用法都写明：**状态语义色（mastered/learning/weak/idle/failed）只作用于 dot / 徽标，不染整块背景**。

存量里存在大量 `bg-red-50 border-red-200 text-red-600` 的**整块状态底色**（`quiz/QuizGradingPage`、`plan/chapter-action.ts`、`learn/chapter-badge.ts`、`primitives.tsx` 自身也有，合计约 90 处）。这是**违反既有规则的技术债**，不是待决的分歧。

治理口径（照做即可，无需再问）：

- 整块底色降为 `bg-subtle` + `border-line`，状态语义改由块内的 **dot / 徽标** 承载；
- **新增代码一律不得引入整块状态底色**；
- 若某处确属「没有整块底色就读不懂」，那是在提一个新组件需求（例如带状态边的 `StatusCard`），走常规流程单独提案，事后以 `(a) 未放开` 为默认。

> 之所以把这条单列出来：它最容易被人当成「美观选择」随手推翻。规则一直是 (a)，执行不到位而已。

## 5. extend @theme 的方法（未来用）

Tailwind 4 是 CSS-first，没有 `tailwind.config.js`。要加语义字号：

```css
/* src/styles/main.css，写在 @theme inline 块内 */
@theme inline {
  --text-micro: 10px;  /* 徽标 / 角标 */
  --text-meta: 11px;   /* 元信息行 */
  --text-body: 15px;   /* 阅读正文 */
}
```

加完即可用 `text-micro` / `text-meta` / `text-body`。**代价**：这是全站语义扩展，必须先消灭同义裸值（本期 78 处 10/11px）才能收口，否则只是多一条写法。故排入台账而非本轮。

## 6. 基线记录

`2026-09-11`，由 `node scripts/ui-consistency-scan.mjs` 生成：

| 指标 | 值 |
|---|---|
| 扫描文件 | 157 个 |
| 硬编码调色板色 | 454 处 / 74 种 / 16 文件 |
| 跨 ≥3 文件重复类串 | 84 条 |
| focus 环透明度 | `/25`×3 · `/40`×3 · `/50`×1 · `/60`×1 |
| 裸 px 字号 | `[15px]`×11 · `[11px]`×39 · `[10px]`×28 · `[13px]`×3 · `[12px]`×1 · `[14px]`×1 |

最脏的五个文件（治理由此开始）：`study/ReviewSession.tsx`(63) · `quiz/QuizAnswerPage.tsx`(60) · `settings/BuiltinModelsPanel.tsx`(56) · `assessment/AssessmentSession.tsx`(40) · `quiz/NewQuizPage.tsx`(39)。

## 7. 校验陷阱：Tailwind 4 会把 Markdown 正文里的类名编进产物

本仓库无 `tailwind.config.js`，Tailwind 4 按项目根目录**自动扫描所有未被 gitignore 的文件**，`docs/**/*.md` 也包含在内。

实测（2026-09-11）：在 `docs/` 下临时写一个含 `` `bg-[#010203]` `` 的 md 文件，`npx vite build` 后该颜色**出现在 dist CSS 里**；删除文件并重建后消失。

两个实际后果：

1. **「grep dist CSS 确认某个 utility 生成了」不可靠** —— 它可能只是文档里提到过。判断某个类是否真的服务于组件，以 `[ui-scan]` 对 `src/` 的扫描结果为准，而不是只 grep 产物。
2. **旧文档里的漂移类名会污染产物**：`ring-ring/60` 源码已清零，但两份设计文档正文仍写着它，dist CSS 里就仍保留该规则 —— 无害，但会在排查时误导人。

```bash
node scripts/ui-consistency-scan.mjs --root=docs   # 想查文档面的漂移时用
```
