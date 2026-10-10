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
 * 章级前置的**人工覆盖**（F7 范围 4，docs/chapter-prereq-override-design-2026-09.md §3）。
 *
 * ⚠️ 刻意**不是** `Chapter` 上的字段。存储是列式 SQLite（`src-tauri/src/db/schema.sql`
 * 的 `chapters` 表逐列显式声明），给 `Chapter` 加字段就必须同批改 Rust 侧的表结构 +
 * 迁移 + DTO，属另一条改动线（且 `src-tauri/**` 是零改动约束区）。独立实体沿用
 * 「新增 key → 无旧数据 → 零迁移」的既有惯例。
 *
 * 语义是**增量**而非整体替换：`added` 补自动推导漏掉的、`removed` 剔除误判的，
 * 自动推导本身**始终保留**。这样概念重新抽取后新增的边照常生效，人工意图也不丢
 * （整体替换会在重跑 AI 后冻结成一份过时清单）。
 */
export interface ChapterPrereqOverride {
  /** 被修正的章（`Chapter.id`）。 */
  chapterId: string;
  /** 人工新增的前置章 id（自动推导之外）。 */
  added: string[];
  /** 人工剔除的前置章 id（从自动推导里排除）。 */
  removed: string[];
}

/** 单条生效前置 + 它的来源（UI 用它标注「自动 / 人工」）。 */
export interface ChapterPrereqEntry {
  chapterId: string;
  origin: "auto" | "manual";
}

/**
 * 生效前置的**唯一合并实现**（自动 ∪ 人工增 − 人工删）。
 *
 * `chapterPrerequisiteIds` 与 UI 的 `chapterPrereqEntries` 都走这里 —— 两处各写一遍
 * 就是「同一规则两处实现」，将来改口径必漏一处。
 *
 * 保序：自动在前、人工在后；自环（`selfId` 自己）一律剔除。
 */
function prereqEntriesCore(
  derived: readonly string[],
  override: ChapterPrereqOverride | undefined,
  selfId?: string,
): ChapterPrereqEntry[] {
  const self = selfId ?? override?.chapterId;
  const removed = new Set(override?.removed ?? []);
  const out: ChapterPrereqEntry[] = [];
  const push = (id: string, origin: ChapterPrereqEntry["origin"]): void => {
    if (id === self || removed.has(id)) return;
    if (out.some((e) => e.chapterId === id)) return;
    out.push({ chapterId: id, origin });
  };
  for (const id of derived) push(id, "auto");
  for (const id of override?.added ?? []) push(id, "manual");
  return out;
}

/** UI 入口：某章的生效前置（自动推导 + 人工覆盖），带来源标记。 */
export function chapterPrereqEntries(
  derived: readonly string[],
  override: ChapterPrereqOverride | undefined,
): ChapterPrereqEntry[] {
  return prereqEntriesCore(derived, override);
}

/** 存储读出的列表 → `chapterPrerequisiteIds` 要的 Map（口径只此一处）。 */
export function prereqOverrideMap(
  overrides: readonly ChapterPrereqOverride[],
): Map<string, ChapterPrereqOverride> {
  return new Map(overrides.map((o) => [o.chapterId, o]));
}

/**
 * 单条人工开关 → 新的覆盖记录（纯函数，UI 每次勾选调一次）。
 *
 * `derived` 是该章当前的**自动推导**前置集合；`want` 是用户希望的最终状态。
 * 归一化：与自动集合一致的意图**不落记录**（否则会攒下一堆无意义的 added/removed），
 * 两条清单都空时返回 `undefined`（= 回到纯自动，调用方应删除该记录）。
 */
export function togglePrereqOverride(
  current: ChapterPrereqOverride | undefined,
  chapterId: string,
  targetId: string,
  want: boolean,
  derived: readonly string[],
): ChapterPrereqOverride | undefined {
  if (targetId === chapterId) return current;
  const added = new Set(current?.added ?? []);
  const removed = new Set(current?.removed ?? []);
  const isDerived = derived.includes(targetId);

  if (want) {
    removed.delete(targetId);
    if (isDerived) added.delete(targetId);
    else added.add(targetId);
  } else {
    added.delete(targetId);
    if (isDerived) removed.add(targetId);
    else removed.delete(targetId);
  }

  if (added.size === 0 && removed.size === 0) return undefined;
  return { chapterId, added: [...added], removed: [...removed] };
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
 * `overrides`（F7 范围 4）：人工覆盖**叠加在自动推导之上**（见 `ChapterPrereqOverride`）。
 * ⚠️ 人工项**不按 `chapters` 范围过滤** —— 它是用户显式指定的，不该被本次调用的范围
 * 悄悄抹掉；下游的范围过滤（`learning-planner.ts` 的 `chapterById.has(pid)`）照旧生效。
 *
 * @returns Map<toChapterId, fromChapterId[]>；无前置的章不出现在 Map 里。
 */
export function chapterPrerequisiteIds(
  graph: KnowledgeGraph,
  chapters: readonly Pick<Chapter, "id" | "unitIds">[],
  overrides?: ReadonlyMap<string, ChapterPrereqOverride>,
): Map<string, string[]> {
  const chapterOfUnit = new Map<string, string>();
  for (const chapter of chapters) {
    for (const unitId of chapter.unitIds ?? []) chapterOfUnit.set(unitId, chapter.id);
  }

  const derivedByChapter = new Map<string, string[]>();
  for (const relation of graph.relations) {
    if (relation.type !== "prerequisite") continue;
    const fromChapter = chapterOfUnit.get(relation.fromId);
    const toChapter = chapterOfUnit.get(relation.toId);
    // 自环（同章内依赖）与范围外单元一并剔除。
    if (fromChapter === undefined || toChapter === undefined) continue;
    if (fromChapter === toChapter) continue;
    const list = derivedByChapter.get(toChapter);
    if (list === undefined) derivedByChapter.set(toChapter, [fromChapter]);
    else if (!list.includes(fromChapter)) list.push(fromChapter);
  }

  const out = new Map<string, string[]>();
  const chapterIds = new Set<string>([
    ...derivedByChapter.keys(),
    ...(overrides?.keys() ?? []),
  ]);
  for (const chapterId of chapterIds) {
    const entries = prereqEntriesCore(
      derivedByChapter.get(chapterId) ?? [],
      overrides?.get(chapterId),
      chapterId,
    );
    if (entries.length > 0) out.set(chapterId, entries.map((e) => e.chapterId));
  }
  return out;
}
