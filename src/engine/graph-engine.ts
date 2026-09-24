/**
 * 章概念子图工具 —— 图谱的**纯结构操作**（无状态、可直跑单测）。
 *
 * N5 概念层回归（T14）：提供章子图裁剪 `subgraphOf` 与概念替换
 * `replaceChapterConcepts`，供 ChapterGraphPage（图谱视图恢复）与概念抽取
 * 落库复用。原 `graphEngine`（addUnit / removeUnit / connect）零消费，已移除。
 */
import type { KnowledgeGraph, KnowledgeRelation, KnowledgeUnit } from "../domain";

/* ------------------------------------------------------------------ */
/* N5 概念层回归：章子图工具（纯函数）                                  */
/* ------------------------------------------------------------------ */

/**
 * 章概念子图：给定章的 unitIds，取对应单元与「两端都在子图内」的关系。
 * 章概念间的关系即图内边；跨章/外部关系被裁剪（图谱视图聚焦单章）。
 */
export function subgraphOf(
  graph: KnowledgeGraph,
  unitIds: readonly string[],
): KnowledgeGraph {
  const ids = new Set(unitIds);
  return {
    units: graph.units.filter((u) => ids.has(u.id)),
    relations: graph.relations.filter((r) => ids.has(r.fromId) && ids.has(r.toId)),
  };
}

/**
 * 替换某章的概念（概念抽取落库辅助）：先按 oldUnitIds 移除旧概念及其
 * 关联边，再并入新概念。返回新图（调用方自行 saveGraph + 更新 Chapter.unitIds）。
 */
export function replaceChapterConcepts(
  graph: KnowledgeGraph,
  oldUnitIds: readonly string[],
  next: { units: KnowledgeUnit[]; relations: KnowledgeRelation[] },
): KnowledgeGraph {
  const old = new Set(oldUnitIds);
  const keepUnits = graph.units.filter((u) => !old.has(u.id));
  const keepRels = graph.relations.filter(
    (r) => !old.has(r.fromId) && !old.has(r.toId),
  );
  return {
    units: [...keepUnits, ...next.units],
    relations: [...keepRels, ...next.relations],
  };
}
