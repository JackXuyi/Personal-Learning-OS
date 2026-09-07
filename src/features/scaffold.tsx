import type { ReactNode } from "react";
import { Card, SectionTitle } from "../components/primitives";
import { PageContainer } from "../components/layout/AppShell";

export function ScaffoldPage({
  title,
  subtitle,
  scope,
  nextSteps,
}: {
  title: string;
  subtitle: string;
  scope: string[];
  nextSteps: string[];
}) {
  return (
    <PageContainer>
      <SectionTitle title={title} subtitle={subtitle} />
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <h3 className="mb-3 text-sm font-semibold text-slate-700">Scope</h3>
          <CheckList items={scope} />
        </Card>
        <Card>
          <h3 className="mb-3 text-sm font-semibold text-slate-700">Next (MVP milestones)</h3>
          <CheckList items={nextSteps} ghost />
        </Card>
      </div>
    </PageContainer>
  );
}

function CheckList({ items, ghost = false }: { items: string[]; ghost?: boolean }) {
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2 text-sm text-slate-600">
          <span
            className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] ${
              ghost ? "bg-slate-100 text-slate-400" : "bg-emerald-100 text-emerald-700"
            }`}
          >
            {ghost ? "…" : "✓"}
          </span>
          <span className={ghost ? "text-slate-400" : undefined}>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function StatusPill({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
        ok
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-amber-200 bg-amber-50 text-amber-700"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald-500" : "bg-amber-500"}`} />
      {label}
    </span>
  );
}

export function FoundationRow({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}
