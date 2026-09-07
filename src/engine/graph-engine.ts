/**
 * Knowledge Graph Engine — builds and edits the graph of knowledge units.
 * Pure structural operations so the graph can be reasoned about & visualized.
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
