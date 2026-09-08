import { NavLink, Outlet } from "react-router-dom";
import type { ReactNode } from "react";
import CommandPalette from "../../components/CommandPalette";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useI18n, type Messages } from "../../i18n";

interface NavItem {
  to: string;
  label: string;
  /** 显示在标签下方的简短说明。 */
  hint?: string;
}

/**
 * 导航分组（P2-4 / S6）：按「做什么」分组做视觉分隔，不改路由路径。
 * 学习空间 / 职业在 Pre-MVP 视觉降权但保留入口。文案走 i18n 字典。
 */
function buildNavGroups(nav: Messages["nav"]) {
  const groups: { title: string; items: NavItem[] }[] = [
    {
      title: nav.groupLearnLoop,
      items: [{ to: "/", label: nav.home.label, hint: nav.home.hint }],
    },
    {
      title: nav.groupStart,
      items: [
        { to: "/learn", label: nav.learn.label, hint: nav.learn.hint },
        { to: "/plan", label: nav.plan.label, hint: nav.plan.hint },
        { to: "/quiz", label: nav.quiz.label, hint: nav.quiz.hint },
      ],
    },
    {
      title: nav.groupContent,
      items: [{ to: "/spaces", label: nav.spaces.label, hint: nav.spaces.hint }],
    },
    {
      title: nav.groupPlan,
      items: [{ to: "/career", label: nav.career.label, hint: nav.career.hint }],
    },
    {
      title: nav.groupSystem,
      items: [{ to: "/settings", label: nav.settings.label, hint: nav.settings.hint }],
    },
  ];
  return groups;
}

export default function AppShell() {
  const providerReady = useSettingsStore((s) => s.providerReady);
  const { m } = useI18n();
  const groups = buildNavGroups(m.nav);

  return (
    <div className="flex h-full min-h-screen bg-slate-50 text-slate-900">
      <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-4">
          <p className="text-sm font-semibold tracking-tight text-slate-900">
            {m.nav.brand}
          </p>
          <p className="mt-0.5 text-xs text-slate-400">{m.nav.brandSub}</p>
        </div>
        <nav className="flex-1 space-y-4 overflow-y-auto p-3">
          {groups.map((group, gi) => (
            <div key={gi}>
              <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                {group.title}
              </p>
              <div className="space-y-1">
                {group.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === "/"}
                    className={({ isActive }) =>
                      `block rounded-lg px-3 py-2 transition-colors ${
                        isActive
                          ? "bg-indigo-50 text-indigo-700"
                          : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
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
        <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2.5 text-xs text-slate-400">
          <span>{m.nav.footerHint}</span>
          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
            {m.nav.footerBadge}
          </span>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
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
      <span className="flex flex-col">
        <span className="text-sm font-medium">{item.label}</span>
        {item.hint ? (
          <span className="text-xs text-slate-400">{item.hint}</span>
        ) : null}
      </span>
      {readyDot ? (
        <span
          className="h-2 w-2 shrink-0 rounded-full bg-emerald-500"
          title={m.nav.readyTooltip}
        />
      ) : null}
    </span>
  );
}

export function PageContainer({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-5xl px-8 py-8">{children}</div>;
}
