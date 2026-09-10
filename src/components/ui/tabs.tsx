import * as React from "react";
import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import { cn } from "../../lib/utils";

/**
 * Tabs（UI Kit；Base UI 底层，资料详情页 4 Tab 用，docs/library-module-design-2026-09.md §8.8）。
 * 用法（受控）：
 *   <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
 *     <TabsList>{items.map(k => <TabsTab value={k}/>)}</TabsList>
 *     <TabsPanel value={k}>…</TabsPanel>
 *   </Tabs>
 */

type TabsListProps = React.ComponentProps<typeof BaseTabs.List>;

function TabsList({ className, ...props }: TabsListProps) {
  return (
    <BaseTabs.List
      data-slot="tabs-list"
      className={cn(
        "flex w-fit gap-1 overflow-x-auto rounded-lg border border-line bg-subtle p-1",
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
        "flex-1 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium text-ink-2 transition-colors",
        "hover:text-ink-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        "data-selected:bg-surface data-selected:text-primary data-selected:shadow-sm",
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

/**
 * 注意：`BaseTabs` 是命名空间对象（Root/List/Tab/Panel），**不能**直接当组件渲染，
 * 否则会得到 "Element type is invalid: got object"。此处 `Tabs` 指向真正的 Root 组件。
 */
const Tabs = BaseTabs.Root;
const TabsRoot = BaseTabs.Root;
export { Tabs, TabsRoot, TabsList, TabsTab, TabsPanel };
