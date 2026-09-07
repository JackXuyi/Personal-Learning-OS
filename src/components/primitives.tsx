import type { ReactNode } from "react";
import type { MasteryBand } from "../engine";

const bandStyles: Record<MasteryBand, string> = {
  "not-started": "bg-slate-100 text-slate-500 border-slate-200",
  learning: "bg-red-50 text-red-600 border-red-200",
  proficient: "bg-amber-50 text-amber-600 border-amber-200",
  mastered: "bg-emerald-50 text-emerald-600 border-emerald-200",
};

export function BandBadge({ band }: { band: MasteryBand }) {
  const label: Record<MasteryBand, string> = {
    "not-started": "Not started",
    learning: "Learning",
    proficient: "Proficient",
    mastered: "Mastered",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${bandStyles[band]}`}
    >
      {label[band]}
    </span>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function SectionTitle({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Bar({ value, className = "" }: { value: number; className?: string }) {
  const pct = Math.round(value * 100);
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
      <div
        className={`h-full rounded-full transition-all ${className || "bg-indigo-500"}`}
        style={{ width: `${Math.min(100, pct)}%` }}
      />
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}
