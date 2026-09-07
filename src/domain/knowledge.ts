/**
 * Core Object #2 & #3 — Knowledge and Knowledge Graph.
 *
 * Knowledge is not a plain text chunk — it is a semantic unit with meaning
 * and relationships. The Knowledge Graph describes how units relate:
 * prerequisite / related / parent / child / example / contrast / application / source.
 */

export type KnowledgeKind = "concept" | "skill" | "fact" | "procedure" | "principle";

export interface KnowledgeUnit {
  id: string;
  title: string;
  kind: KnowledgeKind;
  /** Plain-language summary of the unit. */
  summary?: string;
  /** The source document this unit was extracted from (Evidence chain). */
  sourceDocumentId?: string;
  /** Tags for light-weight organization before full graph tooling lands. */
  tags: string[];
  createdAt: number;
}

export type RelationType =
  | "prerequisite"
  | "related"
  | "parent"
  | "child"
  | "example"
  | "contrast"
  | "application"
  | "source";

export interface KnowledgeRelation {
  id: string;
  fromId: string;
  toId: string;
  type: RelationType;
  /** Optional strength in [0, 1] — used later by Mastery/Recommendation engines. */
  strength?: number;
}

/**
 * Lightweight in-memory graph shape. Enough for the MVP loop; a persisted
 * graph store is planned for Phase 5.
 */
export interface KnowledgeGraph {
  units: KnowledgeUnit[];
  relations: KnowledgeRelation[];
}

/** Helpers shared by engines. */

export function relationsOf(graph: KnowledgeGraph, unitId: string): KnowledgeRelation[] {
  return graph.relations.filter((r) => r.fromId === unitId || r.toId === unitId);
}

/** Units that must be mastered before the given unit makes sense. */
export function prerequisitesOf(graph: KnowledgeGraph, unitId: string): KnowledgeUnit[] {
  const prereqIds = graph.relations
    .filter((r) => r.toId === unitId && r.type === "prerequisite")
    .map((r) => r.fromId);
  return graph.units.filter((u) => prereqIds.includes(u.id));
}
