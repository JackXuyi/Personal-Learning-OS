import { useEffect } from "react";
import { Link } from "react-router-dom";
import { BandBadge, Bar, Card, SectionTitle, Stat } from "../../components/primitives";
import { PageContainer } from "../../components/layout/AppShell";
import { bandOf } from "../../engine";
import { useLoopStore } from "../../stores/useLoopStore";

const LOOP_STEPS = [
  "Document",
  "Knowledge",
  "Graph",
  "Assess",
  "Mastery",
  "Next Action",
];

export default function HomePage() {
  const snapshot = useLoopStore((s) => s.snapshot);
  const loading = useLoopStore((s) => s.loading);
  const error = useLoopStore((s) => s.error);
  const refresh = useLoopStore((s) => s.refresh);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <PageContainer>
      <SectionTitle
        title="Learning Loop"
        subtitle="Prove the closed loop: Learn → Prove → Adapt. Demo data mirrors the README career example."
      />

      {/* Loop pipeline */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        {LOOP_STEPS.map((step, i) => (
          <span key={step} className="flex items-center gap-2">
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600">
              {step}
            </span>
            {i < LOOP_STEPS.length - 1 ? (
              <span className="text-slate-300">→</span>
            ) : null}
          </span>
        ))}
      </div>

      {error ? (
        <Card>
          <p className="text-sm text-red-600">{error}</p>
        </Card>
      ) : null}

      {loading && !snapshot ? (
        <Card>
          <p className="text-sm text-slate-500">Running the learning loop…</p>
        </Card>
      ) : null}

      {snapshot ? (
        <div className="space-y-6">
          {/* Goal readiness */}
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  Active goal
                </p>
                <p className="mt-1 text-lg font-semibold text-slate-900">
                  {snapshot.goal.title}
                </p>
                <p className="text-sm text-slate-500">
                  {snapshot.goal.type} · importance {snapshot.goal.importance}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-8">
                <Stat
                  label="Readiness"
                  value={`${Math.round(snapshot.readiness * 100)}%`}
                  hint="units ≥ 80% mastery"
                />
                <Stat label="Open gaps" value={`${snapshot.actions.length}`} hint="from planner" />
              </div>
            </div>
            <div className="mt-4">
              <Bar value={snapshot.readiness} />
            </div>
          </Card>

          {/* Next best action */}
          {snapshot.next ? (
            <Card className="border-indigo-200 bg-indigo-50/50">
              <SectionTitle
                title="Next best action"
                subtitle="Recommended by the Recommendation Engine — with the reasons (Explainable)."
              />
              <div className="flex items-center gap-3">
                <span className="rounded-md bg-indigo-600 px-2 py-0.5 text-xs font-medium text-white">
                  {snapshot.next.kind}
                </span>
                <span className="text-sm font-semibold text-slate-900">
                  {unitTitle(snapshot.next.unitId)}
                </span>
              </div>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-600">
                {snapshot.next.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </Card>
          ) : null}

          {/* Full plan */}
          <Card>
            <SectionTitle title="Learning plan" subtitle="Dependency-first ordering from the Learning Planner." />
            <PlanList />
          </Card>
        </div>
      ) : null}
    </PageContainer>
  );
}

function PlanList() {
  const snapshot = useLoopStore((s) => s.snapshot);
  if (!snapshot || snapshot.actions.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        No open gaps — the goal is on track.{" "}
        <Link to="/knowledge" className="text-indigo-600 hover:underline">
          Review your knowledge graph
        </Link>
        .
      </p>
    );
  }
  return (
    <ol className="space-y-2">
      {snapshot.actions.map((action, i) => {
        const mastery = snapshot.masteryByUnit[action.unitId] ?? 0;
        return (
          <li
            key={action.id}
            className="flex items-center justify-between gap-4 rounded-lg border border-slate-100 px-3 py-2"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span className="w-6 shrink-0 text-sm font-medium text-slate-400">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                {action.kind}
              </span>
              <span className="truncate text-sm font-medium text-slate-800">
                {unitTitle(action.unitId)}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="text-xs text-slate-400">mastery {Math.round(mastery * 100)}%</span>
              <BandBadge band={bandOf(mastery)} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function unitTitle(unitId: string): string {
  const labels: Record<string, string> = {
    "rag-retrieval": "Retrieval",
    "rag-embedding": "Embedding",
    "rag-chunking": "Chunking",
    "rag-reranking": "Reranking",
    "rag-evaluation": "Evaluation",
    "rag-production": "Production",
    "vector-search": "Vector Search",
    agent: "Agent",
    react: "React",
    typescript: "TypeScript",
    python: "Python",
    rag: "RAG",
  };
  return labels[unitId] ?? unitId;
}
