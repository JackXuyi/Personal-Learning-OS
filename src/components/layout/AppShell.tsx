import { NavLink, Outlet } from "react-router-dom";
import type { ReactNode } from "react";
import CommandPalette from "../../components/CommandPalette";
import { useSettingsStore } from "../../stores/useSettingsStore";

interface NavItem {
  to: string;
  label: string;
  /** 显示在标签下方的简短说明。 */
  hint?: string;
}

/**
 * 导航分组（P2-4 / S6）：按「做什么」分组做视觉分隔，不改路由路径。
 * 学习空间 / 职业在 Pre-MVP 视觉降权但保留入口。
 */
const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: "学习闭环",
    items: [{ to: "/", label: "首页", hint: "今天做哪件事" }],
  },
  {
    title: "开始学习",
    items: [
      { to: "/learn", label: "学习", hint: "章节目录与阅读" },
      { to: "/plan", label: "计划", hint: "章级学习队列" },
      { to: "/quiz", label: "测评", hint: "试卷 · 出卷 · 答题" },
    ],
  },
  {
    title: "内容",
    items: [
      { to: "/spaces", label: "学习空间", hint: "资料与空间" },
    ],
  },
  {
    title: "规划",
    items: [{ to: "/career", label: "职业", hint: "目标就绪度" }],
  },
  {
    title: "系统",
    items: [{ to: "/settings", label: "设置", hint: "AI 服务" }],
  },
];

export default function AppShell() {
  const providerReady = useSettingsStore((s) => s.providerReady);

  return (
    <div className="flex h-full min-h-screen bg-slate-50 text-slate-900">
      <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-4">
          <p className="text-sm font-semibold tracking-tight text-slate-900">
            个人学习 OS
          </p>
          <p className="mt-0.5 text-xs text-slate-400">本地优先 · 学习闭环</p>
        </div>
        <nav className="flex-1 space-y-4 overflow-y-auto p-3">
          {NAV_GROUPS.map((group) => (
            <div key={group.title}>
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
          <span>⌘K 快速操作</span>
          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
            Pre-MVP
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
          title="AI Provider 已就绪"
        />
      ) : null}
    </span>
  );
}

export function PageContainer({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-5xl px-8 py-8">{children}</div>;
}
