/**
 * 图谱三态可视化（T6 · spec §5.4）—— Overview → Focus → Detail。
 *
 * - Overview：全图力导向布局，缺口节点（目标必需且掌握度 <80%）indigo 外圈脉冲；
 * - Focus：单击节点裁剪为一跳邻域，右侧侧栏展示详情与关系（可解释）；
 * - Detail：双击节点跳到列表态高亮该单元的来源文档（Evidence 回链）。
 *
 * 边视觉：prerequisite 虚线箭头 / related 实线 / parent·child 细实线；
 * example·contrast·application·source 不画边，聚焦后进侧栏文本（保持图面克制）。
 */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type {
  KnowledgeGraph,
  KnowledgeRelation,
  KnowledgeUnit,
  RelationType,
} from "../../domain";
import { relationsOf } from "../../domain";
import { BandBadge } from "../../components/primitives";
import { bandOf } from "../../engine";
import { unitTitle } from "../units";
import {
  GRAPH_H,
  GRAPH_W,
  computeLayout,
  degreeOf,
  neighborsOf,
} from "./layout";

/** 图谱中绘制为边的关系类型（其余类型仅在侧栏文本呈现）。 */
const VISIBLE_LINK: ReadonlySet<RelationType> = new Set([
  "prerequisite",
  "related",
  "parent",
  "child",
]);

const REL_LABELS: Record<RelationType, string> = {
  prerequisite: "前置",
  related: "相关",
  parent: "父级",
  child: "子级",
  example: "示例",
  contrast: "对比",
  application: "应用",
  source: "来源",
};

/** 掌握度四色（与 BandBadge 语义一致，供 SVG 节点使用）。 */
const BAND_SVG: Record<string, { fill: string; stroke: string }> = {
  "not-started": { fill: "#f8fafc", stroke: "#cbd5e1" },
  learning: { fill: "#fef2f2", stroke: "#f87171" },
  proficient: { fill: "#fffbeb", stroke: "#fbbf24" },
  mastered: { fill: "#ecfdf5", stroke: "#34d399" },
};

export const GAP_THRESHOLD = 0.8;

interface GraphViewProps {
  graph: KnowledgeGraph;
  /** unitId → mastery（0..1）。 */
  masteryByUnit: Record<string, number>;
  /** 当前目标必需的单元（缺口 = 必需且 <80%）。 */
  requiredUnitIds: string[];
  /** 导入后新写入的单元 id（琥珀色虚线外圈提示）。 */
  highlightIds?: string[];
  /** Detail 态：切到列表并高亮该来源文档（unit.sourceDocumentId 存在时调用）。 */
  onOpenDocument?: (docId: string) => void;
}

const TEXT_COLOR = "#334155";

function nodeKindShape(unit: KnowledgeUnit): "diamond" | "round" {
  return unit.kind === "skill" ? "diamond" : "round";
}

/** 中文/英文混合标题的粗略宽度估算。 */
function nodeWidth(title: string): number {
  const w = [...title].reduce((acc, ch) => acc + (ch.charCodeAt(0) > 255 ? 13 : 7.5), 0) + 22;
  return Math.min(170, Math.max(64, w));
}

export default function GraphView({
  graph,
  masteryByUnit,
  requiredUnitIds,
  highlightIds = [],
  onOpenDocument,
}: GraphViewProps) {
  const navigate = useNavigate();
  const [focusId, setFocusId] = useState<string | undefined>();
  const [view, setView] = useState({ k: 1, tx: 0, ty: 0 });

  const visibleRelations = useMemo(
    () => graph.relations.filter((r) => VISIBLE_LINK.has(r.type)),
    [graph.relations],
  );

  const positions = useMemo(
    () => computeLayout({ units: graph.units, relations: visibleRelations }),
    [graph.units, visibleRelations],
  );

  // Focus 态：裁剪到选中节点 + 一跳邻居，其余淡出。
  const focusSet = useMemo(() => {
    if (!focusId) return undefined;
    const set = neighborsOf(visibleRelations, focusId);
    set.add(focusId);
    return set;
  }, [focusId, visibleRelations]);

  const focusUnit = focusId ? graph.units.find((u) => u.id === focusId) : undefined;
  const focusRelations = focusId ? relationsOf(graph, focusId) : [];

  /** 画布手势：拖拽平移 + 滚轮缩放。 */
  const onWheel = (e: React.WheelEvent) => {
    const factor = e.deltaY < 0 ? 1.12 : 0.9;
    setView((v) => {
      const k = Math.min(2.4, Math.max(0.35, v.k * factor));
      // 以指针为锚缩放（近似）
      const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      return {
        k,
        tx: px - ((px - v.tx) / v.k) * k,
        ty: py - ((py - v.ty) / v.k) * k,
      };
    });
  };

  const relationUnit = (r: KnowledgeRelation): KnowledgeUnit | undefined =>
    graph.units.find((u) => u.id === r.fromId || u.id === r.toId);

  return (
    <div className="flex gap-4">
      {/* 图谱画布 */}
      <div className="relative min-w-0 flex-1 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <svg
          viewBox={`0 0 ${GRAPH_W} ${GRAPH_H}`}
          className="h-[560px] w-full touch-none select-none"
          onWheel={onWheel}
          onClick={(e) => {
            const target = e.target as Element;
            const el = target.closest?.("[data-unit-id]") as SVGElement | null;
            const uid = el?.getAttribute("data-unit-id");
            if (uid) {
              setFocusId((prev) => (prev === uid ? prev : uid));
            } else {
              setFocusId(undefined);
            }
          }}
          onDoubleClick={(e) => {
            const target = e.target as Element;
            const el = target.closest?.("[data-unit-id]") as SVGElement | null;
            const uid = el?.getAttribute("data-unit-id");
            if (!uid) return;
            const unit = graph.units.find((u) => u.id === uid);
            if (unit?.sourceDocumentId && onOpenDocument) {
              onOpenDocument(unit.sourceDocumentId);
            }
          }}
        >
          <defs>
            <marker
              id="arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" />
            </marker>
          </defs>

          <g transform={`translate(${view.tx} ${view.ty}) scale(${view.k})`}>
            {/* 边 */}
            {visibleRelations.map((r) => {
              const a = positions.get(r.fromId);
              const b = positions.get(r.toId);
              if (!a || !b) return null;
              const dashed = r.type === "prerequisite";
              const thin = r.type === "parent" || r.type === "child";
              const dimmed =
                focusSet && (!focusSet.has(r.fromId) || !focusSet.has(r.toId));
              return (
                <line
                  key={r.id}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={dashed ? "#94a3b8" : thin ? "#cbd5e1" : "#a5b4fc"}
                  strokeWidth={dashed ? 1.4 : thin ? 1 : 1.2}
                  strokeDasharray={dashed ? "5 4" : undefined}
                  markerEnd={dashed ? "url(#arrow)" : undefined}
                  opacity={dimmed ? 0.08 : 0.7}
                />
              );
            })}

            {/* 节点 */}
            {graph.units.map((unit) => {
              const p = positions.get(unit.id);
              if (!p) return null;
              const mastery = masteryByUnit[unit.id] ?? 0;
              const band = bandOf(mastery);
              const color = BAND_SVG[band] ?? BAND_SVG["not-started"];
              const isGap =
                requiredUnitIds.includes(unit.id) && mastery < GAP_THRESHOLD;
              const isHighlight = highlightIds.includes(unit.id);
              const w = nodeWidth(unit.title);
              const h = 32;
              const r = 9;
              const diamond = nodeKindShape(unit) === "diamond";
              const dimmed = focusSet && !focusSet.has(unit.id);

              let body: React.ReactNode;
              if (diamond) {
                body = (
                  <polygon
                    points={`${p.x},${p.y - h / 2} ${p.x + w / 2},${p.y} ${p.x},${p.y + h / 2} ${p.x - w / 2},${p.y}`}
                    fill={color.fill}
                    stroke={color.stroke}
                    strokeWidth={1.4}
                  />
                );
              } else {
                body = (
                  <rect
                    x={p.x - w / 2}
                    y={p.y - h / 2}
                    width={w}
                    height={h}
                    rx={r}
                    fill={color.fill}
                    stroke={color.stroke}
                    strokeWidth={1.4}
                  />
                );
              }

              return (
                <g
                  key={unit.id}
                  data-unit-id={unit.id}
                  className="cursor-pointer"
                  opacity={dimmed ? 0.1 : 1}
                  style={{ transition: "opacity 150ms ease" }}
                >
                  {body}
                  {/* 缺口节点：indigo 外圈脉冲 */}
                  {isGap ? (
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={h / 2 + 6}
                      fill="none"
                      stroke="#6366f1"
                      strokeWidth={1.6}
                      className="animate-pulse"
                    />
                  ) : null}
                  {/* 导入新节点：琥珀虚线外圈 */}
                  {isHighlight ? (
                    <rect
                      x={p.x - w / 2 - 7}
                      y={p.y - h / 2 - 7}
                      width={w + 14}
                      height={h + 14}
                      rx={r + 6}
                      fill="none"
                      stroke="#f59e0b"
                      strokeWidth={1.6}
                      strokeDasharray="5 4"
                    />
                  ) : null}
                  <text
                    x={p.x}
                    y={diamond ? p.y + 4 : p.y + 4.5}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={12.5}
                    fill={TEXT_COLOR}
                    style={{ pointerEvents: "none", fontWeight: 500 }}
                  >
                    {unit.title}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>

        {/* 操作提示（顶部角标） */}
        <div className="pointer-events-none absolute right-3 top-3 rounded-full bg-white/90 px-3 py-1 text-[11px] text-slate-400 ring-1 ring-slate-200">
          拖动平移 · 滚轮缩放 · 单击聚焦 · 双击看原文
        </div>
      </div>

      {/* 聚焦侧栏 */}
      <aside className="w-72 shrink-0">
        {focusUnit ? (
          <div className="sticky top-4 space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <h4 className="text-sm font-semibold text-slate-900">{focusUnit.title}</h4>
                <BandBadge band={bandOf(masteryByUnit[focusUnit.id] ?? 0)} />
              </div>
              <p className="mt-1 text-xs text-slate-400">
                {unitTitle(focusUnit.id)} · 掌握度 {Math.round((masteryByUnit[focusUnit.id] ?? 0) * 100)}% ·{" "}
                关联 {degreeOf(graph.relations, focusUnit.id)} 条
              </p>
              {focusUnit.summary ? (
                <p className="mt-2 text-sm text-slate-600">{focusUnit.summary}</p>
              ) : (
                <p className="mt-2 text-xs text-slate-400">该单元暂无摘要。</p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() => navigate(`/study/session?unit=${focusUnit.id}`)}
                  className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
                >
                  去复习 ▶
                </button>
                {focusUnit.sourceDocumentId ? (
                  <button
                    onClick={() => onOpenDocument?.(focusUnit.sourceDocumentId!)}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                  >
                    查看原文
                  </button>
                ) : null}
              </div>
              {requiredUnitIds.includes(focusUnit.id) &&
              (masteryByUnit[focusUnit.id] ?? 0) < GAP_THRESHOLD ? (
                <p className="mt-2 rounded-md bg-indigo-50 px-2 py-1 text-[11px] text-indigo-600">
                  这是当前目标的缺口单元。
                </p>
              ) : null}
            </div>

            {/* 关系清单（含不画边的关系类型，保证信息不丢失） */}
            {focusRelations.length > 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
                  关系
                </p>
                <ul className="space-y-1.5">
                  {focusRelations.map((r) => {
                    const other = relationUnit(r);
                    const label = REL_LABELS[r.type] ?? r.type;
                    return (
                      <li key={r.id} className="flex items-center justify-between gap-2 text-sm">
                        <button
                          onClick={() => setFocusId(r.fromId === focusUnit.id ? r.toId : r.fromId)}
                          className="min-w-0 truncate text-slate-700 hover:text-indigo-600"
                        >
                          {other && other.id !== focusUnit.id ? unitTitle(other.id) : other?.title}
                        </button>
                        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">
                          {label}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs text-slate-400">该单元暂无已建模的关系。</p>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-200 bg-white/60 p-4 text-sm text-slate-400">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">聚焦</p>
            单击节点查看单元详情与关系；双击带来源的单元可回看原文。
          </div>
        )}
      </aside>
    </div>
  );
}
