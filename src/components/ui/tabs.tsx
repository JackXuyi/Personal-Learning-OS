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
        "relative flex w-fit items-center gap-6 border-b border-line bg-transparent p-0",
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
        // -mb-px：压住容器底边，让 Indicator 与 border-b 对齐成一条线。
        "-mb-px whitespace-nowrap border-b-2 border-transparent pb-2 pt-1 text-sm font-medium",
        "text-ink-3 transition-colors hover:text-ink-2",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        "data-selected:border-transparent data-selected:text-ink-1",
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
 */
function TabsIndicator({ className, ...props }: TabsIndicatorProps) {
  return (
    <BaseTabs.Indicator
      data-slot="tabs-indicator"
      className={cn(
        "absolute bottom-0 h-0.5 rounded-full bg-primary transition-all duration-200",
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
