/**
 * 资料库 / 章节目录（/learn）—— V2 三步闭环的「学一章」总入口
 * （UI Workbench U3 → U5 资料库观感，docs/ui-workbench-plan-2026-09.md §11/U5）。
 *
 * U5 升级（A 案：升级 /learn，不新增 /library 路由）：
 * - 页面定位「文档资料库」：主标题/统计改为资料库口径；导入按钮与搜索框固定在页头；
 * - 每份文档一张「文档卡」（类型徽标 + 标题 + 章数/要点数/最后学习时间 + 探索度 +
 *   就绪 Bar），卡头可折叠，卡内为章行（KnowledgeRow 同形态，点击进阅读）；
 * - 页头搜索（文档标题 / 章标题 / 章要点）与 全部/未达标 过滤组合作用于章行；
 * - 导入入口全局化：本页不再内嵌 ImportModal，空态/页头/⌘K/Header 统一走
 *   IMPORT_OPEN_EVENT；导入完成后经 DOCS_CHANGED_EVENT 自动刷新本页。
 *
 * 数据：按文档聚合的 Chapter 列表（listChapters），掌握度取自 Learner State（读时衰减视图）。
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Bar, Card, SectionTitle } from "../../components/primitives";
import {
  DOCS_CHANGED_EVENT,
  PageContainer,
  openImportModal,
} from "../../components/layout/AppShell";
import { MASTERY_THRESHOLD } from "../../domain";
import type { Chapter, DocumentFormat, LearnerState, SourceDocument } from "../../domain";
import { sortChaptersByOrder } from "../../domain";
import { applyForgetting, splitDocument } from "../../engine";
import { refineSplitResult } from "../../ai";
import { buildActiveProvider } from "../../stores/useSettingsStore";
import { storage } from "../../stores/useLoopStore";
import { useI18n, type Messages } from "../../i18n";
import { chapterBadge, isChapterUnmet } from "./chapter-badge";

type Filter = "all" | "unmet";

export default function ChapterCatalogPage() {
  const { m } = useI18n();
  const cat = m.learn.catalog;
  const [searchParams] = useSearchParams();
  const [docs, setDocs] = useState<SourceDocument[]>([]);
  const [chaptersByDoc, setChaptersByDoc] = useState<Record<string, Chapter[]>>({});
  const [learner, setLearner] = useState<LearnerState | undefined>();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [busyDocId, setBusyDocId] = useState<string | undefined>();
  /** 文档卡折叠态：缺省展开（true）；false = 收起。 */
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

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

  // 全局导入（Header / ⌘K / 空态）完成后刷新本页；?import=1 旧链接触发全局 Modal。
  useEffect(() => {
    const onDocsChanged = () => void load();
    window.addEventListener(DOCS_CHANGED_EVENT, onDocsChanged);
    if (searchParams.get("import") === "1") openImportModal();
    return () => window.removeEventListener(DOCS_CHANGED_EVENT, onDocsChanged);
  }, [searchParams]);

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

  const rawQuery = query.trim();
  const q = rawQuery.toLowerCase();

  /** 章行匹配（标题 / 要点内容；空查询恒匹配）。 */
  const chapterMatch = (c: Chapter, d: SourceDocument) => {
    if (!q) return true;
    return (
      c.title.toLowerCase().includes(q) ||
      d.title.toLowerCase().includes(q) ||
      c.keyPoints.some((k) => k.toLowerCase().includes(q))
    );
  };
  /** 文档卡可见性：标题命中显全部章行；否则章行命中才显示（配合 q 过滤行）。 */
  const docKeep = (d: SourceDocument, rows: Chapter[]) => {
    if (!q) return true;
    if (d.title.toLowerCase().includes(q)) return true;
    return rows.length > 0;
  };
  const rowsFor = (d: SourceDocument, chapters: Chapter[]) => {
    const filtered =
      filter === "all" ? chapters : chapters.filter((c) => isChapterUnmet(masteryOf(c.id)));
    if (!q) return filtered;
    if (d.title.toLowerCase().includes(q)) return filtered;
    return filtered.filter((c) => chapterMatch(c, d));
  };

  /** 本次渲染需要展示的文档（搜索/过滤后）。 */
  const keptDocs = useMemo(
    () =>
      visibleDocs.filter((d) => {
        const rows = rowsFor(d, chaptersByDoc[d.id] ?? []);
        return docKeep(d, rows);
      }),
    // rowsFor 闭包依赖 filter/q/learner；显式列出依赖项。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visibleDocs, chaptersByDoc, filter, q, learner],
  );

  /** 文档级「最后学习」相对文案：取所有章测评/复习时间的最大者。 */
  const learnedWhen = (chapters: Chapter[]): string | undefined => {
    let last = 0;
    for (const c of chapters) {
      const unit = learner?.byUnit[c.id];
      if (!unit) continue;
      if (unit.lastAssessmentAt) last = Math.max(last, unit.lastAssessmentAt);
      if (unit.lastReviewedAt) last = Math.max(last, unit.lastReviewedAt);
    }
    if (!last) return undefined;
    const diffDay = Math.floor(Math.max(0, Date.now() - last) / 86_400_000);
    if (diffDay < 1) return cat.learnedToday;
    if (diffDay < 2) return cat.learnedYesterday;
    return cat.learnedAgo(diffDay);
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

  const searched = q.trim().length > 0;

  return (
    <PageContainer>
      <SectionTitle
        title={cat.title}
        subtitle={
          docs.length === 0
            ? cat.subtitleEmpty
            : cat.subtitleStats(docs.length, chapterCount, masteredCount, Math.round(MASTERY_THRESHOLD * 100))
        }
        action={
          <button
            onClick={openImportModal}
            className="rounded-md bg-accent px-3.5 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent/90"
          >
            ＋ {m.common.import}
          </button>
        }
      />

      {/* 页头工具栏：过滤 + 搜索 固定于文档列表上方 */}
      {docs.length > 0 ? (
        <div className="mb-1">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="flex rounded-lg border border-line bg-surface p-0.5">
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
                      filter === v ? "bg-accent text-white" : "text-ink-2 hover:text-ink-1"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={cat.searchPlaceholder}
              aria-label={cat.searchPlaceholder}
              spellCheck={false}
              className="h-8 w-64 rounded-md border border-line bg-surface px-3 text-sm text-ink-1 outline-none transition-colors placeholder:text-ink-3 focus:border-accent"
            />
          </div>
          <p className="mt-1.5 text-xs text-ink-3">{cat.hint}</p>
        </div>
      ) : null}

      {/* 空态：无任何资料 */}
      {docs.length === 0 ? (
        <Card className="mt-4 border-dashed">
          <p className="text-base font-semibold text-ink-1">{cat.emptyTitle}</p>
          <p className="mt-1 text-sm text-ink-2">{cat.emptyDesc}</p>
          <button
            onClick={openImportModal}
            className="mt-4 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/90"
          >
            {cat.emptyImport}
          </button>
        </Card>
      ) : visibleDocs.length === 0 && !searched ? (
        <Card className="mt-4 border-dashed">
          <p className="text-base font-semibold text-ink-1">{cat.doclessTitle}</p>
          <p className="mt-1 text-sm text-ink-2">{cat.doclessDesc(docs.length)}</p>
        </Card>
      ) : (
        <div className="mt-3 space-y-4">
          {keptDocs.map((doc) => {
            const chapters = chaptersByDoc[doc.id] ?? [];
            const rows = rowsFor(doc, chapters);
            const open = collapsed[doc.id] !== true;
            const docMastered = chapters.filter(
              (c) => (masteryOf(c.id) ?? 0) >= MASTERY_THRESHOLD,
            ).length;
            // 探索度 = 已涉猎（曾打开 / 有卷面掌握）章占比，非达标口径。
            const explored = chapters.filter(
              (c) => c.status !== "not-started" || (masteryOf(c.id) ?? 0) > 0,
            ).length;
            const exploredPct = Math.round((explored / Math.max(1, chapters.length)) * 100);
            const points = chapters.reduce((n, c) => n + c.keyPoints.length, 0);
            const when = learnedWhen(chapters);
            return (
              <div
                key={doc.id}
                className="overflow-hidden rounded-xl border border-line bg-surface"
              >
                {/* 文档卡头：类型 · 标题 · 元信息 + 探索度 / 就绪 Bar + 折叠 */}
                <button
                  type="button"
                  onClick={() =>
                    setCollapsed((p) => ({ ...p, [doc.id]: !(p[doc.id] !== true) }))
                  }
                  className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-subtle/50"
                  aria-expanded={open}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="shrink-0 rounded border border-line bg-subtle px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-3">
                        {formatLabel(doc.format, m)}
                      </span>
                      <span className="truncate text-[15px] font-semibold text-ink-1">
                        {doc.title}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-xs text-ink-3">
                      {cat.docMeta(chapters.length, points, when ?? cat.notLearned)}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-4">
                    <span className="w-44">
                      <Bar
                        value={chapters.length > 0 ? docMastered / chapters.length : 0}
                        target={MASTERY_THRESHOLD}
                        targetLabel={cat.targetLine}
                      />
                      <span className="mt-1 flex justify-between text-[10px] tabular-nums text-ink-3">
                        <span>{cat.exploredOf(exploredPct)}</span>
                        <span>{cat.docReady(docMastered, chapters.length)}</span>
                      </span>
                    </span>
                    <span
                      className={`text-xs text-ink-3 transition-transform ${open ? "rotate-90" : ""}`}
                    >
                      ›
                    </span>
                  </span>
                </button>

                {/* 章行（KnowledgeRow 同形态：状态点 + 序 + 标题 + 弱标签 + 掌握度） */}
                {open ? (
                  <div className="border-t border-line">
                    {rows.length === 0 ? (
                      <p className="px-4 py-3 text-sm text-ink-3">
                        {filter === "unmet" &&
                        chapters.every((c) => !isChapterUnmet(masteryOf(c.id)))
                          ? cat.unmetEmpty
                          : cat.searchEmpty(q)}
                      </p>
                    ) : (
                      rows.map((chapter) => {
                        const mastery = masteryOf(chapter.id) ?? 0;
                        const badge = chapterBadge(chapter.status, masteryOf(chapter.id), m);
                        return (
                          <Link
                            key={chapter.id}
                            to={`/learn/${chapter.id}`}
                            className="group flex items-center justify-between gap-3 border-b border-line px-4 py-2 transition-colors last:border-b-0 hover:bg-subtle/50"
                          >
                            <span className="flex min-w-0 items-center gap-2.5">
                              <span
                                className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotOf(chapter, mastery)}`}
                              />
                              <span className="w-6 shrink-0 text-right text-xs tabular-nums text-ink-3">
                                {chapter.order}
                              </span>
                              <span className="truncate text-sm text-ink-1">
                                {chapter.title || m.chapter.ordinal(chapter.order)}
                              </span>
                              <span className="hidden shrink-0 text-xs text-ink-3 sm:inline">
                                {badge.label}
                              </span>
                            </span>
                            <span className="flex shrink-0 items-center gap-3">
                              <span className="w-10 text-right text-xs tabular-nums text-ink-2">
                                {Math.round(mastery * 100)}%
                              </span>
                              <span className="text-xs text-ink-3 transition-transform group-hover:translate-x-0.5">
                                ›
                              </span>
                            </span>
                          </Link>
                        );
                      })
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}

          {/* 搜索无结果 */}
          {searched && keptDocs.length === 0 ? (
            <Card className="border-dashed">
              <p className="text-base font-semibold text-ink-1">{cat.searchEmpty(q)}</p>
            </Card>
          ) : null}

          {/* 旧资料（有正文未切分）补切分 */}
          {!searched && doclessDocs.length > 0 ? (
            <Card className="border-dashed">
              <SectionTitle
                title={cat.unsplitCount(doclessDocs.length)}
                subtitle={cat.unsplitHint}
              />
              <div className="flex flex-wrap gap-2">
                {doclessDocs.map((d) => (
                  <div
                    key={d.id}
                    className="flex items-center gap-2 rounded-lg border border-line bg-subtle px-3 py-1.5 text-sm"
                  >
                    <span className="max-w-40 truncate text-ink-2">{d.title}</span>
                    <button
                      onClick={() => splitNow(d.id)}
                      disabled={busyDocId === d.id || !d.textPreview}
                      className="rounded-md bg-surface px-2 py-0.5 text-xs font-medium text-accent ring-1 ring-line transition-colors hover:bg-subtle disabled:opacity-40"
                    >
                      {busyDocId === d.id ? cat.splitting : cat.splitNow}
                    </button>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}
        </div>
      )}
    </PageContainer>
  );
}

/** 格式徽标文案（DocumentFormat → 字典，缺失回退）。 */
function formatLabel(format: DocumentFormat, m: Messages): string {
  const table = m.learn.format as unknown as Record<string, string>;
  return table[format] ?? table.fallback ?? format;
}

/** 行首状态语义点颜色（派生与 chapterBadge 同源：高掌握优先，再看状态机）。 */
function dotOf(chapter: Chapter, mastery: number): string {
  if ((mastery >= MASTERY_THRESHOLD && chapter.status !== "retake") || chapter.status === "mastered") {
    return "bg-state-mastered";
  }
  switch (chapter.status) {
    case "retake":
      return "bg-state-weak";
    case "ready":
    case "learning":
      return "bg-state-learning";
    default:
      return "bg-state-idle";
  }
}
