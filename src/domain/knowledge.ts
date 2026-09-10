/**
 * 核心对象 #2 & #3 —— Knowledge（知识）与 Knowledge Graph（知识图谱）。
 *
 * 知识不是一段纯文本——而是带有含义与关系的语义单元。知识图谱描述
 * 单元之间的关系：prerequisite / related / parent / child / example /
 * contrast / application / source（八种关系类型）。
 */

export type KnowledgeKind = "concept" | "skill" | "fact" | "procedure" | "principle";

/**
 * 概念的原文出处（Evidence 链在正文档案侧的落点）。
 *
 * 由 AI 给出 `quote`、代码经 `locateQuote` 定位后回填 `start/end`；
 * 定位失败时整个 `evidence` 省略（诚实降级），概念本身照常入库。
 */
export interface ConceptEvidence {
  documentId: string;
  /** 原文（doc.textPreview）绝对字符区间：start 含、end 不含。 */
  start: number;
  end: number;
  quote: string;
}

export interface KnowledgeUnit {
  id: string;
  title: string;
  kind: KnowledgeKind;
  /** Plain-language summary of the unit. */
  summary?: string;
  /** The source document this unit was extracted from (Evidence chain). */
  sourceDocumentId?: string;
  /** 在完整图谱工具就绪前的轻量级归类标签。 */
  tags: string[];
  createdAt: number;
  /** 概念在原文中的出处（可选；定位失败时缺省）。 */
  evidence?: ConceptEvidence;
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
  /** 可选的关系强度 [0, 1]——后续由 Mastery（掌握度）/Recommendation（推荐）引擎使用。 */
  strength?: number;
}

/**
 * 轻量级内存图谱形态。对 MVP 闭环足够；持久化的图存储规划在 Phase 5。
 */
export interface KnowledgeGraph {
  units: KnowledgeUnit[];
  relations: KnowledgeRelation[];
}

/** Helpers shared by engines. */

export function relationsOf(graph: KnowledgeGraph, unitId: string): KnowledgeRelation[] {
  return graph.relations.filter((r) => r.fromId === unitId || r.toId === unitId);
}

/** 必须先于给定单元掌握的前置单元（掌握它，给定单元才讲得通）。 */
export function prerequisitesOf(graph: KnowledgeGraph, unitId: string): KnowledgeUnit[] {
  const prereqIds = graph.relations
    .filter((r) => r.toId === unitId && r.type === "prerequisite")
    .map((r) => r.fromId);
  return graph.units.filter((u) => prereqIds.includes(u.id));
}
