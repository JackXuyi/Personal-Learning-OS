/**
 * 章内 map-reduce · 概念族 —— 概念抽取（map）+ 代码级合并 + 引用式归并（reduce）。
 *
 * 从 `chapter-map-reduce.ts` 拆出：概念族自持一套提示词 / 解析 / 关系下标重映射，
 * 与要点族合并后单文件超 700 行（仓库硬上限），故按「族」分文件。
 *
 * 引用式归并（同要点族的核心不变量）：
 * > AI 在归并阶段只输出 `mergeOf`（被合并的候选编号），产出概念的 `evidence`
 * > 一律从候选继承 —— AI 给的任何引文文本都直接丢弃。
 *
 * 关系处理（概念独有）：块内关系下标在分块后必须抬升到全局候选空间；归并后
 * 再按「候选 → 最终槽位」映射重建，全过程用**下标**贯穿，只在最后一步转成 id。
 *
 * 分层约束：本模块属 `ai/`，不得 import `features/`。锚定能力由调用方注入。
 */
import type { KnowledgeRelation, KnowledgeUnit, RelationType } from "../domain";
import { newId } from "../domain";
import type { AIProvider, ChatMessage } from "./types";
import { AiProviderError } from "./types";
import { PIPELINE_LIMITS, TEMPERATURE, chatJson, isRecord, str } from "./pipeline-core";
import { planChapterBlocks, type AnchorFn } from "./chapter-map-reduce";
import { aiErrPreview, aiLog } from "./log";

/* ------------------------------------------------------------------ */
/* 1) 概念族：类型 · 提示词 · 解析                                      */
/* ------------------------------------------------------------------ */

/** AI 认可的概念类型（与 domain.KnowledgeKind 白名单一致；缺省 concept）。 */
const CONCEPT_KINDS = new Set(["concept", "skill", "fact", "procedure", "principle"]);

/** 画边的关系类型（图谱可视层只画这四类；其余类型留给概念侧栏文本）。 */
const CONCEPT_REL_TYPES: ReadonlySet<RelationType> = new Set([
  "prerequisite",
  "related",
  "parent",
  "child",
]);

/** 单概念草稿（title/kind/summary/tags 内容字段；id/来源由执行器分配）。 */
export interface AiConceptDraft {
  title: string;
  kind: KnowledgeUnit["kind"];
  summary?: string;
  tags: string[];
  /**
   * 原文摘录（可选）——AI 指出该概念出自正文哪一段。
   * 由执行器透传为 `KnowledgeUnit.evidence.quote`，**偏移一律由
   * analyze-service 用 `locateQuote` 回填**（不信 AI 的偏移量）。
   */
  quote?: string;
}

/** 单关系草稿：from/to 为 units 数组下标（0 起）。 */
export interface AiRelationDraft {
  from: number;
  to: number;
  type: RelationType;
}

function isRelType(v: unknown): v is RelationType {
  return typeof v === "string" && CONCEPT_REL_TYPES.has(v as RelationType);
}

const CONCEPT_SYSTEM =
  "你是严谨的学习资料概念分析师。用户会给出一章正文，请把这一章拆成有学习价值的" +
  "知识概念（KnowledgeUnit），并指出概念间关系。\n" +
  "要求：\n" +
  "- 概念粒度适中：一章 6–14 个，宁缺毋滥——只收录正文真正讲到、值得单独记忆/复习的原子概念，不编造正文外的内容；\n" +
  "- kind：concept 概念 / skill 技能 / fact 事实 / procedure 流程 / principle 原理（拿不准用 concept）；\n" +
  "- summary：≤120 字的一句话总结，让复习时能快速回忆；tags：0–3 个 ≤12 字的归类标签；\n" +
  "- quote：该概念在本章正文中的**原文摘录**（≤200 字，逐字照抄，不得改写/概括/拼接）；" +
  "正文里确实找不到明确出处时给空字符串（宁缺毋滥，不要为了填满而编）；\n" +
  "- relations：概念之间的关键关系，只用 prerequisite（前置依赖）/ related（相关）/ parent-child（上下位）；\n" +
  "  关系两端用 units 数组下标（从 0 起）引用，仅画有信息量的边（6–14 个概念建议 ≤16 条），无强关联可不给。\n" +
  "只输出一个 JSON 对象（不要 markdown 围栏与多余文字），格式：" +
  '{"units":[{"title":"向量化","kind":"concept","summary":"…","tags":["嵌入"],"quote":"向量化是把文本映射为向量的过程"}],"relations":[{"from":0,"to":1,"type":"prerequisite"}]}。';

/** 分块版的 system prompt：范围收窄为「这一段」，同样禁止跨段臆测。 */
const CONCEPT_BLOCK_SYSTEM =
  "你是严谨的学习资料概念分析师。用户会把**一章中的其中一段**正文交给你（不是整章）。\n" +
  "请只依据这一段拆出知识概念并指出概念间关系。\n" +
  "要求：\n" +
  "- 概念粒度适中：这一段 2–6 个，宁缺毋滥——只收录这一段真正讲到的原子概念，不编造；\n" +
  "- kind：concept 概念 / skill 技能 / fact 事实 / procedure 流程 / principle 原理（拿不准用 concept）；\n" +
  "- summary：≤120 字的一句话总结；tags：0–3 个 ≤12 字的归类标签；\n" +
  "- quote：该概念在这一段正文中的**原文摘录**（≤200 字，逐字照抄，不得改写/概括/拼接）；" +
  "找不到明确出处时给空字符串（宁缺毋滥）；\n" +
  "- relations：只用 prerequisite / related / parent / child，两端用 units 下标（从 0 起）；\n" +
  "- 铁律：只归纳这一段的真实内容，绝不臆测其他段落。\n" +
  "只输出一个 JSON 对象（不要 markdown 围栏与多余文字），格式：" +
  '{"units":[{"title":"…","kind":"concept","summary":"…","tags":["…"],"quote":"…"}],"relations":[{"from":0,"to":1,"type":"related"}]}。';

/**
 * 归并版 system prompt：AI 只输出「合并后的概念 + 被合并的候选编号」，
 * **不输出 quote**（出处由代码按 `mergeOf` 继承）。
 */
const CONCEPT_MERGE_SYSTEM =
  "你是严谨的学习资料概念编辑。用户会给出一章各分段提炼出的概念候选（带编号，从 0 起）。\n" +
  "请合并重复 / 同义的概念，输出最能代表这一章的概念清单。\n" +
  "要求：\n" +
  "- 每条给 title（≤40 字）、kind、summary（≤120 字，可省）、tags（0–3 个，可省）、" +
  "`mergeOf`（被合并的候选编号数组，至少含 1 个；未被合并时即 [自己的编号]）；\n" +
  "- **不要输出原文引文** —— 引文由系统按 mergeOf 关联；\n" +
  "- 只依据给出的候选，不引入候选之外的信息；输出条数应少于候选条数（要做合并归纳）。\n" +
  "只输出一个 JSON 数组（不要 markdown 围栏与多余文字），格式：" +
  '[{"title":"…","kind":"concept","summary":"…","tags":["…"],"mergeOf":[0,3]}]。';

/** 纯函数：构建整章概念抽取提示词（短章单块路径，与改造前逐字节一致）。 */
export function buildConceptMessages(input: {
  chapterTitle: string;
  text: string;
}): ChatMessage[] {
  return [
    { role: "system", content: CONCEPT_SYSTEM },
    {
      role: "user",
      content: `章「${input.chapterTitle || "(未命名章)"}」正文如下（${input.text.length} 字）：\n\n${input.text}`,
    },
  ];
}

/** 纯函数：构建分块概念抽取提示词（长章 map 阶段，单块）。 */
export function buildConceptBlockMessages(input: {
  blockIndex: number;
  blockTotal: number;
  chapterTitle: string;
  text: string;
}): ChatMessage[] {
  return [
    { role: "system", content: CONCEPT_BLOCK_SYSTEM },
    {
      role: "user",
      content:
        `这是章「${input.chapterTitle || "(未命名章)"}」正文的第 ${input.blockIndex + 1}/${input.blockTotal} 段` +
        `（${input.text.length} 字）。请只归纳这一段：\n\n${input.text}`,
    },
  ];
}

/** 纯函数：构建概念归并提示词（reduce 阶段，只喂「编号 + 标题 + 类型 + 摘要」）。 */
export function buildConceptMergeMessages(input: {
  chapterTitle: string;
  candidates: readonly ConceptCandidate[];
}): ChatMessage[] {
  const lines = input.candidates.map((c) => {
    const tail = `${c.kind}${c.summary ? ` · ${c.summary}` : ""}`;
    return `${c.index}. ${c.title}（${tail}）`;
  });
  return [
    { role: "system", content: CONCEPT_MERGE_SYSTEM },
    {
      role: "user",
      content:
        `章「${input.chapterTitle || "(未命名章)"}」各分段提炼出的概念候选如下` +
        `（共 ${input.candidates.length} 条，编号从 0 起）：\n\n${lines.join("\n")}\n\n` +
        `请合并为 ≤${PIPELINE_LIMITS.conceptMergeMax} 个最能代表本章的概念。`,
    },
  ];
}

/** 概念候选：分块 map 后、已由代码锚定的概念（归并阶段只能引用它）。 */
export interface ConceptCandidate {
  /** 候选全局下标（AI 用 `mergeOf` 引用它）。 */
  index: number;
  title: string;
  kind: KnowledgeUnit["kind"];
  summary?: string;
  tags: string[];
  /** 已锚定的原文出处；未锚定时整体不存在（不允许 AI 补）。 */
  evidence?: { documentId: string; start: number; end: number; quote: string };
}

/** 概念归并的 AI 输出项：`mergeOf` = 被合并的候选下标。 */
export interface AiConceptMergeItem {
  title: string;
  kind: KnowledgeUnit["kind"];
  summary?: string;
  tags: string[];
  mergeOf: number[];
}

/** 纯函数：解析 AI 概念响应 → 规范化草稿（越界下标 / 非法类型丢弃）。 */
export function parseConceptDrafts(raw: unknown): {
  units: AiConceptDraft[];
  relations: AiRelationDraft[];
} {
  if (!isRecord(raw)) {
    throw new AiProviderError("request-failed", "AI 概念抽取响应不是对象。");
  }
  const rawUnits = Array.isArray(raw.units) ? raw.units : [];
  const units: AiConceptDraft[] = [];
  for (const item of rawUnits) {
    if (!isRecord(item)) continue;
    const title = str(item.title)?.trim();
    if (!title || title.length > 40) continue;
    const kind = typeof item.kind === "string" && CONCEPT_KINDS.has(item.kind)
      ? (item.kind as KnowledgeUnit["kind"])
      : "concept";
    const summary = str(item.summary)?.trim();
    const tags = Array.isArray(item.tags)
      ? item.tags.filter((t): t is string => typeof t === "string")
          .map((t) => t.trim().slice(0, 12))
          .filter((t) => t.length > 0)
          .slice(0, 3)
      : [];
    const quote = str(item.quote)?.trim().slice(0, PIPELINE_LIMITS.keyPointQuoteMaxChars);
    units.push({
      title,
      kind,
      ...(summary && summary.length <= 120 ? { summary } : summary ? { summary: `${summary.slice(0, 120)}…` } : {}),
      tags,
      // 缺失 quote 是允许的（evidence 整体可选），不报错。
      ...(quote ? { quote } : {}),
    });
  }
  if (units.length === 0) {
    throw new AiProviderError("request-failed", "AI 概念抽取未返回任何合规概念。");
  }
  const relations = parseConceptRelations(raw.relations, units.length);
  return { units, relations };
}

/**
 * 纯函数：解析概念关系数组 → 规范化的关系草稿（越界 / 自环 / 非法类型丢弃，同向同型去重）。
 *
 * 抽成独立函数是因为分块后需要**两次**用到同一套校验：
 * ① 块内解析（`unitCount` = 本块概念数）；② 全局重映射（`unitCount` = 全局候选数）。
 */
export function parseConceptRelations(raw: unknown, unitCount: number): AiRelationDraft[] {
  const rawRels = Array.isArray(raw) ? raw : [];
  const relations: AiRelationDraft[] = [];
  for (const item of rawRels) {
    if (!isRecord(item)) continue;
    const from = item.from;
    const to = item.to;
    if (
      typeof from !== "number" || !Number.isInteger(from) ||
      typeof to !== "number" || !Number.isInteger(to) ||
      from === to || from < 0 || to < 0 || from >= unitCount || to >= unitCount
    ) continue;
    if (!isRelType(item.type)) continue;
    relations.push({ from, to, type: item.type });
  }
  // 去重（同向同型只留一条）。
  const seen = new Set<string>();
  return relations.filter((r) => {
    const k = `${r.from}\u0001${r.to}\u0001${r.type}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** 概念归并结果：合并后的概念 + 「去重后候选下标 → 最终槽位下标」映射。 */
export interface ConceptMergeOutcome {
  /** 最终概念列表 = AI 归并项 + 未被归并覆盖的候选（追加在后，不丢内容）。 */
  merged: ConceptCandidate[];
  /** `candidateToMerged[i]` = 去重后候选 `i` 归属的最终槽位下标（恒有值）。 */
  candidateToMerged: number[];
}

/**
 * 纯函数：解析概念归并响应 → 最终概念列表 + 候选到槽位的映射。
 *
 * **引用式归并**：仅采信 AI 的 `title` / `kind` / `summary` / `tags` / `mergeOf`；
 * `evidence` 从 `mergeOf` 中**首个带 evidence 的候选**整体继承（合并后的概念
 * 出处只能落在其中一个来源上，取首个可锚定者，**宁少不编**）。
 *
 * 丢弃规则：
 * - `mergeOf` 里没有任何合法下标 → 丢弃该条（无从继承出处，也说明 AI 乱答）；
 * - `title` 为空 / 超 40 字 → 丢弃；
 * - 与已保留条目 title 重复 → 丢弃。
 *
 * AI 未覆盖的候选不丢弃：按原顺序追加为独立槽位，关系仍可挂靠（不静默丢内容）。
 */
export function parseConceptMerge(
  raw: unknown,
  candidates: readonly ConceptCandidate[],
): ConceptMergeOutcome {
  if (!Array.isArray(raw)) {
    throw new AiProviderError("request-failed", "AI 概念归并响应不是数组。");
  }
  const merged: ConceptCandidate[] = [];
  const candidateToMerged: number[] = new Array(candidates.length).fill(-1);
  const seenTitles = new Set<string>();

  for (const item of raw) {
    if (!isRecord(item)) continue;
    const title = str(item.title)?.trim();
    if (!title || title.length > 40) continue;
    const mergeOf = Array.isArray(item.mergeOf)
      ? item.mergeOf.filter(
          (n): n is number =>
            typeof n === "number" && Number.isInteger(n) && n >= 0 && n < candidates.length,
        )
      : [];
    if (mergeOf.length === 0) continue;
    if (seenTitles.has(title)) continue;
    seenTitles.add(title);

    const first = candidates[mergeOf[0]];
    const kind = typeof item.kind === "string" && CONCEPT_KINDS.has(item.kind)
      ? (item.kind as KnowledgeUnit["kind"])
      : first.kind;
    const summary = str(item.summary)?.trim();
    const tags = Array.isArray(item.tags)
      ? item.tags.filter((t): t is string => typeof t === "string")
          .map((t) => t.trim().slice(0, 12))
          .filter((t) => t.length > 0)
          .slice(0, 3)
      : first.tags;
    // 出处只能继承，不能生成：取 mergeOf 中首个带 evidence 的候选。
    let evidence: ConceptCandidate["evidence"];
    for (const idx of mergeOf) {
      if (candidates[idx].evidence) {
        evidence = candidates[idx].evidence;
        break;
      }
    }
    const slot = merged.length;
    merged.push({
      index: slot,
      title,
      kind,
      ...(summary
        ? { summary: summary.length <= 120 ? summary : `${summary.slice(0, 120)}…` }
        : first.summary
          ? { summary: first.summary }
          : {}),
      tags,
      ...(evidence ? { evidence } : {}),
    });
    for (const idx of mergeOf) candidateToMerged[idx] = slot;
    if (merged.length >= PIPELINE_LIMITS.conceptMergeMax) break;
  }

  // AI 未覆盖的候选 → 追加为独立槽位（保内容，保出处）。
  for (let i = 0; i < candidates.length; i++) {
    if (candidateToMerged[i] !== -1) continue;
    candidateToMerged[i] = merged.length;
    merged.push({ ...candidates[i], index: merged.length });
  }

  return { merged, candidateToMerged };
}

/* ------------------------------------------------------------------ */
/* 2) 概念族：执行器                                                   */
/* ------------------------------------------------------------------ */

/** 概念抽取结果。 */
export interface MappedConceptResult {
  units: KnowledgeUnit[];
  relations: KnowledgeRelation[];
  /** 实际分块数（1 = 走单块直出路径）。 */
  blocks: number;
  /** map 阶段失败并跳过的块数（>0 时内容可能不完整）。 */
  skippedBlocks: number;
  /** quote 未能在原文定位、因而被丢弃的条数。 */
  unanchored: number;
  /** true = AI 归并失败，回退到代码级合并结果（D6）。 */
  mergeFallback: boolean;
}

/** 锚定单条概念的出处：无 quote / 无 documentId / 锚定失败 → undefined（整体移除）。 */
function anchorEvidence(
  quote: string | undefined,
  anchor: AnchorFn,
  documentId: string | undefined,
): ConceptCandidate["evidence"] {
  if (!quote || !documentId) return undefined;
  const hit = anchor(quote);
  if (!hit) return undefined;
  return { documentId, start: hit.start, end: hit.end, quote };
}

/** 概念候选 → KnowledgeUnit[]（id / createdAt 在此分配，evidence 原样透传）。 */
function candidatesToUnits(candidates: readonly ConceptCandidate[], now: number): KnowledgeUnit[] {
  return candidates.map((c) => ({
    id: newId("unit"),
    title: c.title,
    kind: c.kind,
    ...(c.summary ? { summary: c.summary } : {}),
    tags: c.tags,
    createdAt: now,
    ...(c.evidence ? { evidence: c.evidence } : {}),
  }));
}

/**
 * 关系下标重映射：把关系草稿的端点在**下标空间**中搬家
 * （候选空间 → 去重后空间 / 最终槽位空间），丢自环与越界，同向同型去重。
 */
export function remapRelationDrafts(
  relations: readonly AiRelationDraft[],
  mapIndex: (i: number) => number | undefined,
  slotCount: number,
): AiRelationDraft[] {
  const seen = new Set<string>();
  const out: AiRelationDraft[] = [];
  for (const r of relations) {
    const from = mapIndex(r.from);
    const to = mapIndex(r.to);
    if (from === undefined || to === undefined) continue;
    if (from === to || from < 0 || to < 0 || from >= slotCount || to >= slotCount) continue;
    const k = `${from}\u0001${to}\u0001${r.type}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ from, to, type: r.type });
  }
  return out;
}

/** 把下标空间的关系草稿落成带真实 id 的关系（越界 / 自环丢弃，同向同型去重）。 */
export function materializeRelations(
  relationDrafts: readonly AiRelationDraft[],
  unitIds: readonly string[],
): KnowledgeRelation[] {
  const seen = new Set<string>();
  const out: KnowledgeRelation[] = [];
  for (const r of relationDrafts) {
    if (r.from < 0 || r.to < 0 || r.from >= unitIds.length || r.to >= unitIds.length || r.from === r.to) {
      continue;
    }
    const k = `${r.from}\u0001${r.to}\u0001${r.type}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ id: newId("rel"), fromId: unitIds[r.from], toId: unitIds[r.to], type: r.type });
  }
  return out;
}

/** 代码级合并：按 title 去重（保首条），并给出「原候选下标 → 去重后下标」映射。 */
function dedupConceptCandidates(candidates: readonly ConceptCandidate[]): {
  candidates: ConceptCandidate[];
  indexMap: number[];
} {
  const out: ConceptCandidate[] = [];
  const indexMap: number[] = new Array(candidates.length).fill(-1);
  const seen = new Map<string, number>();
  candidates.forEach((c, i) => {
    const key = c.title.trim();
    const hit = seen.get(key);
    if (hit !== undefined) {
      indexMap[i] = hit;
      return;
    }
    seen.set(key, out.length);
    indexMap[i] = out.length;
    out.push({ ...c, index: out.length });
  });
  return { candidates: out, indexMap };
}

/**
 * 概念抽取（章内 map-reduce，注入锚定回调）—— 任意长度章正文都不再因长度抛错。
 *
 * 与要点版的差异（概念独有）：
 * - map 阶段除概念外还要处理**关系**：块内关系下标在合并后必须抬升到全局候选空间；
 * - 归并阶段 `evidence` 从 `mergeOf` 首个可锚定候选继承；
 * - 归并后关系需按「候选 → 最终槽位」映射重建（否则下标全部失效）。
 */
export async function extractConceptsMapped(
  provider: AIProvider,
  input: {
    chapterTitle: string;
    /** 章正文（调用方用 contentRef 从全文切出）。 */
    text: string;
    /** 所属资料 id；不传则所有概念都不带 evidence（与既有语义一致）。 */
    documentId?: string;
    /** 锚定回调（由 analyze-service 注入）。 */
    anchor: AnchorFn;
    /** 块级进度（`k` 从 1 起）。 */
    onBlock?: (k: number, K: number) => void;
    now?: number;
  },
): Promise<MappedConceptResult> {
  const body = input.text.trim();
  if (body.length === 0) {
    throw new AiProviderError("request-failed", "章正文为空，无法提炼概念。");
  }
  const now = input.now ?? Date.now();
  const blocks = planChapterBlocks(body);

  // 短章：单块直出（提示词与改造前逐字节一致）。
  if (blocks.length <= 1) {
    if (body.length > PIPELINE_LIMITS.conceptBlockMaxChars) {
      throw new AiProviderError(
        "request-failed",
        `单块仍过长（${body.length} 字，上限 ${PIPELINE_LIMITS.conceptBlockMaxChars}），分块算法异常，请排查。`,
      );
    }
    const raw = await chatJson(
      provider,
      buildConceptMessages({ chapterTitle: input.chapterTitle, text: body }),
      TEMPERATURE.concept,
    );
    const { units: drafts, relations } = parseConceptDrafts(raw);
    let unanchored = 0;
    const candidates: ConceptCandidate[] = drafts.map((d, i) => {
      const ev = anchorEvidence(d.quote, input.anchor, input.documentId);
      if (d.quote && !ev) unanchored++;
      return {
        index: i,
        title: d.title,
        kind: d.kind,
        ...(d.summary ? { summary: d.summary } : {}),
        tags: d.tags,
        ...(ev ? { evidence: ev } : {}),
      };
    });
    const unitList = candidatesToUnits(candidates, now);
    return {
      units: unitList,
      relations: materializeRelations(relations, unitList.map((u) => u.id)),
      blocks: 1,
      skippedBlocks: 0,
      unanchored,
      mergeFallback: false,
    };
  }

  // map：逐块串行。块内概念与关系统统抬升到全局候选下标空间。
  const candidates: ConceptCandidate[] = [];
  const rawRelations: AiRelationDraft[] = [];
  let skippedBlocks = 0;
  let unanchored = 0;
  for (let k = 0; k < blocks.length; k++) {
    input.onBlock?.(k + 1, blocks.length);
    try {
      const raw = await chatJson(
        provider,
        buildConceptBlockMessages({
          blockIndex: k,
          blockTotal: blocks.length,
          chapterTitle: input.chapterTitle,
          text: body.slice(blocks[k].start, blocks[k].end),
        }),
        TEMPERATURE.concept,
      );
      const { units: drafts, relations } = parseConceptDrafts(raw);
      const offset = candidates.length;
      for (const r of relations) {
        rawRelations.push({ from: r.from + offset, to: r.to + offset, type: r.type });
      }
      for (const d of drafts) {
        const ev = anchorEvidence(d.quote, input.anchor, input.documentId);
        if (d.quote && !ev) unanchored++;
        candidates.push({
          index: candidates.length,
          title: d.title,
          kind: d.kind,
          ...(d.summary ? { summary: d.summary } : {}),
          tags: d.tags,
          ...(ev ? { evidence: ev } : {}),
        });
      }
    } catch {
      skippedBlocks++;
    }
  }
  if (candidates.length === 0) {
    throw new AiProviderError("request-failed", "所有分块提炼均失败，未能得到任何概念。");
  }

  // 代码级合并：按 title 去重（保首条）。关系在下标空间重映射。
  const { candidates: deduped, indexMap } = dedupConceptCandidates(candidates);

  const buildResult = (
    list: readonly ConceptCandidate[],
    relationDrafts: readonly AiRelationDraft[],
    mergeFallback: boolean,
  ): MappedConceptResult => {
    const unitList = candidatesToUnits(list, now);
    return {
      units: unitList,
      relations: materializeRelations(relationDrafts, unitList.map((u) => u.id)),
      blocks: blocks.length,
      skippedBlocks,
      unanchored,
      mergeFallback,
    };
  };

  const fallbackRelations = remapRelationDrafts(
    rawRelations,
    (i) => indexMap[i],
    deduped.length,
  );

  // reduce：AI 合并同义概念（引用式：evidence 从候选继承）；失败回退代码合并（D6）。
  try {
    const raw = await chatJson(
      provider,
      buildConceptMergeMessages({ chapterTitle: input.chapterTitle, candidates: deduped }),
      TEMPERATURE.concept,
    );
    const { merged, candidateToMerged } = parseConceptMerge(raw, deduped);
    if (merged.length === 0) {
      throw new AiProviderError("request-failed", "概念归并未产出任何合规条目。");
    }
    // 关系端点：去重前候选下标 →（indexMap）去重后下标 →（candidateToMerged）最终槽位。
    const mergedRelations = remapRelationDrafts(
      rawRelations,
      (i) => candidateToMerged[indexMap[i]],
      merged.length,
    );
    return buildResult(merged, mergedRelations, false);
  } catch (err) {
    aiLog("warn", "chapter-map-reduce", "概念归并失败，回退代码级合并结果", {
      reason: aiErrPreview(err),
      candidates: deduped.length,
    });
    return buildResult(deduped, fallbackRelations, true);
  }
}
