import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { BandBadge, Card, SectionTitle } from "../../components/primitives";
import { PageContainer } from "../../components/layout/AppShell";
import { bandOf } from "../../engine";
import type { KnowledgeGraph, KnowledgeUnit } from "../../domain";
import { storage, useLoopStore } from "../../stores/useLoopStore";
import { useSessionStore } from "../../stores/useSessionStore";
import { useI18n } from "../../i18n";
import AssessmentSession from "./AssessmentSession";
import { unitTitle } from "../units";

/**
 * 测评 —— 自适应题目（从回忆到应用）。
 *
 * 首页：选单元 → 会话作答（AssessmentSession）。支持 ?unit= 直达会话。
 */
export default function AssessmentPage() {
  const { m } = useI18n();
  const a = m.assessment;
  const snapshot = useLoopStore((s) => s.snapshot);
  const refresh = useLoopStore((s) => s.refresh);
  const records = useSessionStore((s) => s.records);
  const [params, setParams] = useSearchParams();
  const directUnitId = params.get("unit");

  const [graph, setGraph] = useState<KnowledgeGraph | undefined>();
  const [active, setActive] = useState<KnowledgeUnit | undefined>();

  useEffect(() => {
    void (async () => {
      if (!useLoopStore.getState().snapshot) await refresh(m);
      setGraph(await storage.getGraph());
    })();
  }, [refresh]);

  // ?unit=xxx 直达会话
  useEffect(() => {
    if (!graph || !directUnitId) return;
    const unit = graph.units.find((u) => u.id === directUnitId);
    if (unit) {
      setActive(unit);
      setParams({}, { replace: true }); // 清掉 query，避免刷新时复选
    }
  }, [graph, directUnitId, setParams]);

  const units = graph?.units ?? [];
  const recommended =
    snapshot?.next && units.some((u) => u.id === snapshot.next!.unitId)
      ? units.find((u) => u.id === snapshot.next!.unitId)
      : units[0];

  const exitSession = () => setActive(undefined);

  if (active) {
    return <AssessmentSession unit={active} onExit={exitSession} />;
  }

  const todayAssessments = records.filter((r) => r.mode === "assessment");

  return (
    <PageContainer>
      <SectionTitle
        title={a.title}
        subtitle={a.subtitle}
      />

      {/* 建议先测 */}
      {recommended ? (
        <Card className="border-indigo-200 bg-indigo-50/40">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-indigo-400">
                {a.recommendEyebrow}
              </p>
              <p className="mt-1 text-lg font-semibold text-slate-900">
                {unitTitle(recommended.id)}
              </p>
            </div>
            <button
              onClick={() => setActive(recommended)}
              className="rounded-xl bg-indigo-600 px-6 py-3 text-base font-semibold text-white shadow-sm hover:bg-indigo-700"
            >
              {a.start}
            </button>
          </div>
        </Card>
      ) : null}

      {/* 选单元 */}
      <Card className="mt-6">
        <p className="mb-3 text-sm font-semibold text-slate-700">{a.pickAny}</p>
        {units.length === 0 ? (
          <p className="text-sm text-slate-500">
            {a.emptyLead}{" "}
            <Link to="/study" className="text-indigo-600 hover:underline">
              {a.goStudy}
            </Link>{" "}
            {a.emptyTail}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {units.map((u) => {
              const mastery = snapshot?.masteryByUnit[u.id] ?? 0;
              return (
                <button
                  key={u.id}
                  onClick={() => setActive(u)}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 transition hover:border-indigo-200 hover:bg-indigo-50/40"
                >
                  {unitTitle(u.id)}
                  <BandBadge band={bandOf(mastery)} />
                </button>
              );
            })}
          </div>
        )}
      </Card>

      {/* 今日已测 */}
      {todayAssessments.length > 0 ? (
        <Card className="mt-6">
          <SectionTitle title={a.todayTitle} subtitle={a.todayCount(todayAssessments.length)} />
          <ul className="space-y-1 text-sm text-slate-600">
            {todayAssessments.map((r) => (
              <li key={`${r.unitId}-${r.at}`}>
                {unitTitle(r.unitId)} · {r.correct ? a.correct : a.wrong} ·{" "}
                {r.correct ? "+" : ""}
                {Math.round((r.masteryDelta ?? 0) * 100)}%
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </PageContainer>
  );
}
