import { useEffect, useState } from "react";
import { BandBadge, Card, SectionTitle } from "../../components/primitives";
import { PageContainer } from "../../components/layout/AppShell";
import { bandOf } from "../../engine";
import type { KnowledgeGraph, LearnerState } from "../../domain";
import { storage } from "../../stores/useLoopStore";

export default function KnowledgePage() {
  const [graph, setGraph] = useState<KnowledgeGraph | undefined>();
  const [learner, setLearner] = useState<LearnerState | undefined>();

  useEffect(() => {
    void (async () => {
      const [g, l] = await Promise.all([storage.getGraph(), storage.getLearnerState()]);
      setGraph(g);
      setLearner(l);
    })();
  }, []);

  return (
    <PageContainer>
      <SectionTitle
        title="知识"
        subtitle="来自你资料源的知识单元，掌握度实时取自 Learner State。"
      />
      <Card>
        {!graph ? (
          <p className="text-sm text-slate-500">图谱加载中…</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {graph.units.map((unit) => {
              const mastery = learner?.byUnit[unit.id]?.mastery ?? 0;
              return (
                <li key={unit.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">{unit.title}</p>
                    <p className="truncate text-xs text-slate-400">
                      {unit.kind}
                      {unit.summary ? ` · ${unit.summary}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-xs tabular-nums text-slate-500">
                      {Math.round(mastery * 100)}%
                    </span>
                    <BandBadge band={bandOf(mastery)} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </PageContainer>
  );
}
