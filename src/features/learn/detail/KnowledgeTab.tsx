import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../../../i18n';
import { storage } from '../../../stores/useLoopStore';
import { Button } from '../../../components/ui/button';
import { Section } from '../../../components/primitives';
import { notifyDocsChanged } from '../../../components/layout/AppShell';
import { buildActiveProvider } from '../../../ai/active';
import { analyzeConceptsNow } from '../analyze-service';
import GraphView from '../../knowledge/GraphView';
import { subgraphOf } from '../../../engine/graph-engine';
import type { SourceDocument, Chapter, KnowledgeGraph, LearnerState } from '../../../domain';

interface KnowledgeTabProps {
  doc: SourceDocument;
  chapters: Chapter[];
  graph: KnowledgeGraph | null;
  learner: LearnerState | null;
  onChanged: () => Promise<void>;
}

export default function KnowledgeTab({ doc, chapters, graph, learner, onChanged }: KnowledgeTabProps) {
  const t = useI18n();
  const [busyTick, setBusyTick] = useState<{ i: number; n: number; title: string }>();
  const [summary, setSummary] = useState<{ ok: number; failed: string[] }>();

  const aiReady = useMemo(() => buildActiveProvider()?.isConfigured() ?? false, []);

  const allUnitIds = useMemo(() => chapters.flatMap((c) => c.unitIds ?? []), [chapters]);
  const subgraph = useMemo(() => {
    if (!graph) return { units: [], relations: [] };
    return subgraphOf(graph, allUnitIds);
  }, [graph, allUnitIds]);

  const extracted = chapters.filter((c) => (c.unitIds?.length ?? 0) > 0).length;

  const masteryMap = useMemo(() => {
    if (!learner) return {};
    const m: Record<string, number> = {};
    for (const [unitId, state] of Object.entries(learner.byUnit)) {
      m[unitId] = state.mastery ?? 0;
    }
    return m;
  }, [learner]);

  const extractAll = async () => {
    if (chapters.length === 0 || !aiReady) return;
    setBusyTick({ i: 0, n: chapters.length, title: '' });
    setSummary(undefined);
    const failed: string[] = [];
    let ok = 0;

    for (let i = 0; i < chapters.length; i++) {
      const ch = chapters[i];
      setBusyTick({ i: i + 1, n: chapters.length, title: ch.title });
      try {
        await analyzeConceptsNow(ch, doc, { storage });
        ok++;
      } catch (e) {
        console.error(`Failed to extract concepts for chapter ${ch.id}:`, e);
        failed.push(ch.title);
      }
    }

    setBusyTick(undefined);
    setSummary({ ok, failed });
    notifyDocsChanged();
    await onChanged();
  };

  return (
    <div className="space-y-6">
      {/* 章要点汇总 */}
      <Section title={t.learn.detail.knowledge.pointsHead} />
      {chapters.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-surface p-6 text-center">
          <p className="text-xs text-ink-3">{t.learn.detail.knowledge.pointsEmpty}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {chapters.map((ch, idx) => (
            <div key={ch.id} className="rounded-lg border border-line bg-surface p-3">
              <Link
                to={`/learn/chapter/${ch.id}`}
                className="text-sm font-medium text-ink-1 hover:text-primary"
              >
                {idx + 1}  {ch.title}
              </Link>
              {ch.keyPoints && ch.keyPoints.length > 0 ? (
                <ul className="mt-2 space-y-1 text-xs text-ink-2">
                  {ch.keyPoints.map((kp, i) => (
                    <li key={i}>• {kp}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-ink-3">{t.learn.detail.knowledge.pointsEmpty}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 概念图谱 */}
      <Section
        title={t.learn.detail.knowledge.graphHead}
        className="mt-8"
        action={
          <Button
            size="sm"
            variant="outline"
            onClick={extractAll}
            disabled={!!busyTick || !aiReady || chapters.length === 0}
          >
            {extracted > 0
              ? t.learn.detail.knowledge.reExtract
              : t.learn.detail.knowledge.extractAll}
          </Button>
        }
      />
      <p className="text-xs text-ink-3">
        {t.learn.detail.knowledge.graphStats(
          extracted,
          chapters.length,
          subgraph.units.length,
          subgraph.relations.length
        )}
      </p>

      {subgraph.units.length > 0 ? (
        <div className="rounded-xl border border-line bg-surface p-2">
          <GraphView
            graph={subgraph}
            masteryByUnit={masteryMap}
            requiredUnitIds={allUnitIds}
          />
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-line bg-surface p-6 text-center">
          <p className="text-sm font-medium text-ink-1">
            {t.learn.detail.knowledge.graphEmptyTitle}
          </p>
          <p className="mt-1 text-xs text-ink-3">
            {aiReady
              ? t.learn.detail.knowledge.graphEmptyDesc
              : t.learn.detail.knowledge.graphNoAi}
          </p>
        </div>
      )}

      {/* 进度提示 */}
      {busyTick && (
        <div className="rounded-lg border border-line bg-surface p-3">
          <p className="text-xs text-ink-2">
            {t.learn.detail.knowledge.extracting(busyTick.i, busyTick.n, busyTick.title)}
          </p>
        </div>
      )}

      {/* 完成汇总 */}
      {summary && (
        <div className="rounded-lg border border-line bg-surface p-3">
          <p className="text-xs text-ink-2">
            {t.learn.detail.knowledge.extractDone(summary.ok, summary.failed.length)}
          </p>
          {summary.failed.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-ink-3">
              {summary.failed.map((title, i) => (
                <li key={i}>• {title}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
