/**
 * 章内 map-reduce —— 把「一次读整章」的逐章管道（概念抽取 / 要点抽取）改成
 * 「章内分块 map → 代码级合并 → 引用式 AI 归并」。
 *
 * 为什么需要：`pipelines.ts` 原来对单章设 40,000 字硬上限，超限直接抛错，
 * 长章（几万字的 PDF 论文单章）永远拿不到概念 / 要点。而「概览」管道早已用
 * map-reduce 跑通 40 万字 —— 本模块把那套范式补齐到逐章管道。
 *
 * ## 引用式归并（本模块的核心不变量）
 *
 * 分块后各块互不可见，必须归并；但要点/概念的 `quote` 要能与原文精确对齐
 * （`locateQuote` / `anchorToDocument` 的契约）。若让 AI 在归并时重写引文，
 * 引文就会与原文漂移，溯源承诺被架空。因此：
 *
 * > **AI 在归并阶段只输出「候选编号」（`sourceIndex` / `mergeOf`），
 * > 产出条目的 `quote` / `start` / `end` 一律从候选整体继承 —— AI 给的任何
 * > 引文文本都直接丢弃、不予采信。**
 *
 * 由此保证归并产物的出处字段与代码侧候选**逐字节一致**（单测守住）。
 *
 * 分层约束：本模块属 `ai/`，**不得** import `features/`。锚定能力（`AnchorFn`）
 * 由调用方（`analyze-service`）注入 —— 它才持有全文与章偏移。
 */
import type { KeyPointRef } from "../domain";
import type { AIProvider, ChatMessage } from "./types";
import { AiProviderError } from "./types";
import { PIPELINE_LIMITS, TEMPERATURE, chatJson, isRecord, str } from "./pipeline-core";
import { adaptiveChunkChars, planTextBlocks, type TextBlock } from "./text-blocks";
import { aiErrPreview, aiLog } from "./log";
import { hasMeaningfulText } from "../lib/text-quality";

/** 质量门原语已下沉 `lib/text-quality.ts`（engine 侧也要用）；此处 re-export 保持兼容。 */
export { hasMeaningfulText };

/* ------------------------------------------------------------------ */
/* 1) 章内分块（纯函数）                                               */
/* ------------------------------------------------------------------ */

/**
 * 纯函数：把章正文规划成 ≤ `chapterBlockMaxChunks` 块。
 *
 * 块尺寸 = `clamp(ceil(len / maxChunks), min, max)`：
 * - 短章（≤ min）得到 min → 装得下即单块，与改造前行为一致；
 * - 长章自动放大块尺寸，块数恒 ≤ 8（保证调用次数可控，本地小模型可承受）。
 *
 * 章内只有一个章，故**不传章起点**（无跨章可切），只按段落空行切。
 */
export function planChapterBlocks(text: string): TextBlock[] {
  const size = adaptiveChunkChars(text.length, {
    min: PIPELINE_LIMITS.chapterBlockMinChars,
    max: PIPELINE_LIMITS.chapterBlockMaxChars,
    maxChunks: PIPELINE_LIMITS.chapterBlockMaxChunks,
  });
  return planTextBlocks({
    text,
    chunkChars: size,
    maxChunks: PIPELINE_LIMITS.chapterBlockMaxChunks,
  });
}

/**
 * 锚定能力（由调用方注入）：把 AI 给出的 quote 锚定成**文档绝对区间**。
 *
 * 返回 `undefined` = 该条在原文找不到确切出处 → 调用方应丢弃该条
 * （保持「无出处不入库」的诚实降级，不伪造 start/end）。
 */
export interface AnchorFn {
  (quote: string): { start: number; end: number } | undefined;
}

/* ------------------------------------------------------------------ */
/* 2) 要点族：类型与提示词                                             */
/* ------------------------------------------------------------------ */

/**
 * 单条要点草稿。
 *
 * 注意：**这里没有 start/end**。偏移量不由 AI 给——AI 报的字符偏移在换行 /
 * 全角 / 截断场景下经常漂移，交给它等于把「可溯源」这条承诺架空。
 * 偏移一律由 `locateQuote` 在原文里算出来（见 features/learn/evidence-anchor.ts）。
 */
export interface AiKeyPointDraft {
  point: string;
  quote: string;
}

/** 要点候选：分块 map 后、已由代码锚定的条目（归并阶段只能引用它）。 */
export interface KeyPointCandidate {
  /** 候选全局下标（AI 用 `sourceIndex` 引用它）。 */
  index: number;
  point: string;
  /** 原文摘录：与 `start/end` 同源，均来自代码侧锚定。 */
  quote: string;
  start: number;
  end: number;
}

/**
 * 要点抽取与「概念抽取」的关键差异：**每条要点都必须附原文摘录**。
 * 用户的核心诉求是「知识点能对应到原文」，所以提示词把 quote 列为必填项，
 * 并明确要求逐字照抄——便于 `locateQuote` 精确命中（档 1 就能解决绝大多数）。
 */
const KEYPOINT_SYSTEM =
  "你是严谨的学习资料要点提炼助手。用户会给出一章正文，请提炼这一章的学习要点。\n" +
  "要求：\n" +
  "- 2–5 条陈述式要点，每条 ≤60 字、可判对错，只讲正文真正讲到的内容，绝不编造；\n" +
  "- 每条要点必须附 `quote`：该要点在本章正文中对应的**原文摘录**（≤200 字）。\n" +
  "  必须逐字照抄正文中的连续片段，不得改写、概括、拼接不相邻的句子；\n" +
  "- 找不到确切原文出处的要点请不要输出（宁缺毋滥），不要为了凑数给空 quote；\n" +
  "- 要点之间不要重复，也不要与章标题重复。\n" +
  "只输出一个 JSON 对象（不要 markdown 围栏与多余文字），格式：" +
  '{"points":[{"point":"要点","quote":"原文摘录"}]}。';

/**
 * 分块版的 system prompt：把范围从「一章」收窄为「这一段」。
 *
 * 关键约束是**只看这一段** —— 块与块之间不可见，一旦让它「推测整章」就会
 * 编造（与概览 `CHUNK_DIGEST_SYSTEM` 同一条铁律）。
 */
const KEYPOINT_BLOCK_SYSTEM =
  "你是严谨的学习资料要点提炼助手。用户会把**一章中的其中一段**正文交给你（不是整章）。\n" +
  "请只依据这一段提炼要点：\n" +
  "- 1–3 条陈述式要点，每条 ≤60 字、可判对错，只讲这一段真正讲到的内容，绝不编造；\n" +
  "- 每条要点必须附 `quote`：该要点在这一段正文中对应的**原文摘录**（≤200 字）。\n" +
  "  必须逐字照抄这一段里的连续片段，不得改写、概括、拼接不相邻的句子；\n" +
  "- 找不到确切原文出处的要点请不要输出（宁缺毋滥），不要为了凑数给空 quote；\n" +
  "- 铁律：只归纳这一段的真实内容，绝不臆测其他段落。\n" +
  "只输出一个 JSON 对象（不要 markdown 围栏与多余文字），格式：" +
  '{"points":[{"point":"要点","quote":"原文摘录"}]}。';

/**
 * 归并版 system prompt：**明确禁止 AI 输出引文**。
 *
 * 只说「给编号」不说「引文由系统关联」的话，小模型仍会习惯性回吐 quote，
 * 浪费输出预算并诱发截断。
 */
const KEYPOINT_MERGE_SYSTEM =
  "你是严谨的学习资料要点编辑。用户会给出一章各分段提炼出的要点候选（带编号，从 0 起）。\n" +
  "请合并重复 / 表达相近的要点，输出最能代表这一章的若干条要点。\n" +
  "要求：\n" +
  "- 每条给 `point`（≤60 字、可判对错的陈述句）与 `sourceIndex`（该要点依据的候选编号）；\n" +
  "- **不要输出原文引文** —— 引文由系统按 sourceIndex 自动关联，你只需给出编号；\n" +
  "- 只依据给出的候选，不引入候选之外的信息；\n" +
  "- 输出条数必须**明显少于**候选条数（要做合并归纳，不是逐条搬运）。\n" +
  "只输出一个 JSON 数组（不要 markdown 围栏与多余文字），格式：" +
  '[{"point":"要点","sourceIndex":0}]。';

/** 纯函数：构建整章要点抽取提示词（短章单块路径，与改造前逐字节一致）。 */
export function buildKeyPointMessages(input: {
  chapterTitle: string;
  text: string;
}): ChatMessage[] {
  return [
    { role: "system", content: KEYPOINT_SYSTEM },
    {
      role: "user",
      content: `章「${input.chapterTitle || "(未命名章)"}」正文如下（${input.text.length} 字）：\n\n${input.text}`,
    },
  ];
}

/** 纯函数：构建分块要点抽取提示词（长章 map 阶段，单块）。 */
export function buildKeyPointBlockMessages(input: {
  blockIndex: number;
  blockTotal: number;
  text: string;
}): ChatMessage[] {
  return [
    { role: "system", content: KEYPOINT_BLOCK_SYSTEM },
    {
      role: "user",
      content:
        `这是章正文的第 ${input.blockIndex + 1}/${input.blockTotal} 段` +
        `（${input.text.length} 字）。请只归纳这一段：\n\n${input.text}`,
    },
  ];
}

/** 纯函数：构建要点归并提示词（reduce 阶段，只喂「编号 + 表述」）。 */
export function buildKeyPointMergeMessages(input: {
  chapterTitle: string;
  candidates: readonly KeyPointCandidate[];
}): ChatMessage[] {
  const lines = input.candidates.map((c) => `${c.index}. ${c.point}`);
  return [
    { role: "system", content: KEYPOINT_MERGE_SYSTEM },
    {
      role: "user",
      content:
        `章「${input.chapterTitle || "(未命名章)"}」各分段提炼出的要点候选如下` +
        `（共 ${input.candidates.length} 条，编号从 0 起）：\n\n${lines.join("\n")}\n\n` +
        `请合并为 ≤${PIPELINE_LIMITS.keyPointMergeMax} 条最能代表本章的要点。`,
    },
  ];
}

/* ------------------------------------------------------------------ */
/* 3) 要点族：解析                                                     */
/* ------------------------------------------------------------------ */

/**
 * 纯函数：解析 AI 要点响应 → 规范化草稿（裁剪 / 过滤 / 去重）。
 *
 * - `point` 裁剪到 60 字，`quote` 裁剪到 200 字；
 * - 空 point 丢弃；空 quote 丢弃（无原文出处的要点不入库，诚实降级）；
 * - 纯符号 point 丢弃（`hasMeaningfulText` 质量门，见函数注释）；
 * - 按 point 去重；最多留 `keyPointMergeMax`（8）条；
 * - 全部不合规 → 抛 `request-failed`（由调用方决定是否提示重试）。
 */
export function parseKeyPointDrafts(raw: unknown): AiKeyPointDraft[] {
  if (!isRecord(raw)) {
    throw new AiProviderError("request-failed", "AI 要点抽取响应不是对象。");
  }
  const rawPoints = Array.isArray(raw.points) ? raw.points : [];
  const out: AiKeyPointDraft[] = [];
  const seen = new Set<string>();

  for (const item of rawPoints) {
    if (!isRecord(item)) continue;
    const point = str(item.point)?.trim();
    if (!point) continue;
    const quote = str(item.quote)?.trim();
    // 无原文摘录 → 该条不可溯源，直接丢弃（E3 诚实降级）。
    if (!quote) continue;
    if (!hasMeaningfulText(point)) continue;
    const p = point.slice(0, PIPELINE_LIMITS.keyPointMaxChars);
    if (seen.has(p)) continue;
    seen.add(p);
    out.push({ point: p, quote: quote.slice(0, PIPELINE_LIMITS.keyPointQuoteMaxChars) });
    if (out.length >= PIPELINE_LIMITS.keyPointMergeMax) break;
  }

  if (out.length === 0) {
    throw new AiProviderError("request-failed", "AI 要点抽取未返回任何带原文出处的要点。");
  }
  return out;
}

/**
 * 纯函数：解析单块要点响应。
 *
 * 与 `parseKeyPointDrafts` **同契约**（同一套裁剪 / 丢空 quote / 去重 / 上限）。
 * 之所以单列一个名字：块级解析的语义是「这一段」而非「这一章」，
 * 调用点读起来更直观，将来若块级口径需要独立调整也有挂点。
 */
export function parseKeyPointBlockDrafts(raw: unknown): AiKeyPointDraft[] {
  return parseKeyPointDrafts(raw);
}

/**
 * 纯函数：解析要点归并响应 → 已带出处的要点引用。
 *
 * **引用式归并**：仅采信 AI 的 `point` 文本与 `sourceIndex` 编号；
 * `quote` / `start` / `end` 整体从 `candidates[sourceIndex]` 复制。
 *
 * 丢弃规则（宁少不编）：
 * - `sourceIndex` 非整数 / 越界 → 丢弃该条；
 * - `point` 为空或纯符号（质量门）→ 丢弃；
 * - 与已保留条目 **point 相同** → 丢弃（重复表述）；
 * - 与已保留条目 **start/end 相同** → 丢弃（同一处原文不该产两条引用）。
 *
 * 全部非法 → 返回 `[]`（由调用方决定是否回退代码级合并结果）。
 */
export function parseKeyPointMerge(
  raw: unknown,
  candidates: readonly KeyPointCandidate[],
): KeyPointRef[] {
  if (!Array.isArray(raw)) {
    throw new AiProviderError("request-failed", "AI 要点归并响应不是数组。");
  }
  const out: KeyPointRef[] = [];
  const seenPoints = new Set<string>();
  const seenSpans = new Set<string>();
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const src = item.sourceIndex;
    if (typeof src !== "number" || !Number.isInteger(src) || src < 0 || src >= candidates.length) {
      continue;
    }
    const point = str(item.point)?.trim();
    if (!point) continue;
    if (!hasMeaningfulText(point)) continue;
    const p = point.slice(0, PIPELINE_LIMITS.keyPointMaxChars);
    const c = candidates[src];
    const span = `${c.start}\u0001${c.end}`;
    if (seenPoints.has(p) || seenSpans.has(span)) continue;
    seenPoints.add(p);
    seenSpans.add(span);
    out.push({ point: p, quote: c.quote, start: c.start, end: c.end });
    if (out.length >= PIPELINE_LIMITS.keyPointMergeMax) break;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 4) 要点族：执行器                                                   */
/* ------------------------------------------------------------------ */

/** 逐条锚定：命中即入 refs；未命中计入 unanchored 并丢弃（E3 诚实降级）。 */
function toKeyPointRefs(
  drafts: readonly AiKeyPointDraft[],
  anchor: AnchorFn,
): { refs: KeyPointRef[]; unanchored: number } {
  const refs: KeyPointRef[] = [];
  let unanchored = 0;
  for (const d of drafts) {
    const hit = anchor(d.quote);
    if (!hit) {
      unanchored++;
      continue;
    }
    refs.push({ point: d.point, quote: d.quote, start: hit.start, end: hit.end });
  }
  return { refs, unanchored };
}

/**
 * 代码级兜底合并：按 point 与区间双重去重（归并失败时的退路，D6）。
 *
 * 不重排、不改写，只做「确定性去重 + 截断」，因此结果一定可溯源。
 */
function dedupKeyPointCandidates(candidates: readonly KeyPointCandidate[]): KeyPointRef[] {
  const out: KeyPointRef[] = [];
  const seenPoints = new Set<string>();
  const seenSpans = new Set<string>();
  for (const c of candidates) {
    const span = `${c.start}\u0001${c.end}`;
    if (seenPoints.has(c.point) || seenSpans.has(span)) continue;
    seenPoints.add(c.point);
    seenSpans.add(span);
    out.push({ point: c.point, quote: c.quote, start: c.start, end: c.end });
    if (out.length >= PIPELINE_LIMITS.keyPointMergeMax) break;
  }
  return out;
}

export interface MappedKeyPointResult {
  /** 已带 quote / start / end 的要点（全部出处字段来自代码侧，见模块头不变量）。 */
  refs: KeyPointRef[];
  /** 实际分块数（1 = 走单块直出路径）。 */
  blocks: number;
  /** map 阶段失败并跳过的块数（>0 时内容可能不完整）。 */
  skippedBlocks: number;
  /** quote 未能在原文定位、因而被丢弃的条数。 */
  unanchored: number;
  /** true = AI 归并失败，回退到代码级合并结果（D6）。 */
  mergeFallback: boolean;
}

/**
 * 要点抽取（章内 map-reduce）：任意长度章正文都不再因长度抛错。
 *
 * 执行序：
 * 1. `planChapterBlocks` 分块；
 * 2. **单块**（短章）→ 走整章提示词单次调用，行为与改造前一致；
 * 3. **多块**（长章）→ 逐块 map（单块失败跳过并计数）→ 逐条锚定 → 候选；
 * 4. 候选全部失败 → 抛错（该章判失败）；
 * 5. AI 归并（引用式）→ 失败则回退代码级合并（D6），不把已成功的块全废掉。
 */
export async function extractKeyPointsMapped(
  provider: AIProvider,
  input: {
    chapterTitle: string;
    /** 章正文（调用方用 contentRef 从全文切出）。 */
    text: string;
    /** 锚定回调（由 analyze-service 注入，内部闭包持有章的绝对偏移）。 */
    anchor: AnchorFn;
    /** 块级进度（`k` 从 1 起，`K` 为总块数）。 */
    onBlock?: (k: number, K: number) => void;
  },
): Promise<MappedKeyPointResult> {
  const body = input.text.trim();
  if (body.length === 0) {
    throw new AiProviderError("request-failed", "章正文为空，无法提炼要点。");
  }

  const blocks = planChapterBlocks(body);

  // 短章：单块直出。提示词与改造前逐字节一致（TC-UC04-01）。
  if (blocks.length <= 1) {
    if (body.length > PIPELINE_LIMITS.keyPointBlockMaxChars) {
      throw new AiProviderError(
        "request-failed",
        `单块仍过长（${body.length} 字，上限 ${PIPELINE_LIMITS.keyPointBlockMaxChars}），分块算法异常，请排查。`,
      );
    }
    const raw = await chatJson(
      provider,
      buildKeyPointMessages({ chapterTitle: input.chapterTitle, text: body }),
      TEMPERATURE.keyPoint,
    );
    const { refs, unanchored } = toKeyPointRefs(parseKeyPointDrafts(raw), input.anchor);
    return { refs, blocks: 1, skippedBlocks: 0, unanchored, mergeFallback: false };
  }

  // map：逐块串行。单块失败只跳过并计数，不整章判死。
  const candidates: KeyPointCandidate[] = [];
  let skippedBlocks = 0;
  let unanchored = 0;
  for (let k = 0; k < blocks.length; k++) {
    input.onBlock?.(k + 1, blocks.length);
    try {
      const raw = await chatJson(
        provider,
        buildKeyPointBlockMessages({
          blockIndex: k,
          blockTotal: blocks.length,
          text: body.slice(blocks[k].start, blocks[k].end),
        }),
        TEMPERATURE.keyPoint,
      );
      // 候选必须在此刻就带 start/end —— 归并后只能继承、不能重算。
      for (const d of parseKeyPointBlockDrafts(raw)) {
        const hit = input.anchor(d.quote);
        if (!hit) {
          unanchored++;
          continue;
        }
        candidates.push({
          index: candidates.length,
          point: d.point,
          quote: d.quote,
          start: hit.start,
          end: hit.end,
        });
      }
    } catch {
      skippedBlocks++;
    }
  }
  if (candidates.length === 0) {
    // 「候选为空」有两种成因，语义不同，不能一律判失败：
    // a) 所有分块调用都失败 → 该章确属失败（与逐块抛错一致）；
    // b) 分块调用成功，但 AI 给的 quote 全都锚不到原文 → 章**不算失败**
    //    （改造前就是「成功但 0 条 refs，保留原 keyPoints」，保持不回归）。
    if (skippedBlocks === blocks.length) {
      throw new AiProviderError("request-failed", "所有分块提炼均失败，未能得到任何要点。");
    }
    return { refs: [], blocks: blocks.length, skippedBlocks, unanchored, mergeFallback: false };
  }

  // reduce：AI 只选源与措辞；quote / start / end 一律从候选继承。
  const fallback = dedupKeyPointCandidates(candidates);
  try {
    const raw = await chatJson(
      provider,
      buildKeyPointMergeMessages({ chapterTitle: input.chapterTitle, candidates }),
      TEMPERATURE.keyPoint,
    );
    const merged = parseKeyPointMerge(raw, candidates);
    if (merged.length === 0) {
      throw new AiProviderError("request-failed", "要点归并未产出任何合规条目。");
    }
    return {
      refs: merged,
      blocks: blocks.length,
      skippedBlocks,
      unanchored,
      mergeFallback: false,
    };
  } catch (err) {
    aiLog("warn", "chapter-map-reduce", "要点归并失败，回退代码级合并结果", {
      reason: aiErrPreview(err),
      candidates: candidates.length,
    });
    return {
      refs: fallback,
      blocks: blocks.length,
      skippedBlocks,
      unanchored,
      mergeFallback: true,
    };
  }
}
