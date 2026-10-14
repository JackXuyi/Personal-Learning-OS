/**
 * 跨文档概念图谱的纯计算层（方案 `docs/cross-document-concept-graph-design-2026-10.md` §4.3.1）。
 *
 * 为什么单独成模块：本页面渲染层受 `rules/no-headless-browser-validation` 约束不可自动
 * 校验，故把「归属解析 / 筛选 / 度数统计 / 核心子图裁剪」全部压进纯函数，用
 * `npm run test:xdoc` 直跑覆盖 —— 无 React、无 DOM、不接触 storage。
 *
 * ⚠️ 关键实测（方案 §3.3.1）：`KnowledgeUnit.sourceDocumentId` 在真实数据里**恒为
 * `undefined`**（两条概念抽取管道都不写它）⇒ 归属解析必须走三级回退，否则整页
 * 只有一个「未关联资料」桶。
 *
 * ⚠️ 布局硬上限：`features/knowledge/layout.ts` 自述「规模假设 ≤ 50 节点」且斥力 O(n²)
 * ⇒ 全库概念必须**裁剪后**再送布局（`CORE_LIMIT`，见下）。
 */
import type { KnowledgeGraph, KnowledgeUnit } from "../../domain";
import { subgraphOf } from "../../engine/graph-engine";

/** 归属解析不到资料的单元统一落这个桶（非真实 docId，不会与 id 冲突）。 */
export const UNLINKED_KEY = "__unlinked__";

/**
 * 核心子图上限。
 *
 * ⚠️ 硬约束：不得超过 `features/knowledge/layout.ts` 自述的「≤ 50 节点」规模假设
 * （斥力 O(n²)）。改这个常量前先重读 layout.ts 顶部注释 —— 单测 `TC-EDGE-04` 会拦。
 */
export const CORE_LIMIT = 40;

/** 资料的最小引用形态（页面只需 id 与 title，避免依赖整个 `SourceDocument`）。 */
export interface DocRef {
  id: string;
  title: string;
}

/**
 * unitId → 归属资料 id（或 `UNLINKED_KEY`）。
 *
 * 三级回退（§3.3.1 实测：`sourceDocumentId` 在真实数据里恒为 `undefined`）：
 *   ① `unit.evidence?.documentId` —— 锚定成功的概念才有（AI 给的 quote 在正文中定位
 *      不到时，`evidence` 整体省略而概念照常入库，属既定「诚实降级」）；
 *   ② 反查 `chapters[].unitIds`  —— 最可靠：概念落库时必然写进所属章的 unitIds；
 *   ③ `unit.sourceDocumentId`    —— 知识包导入重映射会写。
 *
 * 命中的 docId **必须仍在 `documents` 内** —— 指向已删资料的悬空引用按「未关联」处理
 * （数据层不塞文案；UI 用 i18n 标签兜底，绝不显示裸 id）。
 *
 * 确定性：反查表按 docId 字典序建立、首个命中即锁定 ⇒ 同一单元被多份资料的章引用时
 * 结果稳定，不随 `Map` 迭代顺序漂移。
 */
export function unitOwnerIndex(
  graph: KnowledgeGraph,
  documents: readonly DocRef[],
  chapterUnitIdsByDoc: ReadonlyMap<string, readonly string[]>,
): Map<string, string> {
  const known = new Set(documents.map((d) => d.id));

  // ② 反查表：按 docId 字典序建表，保证「同一单元出现在多份资料的章里」时取值稳定。
  const byChapter = new Map<string, string>();
  for (const docId of [...chapterUnitIdsByDoc.keys()].sort()) {
    for (const unitId of chapterUnitIdsByDoc.get(docId) ?? []) {
      if (!byChapter.has(unitId)) byChapter.set(unitId, docId);
    }
  }

  const out = new Map<string, string>();
  for (const u of graph.units) {
    const ev = u.evidence?.documentId;
    const viaChapter = byChapter.get(u.id);
    const owner =
      ev !== undefined && known.has(ev)
        ? ev
        : viaChapter !== undefined && known.has(viaChapter)
          ? viaChapter
          : u.sourceDocumentId !== undefined && known.has(u.sourceDocumentId)
            ? u.sourceDocumentId
            : UNLINKED_KEY;
    out.set(u.id, owner);
  }
  return out;
}

/** 每份资料（含 `UNLINKED_KEY`）的概念计数 —— 供筛选 chip 显示。 */
export function ownerCounts(ownerIndex: ReadonlyMap<string, string>): Map<string, number> {
  const out = new Map<string, number>();
  for (const docId of ownerIndex.values()) out.set(docId, (out.get(docId) ?? 0) + 1);
  return out;
}

/** 选中的 docId 集合（可含 `UNLINKED_KEY`）→ 保留的 unitId 集合。 */
export function unitIdsOfDocuments(
  ownerIndex: ReadonlyMap<string, string>,
  docIds: ReadonlySet<string>,
): Set<string> {
  const out = new Set<string>();
  for (const [unitId, docId] of ownerIndex) if (docIds.has(docId)) out.add(unitId);
  return out;
}

export interface CorePick {
  /** 裁剪后的子图（可直接喂 `GraphView`）。 */
  graph: KnowledgeGraph;
  /** 筛选范围内的单元总数。 */
  total: number;
  /** 实际渲染的单元数。 */
  shown: number;
  truncated: boolean;
  /** 被截断掉的单元数（`total − shown`）。 */
  hidden: number;
}

/**
 * 核心子图：在「筛选后的池」内按度数降序取前 `limit` 个单元。
 *
 * - 度数**只在池内统计**（两端都在池里的边才计数）⇒ 筛选后语义一致：
 *   「在这批资料里，谁最核心」。
 * - 排序确定性：度数 desc → `title` asc → `id` asc。显式给全序，不依赖
 *   `Array.prototype.sort` 的稳定性（Node ≥ 12 已稳定，但显式更不易被将来改动破坏）。
 * - 度数相同且名额有余时，**度数为 0 的孤立概念也会入选**（它们仍可复习 / 回原文，
 *   不该被静默丢弃）。
 * - 输出图的 `units` 顺序沿用 `subgraphOf`（即 `graph.units` 原序）—— `computeLayout`
 *   的螺旋 seed 按数组下标取值，固定顺序 = 布局稳定、重渲染不跳。
 * - **只读**：不改入参、不共享可变引用（`subgraphOf` 只做过滤，不原地改对象）。
 */
export function coreSubgraphOf(
  graph: KnowledgeGraph,
  opts: { limit?: number; unitIds?: ReadonlySet<string> } = {},
): CorePick {
  const limit = Math.max(0, opts.limit ?? CORE_LIMIT);
  const pool: KnowledgeUnit[] = opts.unitIds
    ? graph.units.filter((u) => opts.unitIds!.has(u.id))
    : graph.units;
  const poolIds = new Set(pool.map((u) => u.id));

  // 度数只在池内统计（两端都在池里的边才计数）—— 池外单元参与的边不计入。
  const degree = new Map<string, number>();
  for (const id of poolIds) degree.set(id, 0);
  for (const r of graph.relations) {
    if (!poolIds.has(r.fromId) || !poolIds.has(r.toId)) continue;
    degree.set(r.fromId, (degree.get(r.fromId) ?? 0) + 1);
    degree.set(r.toId, (degree.get(r.toId) ?? 0) + 1);
  }

  // 显式全序：度数 desc → title asc → id asc。
  const ranked = [...pool].sort(
    (a, b) =>
      (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) ||
      (a.title < b.title ? -1 : a.title > b.title ? 1 : 0) ||
      (a.id < b.id ? -1 : 1),
  );
  const pickedIds = ranked.slice(0, limit).map((u) => u.id);

  // subgraphOf 保证：只保留两端都在子图内的边（无悬空边）。
  return {
    graph: subgraphOf(graph, pickedIds),
    total: pool.length,
    shown: pickedIds.length,
    truncated: pool.length > pickedIds.length,
    hidden: Math.max(0, pool.length - pickedIds.length),
  };
}
