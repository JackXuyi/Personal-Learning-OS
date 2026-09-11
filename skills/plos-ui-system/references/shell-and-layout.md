# 壳层与布局：黄金样件

> 「样子」的定义来源。改壳层前必读；改任何页面前先看 §1 的容器常量。
> 样件由 2026-09-11 侧栏重构产出：`docs/nav-sidebar-redesign-design-2026-09.md`。

## 1. 布局常量表

| 位置 | 值 | 依据 |
|---|---|---|
| 侧栏宽度 | `w-60`（240px） | `layout/NavSidebar.tsx:24` |
| 侧栏容器 | `aside.flex.w-60.shrink-0.flex-col.border-r.border-line.bg-surface` | 同上 |
| 侧栏 brand 区 | `border-b border-line px-5 py-3.5`，标题 `text-sm font-semibold tracking-tight text-ink-1` | 同上 `:25` |
| 侧栏列表 | `nav.flex-1.space-y-0-5.p-3` | 同上 `:29` |
| 侧栏 footer | `border-t border-line px-4 py-2.5 text-xs text-ink-3` | 同上 `:89` |
| **导航行** | `flex items-center gap-2.5 rounded-md px-3 py-2 transition-colors` | 同上 `:42` |
| 导航图标 | `h-4 w-4 shrink-0` + `strokeWidth={1.75}` + `aria-hidden` | 同上 `:51-57` |
| 导航名称 | `truncate text-sm` | 同上 `:58` |
| 选中态 | 容器 `bg-subtle text-ink-1` **且** 图标 `text-primary` | 同上 `:43` `:52` |
| 未选中 | 容器 `text-ink-2 hover:bg-subtle hover:text-ink-1`；图标 `text-ink-3 group-hover:text-ink-2` | 同上 `:45` `:53` |
| 页面容器 | `PageContainer`（default = `max-w-5xl px-8 py-8`；`wide` = `max-w-[1600px]`） | `layout/AppShell.tsx` |
| Header | `h-12` + `border-b`；居中搜索 ≤ `max-w-md` | 同上 |

## 2. 「图标 + 文本行」原子（导航、菜单、列表项通用）

```
IconTextRow
  ├── icon      : 16px / strokeWidth 1.75 / aria-hidden（不可点时 inherited 色）
  ├── 名称      : 单行 truncate text-sm —— 永不带第二行常驻描述
  ├── 描述      : 只能进浮层（role="tooltip" + pointer-events-none + group-hover/focus-visible）
  │              并同时挂 title 兜底（触屏 / 无 hover）
  └── 右侧槽    : 状态点 / 徽标，ml-auto，绝不用空格占位
```

规则：**任何一行只允许一个名称文本**。第二信息只能进浮层或页面标题区。
当前该模式仅在 `NavSidebar` 内出现 1 处，故尚未抽取；出现第 3 处时按 `extraction-playbook.md` 抽为 `IconTextRow`。

## 3. 两条硬坑（已实踩，勿重复付出学费）

### 坑一：祖先的 `overflow` 会裁掉浮层

`<nav>` / 任何祖先**不得**设 `overflow-y-auto` 或 `overflow-hidden`。
CSS 规范中一个方向非 `visible` 时，另一个方向的 `visible` 会被计算成 `auto` —— 结果就是右侧浮出的 tooltip 被裁掉一半甚至不可见。

取舍：侧栏项数固定（8 项）时**不要**做内部滚动，极端矮窗口交给外层容器滚动。
若将来项数真的增长到必须滚动，浮层方案要同步改成 portal 或改用 `title` 兜底。

### 坑二：给 children 内部的元素按 `isActive` 着色，必须用函数式 children

```tsx
// ✅ 正确：children 是函数，isActive 能传进去
<NavLink className={({ isActive }) => `... ${isActive ? "bg-subtle" : ""}`}>
  {({ isActive }) => (
    <>
      <Icon className={isActive ? "text-primary" : "text-ink-3"} />
      <span>{label}</span>
    </>
  )}
</NavLink>

// ❌ 错误：className 回调取不到 children 内部，图标永远着不了色
<NavLink className={({ isActive }) => ...}>
  <Icon />
</NavLink>
```

## 4. 浮层（tooltip）标准写法

```tsx
className="pointer-events-none absolute left-full top-1/2 z-30 ml-2
           -translate-y-1/2 whitespace-nowrap rounded-md border border-line
           bg-surface px-2 py-1 text-xs text-ink-2 opacity-0 shadow-sm
           transition-opacity duration-150
           group-hover:opacity-100 group-focus-visible:opacity-100"
```

要点：父级必须有 `group relative`；`pointer-events-none` 防止浮层挡住鼠标导致闪烁；`group-focus-visible:` 保证键盘可达。

## 5. 什么时候允许打破常量

只有一种情况：**新增需求与本表常量产生物理冲突**（例如要塞一个宽 280px 的二级面板）。
此时的做法是**回来改本表**，让表继续成为唯一事实源 —— 而不是在页面上写个一次性宽度绕过它。

在文件里绕过的写法，必须在代码注释里写明「一次性，已知与 shell-and-layout.md 冲突，原因：…」，否则视为违反。
