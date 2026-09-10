import * as React from "react";
import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import { cn } from "../../lib/utils";

/**
 * Tabs（UI Kit；Base UI 底层，资料详情页 4 Tab 用，docs/library-module-design-2026-09.md §8.8）。
 *
 * 视觉：下划线式（Linear / Workbench 风格）——容器只有底部一条 `border-line`，
 * 选中态由 `TabsIndicator` 的 2px 主色圆角条表达，切换时滑动过渡。
 * 未选 `text-ink-3`，hover `text-ink-2`，选中 `text-ink-1`。
 *
 * 用法（受控）：
 *   <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
 *     <TabsList>
 *       {items.map(k => <TabsTab key={k} value={k} />)}
 *       <TabsIndicator />
 *     </TabsList>
 *     <TabsPanel value={k}>…</TabsPanel>
 *   </Tabs>
 */

type TabsListProps = React.ComponentProps<typeof BaseTabs.List>;

function TabsList({ className, ...props }: TabsListProps) {
  return (
    <BaseTabs.List
      data-slot="tabs-list"
      className={cn(
        // w-full + Tab flex-1：整行铺满、各项等宽（不再 w-fit 左对齐留白）。
        "relative flex w-full items-stretch gap-1 border-b border-line bg-transparent p-0",
        className,
      )}
      {...props}
    />
  );
}

type TabsTabProps = React.ComponentProps<typeof BaseTabs.Tab>;

function TabsTab({ className, ...props }: TabsTabProps) {
  return (
    <BaseTabs.Tab
      data-slot="tabs-tab"
      className={cn(
        // 选中态由 TabsIndicator 单独承担：这里不再画 border-b-2（避免 2px 落差
        // 与「主色条 + 灰线」双层线），只负责等分、字色与焦点环。
        "min-w-0 flex-1 whitespace-nowrap px-2 pb-2 pt-1 text-center text-sm font-medium",
        "text-ink-3 transition-colors hover:text-ink-2",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        "data-selected:text-ink-1",
        className,
      )}
      {...props}
    />
  );
}

type TabsPanelProps = React.ComponentProps<typeof BaseTabs.Panel>;

function TabsPanel({ className, ...props }: TabsPanelProps) {
  return (
    <BaseTabs.Panel
      data-slot="tabs-panel"
      className={cn("min-w-0 outline-none", className)}
      {...props}
    />
  );
}

type TabsIndicatorProps = React.ComponentProps<typeof BaseTabs.Indicator>;

/**
 * 滑动下划线。必须放在 `TabsList` **内部**（它靠 List 的布局测量位置），
 * 且容器需为 `relative` —— TabsList 已带，勿去掉。
 *
 * ⚠️ 踩坑记录（Base UI 1.8）：`Tabs.Indicator` **不会自动定位**，它只把量测结果
 * 写成 CSS 变量（`--active-tab-left` / `--active-tab-width`，值自带 `px`）挂在自身
 * inline style 上。因此**必须自己把变量绑到 `left` / `width`** —— 早期版本只给了
 * `absolute bottom-0 h-0.5 bg-primary`，宽度恒为 0，选中态完全不可见。
 */
function TabsIndicator({ className, ...props }: TabsIndicatorProps) {
  return (
    <BaseTabs.Indicator
      data-slot="tabs-indicator"
      className={cn(
        "absolute left-[var(--active-tab-left)] w-[var(--active-tab-width)]",
        // -bottom-px：压住 TabsList 的 border-b，避免「2px 主色 + 1px 灰线」两层。
        "-bottom-px h-0.5 rounded-full bg-primary",
        "transition-[left,width] duration-200 ease-out motion-reduce:transition-none",
        className,
      )}
      {...props}
    />
  );
}

/**
 * 注意：`BaseTabs` 是命名空间对象（Root/List/Tab/Panel/Indicator），**不能**直接
 * 当组件渲染，否则会得到 "Element type is invalid: got object"。此处 `Tabs`
 * 指向真正的 Root 组件。
 */
const Tabs = BaseTabs.Root;
const TabsRoot = BaseTabs.Root;
export { Tabs, TabsRoot, TabsList, TabsTab, TabsPanel, TabsIndicator };
