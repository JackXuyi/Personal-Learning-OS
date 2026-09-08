import { Link, NavLink, Outlet } from "react-router-dom";
import type { ReactNode } from "react";
import CommandPalette from "../../components/CommandPalette";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useI18n, type Messages } from "../../i18n";

/** 打开 ⌘K 命令面板（Header 搜索框触发；CommandPalette 监听同事件）。 */
export const CMD_OPEN_EVENT = "plos:open-palette";

export function openCommandPalette() {
  window.dispatchEvent(new CustomEvent(CMD_OPEN_EVENT));
}

interface NavItem {
  to: string;
  label: string;
  hint?: string;
}

/**
 * 导航分组（UI Workbench 五组，docs/ui-workbench-plan-2026-09.md §4.1）。
 *
 * 启用里程碑：
 * - Library 项：U5（升级 /learn 资料库观感后放开，届时移除 enabled=false）；
 * - Graph 项：N5 概念层全局图谱回归后放开；
 * - Learner 项：U6「我的画像」页上线后放开。
 * 分组中无可达项时整组不渲染。
 */
function buildNavGroups(nav: Messages["nav"]): { title: string; items: NavItem[] }[] {
  const group = (title: string, items: NavItem[]): { title: string; items: NavItem[] }[] =>
    items.length > 0 ? [{ title, items }] : [];

  return [
    ...group(nav.groupToday, [{ to: "/", label: nav.home.label, hint: nav.home.hint }]),
    ...group(nav.groupLearn, [
      { to: "/plan", label: nav.plan.label, hint: nav.plan.hint },
      { to: "/learn", label: nav.learn.label, hint: nav.learn.hint },
      { to: "/quiz", label: nav.quiz.label, hint: nav.quiz.hint },
    ]),
    /* KNOWLEDGE：资料库 / 图谱 —— U5 与 N5 前无可达项，整组隐藏 */
    ...group(nav.groupKnowledge, []),
    ...group(nav.groupGoals, [{ to: "/career", label: nav.career.label, hint: nav.career.hint }]),
    ...group(nav.groupSystem, [{ to: "/settings", label: nav.settings.label, hint: nav.settings.hint }]),
  ];
}

export default function AppShell() {
  const providerReady = useSettingsStore((s) => s.providerReady);
  const { m } = useI18n();
  const groups = buildNavGroups(m.nav);

  return (
    <div className="flex h-full min-h-0 bg-app-bg text-ink-1">
      <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-surface">
        <div className="border-b border-line px-5 py-3.5">
          <p className="text-sm font-semibold tracking-tight text-ink-1">{m.nav.brand}</p>
          <p className="mt-0.5 text-xs text-ink-3">{m.nav.brandSub}</p>
        </div>
        <nav className="flex-1 space-y-4 overflow-y-auto p-3">
          {groups.map((group, gi) => (
            <div key={gi}>
              <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-3">
                {group.title}
              </p>
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === "/"}
                    className={({ isActive }) =>
                      `block rounded-md px-3 py-1.5 transition-colors ${
                        isActive
                          ? "bg-subtle text-ink-1"
                          : "text-ink-2 hover:bg-subtle hover:text-ink-1"
                      }`
                    }
                  >
                    <ShellNavContent
                      item={item}
                      readyDot={item.to === "/settings" && providerReady}
                    />
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-xs text-ink-3">
          <span>{m.nav.footerHint}</span>
          <span className="rounded border border-line bg-subtle px-1.5 py-0.5 font-mono text-[10px] text-ink-2">
            {m.nav.footerBadge}
          </span>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* 顶部 Header：居中全局搜索（=⌘K）+ 右侧 AI 状态（点击去设置） */}
        <header className="relative flex h-12 shrink-0 items-center border-b border-line bg-surface px-4">
          <button
            type="button"
            onClick={openCommandPalette}
            aria-label={m.cmd.searchAria}
            className="mx-auto flex h-8 w-full max-w-md items-center justify-between gap-2 rounded-md border border-line bg-app-bg px-3 text-left text-sm text-ink-3 transition-colors hover:border-ink-2 hover:text-ink-2"
          >
            <span className="truncate">{m.cmd.placeholder}</span>
            <kbd className="shrink-0 rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[10px] text-ink-3">
              ⌘K
            </kbd>
          </button>
          <Link
            to="/settings"
            title={m.nav.readyTooltip}
            className="absolute right-4 flex items-center gap-1.5 text-xs text-ink-2 transition-colors hover:text-ink-1"
          >
            <span
              className={`h-2 w-2 rounded-full ${
                providerReady ? "bg-state-mastered" : "bg-state-idle"
              }`}
            />
            <span>{providerReady ? m.nav.aiReady : m.nav.aiOffline}</span>
          </Link>
        </header>

        <main className="min-w-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
      <CommandPalette />
    </div>
  );
}

function ShellNavContent({
  item,
  readyDot,
}: {
  item: NavItem;
  readyDot?: boolean;
}) {
  const { m } = useI18n();
  return (
    <span className="flex items-center justify-between gap-2">
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium">{item.label}</span>
        {item.hint ? (
          <span className="truncate text-xs text-ink-3">{item.hint}</span>
        ) : null}
      </span>
      {readyDot ? (
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-state-mastered"
          title={m.nav.readyTooltip}
        />
      ) : null}
    </span>
  );
}

export function PageContainer({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-5xl px-8 py-8">{children}</div>;
}
