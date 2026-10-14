/**
 * 跨资料概念图谱页（`/graph`）—— README 独有条目（无 Feature 编号）。
 *
 * 方案真源：`docs/cross-document-concept-graph-design-2026-10.md`。
 *
 * 定位：把**全库**概念渲染成一张可探索的图 —— 此前概念只能在「章」或「资料」的
 * 笼子里看（`ChapterGraphPage` 单章 / `KnowledgeTab` 单份资料）。图谱数据层一直是
 * 全局单图（`storage.getGraph()` 无范围参数），缺的只是消费方。
 *
 * 两条硬约束写在方案里、实施时照此执行：
 *   1. 布局上限（`layout.ts` 自述 ≤ 50 节点，斥力 O(n²)）⇒ 按度数取核心子图
 *      （`CORE_LIMIT`）并提供资料筛选收窄范围；
 *   2. 归属资料的三级回退（`KnowledgeUnit.sourceDocumentId` 在真实数据里恒为
 *      `undefined`，方案 §3.3.1）⇒ 结果注入 `GraphView.documentIdOf`，否则本页的
 *      「双击回原文 / 查看原文」会静默失效。
 *
 * **只读页面**：不写 `saveGraph`、不新增 storage key、无 AI 调用、无网络请求。
 * 全部判定逻辑在 `cross-doc-graph-model.ts`（纯函数，`npm run test:xdoc` 覆盖）。
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Card } from "../../components/primitives";
import { PageContainer } from "../../components/layout/AppShell";
import { Button } from "../../components/ui/button";
import { useI18n } from "../../i18n";
import { storage } from "../../stores/useLoopStore";
import type { KnowledgeGraph, LearnerState } from "../../domain";
import GraphView from "./GraphView";
import {
  UNLINKED_KEY,
  coreSubgraphOf,
  ownerCounts,
  unitIdsOfDocuments,
  unitOwnerIndex,
  type DocRef,
} from "./cross-doc-graph-model";

export default function CrossDocGraphPage() {
  const { m } = useI18n();
  const t = m.knowledge.crossDoc;
  const navigate = useNavigate();
  const [params] = useSearchParams();
  /**
   * `?doc=` 深链预选 —— **只在首次挂载取值**：跟随 `searchParams` 变化会在每次
   * 重新读取时重置筛选集合，造成图谱闪烁（方案 §8.2 决策）。
   */
  const [presetDoc] = useState(() => params.get("doc"));

  const [graph, setGraph] = useState<KnowledgeGraph | undefined>();
  const [docs, setDocs] = useState<DocRef[] | undefined>();
  const [learner, setLearner] = useState<LearnerState | undefined>();
  const [owner, setOwner] = useState<Map<string, string> | undefined>();
  const [selected, setSelected] = useState<Set<string> | undefined>();
  const [loadError, setLoadError] = useState<string | undefined>();
  /** 重试计数：唯一的「重新读取」触发器。 */
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        setLoadError(undefined);
        const [documents, g, ls] = await Promise.all([
          storage.listDocuments(),
          storage.getGraph(),
          storage.getLearnerState(),
        ]);
        // ⚠️ 章必须并发读（本页唯一「贵」读）：串行会让首屏时间随资料数线性放大。
        const chapters = await Promise.all(
          documents.map(
            async (d) =>
              [d.id, (await storage.listChapters(d.id)).flatMap((c) => c.unitIds ?? [])] as const,
          ),
        );
        if (!alive) return;

        const refs: DocRef[] = documents.map((d) => ({ id: d.id, title: d.title }));
        const index = unitOwnerIndex(g, refs, new Map(chapters));
        const keys = [...ownerCounts(index).keys()];

        setGraph(g);
        setDocs(refs);
        setLearner(ls);
        setOwner(index);
        // 初始化筛选：`?doc=` 命中且有概念 → 只选它；否则全选。
        setSelected(presetDoc && keys.includes(presetDoc) ? new Set([presetDoc]) : new Set(keys));
      } catch (e) {
        if (alive) setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [nonce, presetDoc]);

  const masteryByUnit = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [id, mm] of Object.entries(learner?.byUnit ?? {})) out[id] = mm.mastery;
    return out;
  }, [learner]);

  /** 每份资料（含「未关联」桶）的概念计数 —— chip 上的数字。 */
  const counts = useMemo(
    () => (owner ? ownerCounts(owner) : new Map<string, number>()),
    [owner],
  );

  /** 核心子图：筛选变化即重算（纯函数，便宜）。 */
  const pick = useMemo(() => {
    if (!graph || !owner || !selected) return undefined;
    return coreSubgraphOf(graph, { unitIds: unitIdsOfDocuments(owner, selected) });
  }, [graph, owner, selected]);

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const selectAll = () => setSelected(new Set(counts.keys()));

  // ---- 渲染顺序：错误 → 加载 → 空 → 未选中 → 正常 ----
  // 错误态必须最先判定，否则存储故障会被显示成「还没有概念」，用户会以为数据丢了
  // （`LibraryPage` 的既有教训）。
  // ⚠️ `Card` 的签名只有 `{ children, className }`（`primitives.tsx`）——**不透传
  //    rest props**，故 `data-testid` 必须挂在外层包裹 `div` 上。
  if (loadError) {
    return (
      <PageContainer size="wide">
        <div data-testid="crossdoc-graph-error">
          <Card>
            <p className="text-base font-semibold text-ink-1">{t.loadFailedTitle}</p>
            <p className="mt-1 text-sm text-ink-3">{loadError}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setNonce((n) => n + 1)}>
                {t.retry}
              </Button>
              <Button size="sm" variant="outline" onClick={() => navigate("/learn")}>
                {t.backToLibrary}
              </Button>
            </div>
          </Card>
        </div>
      </PageContainer>
    );
  }

  if (!graph || !docs || !owner || !selected) {
    return <PageContainer size="wide">{t.opening}</PageContainer>;
  }

  if (graph.units.length === 0) {
    return (
      <PageContainer size="wide">
        <div data-testid="crossdoc-graph-empty">
          <Card>
            <p className="text-base font-semibold text-ink-1">{t.emptyTitle}</p>
            <p className="mt-1 text-sm text-ink-3">{t.emptyDesc}</p>
            <div className="mt-4">
              <Button size="sm" variant="outline" onClick={() => navigate("/learn")}>
                {t.goLibrary}
              </Button>
            </div>
          </Card>
        </div>
      </PageContainer>
    );
  }

  /** 「未关联」不是一个资料桶，不能计入覆盖数（同一屏的数字必须同口径）。 */
  const docCount = counts.size - (counts.has(UNLINKED_KEY) ? 1 : 0);

  return (
    <PageContainer size="wide">
      <div data-testid="crossdoc-graph-page">
        <h1 className="text-xl font-semibold text-ink-1">{t.title}</h1>
        <p className="mt-1 text-sm text-ink-2">{t.subtitle}</p>
        <p className="mt-2 text-xs text-ink-3" data-testid="crossdoc-graph-stats">
          {t.stats(pick?.total ?? 0, pick?.graph.relations.length ?? 0, docCount)}
        </p>

        {/*
          资料筛选 chip 行（多选）。
          ⚠️ 刻意不用下拉：`rules/dropdown-select` 规定下拉唯一来源是单选
          `components/ui/select`，多选要 Dialog/DropdownMenu；资料数通常个位数，
          一行 chip 更直接、零浮层，天然规避 ui:check 的两个禁区。
        */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs text-ink-3">{t.filterLabel}</span>
          <Button
            size="sm"
            variant="outline"
            data-testid="crossdoc-graph-filter-all"
            onClick={selectAll}
          >
            {t.filterAll}
          </Button>
          {docs
            .filter((d) => counts.has(d.id))
            .map((d) => (
              <Button
                key={d.id}
                size="sm"
                data-testid="crossdoc-graph-filter-doc"
                variant={selected.has(d.id) ? "default" : "outline"}
                onClick={() => toggle(d.id)}
              >
                {t.filterChip(d.title, counts.get(d.id) ?? 0)}
              </Button>
            ))}
          {counts.has(UNLINKED_KEY) ? (
            <Button
              size="sm"
              data-testid="crossdoc-graph-filter-unlinked"
              variant={selected.has(UNLINKED_KEY) ? "default" : "outline"}
              onClick={() => toggle(UNLINKED_KEY)}
            >
              {t.filterChip(t.filterUnlinked, counts.get(UNLINKED_KEY) ?? 0)}
            </Button>
          ) : null}
        </div>

        {pick?.truncated ? (
          <p
            data-testid="crossdoc-graph-truncated"
            className="mt-3 rounded-md bg-subtle px-3 py-2 text-xs text-ink-3"
          >
            {t.truncated(pick.shown, pick.total)}
          </p>
        ) : null}

        {!pick || pick.graph.units.length === 0 ? (
          <div data-testid="crossdoc-graph-no-selection" className="mt-4">
            <Card>
              <p className="text-base font-semibold text-ink-1">{t.noSelectionTitle}</p>
              <p className="mt-1 text-sm text-ink-3">{t.noSelectionDesc}</p>
              <div className="mt-4">
                <Button size="sm" variant="outline" onClick={selectAll}>
                  {t.selectAll}
                </Button>
              </div>
            </Card>
          </div>
        ) : (
          <div className="mt-4">
            <GraphView
              graph={pick.graph}
              masteryByUnit={masteryByUnit}
              /* 跨文档页没有「当前目标」⇒ 没有「必需单元」，语义诚实优先 */
              requiredUnitIds={[]}
              /* 归属解析注入：本页唯一必需的 GraphView 改造（方案 §3.3.1） */
              documentIdOf={(u) => {
                const id = owner.get(u.id);
                return id === undefined || id === UNLINKED_KEY ? undefined : id;
              }}
              onOpenDocument={(docId) => navigate(`/learn/doc/${docId}`)}
              /* onReviewUnit 不传 → GraphView 回退 /study/session?unit=<id>（全局概念复习） */
            />
          </div>
        )}
      </div>
    </PageContainer>
  );
}
