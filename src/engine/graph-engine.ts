/**
 * 知识图谱引擎 —— 构建并编辑知识单元组成的图谱。
 * 采用纯结构操作，便于对图谱进行推理与可视化。
 *
 * N5 概念层回归（T14）：追加章子图工具 subgraphOf / replaceChapterConcepts，
 * 供 ChapterGraphPage（图谱视图恢复）与概念抽取落库复用。
 */
import type {
  KnowledgeGraph,
  KnowledgeRelation,
  KnowledgeUnit,
  RelationType,
} from "../domain";
import { newId } from "../domain";

export interface GraphEngine {
  addUnit(graph: KnowledgeGraph, unit: KnowledgeUnit): KnowledgeGraph;
  removeUnit(graph: KnowledgeGraph, unitId: string): KnowledgeGraph;
  connect(
    graph: KnowledgeGraph,
    fromId: string,
    toId: string,
    type: RelationType,
    strength?: number,
  ): KnowledgeGraph;
}

export const graphEngine: GraphEngine = {
  addUnit(graph, unit) {
    if (graph.units.some((u) => u.id === unit.id)) return graph;
    return { units: [...graph.units, unit], relations: graph.relations };
  },

  removeUnit(graph, unitId) {
    return {
      units: graph.units.filter((u) => u.id !== unitId),
      relations: graph.relations.filter(
        (r) => r.fromId !== unitId && r.toId !== unitId,
      ),
    };
  },

  connect(graph, fromId, toId, type, strength) {
    const already = graph.relations.some(
      (r) => r.fromId === fromId && r.toId === toId && r.type === type,
    );
    if (already) return graph;
    const relation: KnowledgeRelation = {
      id: newId("rel"),
      fromId,
      toId,
      type,
      strength,
    };
    return { units: graph.units, relations: [...graph.relations, relation] };
  },
};

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
