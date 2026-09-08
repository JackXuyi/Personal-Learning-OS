/**
 * P1 章节目录（/learn）—— V2 三步闭环的「学一章」总入口（T5）。
 *
 * 数据：按文档聚合的 Chapter 列表（listChapters），掌握度取自 Learner State。
 * 交互：
 * - 每份文档一块：文档标题 + 就绪进度（已掌握章 / 总章）；
 * - 章卡片：序 + 标题、状态徽标、掌握度进度条；点击进入 /learn/:chapterId 阅读；
 * - 过滤：全部 / 仅未达标；空态引导导入（ImportModal，支持 ?import=1 直达）。
 *
 * 取代原 Knowledge 列表页（docs §2 融合矩阵 #8 / §4 页面 P1）：
 * 图谱可视化延后 N5（GraphView 组件保留在 features/knowledge/ 待复用）。
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Bar, Card, SectionTitle } from "../../components/primitives";
import { PageContainer } from "../../components/layout/AppShell";
import { MASTERY_THRESHOLD } from "../../domain";
import type { Chapter, LearnerState, SourceDocument } from "../../domain";
import { sortChaptersByOrder } from "../../domain";
import { applyForgetting, splitDocument } from "../../engine";
import { refineSplitResult } from "../../ai";
import { buildActiveProvider } from "../../stores/useSettingsStore";
import { storage } from "../../stores/useLoopStore";
import { useI18n } from "../../i18n";
import { chapterBadge, isChapterUnmet } from "./chapter-badge";
import ImportModal from "./ImportModal";

type Filter = "all" | "unmet";

export default function ChapterCatalogPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [docs, setDocs] = useState<SourceDocument[]>([]);
  const [chaptersByDoc, setChaptersByDoc] = useState<Record<string, Chapter[]>>({});
  const [learner, setLearner] = useState<LearnerState | undefined>();
  const [filter, setFilter] = useState<Filter>("all");
  const [importOpen, setImportOpen] = useState(
    () => searchParams.get("import") === "1",
  );
  const [busyDocId, setBusyDocId] = useState<string | undefined>();
  const { m } = useI18n();
  const cat = m.learn.catalog;

  const load = async () => {
    const [ds, ls] = await Promise.all([
      storage.listDocuments(),
      storage.getLearnerState(),
    ]);
    // 读时遗忘衰减（V2 T9）：目录就绪进度与首页/计划同口径（衰减视图，幂等不写回）。
    const learner = applyForgetting(ls, Date.now());
    const withChapters = await Promise.all(
      ds.map(async (d) => [d.id, sortChaptersByOrder(await storage.listChapters(d.id))] as const),
    );
    setDocs(ds);
    setChaptersByDoc(Object.fromEntries(withChapters));
    setLearner(learner);
  };

  useEffect(() => {
    void load();
  }, []);

  const masteryOf = (chapterId: string) => learner?.byUnit[chapterId]?.mastery;

  const visibleDocs = useMemo(
    () =>
      docs
        .filter((d) => (chaptersByDoc[d.id] ?? []).length > 0)
        .sort((a, b) => a.importedAt - b.importedAt),
    [docs, chaptersByDoc],
  );
  const doclessDocs = useMemo(
    () => docs.filter((d) => (chaptersByDoc[d.id] ?? []).length === 0),
    [docs, chaptersByDoc],
  );

  const chapterCount = visibleDocs.reduce((n, d) => n + (chaptersByDoc[d.id] ?? []).length, 0);
  const masteredCount = visibleDocs.reduce(
    (n, d) =>
      n +
      (chaptersByDoc[d.id] ?? []).filter((c) => (masteryOf(c.id) ?? 0) >= MASTERY_THRESHOLD).length,
    0,
  );

  const onImported = async (_docId: string, chapterIds: string[]) => {
    setImportOpen(false);
    await load();
    if (chapterIds[0]) navigate(`/learn/${chapterIds[0]}`);
  };

  /** 对旧资料（有正文但无章节）补一次切分（T12：Provider 就绪时附 AI 精修）。 */
  const splitNow = async (docId: string) => {
    const doc = docs.find((d) => d.id === docId);
    if (!doc?.textPreview) return;
    setBusyDocId(docId);
    try {
      const { chapters: heuristic } = splitDocument({ documentId: doc.id, text: doc.textPreview });
      let chapters = heuristic;
      if (heuristic.length > 0) {
        const out = await refineSplitResult(buildActiveProvider(), heuristic, doc.textPreview);
        chapters = out.chapters;
      }
      if (chapters.length > 0) await storage.saveChapters(doc.id, chapters);
      await load();
    } finally {
      setBusyDocId(undefined);
    }
  };

  return (
    <PageContainer>
      <SectionTitle
        title={cat.title}
        subtitle={
          docs.length === 0
            ? cat.subtitleEmpty
            : cat.subtitleStats(
                chapterCount,
                masteredCount,
                Math.round(MASTERY_THRESHOLD * 100),
              )
        }
        action={
          <button
            onClick={() => setImportOpen(true)}
            className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
          >
            ＋ {m.common.import}
          </button>
        }
      />

      {visibleDocs.length > 0 ? (
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
            {(
              [
                ["all", cat.filterAll],
                ["unmet", cat.filterUnmet],
              ] as [Filter, string][]
            ).map(([v, label]) => (
              <button
                key={v}
                onClick={() => setFilter(v)}
                className={`rounded-md px-3 py-1 text-sm font-medium transition ${
                  filter === v
                    ? "bg-indigo-600 text-white"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-400">{cat.hint}</p>
        </div>
      ) : null}

      {/* 空态：无任何资料 */}
      {docs.length === 0 ? (
        <Card className="border-dashed">
          <p className="text-base font-semibold text-slate-900">{cat.emptyTitle}</p>
          <p className="mt-1 text-sm text-slate-500">{cat.emptyDesc}</p>
          <button
            onClick={() => setImportOpen(true)}
            className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            {cat.emptyImport}
          </button>
        </Card>
      ) : visibleDocs.length === 0 ? (
        <Card className="border-dashed">
          <p className="text-base font-semibold text-slate-900">{cat.doclessTitle}</p>
          <p className="mt-1 text-sm text-slate-500">{cat.doclessDesc(docs.length)}</p>
        </Card>
      ) : (
        <div className="space-y-6">
          {visibleDocs.map((doc) => {
            const chapters = chaptersByDoc[doc.id] ?? [];
            const docMastered = chapters.filter(
              (c) => (masteryOf(c.id) ?? 0) >= MASTERY_THRESHOLD,
            ).length;
            const shown = filter === "all" ? chapters : chapters.filter((c) => isChapterUnmet(masteryOf(c.id)));
            return (
              <div key={doc.id}>
                {/* 文档头 + 就绪进度 */}
                <div className="mb-2 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-800">{doc.title}</p>
                    <p className="text-xs text-slate-400">
                      {cat.chapterRange(docMastered, chapters.length)}
                    </p>
                  </div>
                  <div className="w-40 shrink-0">
                    <Bar
                      value={chapters.length > 0 ? docMastered / chapters.length : 0}
                      target={MASTERY_THRESHOLD}
                      targetLabel={cat.targetLine}
                    />
                  </div>
                </div>

                {/* 章卡片 */}
                {shown.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-slate-200 px-4 py-3 text-sm text-slate-400">
                    {cat.unmetEmpty}
                  </p>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {shown.map((chapter) => {
                      const mastery = masteryOf(chapter.id) ?? 0;
                      const badge = chapterBadge(chapter.status, masteryOf(chapter.id), m);
                      return (
                        <button
                          key={chapter.id}
                          onClick={() => navigate(`/learn/${chapter.id}`)}
                          className="group rounded-xl border border-slate-200 bg-white p-3.5 text-left shadow-sm transition hover:border-indigo-200 hover:shadow"
                        >
                          <div className="flex items-center gap-2.5">
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-500 group-hover:bg-indigo-100 group-hover:text-indigo-700">
                              {chapter.order}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">
                              {chapter.title || m.chapter.ordinal(chapter.order)}
                            </span>
                            <span
                              className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${badge.cls}`}
                            >
                              {badge.label}
                            </span>
                          </div>
                          <div className="mt-2.5 flex items-center gap-2 pl-8">
                            <div className="flex-1">
                              <Bar value={mastery} target={MASTERY_THRESHOLD} targetLabel={cat.targetLine} />
                            </div>
                            <span className="w-9 shrink-0 text-right text-xs tabular-nums text-slate-400">
                              {Math.round(mastery * 100)}%
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 旧资料（有正文未切分）补切分 */}
      {doclessDocs.length > 0 ? (
        <Card className="mt-6 border-dashed">
          <SectionTitle
            title={cat.unsplitCount(doclessDocs.length)}
            subtitle={cat.unsplitHint}
          />
          <div className="flex flex-wrap gap-2">
            {doclessDocs.map((d) => (
              <div
                key={d.id}
                className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm"
              >
                <span className="max-w-40 truncate text-slate-600">{d.title}</span>
                <button
                  onClick={() => splitNow(d.id)}
                  disabled={busyDocId === d.id || !d.textPreview}
                  className="rounded-md bg-white px-2 py-0.5 text-xs font-medium text-indigo-600 ring-1 ring-slate-200 hover:bg-indigo-50 disabled:opacity-40"
                >
                  {busyDocId === d.id ? cat.splitting : cat.splitNow}
                </button>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {importOpen ? <ImportModal onClose={() => setImportOpen(false)} onImported={onImported} /> : null}
    </PageContainer>
  );
}
