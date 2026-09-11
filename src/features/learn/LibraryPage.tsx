/**
 * 资料库列表页（/learn；docs/library-module-design-2026-09.md §8.11）。
 *
 * 替代原 ChapterCatalogPage（文档卡内嵌章行的混合页）：资料是一等管理对象，
 * 卡片只展示「名称 / 导入时间 / 类型 / 来源 / 统计」，点击进详情页；
 * 资料级操作（重命名 / 元信息 / 替换 / 追加 / 删除 / 切分）经右上「⋯」菜单 +
 * 弹窗完成；导入复用全局 ImportModal（IMPORT_OPEN_EVENT）。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, SectionTitle } from "../../components/primitives";
import { Button } from "../../components/ui/button";
import { ConfirmDialog } from "../../components/ui/confirm-dialog";
import {
  DOCS_CHANGED_EVENT,
  PageContainer,
  notifyDocsChanged,
  openImportModal,
} from "../../components/layout/AppShell";
import { MASTERY_THRESHOLD } from "../../domain";
import type { Chapter, LearnerState, SourceDocument } from "../../domain";
import { sortChaptersByOrder } from "../../domain";
import { applyForgetting } from "../../engine";
import { hybridSearch } from "../../ai/retrieval/hybrid-search";
import type { SearchHit } from "../../ai/retrieval/hybrid-search";
import { createEmbedder } from "../../ai/embedding";
import { storage } from "../../stores/useLoopStore";
import { useIndexStore } from "../../stores/useIndexStore";
import { useI18n } from "../../i18n";
import { SegmentedTabs } from "../../components/primitives";
import DocumentCard from "./library/DocumentCard";
import type { DocActionKind } from "./library/DocActionsMenu";
import { SplitServiceError, splitDocumentNow } from "./split-service";
import { activeEmbeddingModel, autoIndexAfterImport } from "./index-service";
import {
  AppendDocModal,
  DeleteDocDialog,
  DocumentMetaDialog,
  RenameDocDialog,
  UpdateDocModal,
} from "./library/dialogs";

/** 正文检索段：命中片段的最大字符数（与方案 §7.1 一致）。 */
const HIT_SNIPPET_CHARS = 120;
/** 查询防抖时长（与方案 §7.4 一致）。 */
const SEARCH_DEBOUNCE_MS = 300;
/** 触发内容检索的最小查询长度（1 字符检索噪声过大）。 */
const MIN_QUERY_CHARS = 2;

type Filter = "all" | "unsplit" | "active";
type Sort = "newest" | "oldest" | "title";
type DialogState = { kind: DocActionKind; doc: SourceDocument };

export default function LibraryPage() {
  const { m } = useI18n();
  const lib = m.learn.library;
  const searchT = m.learn.search;
  const navigate = useNavigate();
  const [docs, setDocs] = useState<SourceDocument[]>([]);
  const [chaptersByDoc, setChaptersByDoc] = useState<Record<string, Chapter[]>>({});
  const [learner, setLearner] = useState<LearnerState | undefined>();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("newest");
  const [dialog, setDialog] = useState<DialogState | undefined>();
  /** 正在切分的资料 id（禁用重复触发 + 按钮态）。 */
  const [splitBusy, setSplitBusy] = useState<string>();
  /** 列表页就地切分的 inline 反馈（成功 / 无正文 / 未切出章）。 */
  const [notice, setNotice] = useState<string>();
  /** 待确认的重新切分目标（重构章节会迁移掌握度 → 必须确认）。 */
  const [confirmDoc, setConfirmDoc] = useState<SourceDocument>();
  /** 切分重入锁：state 更新异步，同帧连点需 ref 兜底，避免并发 saveChapters。 */
  const splitLock = useRef(false);
  /** 正文检索结果（RAG 接线后的 chunk 级命中）。 */
  const [contentHits, setContentHits] = useState<SearchHit[]>([]);
  const [searchMode, setSearchMode] = useState<"hybrid" | "fulltext">("fulltext");
  const [searching, setSearching] = useState(false);
  /** 向量索引进度（仅用于徽标提示，检索本身不等索引）。 */
  const indexRunning = useIndexStore((s) => s.running);
  const indexProgress = useIndexStore((s) => s.progress);

  const load = async () => {
    const [ds, ls] = await Promise.all([storage.listDocuments(), storage.getLearnerState()]);
    // 读时遗忘衰减（与首页/计划同口径；衰减视图，幂等不写回）。
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
    const h = () => void load();
    window.addEventListener(DOCS_CHANGED_EVENT, h);
    return () => window.removeEventListener(DOCS_CHANGED_EVENT, h);
  }, []);

  /**
   * 正文检索（内容级）：查询防抖 300ms → 混合检索（FTS + 向量，RRF 融合）。
   *
   * 与上面的「元信息过滤」分工明确：
   * - 元信息（标题 / 来源 / 章标题 / 要点）由页面本地过滤承担，决定**卡片网格**显示什么；
   * - 正文内容由本效果检索，决定**正文命中段**显示什么。
   * 两者互不替代——资料列表始终是页面主体（产品红线）。
   */
  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_QUERY_CHARS) {
      setContentHits([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      void hybridSearch(q, {
        storage,
        // 查询向量走本地 Embedder(与「当前使用模型」无关,D5)
        embedder: createEmbedder(activeEmbeddingModel()),
        limit: 8,
      })
        .then((r) => {
          if (cancelled) return;
          setContentHits(r.hits);
          setSearchMode(r.mode);
        })
        .catch(() => {
          // 检索失败不该打断页面：静默清空正文段（元信息结果照常显示）
          if (!cancelled) setContentHits([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  /** 过滤 + 搜索 + 排序后的可见资料。 */
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = docs.filter((d) => {
      if (q) {
        const hit =
          d.title.toLowerCase().includes(q) ||
          (d.source ?? "").toLowerCase().includes(q) ||
          (chaptersByDoc[d.id] ?? []).some(
            (c) =>
              c.title.toLowerCase().includes(q) ||
              c.keyPoints.some((k) => k.toLowerCase().includes(q)),
          );
        if (!hit) return false;
      }
      const chapters = chaptersByDoc[d.id] ?? [];
      if (filter === "unsplit") return chapters.length === 0;
      if (filter === "active") {
        return chapters.some((c) => {
          const unit = learner?.byUnit[c.id];
          return c.status !== "not-started" || (unit?.mastery ?? 0) > 0;
        });
      }
      return true;
    });
    const sorted = [...rows];
    if (sort === "newest") sorted.sort((a, b) => b.importedAt - a.importedAt);
    if (sort === "oldest") sorted.sort((a, b) => a.importedAt - b.importedAt);
    if (sort === "title") sorted.sort((a, b) => a.title.localeCompare(b.title));
    return sorted;
  }, [docs, chaptersByDoc, learner, query, filter, sort]);

  const stats = useMemo(() => {
    const chapters = docs.reduce((n, d) => n + (chaptersByDoc[d.id] ?? []).length, 0);
    const mastered = docs.reduce(
      (n, d) =>
        n +
        (chaptersByDoc[d.id] ?? []).filter(
          (c) => (learner?.byUnit[c.id]?.mastery ?? 0) >= MASTERY_THRESHOLD,
        ).length,
      0,
    );
    return { docs: docs.length, chapters, mastered };
  }, [docs, chaptersByDoc, learner]);

  /**
   * 列表页就地切分（纯代码、零 AI、确定性无重试，与详情页 SplitTab 同源服务）。
   * 成功后广播 DOCS_CHANGED_EVENT 并重载本页；失败按类型化错误给文案，不改动旧章。
   */
  const runSplit = async (doc: SourceDocument) => {
    if (splitLock.current) return;
    splitLock.current = true;
    setSplitBusy(doc.id);
    setNotice(undefined);
    try {
      const result = await splitDocumentNow(doc, { storage });
      setNotice(
        m.learn.detail.split.result(
          result.chapters.length,
          result.carriedMastery,
          result.droppedMastery,
          false,
        ),
      );
      // 列表页就地重切同样使旧向量失效 → 补后台重算入队（G1）。
      autoIndexAfterImport();
      notifyDocsChanged();
      await load();
    } catch (e) {
      const kind = e instanceof SplitServiceError ? e.kind : undefined;
      setNotice(
        kind === "no-body" ? m.learn.detail.split.noBody : m.learn.detail.split.noChapters,
      );
    } finally {
      splitLock.current = false;
      setSplitBusy(undefined);
    }
  };

  const onCardAction = (doc: SourceDocument, kind: DocActionKind) => {
    // 切分：纯代码操作，列表页就地执行；重新切分会重构章节并迁移掌握度 → 先确认。
    if (kind === "split") {
      void runSplit(doc);
      return;
    }
    if (kind === "resplit") {
      setConfirmDoc(doc);
      return;
    }
    setDialog({ kind, doc });
  };

  const searched = query.trim().length > 0;

  return (
    <PageContainer>
      <SectionTitle
        title={lib.title}
        subtitle={
          docs.length === 0
            ? lib.subtitleEmpty
            : lib.subtitleStats(
                stats.docs,
                stats.chapters,
                stats.mastered,
                Math.round(MASTERY_THRESHOLD * 100),
              )
        }
        action={
          <Button onClick={openImportModal} size="sm" className="px-3.5 text-sm">
            ＋ {m.common.import}
          </Button>
        }
      />

      {docs.length > 0 ? (
        <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
          <SegmentedTabs<Filter>
            value={filter}
            onChange={setFilter}
            testIdPrefix="library-filter"
            items={[
              { value: "all", label: lib.filterAll },
              { value: "unsplit", label: lib.filterUnsplit },
              { value: "active", label: lib.filterActive },
            ]}
          />
          <div className="flex items-center gap-2">
            <SegmentedTabs<Sort>
              value={sort}
              onChange={setSort}
              testIdPrefix="library-sort"
              items={[
                { value: "newest", label: lib.sortNewest },
                { value: "oldest", label: lib.sortOldest },
                { value: "title", label: lib.sortTitle },
              ]}
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={lib.searchPlaceholder}
              aria-label={lib.searchPlaceholder}
              spellCheck={false}
              data-testid="library-search"
              className="h-8 w-56 rounded-md border border-line bg-surface px-3 text-sm text-ink-1 outline-none transition-colors placeholder:text-ink-3 focus:border-primary"
            />
          </div>
        </div>
      ) : null}

      {/* 正文命中（RAG 内容级检索）：无命中 / 未搜索时整段隐藏，不留空壳占位 */}
      {searched && (searching || contentHits.length > 0) ? (
        <section data-testid="learn-content-hits" className="mt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-ink-3">
              {searching ? searchT.loading : searchT.contentHits(contentHits.length)}
            </p>
            {indexRunning && indexProgress.total > 0 ? (
              <span className="text-xs text-ink-3">
                {searchT.indexing(indexProgress.done, indexProgress.total)}
              </span>
            ) : searchMode === "fulltext" ? (
              <span className="text-xs text-ink-3" title={searchT.fulltextOnlyHint}>
                {searchT.fulltextOnly} ⓘ
              </span>
            ) : null}
          </div>
          {contentHits.length > 0 ? (
            <div className="mt-2 space-y-2">
              {contentHits.map((hit) => (
                <button
                  key={hit.chunk.id}
                  type="button"
                  onClick={() => navigate(`/learn/chapter/${hit.chunk.chapterId}`)}
                  className="block w-full rounded-lg border border-line bg-surface p-3 text-left transition-colors focus-visible:border-primary focus-visible:outline-none hover:border-primary"
                >
                  <p className="flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
                    <span className="text-ink-2">{hit.docTitle}</span>
                    {hit.chapterTitle ? <span>· {hit.chapterTitle}</span> : null}
                    {hit.semantic ? (
                      <span className="rounded border border-line px-1 text-[10px] text-primary">
                        {searchT.semanticTag}
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-ink-2">
                    {hit.chunk.content.length <= HIT_SNIPPET_CHARS
                      ? hit.chunk.content
                      : `${hit.chunk.content.slice(0, HIT_SNIPPET_CHARS)}…`}
                  </p>
                </button>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {/* 就地切分的 inline 反馈（无 toast 体系，与详情页 SplitTab 同款样式） */}
      {notice ? (
        <div
          data-testid="library-notice"
          className="mt-3 rounded-lg border border-line bg-surface p-3"
        >
          <p className="text-xs text-ink-2">{notice}</p>
        </div>
      ) : null}

      {docs.length === 0 ? (
        <Card className="mt-4 border-dashed">
          <p className="text-base font-semibold text-ink-1">{lib.emptyTitle}</p>
          <p className="mt-1 text-sm text-ink-2">{lib.emptyDesc}</p>
          <Button onClick={openImportModal} className="mt-4">
            {lib.emptyImport}
          </Button>
        </Card>
      ) : visible.length === 0 ? (
        <Card className="mt-4 border-dashed">
          <p className="text-base font-semibold text-ink-1">
            {searched ? lib.searchEmpty(query.trim()) : lib.filterAll}
          </p>
        </Card>
      ) : (
        <div data-testid="library-grid" className="mt-3 grid gap-4 sm:grid-cols-2">
          {visible.map((d) => (
            <DocumentCard
              key={d.id}
              doc={d}
              chapters={chaptersByDoc[d.id] ?? []}
              learner={learner}
              busy={splitBusy === d.id}
              onAction={(kind) => onCardAction(d, kind)}
            />
          ))}
        </div>
      )}

      {/* 弹窗组：一次只开一个，关闭即清 */}
      <RenameDocDialog doc={dialog?.kind === "rename" ? dialog.doc : undefined} onClose={() => setDialog(undefined)} />
      <DocumentMetaDialog doc={dialog?.kind === "meta" ? dialog.doc : undefined} onClose={() => setDialog(undefined)} />
      <UpdateDocModal doc={dialog?.kind === "replace" ? dialog.doc : undefined} onClose={() => setDialog(undefined)} />
      <AppendDocModal doc={dialog?.kind === "append" ? dialog.doc : undefined} onClose={() => setDialog(undefined)} />
      <DeleteDocDialog
        doc={dialog?.kind === "delete" ? dialog.doc : undefined}
        onClose={() => setDialog(undefined)}
      />

      {/* 重新切分确认（与详情页 SplitTab 同文案；确认后回列表就地执行） */}
      <ConfirmDialog
        open={confirmDoc !== undefined}
        onOpenChange={(open) => {
          if (!open) setConfirmDoc(undefined);
        }}
        title={m.learn.detail.split.confirmTitle}
        description={m.learn.detail.split.confirmDesc(
          confirmDoc ? (chaptersByDoc[confirmDoc.id] ?? []).length : 0,
        )}
        confirmLabel={m.learn.detail.split.confirmOk}
        cancelLabel={m.common.cancel}
        onConfirm={() => {
          const target = confirmDoc;
          setConfirmDoc(undefined);
          if (target) void runSplit(target);
        }}
      />
    </PageContainer>
  );
}
