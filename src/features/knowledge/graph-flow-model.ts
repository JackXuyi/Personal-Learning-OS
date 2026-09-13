/**
 * 图谱 → React Flow 元素映射（纯函数 · node 可直跑单测）。
 *
 * 从 `GraphView.tsx` 抽出的原因（方案 §4.1）：React Flow 的渲染层属 DOM，
 * 受 `rules/no-headless-browser-validation` 约束无法自动校验，而「坐标换算 +
 * 视觉判定 + 边样式分派」恰恰最易错。抽成纯函数后可用 `npm run test:flow` 覆盖，
 * 把不可测面积压到最小。
 *
 * ⚠️ 硬约束：本文件对 `@xyflow/react` **只能 `import type`**。一旦引入运行时值
 * （如 `MarkerType`），node 直跑单测就会拉入 DOM 依赖而失败。箭头 marker 因此
 * 由组件层经 `BuildEdgesOptions.arrowMarker` 注入。
 *
 * 关键不变量：
 *  1. `node.position` 是节点【左上角】，而 `computeLayout` 给的是【中心点】
 *     → 必须减去半个宽高；
 *  2. `node.width` 必须与布局使用的估算宽度一致，否则实际渲染尺寸与布局假定
 *     不符，节点会重叠；
 *  3. 端点不在 `positions` 内的边一律丢弃（悬空边不入图）。
 */
import type { CSSProperties } from "react";
import type { Edge, Node } from "@xyflow/react";
import type { KnowledgeGraph, KnowledgeUnit, RelationType } from "../../domain";
import { MASTERY_THRESHOLD } from "../../domain";
import type { MasteryBand } from "../../engine";
import { bandOf } from "../../engine";
import type { Point } from "./layout";

/** 图谱中绘制为边的关系类型（其余类型仅在侧栏文本呈现，信息不丢失）。 */
const VISIBLE_LINK: ReadonlySet<RelationType> = new Set([
  "prerequisite",
  "related",
  "parent",
  "child",
]);

/** 节点盒尺寸（与改造前 SVG 的 `h = 32` / `r = 9` 一致）。 */
export const NODE_H = 32;
export const NODE_R = 9;

/** 淡出透明度：节点 0.1、边 0.08（沿用改造前取值）。 */
export const DIM_OPACITY = 0.1;
export const DIM_EDGE_OPACITY = 0.08;

/** 缺口高亮阈值：与领域达标线同源（P1 阈值收敛）。 */
export const GAP_THRESHOLD = MASTERY_THRESHOLD;

/** 该关系类型是否绘制为边。 */
export function isVisibleLink(type: RelationType): boolean {
  return VISIBLE_LINK.has(type);
}

/** 中文/英文混合标题的粗略宽度估算（自 GraphView 迁入，行为不变）。 */
export function nodeWidth(title: string): number {
  const w = [...title].reduce((acc, ch) => acc + (ch.charCodeAt(0) > 255 ? 13 : 7.5), 0) + 22;
  return Math.min(170, Math.max(64, w));
}

/**
 * 视觉档位：掌握度四色 + 形状。
 * 颜色一律走 PLOS 语义 token（改造前是硬编码 hex，见方案 §7.4 映射表）。
 * 返回 CSS 值而非 Tailwind class —— 节点主体用内嵌 SVG 绘制（菱形需精确复刻
 * 原 polygon 的「宽 w × 高 32」形状，旋转方块做不到等宽高），SVG 属性吃 CSS 值。
 */
export interface NodeVisual {
  shape: "diamond" | "round";
  /** 节点填充（CSS 值，token 派生；约等于原 hex 的 *-50 浅色）。 */
  fill: string;
  /** 节点描边（CSS 值，token 派生）。 */
  stroke: string;
}

const VISUAL_BY_BAND: Record<MasteryBand, Omit<NodeVisual, "shape">> = {
  "not-started": { fill: "var(--plos-surface)", stroke: "var(--plos-line)" },
  learning: {
    fill: "color-mix(in srgb, var(--plos-state-learning) 10%, white)",
    stroke: "var(--plos-state-learning)",
  },
  proficient: {
    fill: "color-mix(in srgb, var(--plos-state-weak) 10%, white)",
    stroke: "var(--plos-state-weak)",
  },
  mastered: {
    fill: "color-mix(in srgb, var(--plos-state-mastered) 10%, white)",
    stroke: "var(--plos-state-mastered)",
  },
};

/** skill 画菱形，其余画圆角矩形。 */
export function nodeVisualOf(unit: KnowledgeUnit, mastery: number): NodeVisual {
  return {
    shape: unit.kind === "skill" ? "diamond" : "round",
    ...(VISUAL_BY_BAND[bandOf(mastery)] ?? VISUAL_BY_BAND["not-started"]),
  };
}

/**
 * 自定义节点携带的数据。
 * 用 `type` 而非 `interface` —— React Flow 要求 `NodeData extends Record<string, unknown>`，
 * 而 interface 没有隐式索引签名，会不满足该约束。
 */
export type UnitNodeData = {
  unit: KnowledgeUnit;
  mastery: number;
  band: MasteryBand;
  /** required 且 mastery < GAP_THRESHOLD。 */
  isGap: boolean;
  /** 导入后新写入（琥珀虚线外圈）。 */
  isHighlight: boolean;
  /** 估算宽度（同时作为 `node.width`，保证布局与实际一致）。 */
  width: number;
  /** `unit.title`（节点内直接渲染，省一层取值）。 */
  title: string;
};

export type UnitFlowNode = Node<UnitNodeData, "unit">;

export interface BuildFlowInput {
  graph: KnowledgeGraph;
  /** `computeLayout` 输出（**中心点**坐标）。 */
  positions: Map<string, Point>;
  /** unitId → mastery（0..1）。 */
  masteryByUnit: Record<string, number>;
  /** 当前目标必需的单元（缺口 = 必需且 <80%）。 */
  requiredUnitIds: readonly string[];
  /** 导入后新写入的单元 id。 */
  highlightIds: readonly string[];
  /** 有值时非成员降至 `DIM_OPACITY`。 */
  focusSet?: ReadonlySet<string>;
}

export function buildFlowNodes(input: BuildFlowInput): UnitFlowNode[] {
  const { graph, positions, masteryByUnit, requiredUnitIds, highlightIds, focusSet } = input;
  return graph.units.flatMap((unit) => {
    const p = positions.get(unit.id);
    if (!p) return []; // 无坐标 → 不渲染（与改造前一致）
    const mastery = masteryByUnit[unit.id] ?? 0;
    const width = nodeWidth(unit.title);
    const node: UnitFlowNode = {
      id: unit.id,
      type: "unit",
      // 中心点 → 左上角（不变量 1）
      position: { x: p.x - width / 2, y: p.y - NODE_H / 2 },
      width, // 与布局估算一致（不变量 2）
      data: {
        unit,
        mastery,
        band: bandOf(mastery),
        isGap: requiredUnitIds.includes(unit.id) && mastery < GAP_THRESHOLD,
        isHighlight: highlightIds.includes(unit.id),
        width,
        title: unit.title,
      },
      style: {
        opacity: focusSet && !focusSet.has(unit.id) ? DIM_OPACITY : 1,
        transition: "opacity 150ms ease",
      },
      draggable: false, // D1：图是「读」的不是「画」的
      selectable: false,
    };
    return [node];
  });
}

/** 边样式（可单测：类型 → 描边 / 虚线 / 箭头 / 基线透明度）。 */
export interface EdgeVisual {
  stroke: string;
  strokeWidth: number;
  strokeDasharray?: string;
  /** 是否需要箭头 marker（由组件层注入具体值）。 */
  arrow: boolean;
  /** 非聚焦态的基线透明度。 */
  opacity: number;
}

const EDGE_VISUAL: Record<string, EdgeVisual> = {
  // 前置：灰虚线 + 箭头
  prerequisite: {
    stroke: "var(--plos-ink-3)",
    strokeWidth: 1.4,
    strokeDasharray: "5 4",
    arrow: true,
    opacity: 0.7,
  },
  // 相关：品牌色实线（较原 #a5b4fc 略深，故降透明度补偿）
  related: {
    stroke: "var(--plos-primary)",
    strokeWidth: 1.2,
    arrow: false,
    opacity: 0.5,
  },
  // 父子：最细的分隔线
  parent: { stroke: "var(--plos-line)", strokeWidth: 1, arrow: false, opacity: 0.7 },
  child: { stroke: "var(--plos-line)", strokeWidth: 1, arrow: false, opacity: 0.7 },
};

const FALLBACK_EDGE_VISUAL: EdgeVisual = {
  stroke: "var(--plos-line)",
  strokeWidth: 1,
  arrow: false,
  opacity: 0.7,
};

export function edgeVisualOf(type: RelationType): EdgeVisual {
  return EDGE_VISUAL[type] ?? FALLBACK_EDGE_VISUAL;
}

export interface BuildEdgesOptions {
  /**
   * 箭头 marker 的值（组件层注入 `MarkerType.ArrowClosed` 对象；测试可传任意字符串）。
   * 模型层不 import `@xyflow/react` 的运行时值，故需外部注入。
   */
  arrowMarker?: Edge["markerEnd"];
}

export function buildFlowEdges(
  graph: KnowledgeGraph,
  focusSet?: ReadonlySet<string>,
  opts?: BuildEdgesOptions,
): Edge[] {
  const ids = new Set(graph.units.map((u) => u.id));
  return graph.relations
    .filter((r) => isVisibleLink(r.type))
    // 悬空边（端点不在 units 内）丢弃：不画幽灵边（不变量 3）
    .filter((r) => ids.has(r.fromId) && ids.has(r.toId))
    .map((r) => {
      const v = edgeVisualOf(r.type);
      const dimmed = focusSet && (!focusSet.has(r.fromId) || !focusSet.has(r.toId));
      const style: CSSProperties = {
        stroke: v.stroke,
        strokeWidth: v.strokeWidth,
        strokeDasharray: v.strokeDasharray,
        opacity: dimmed ? DIM_EDGE_OPACITY : v.opacity,
        transition: "opacity 150ms ease",
      };
      const edge: Edge = {
        id: r.id,
        source: r.fromId,
        target: r.toId,
        type: "straight",
        style,
      };
      if (v.arrow && opts?.arrowMarker) edge.markerEnd = opts.arrowMarker;
      return edge;
    });
}
