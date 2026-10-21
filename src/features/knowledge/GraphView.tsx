/**
 * 图谱三态可视化（T6 · spec §5.4）—— Overview → Focus → Detail。
 *
 * - Overview：全图力导向布局，缺口节点（目标必需且掌握度 <80%）indigo 外圈脉冲；
 * - Focus：单击节点裁剪为一跳邻域，右侧侧栏展示详情与关系（可解释）；
 * - Detail：双击节点跳到列表态高亮该单元的来源文档（Evidence 回链）。
 *
 * 边视觉：prerequisite 虚线箭头 / related 实线 / parent·child 细实线；
 * example·contrast·application·source 不画边，聚焦后进侧栏文本（保持图面克制）。
 *
 * 绘制层为 React Flow（`@xyflow/react` v12）：平移 / 缩放 / 适配视图由库提供，
 * 布局仍用自研 `computeLayout`（确定性力导向）。图谱 → 元素的映射收在
 * `graph-flow-model.ts`（纯函数，可 node 直跑单测）。
 *
 * 归属资料解析：「双击回原文」与侧栏「查看原文」都走 `ownerDocIdOf` —— 优先用宿主
 * 注入的 `documentIdOf`，缺省才回落 `unit.sourceDocumentId`（跨文档图谱页必须注入，
 * 见 `docs/cross-document-concept-graph-design-2026-10.md` §3.3.1）。
 */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  ReactFlow,
  type Edge,
  type FitViewOptions,
  type NodeTypes,
  type ProOptions,
} from "@xyflow/react";
import type { KnowledgeGraph, KnowledgeRelation, KnowledgeUnit } from "../../domain";
import { relationsOf } from "../../domain";
import { BandBadge } from "../../components/primitives";
import { useI18n } from "../../i18n";
import { bandOf } from "../../engine";
import { unitAlias } from "../units";
import { MarkdownBlock } from "../learn/render/markdown-core";
import { computeLayout, degreeOf, neighborsOf } from "./layout";
import {
  GAP_THRESHOLD,
  buildFlowEdges,
  buildFlowNodes,
  isVisibleLink,
} from "./graph-flow-model";
import UnitNode from "./UnitNode";

/** ⚠️ 必须定义在组件外：定义在组件内会导致每次 render 生成新对象 → 无限重渲染。 */
const nodeTypes: NodeTypes = { unit: UnitNode };

/** 常量对象同样定义在组件外，避免每次 render 产生新引用。 */
const FIT_VIEW_OPTIONS: FitViewOptions = { padding: 0.15 };

const PRO_OPTIONS: ProOptions = { hideAttribution: true };

/** prerequisite 边的箭头（颜色 token 化；模型层只收值、不认识库类型）。 */
const ARROW_MARKER: Edge["markerEnd"] = {
  type: MarkerType.ArrowClosed,
  width: 14,
  height: 14,
  color: "var(--plos-ink-3)",
};

/** 画布高度：所有断点统一最小 500px（用户指定）。 */
const CANVAS_HEIGHT = "h-[500px]";

interface GraphViewProps {
  graph: KnowledgeGraph;
  /** unitId → mastery（0..1）。 */
  masteryByUnit: Record<string, number>;
  /** 当前目标必需的单元（缺口 = 必需且 <80%）。 */
  requiredUnitIds: string[];
  /** 导入后新写入的单元 id（琥珀色虚线外圈提示）。 */
  highlightIds?: string[];
  /** Detail 态：双击节点跳到该单元的来源资料（归属解析见 `documentIdOf`）。 */
  onOpenDocument?: (docId: string) => void;
  /**
   * N5 概念层回归：替代默认「/study/session?unit=」跳转，由宿主（章图谱页）
   * 注入带章上下文的复习入口（?chapterId=&unit=）。缺省回退 V1 直链。
   */
  onReviewUnit?: (unitId: string) => void;
  /**
   * 宿主注入的「单元 → 归属资料 id」解析（跨文档图谱页必需）。
   *
   * ⚠️ 真实数据里 `KnowledgeUnit.sourceDocumentId` **恒为 `undefined`**（两条概念抽取
   * 管道都不写它，见 `docs/cross-document-concept-graph-design-2026-10.md` §3.3.1），
   * 所以「双击回原文」与侧栏「查看原文」这两条既有路径在本组件里全靠它判定；
   * 跨文档页必须注入，否则两个入口会静默失效。
   *
   * 缺省回退 `unit.sourceDocumentId`（既有行为）—— 章图谱页 / 资料「概念」Tab
   * 不传此 prop，行为与改造前逐字节一致。
   */
  documentIdOf?: (unit: KnowledgeUnit) => string | undefined;
}

export default function GraphView({
  graph,
  masteryByUnit,
  requiredUnitIds,
  highlightIds = [],
  onOpenDocument,
  onReviewUnit,
  documentIdOf,
}: GraphViewProps) {
  const navigate = useNavigate();
  const { m } = useI18n();
  const k = m.knowledge;
  const [focusId, setFocusId] = useState<string | undefined>();

  /** 归属资料的唯一取值口：先问宿主注入，再回落既有字段。 */
  const ownerDocIdOf = (u?: KnowledgeUnit): string | undefined =>
    u ? (documentIdOf ? documentIdOf(u) : u.sourceDocumentId) : undefined;

  const visibleRelations = useMemo(
    () => graph.relations.filter((r) => isVisibleLink(r.type)),
    [graph.relations],
  );

  const positions = useMemo(
    () => computeLayout({ units: graph.units, relations: visibleRelations }),
    [graph.units, visibleRelations],
  );

  // Focus 态：裁剪到选中节点 + 一跳邻居，其余淡出。
  // 防护：焦点单元在当前图谱内已不存在（如重新提炼概念后）→ 不聚焦，全图正常显示。
  const focusSet = useMemo(() => {
    if (!focusId) return undefined;
    if (!graph.units.some((u) => u.id === focusId)) return undefined;
    const set = neighborsOf(visibleRelations, focusId);
    set.add(focusId);
    return set;
  }, [focusId, graph.units, visibleRelations]);

  const nodes = useMemo(
    () =>
      buildFlowNodes({
        graph,
        positions,
        masteryByUnit,
        requiredUnitIds,
        highlightIds,
        focusSet,
      }),
    [graph, positions, masteryByUnit, requiredUnitIds, highlightIds, focusSet],
  );

  const edges = useMemo(
    () => buildFlowEdges(graph, focusSet, { arrowMarker: ARROW_MARKER }),
    [graph, focusSet],
  );

  const focusUnit = focusId ? graph.units.find((u) => u.id === focusId) : undefined;
  const focusRelations = focusId ? relationsOf(graph, focusId) : [];
  /** 已知别名的副标题；未命中时整段省略 —— 绝不显示裸 id（AI 提炼的概念不在别名表里）。 */
  const focusAlias = focusUnit ? unitAlias(focusUnit.id) : undefined;

  const relationUnit = (r: KnowledgeRelation): KnowledgeUnit | undefined =>
    graph.units.find((u) => u.id === r.fromId || u.id === r.toId);

  // 空图谱兜底：不挂载 React Flow（避免空画布带来的 fitView 异常与无谓渲染）。
  if (graph.units.length === 0) {
    return (
      <div className={`${CANVAS_HEIGHT} rounded-xl border border-dashed border-line`} />
    );
  }

  return (
    // 窄屏：侧栏堆叠到画布下方（lg 起才并排）
    <div className="flex flex-col gap-4 lg:flex-row">
      {/* 图谱画布 */}
      <div className="relative min-w-0 flex-1 overflow-hidden rounded-xl border border-line bg-surface h-200">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={FIT_VIEW_OPTIONS}
          minZoom={0.35}
          maxZoom={2.4}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          proOptions={PRO_OPTIONS}
          onNodeClick={(_, node) => setFocusId((prev) => (prev === node.id ? prev : node.id))}
          onNodeDoubleClick={(_, node) => {
            const docId = ownerDocIdOf(graph.units.find((u) => u.id === node.id));
            if (docId && onOpenDocument) {
              onOpenDocument(docId);
            }
          }}
          onPaneClick={() => setFocusId(undefined)}
          className={CANVAS_HEIGHT}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={16}
            size={1}
            color="var(--plos-line)"
          />
          <Controls
            showInteractive={false}
            className="[&>button]:border-line [&>button]:bg-surface [&>button]:text-ink-2"
          />
        </ReactFlow>

        {/* 操作提示（顶部角标） */}
        <div className="pointer-events-none absolute right-3 top-3 rounded-full bg-white/90 px-3 py-1 text-[11px] text-ink-3 ring-1 ring-line">
          {k.hintPill}
        </div>
      </div>

      {/* 聚焦侧栏：窄屏整宽，宽屏固定 288px */}
      <aside className="w-full shrink-0 lg:w-72">
        {focusUnit ? (
          <div className="sticky top-4 space-y-4">
            <div className="rounded-xl border border-line bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <h4 className="text-sm font-semibold text-ink-1">{focusUnit.title}</h4>
                <BandBadge band={bandOf(masteryByUnit[focusUnit.id] ?? 0)} />
              </div>
              <p className="mt-1 text-xs text-ink-3">
                {focusAlias ? `${focusAlias} · ` : ""}
                {k.masteryOf(Math.round((masteryByUnit[focusUnit.id] ?? 0) * 100), degreeOf(graph.relations, focusUnit.id))}
              </p>
              {focusUnit.summary ? (
                <MarkdownBlock
                  text={focusUnit.summary}
                  className="mt-2 text-sm leading-6 text-ink-2"
                />
              ) : (
                <p className="mt-2 text-xs text-ink-3">{k.noSummary}</p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() =>
                    onReviewUnit
                      ? onReviewUnit(focusUnit.id)
                      : navigate(`/study/session?unit=${focusUnit.id}`)
                  }
                  className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary"
                >
                  {k.review}
                </button>
                {ownerDocIdOf(focusUnit) ? (
                  <button
                    onClick={() => onOpenDocument?.(ownerDocIdOf(focusUnit)!)}
                    className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-2 hover:bg-subtle"
                  >
                    {k.viewSource}
                  </button>
                ) : null}
              </div>
              {requiredUnitIds.includes(focusUnit.id) &&
              (masteryByUnit[focusUnit.id] ?? 0) < GAP_THRESHOLD ? (
                <p className="mt-2 rounded-md bg-learning-soft px-2 py-1 text-[11px] text-primary">
                  {k.gapNote}
                </p>
              ) : null}
            </div>

            {/* 关系清单（含不画边的关系类型，保证信息不丢失） */}
            {focusRelations.length > 0 ? (
              <div className="rounded-xl border border-line bg-white p-4 shadow-sm">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-3">
                  {k.relationsTitle}
                </p>
                <ul className="space-y-1.5">
                  {focusRelations.map((r) => {
                    const other = relationUnit(r);
                    const label = k.rel[r.type] ?? r.type;
                    return (
                      <li key={r.id} className="flex items-center justify-between gap-2 text-sm">
                        <button
                          onClick={() => setFocusId(r.fromId === focusUnit.id ? r.toId : r.fromId)}
                          className="min-w-0 truncate text-ink-1 hover:text-primary"
                        >
                          {other ? other.title : ""}
                        </button>
                        <span className="shrink-0 rounded-full bg-subtle px-2 py-0.5 text-[11px] text-ink-2">
                          {label}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : (
              <div className="rounded-xl border border-line bg-white p-4 shadow-sm">
                <p className="text-xs text-ink-3">{k.noRelations}</p>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-line bg-white/60 p-4 text-sm text-ink-3">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-3">{k.focusEyebrow}</p>
            {k.focusPlaceholder}
          </div>
        )}
      </aside>
    </div>
  );
}
