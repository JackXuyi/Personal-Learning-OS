/**
 * 知识页（T5 + T6）—— 列表 / 图谱双视图 + 导入资料管道。
 *
 * - 工具条：视图切换（图谱 | 列表）+「导入资料」（支持 #/knowledge?import=1 直达）
 * - 列表视图：单元 + 掌握度 + 来源文档标记（Evidence），支持按文档聚焦高亮
 * - 图谱视图：GraphView 三态可视化，缺口节点高亮
 * - 空图谱：引导导入第一份资料
 */
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { BandBadge, Card, SectionTitle } from "../../components/primitives";
import { PageContainer } from "../../components/layout/AppShell";
import { bandOf } from "../../engine";
import type { KnowledgeGraph, LearnerState, SourceDocument } from "../../domain";
import { storage } from "../../stores/useLoopStore";
import { kindLabel } from "../units";
import GraphView from "./GraphView";
import ImportModal from "./ImportModal";

type View = "graph" | "list";

export default function KnowledgePage() {
  const [searchParams] = useSearchParams();
  const [graph, setGraph] = useState<KnowledgeGraph | undefined>();
  const [learner, setLearner] = useState<LearnerState | undefined>();
  const [docs, setDocs] = useState<SourceDocument[]>([]);
  const [required, setRequired] = useState<string[]>([]);
  const [view, setView] = useState<View>("graph");
  const [importOpen, setImportOpen] = useState(
    () => searchParams.get("import") === "1",
  );
  const [highlightIds, setHighlightIds] = useState<string[]>([]);
  const [docFocusId, setDocFocusId] = useState<string | undefined>();

  const load = async () => {
    const [g, l, d, goals] = await Promise.all([
      storage.getGraph(),
      storage.getLearnerState(),
      storage.listDocuments(),
      storage.listGoals(),
    ]);
    setGraph(g);
    setLearner(l);
    setDocs(d);
    setRequired(goals[0]?.requiredUnitIds ?? []);
  };

  useEffect(() => {
    void load();
  }, []);

  /** unitId → 掌握度 快照。 */
  const masteryByUnit = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [id, m] of Object.entries(learner?.byUnit ?? {})) out[id] = m.mastery;
    return out;
  }, [learner]);

  const docTitleOf = (docId: string) =>
    docs.find((d) => d.id === docId)?.title ?? docId;

  const onImported = async (_docId: string, addedUnitIds: string[]) => {
    await load();
    setImportOpen(false);
    if (addedUnitIds.length > 0) {
      setView("graph");
      setHighlightIds(addedUnitIds);
      window.setTimeout(() => setHighlightIds([]), 6_000);
    }
  };

  const unitsInFocusDoc = useMemo(
    () =>
      docFocusId
        ? graph?.units.filter((u) => u.sourceDocumentId === docFocusId) ?? []
        : [],
    [graph, docFocusId],
  );

  return (
    <PageContainer>
      <SectionTitle
        title="知识"
        subtitle="来自你资料源的知识单元，掌握度实时取自 Learner State。"
        action={
          <button
            onClick={() => setImportOpen(true)}
            className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
          >
            ＋ 导入资料
          </button>
        }
      />

      {/* 视图切换 + 统计 */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
          {(
            [
              ["graph", "图谱"],
              ["list", "列表"],
            ] as [View, string][]
          ).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-md px-3 py-1 text-sm font-medium transition ${
                view === v
                  ? "bg-indigo-600 text-white"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {graph && graph.units.length > 0 ? (
          <p className="text-xs text-slate-400">
            {graph.units.length} 个单元 · {graph.relations.length} 条关系
          </p>
        ) : null}
      </div>

      {/* 主体 */}
      {!graph ? (
        <Card>
          <p className="text-sm text-slate-500">图谱加载中…</p>
        </Card>
      ) : graph.units.length === 0 ? (
        <Card className="border-dashed">
          <p className="text-base font-semibold text-slate-900">图谱还是空的</p>
          <p className="mt-1 text-sm text-slate-500">
            导入第一份资料，系统会把它解析成知识单元放进图谱。
          </p>
          <button
            onClick={() => setImportOpen(true)}
            className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            导入第一份资料
          </button>
        </Card>
      ) : view === "graph" ? (
        <GraphView
          graph={graph}
          masteryByUnit={masteryByUnit}
          requiredUnitIds={required}
          highlightIds={highlightIds}
          onOpenDocument={(docId) => {
            setDocFocusId(docId);
            setView("list");
          }}
        />
      ) : (
        <div className="space-y-3">
          {/* Evidence 聚焦条：从图谱双击原文后定位到具体文档 */}
          {docFocusId ? (
            <div className="flex items-center justify-between rounded-xl border border-indigo-200 bg-indigo-50/60 px-4 py-2.5">
              <p className="text-sm text-indigo-800">
                查看「{docTitleOf(docFocusId)}」中的 {unitsInFocusDoc.length} 个单元
              </p>
              <button
                onClick={() => setDocFocusId(undefined)}
                className="rounded-md px-2 py-1 text-xs text-indigo-500 hover:bg-indigo-100"
              >
                清除高亮 ✕
              </button>
            </div>
          ) : null}
          <Card>
            <ul className="divide-y divide-slate-100">
              {graph.units.map((unit) => {
                const mastery = learner?.byUnit[unit.id]?.mastery ?? 0;
                const inDoc = Boolean(docFocusId && unit.sourceDocumentId === docFocusId);
                return (
                  <li
                    key={unit.id}
                    className={`flex items-center justify-between gap-4 rounded-lg px-2 py-3 transition ${
                      inDoc ? "bg-indigo-50/70 ring-1 ring-indigo-200" : ""
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">
                        {unit.title}
                        <span className="ml-2 rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">
                          {kindLabel(unit.kind)}
                        </span>
                      </p>
                      <p className="truncate text-xs text-slate-400">
                        {unit.summary ?? "暂无摘要"}
                        {unit.sourceDocumentId ? (
                          <span className="text-indigo-500">
                            {" · 来自 "}
                            {docTitleOf(unit.sourceDocumentId)}
                          </span>
                        ) : null}
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
          </Card>
        </div>
      )}

      {/* 导入资料 Modal */}
      {importOpen ? (
        <ImportModal
          existing={(graph?.units ?? []).map((u) => ({ id: u.id, title: u.title }))}
          onClose={() => setImportOpen(false)}
          onImported={onImported}
        />
      ) : null}
    </PageContainer>
  );
}
