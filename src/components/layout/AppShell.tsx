import { NavLink, Outlet } from "react-router-dom";
import type { ReactNode } from "react";

interface NavItem {
  to: string;
  label: string;
  /** 显示在标签下方的简短说明。 */
  hint?: string;
}

const NAV: NavItem[] = [
  { to: "/", label: "首页", hint: "学习闭环" },
  { to: "/spaces", label: "学习空间", hint: "知识库" },
  { to: "/knowledge", label: "知识", hint: "图谱与掌握度" },
  { to: "/assessment", label: "测评", hint: "自适应题目" },
  { to: "/career", label: "职业", hint: "目标就绪度" },
  { to: "/study", label: "学习", hint: "计划与记录" },
  { to: "/settings", label: "设置", hint: "AI Provider" },
];

export default function AppShell() {
  return (
    <div className="flex h-full min-h-screen bg-slate-50 text-slate-900">
      <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-4">
          <p className="text-sm font-semibold tracking-tight text-slate-900">
            个人学习 OS
          </p>
          <p className="mt-0.5 text-xs text-slate-400">本地优先 · Pre-MVP</p>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {NAV.map((item) => (
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
              <ShellNavContent item={item} />
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-100 px-5 py-3 text-xs text-slate-400">
          Foundation scaffold · Phase 0
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}

function ShellNavContent({ item }: { item: NavItem }) {
  return (
    <span className="flex flex-col">
      <span className="text-sm font-medium">{item.label}</span>
      {item.hint ? <span className="text-xs text-slate-400">{item.hint}</span> : null}
    </span>
  );
}

export function PageContainer({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-5xl px-8 py-8">{children}</div>;
}
