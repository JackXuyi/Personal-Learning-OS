import { NavLink, Outlet } from "react-router-dom";
import type { ReactNode } from "react";

interface NavItem {
  to: string;
  label: string;
  /** Short description shown under the label. */
  hint?: string;
}

const NAV: NavItem[] = [
  { to: "/", label: "Home", hint: "Learning loop" },
  { to: "/spaces", label: "Learning Spaces", hint: "Knowledge bases" },
  { to: "/knowledge", label: "Knowledge", hint: "Graph & mastery" },
  { to: "/assessment", label: "Assessment", hint: "Adaptive questions" },
  { to: "/career", label: "Career", hint: "Goal readiness" },
  { to: "/study", label: "Study", hint: "Plans & sessions" },
  { to: "/settings", label: "Settings", hint: "AI provider" },
];

export default function AppShell() {
  return (
    <div className="flex h-full min-h-screen bg-slate-50 text-slate-900">
      <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-4">
          <p className="text-sm font-semibold tracking-tight text-slate-900">
            Personal Learning OS
          </p>
          <p className="mt-0.5 text-xs text-slate-400">Local-first · Pre-MVP</p>
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
