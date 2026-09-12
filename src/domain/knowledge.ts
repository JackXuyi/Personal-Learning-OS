/**
 * 核心对象 #2 & #3 —— Knowledge（知识）与 Knowledge Graph（知识图谱）。
 *
 * 知识不是一段纯文本——而是带有含义与关系的语义单元。知识图谱描述
 * 单元之间的关系：prerequisite / related / parent / child / example /
 * contrast / application / source（八种关系类型）。
 */
import type { Chapter } from "./chapter";

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

/**
 * 章级前置推导：把概念层的 prerequisite 边「抬升」成章与章的先后关系。
 *
 * 判定：若概念 x 是概念 y 的 prerequisite，且 x 属于章 A、y 属于章 B（A ≠ B），
 * 则 A 是 B 的前置章。同章内部的概念依赖不构成章级前置（组不了序，也没意义）。
 *
 * 只映射 `chapters` 参数范围内的单元：范围外的章（如另一份文档）不参与判定，
 * 否则章级计划会为看不见的章反复标注「前置未掌握」。
 *
 * @returns Map<toChapterId, fromChapterId[]>；无前置的章不出现在 Map 里。
 */
export function chapterPrerequisiteIds(
  graph: KnowledgeGraph,
  chapters: readonly Pick<Chapter, "id" | "unitIds">[],
): Map<string, string[]> {
  const chapterOfUnit = new Map<string, string>();
  for (const chapter of chapters) {
    for (const unitId of chapter.unitIds ?? []) chapterOfUnit.set(unitId, chapter.id);
  }

  const out = new Map<string, string[]>();
  for (const relation of graph.relations) {
    if (relation.type !== "prerequisite") continue;
    const fromChapter = chapterOfUnit.get(relation.fromId);
    const toChapter = chapterOfUnit.get(relation.toId);
    // 自环（同章内依赖）与范围外单元一并剔除。
    if (fromChapter === undefined || toChapter === undefined) continue;
    if (fromChapter === toChapter) continue;
    const list = out.get(toChapter);
    if (list === undefined) out.set(toChapter, [fromChapter]);
    else if (!list.includes(fromChapter)) list.push(fromChapter);
  }
  return out;
}
