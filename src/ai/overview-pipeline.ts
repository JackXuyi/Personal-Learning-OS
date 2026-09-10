/**
 * AI 概览管道（整篇级）—— 资料详情页「概览」Tab 的能力实现。
 *
 * 为什么另起一个文件而不进 `pipelines.ts`：
 * `pipelines.ts` 已 765 行、超出仓库「文件 ≤700 行」硬上限，新能力不得继续堆入。
 * 本模块**自持**尺寸常量 / 提示词 / 解析器 / 执行器，只从 `pipelines.ts` 复用
 * `chatJson` / `isRecord` / `str`（既有传输与归一化工具），**不复制第二份**。
 *
 * 与既有五组管道的差异：那些都是**逐章**粒度，本管道是**整篇**粒度 ——
 * 长资料必然装不下单次调用（既有单章上限 40k 字，整篇可达 20 万字），
 * 因此这里的内核是**分层归纳（map-reduce）**：按章切块 → 逐块中部摘要 →
 * 归并成稿，保证概览覆盖全文主干而非只有开头。
 *
 * 诚实降级：不合规的 AI 输出一律抛 `AiProviderError`（类型化、可重试），
 * 绝不返回「看起来像概览」的半成品。
 */
import type { Chapter, OverviewMode } from "../domain";
import type { AIProvider, ChatMessage } from "./types";
import { AiProviderError } from "./types";
import { chatJson, isRecord, str } from "./pipelines";

/* ------------------------------------------------------------------ */
/* 1) 尺寸常量 + 分块规划（纯函数）                                    */
/* ------------------------------------------------------------------ */

/** 概览管道的尺寸上限（自持一份，不扩大 `pipelines.PIPELINE_LIMITS`）。 */
export const OVERVIEW_LIMITS = {
  /** 单次成稿上限 = 单块上限（同口径，便于「1 块 ⟺ 单次成稿」的统一推理）。 */
  chunkChars: 12_000,
  /** 最多分块数；正文更长时按 ceil(len / maxChunks) 放大块尺寸，保证块数 ≤ 该值。 */
  maxChunks: 20,
  /** 整篇硬上限（超出抛错，提示先精简 / 拆分）。 */
  maxTextChars: 400_000,
  /** 归并阶段喂给 AI 的中部摘要总量上限（超出按顺序截断并标注）。 */
  reduceChars: 16_000,
  gistChars: 60,
  sectionMax: 6,
  sectionHeadingChars: 20,
  sectionDetailChars: 80,
  prereqMax: 3,
  prereqChars: 40,
  keywordMax: 6,
  keywordChars: 12,
  /** 单块中部摘要的字符上限。 */
  digestChars: 120,
  /** 单块摘要里关键词 / 小标题的条数上限。 */
  digestKeywordMax: 4,
  digestHeadingMax: 4,
} as const;

/** 分块规划结果（纯数据，供执行器与单测共用）。 */
export interface OverviewBlock {
  index: number;
  /** 在 doc.textPreview 中的绝对区间（start 含 / end 不含）。 */
  start: number;
  end: number;
  /** 提示词里的块标识（所属章标题 / `第 N 段`）。 */
  label: string;
}

/**
 * 收集「允许切开」的位置（升序、去重、去端点）。
 *
 * 两类候选：
 * - **章起点**：章是切分器算好的语义单元，用章起点断块保证**不跨章切**
 *   （跨章切会把两章中段拼一起，归并阶段容易串味）；
 * - **段落空行**：`\n\n` 之后。用于两种情况：无章节时退化为按段落分块；
 *   单章本身超限时在章内二次切分（避免把 markdown 围栏或表格行切一半）。
 */
function collectBoundaries(text: string, chapters?: readonly Chapter[]): number[] {
  const len = text.length;
  const set = new Set<number>();
  for (const c of chapters ?? []) {
    const s = Math.max(0, Math.min(c.contentRef.start, len));
    if (s > 0 && s < len) set.add(s);
  }
  const re = /\n\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const at = m.index + m[0].length;
    if (at > 0 && at < len) set.add(at);
  }
  return [...set].sort((a, b) => a - b);
}

/**
 * 按候选边界顺序积累成块：块从 `start` 起，切点取「≤ start + chunkChars 的最靠右
 * 候选边界」；该范围内没有候选边界就硬切在 `start + chunkChars`（保证有进展）。
 */
function cutByBoundaries(
  text: string,
  boundaries: number[],
  chunkChars: number,
): { start: number; end: number }[] {
  const len = text.length;
  const out: { start: number; end: number }[] = [];
  let start = 0;
  while (start < len) {
    const target = start + chunkChars;
    if (target >= len) {
      out.push({ start, end: len });
      break;
    }
    let cut = -1;
    for (let i = boundaries.length - 1; i >= 0; i--) {
      const b = boundaries[i];
      if (b <= start) break;
      if (b <= target) {
        cut = b;
        break;
      }
    }
    // 范围内没有语义边界（超长章节 / 无空行）→ 硬切，避免零进展死循环。
    if (cut <= start) cut = target;
    out.push({ start, end: cut });
    start = cut;
  }
  return out.length > 0 ? out : [{ start: 0, end: len }];
}

/** 兜底：忽略语义边界，按 maxChunks 算术均分（保证块数 ≤ maxChunks）。 */
function splitEvenly(len: number, maxChunks: number): { start: number; end: number }[] {
  const size = Math.max(1, Math.ceil(len / maxChunks));
  const out: { start: number; end: number }[] = [];
  for (let start = 0; start < len; start += size) {
    out.push({ start, end: Math.min(start + size, len) });
  }
  return out;
}

/**
 * 块的显示标识：起点落在某章区间内 → 该章标题；否则**空串**。
 *
 * 为什么无章时不给「第 N 段」：这个 label 会经 `onProgress` 直接进 UI 进度行，
 * 而 UI 文案必须走 i18n —— 硬编码中文会漏到英文界面。块的序号提示由
 * `buildChunkDigestMessages` 自己在提示词里给出（`第 i/n 段`），信息不丢。
 * 章标题属**数据**（用户自己的资料内容），可以透出。
 */
function labelOf(start: number, chapters?: readonly Chapter[]): string {
  for (const c of chapters ?? []) {
    if (start >= c.contentRef.start && start < c.contentRef.end) {
      return c.title ?? "";
    }
  }
  return "";
}

/**
 * 纯函数：把正文规划成 ≤ maxChunks 块（连续、无重叠、覆盖全文）。
 *
 * 不变式（单测 TC-OV-07）：
 * - `blocks[0].start === 0`、末块 `end === text.length`（不留尾巴）；
 * - `blocks[i].end === blocks[i + 1].start`（拼接各块切片 === 原文）；
 * - `blocks.length <= maxChunks`。
 *
 * 空 / 纯空白正文 → `[]`（不抛错，由调用方决定提示）。
 */
export function planOverviewBlocks(input: {
  text: string;
  chapters?: readonly Chapter[];
  chunkChars?: number;
  maxChunks?: number;
}): OverviewBlock[] {
  const { text, chapters } = input;
  const chunkChars = input.chunkChars ?? OVERVIEW_LIMITS.chunkChars;
  const maxChunks = input.maxChunks ?? OVERVIEW_LIMITS.maxChunks;

  if (text.trim().length === 0) return [];
  // 与「单次成稿」同门槛：只要装得下就只出一块。
  if (text.length <= chunkChars) {
    return [{ index: 0, start: 0, end: text.length, label: "" }];
  }

  const boundaries = collectBoundaries(text, chapters);
  let ranges = cutByBoundaries(text, boundaries, chunkChars);

  if (ranges.length > maxChunks) {
    // 放大块尺寸重跑：chunk = ceil(len / maxChunks) 时块数上界即 maxChunks。
    ranges = cutByBoundaries(text, boundaries, Math.ceil(text.length / maxChunks));
  }
  if (ranges.length > maxChunks) {
    // 极端边界分布（如每章都比目标块略小）仍超限 → 兜底算术均分。
    // 这一步会放弃「不跨章」的语义约束，换取块数硬保证。
    ranges = splitEvenly(text.length, maxChunks);
  }

  return ranges.map((r, i) => ({
    index: i,
    start: r.start,
    end: r.end,
    label: labelOf(r.start, chapters),
  }));
}

/* ------------------------------------------------------------------ */
/* 2) 提示词（纯函数）                                                 */
/* ------------------------------------------------------------------ */

/** 温度：概览偏叙述，但四项结构需稳定 → 与「精修」同档。 */
const OVERVIEW_TEMPERATURE = 0.3;

/**
 * 分块归纳（map）的 system prompt。
 * 关键约束是**只看这一段**——块与块之间不可见，一旦让它「推测整体」就会编造。
 */
const CHUNK_DIGEST_SYSTEM =
  "你是严谨的学习资料导读编辑。用户会把一份长资料中的**其中一段**正文交给你（不是全文）。\n" +
  "请只依据这一段归纳，输出三项：\n" +
  "- digest：这一段讲了什么（≤120 字；陈述内容本身，不空谈「本段介绍了…」）；\n" +
  "- keywords：这一段的关键词 0–4 个（每个 ≤12 字）；\n" +
  "- headings：这一段涉及的主题名 0–4 个（每个 ≤20 字，供后续归并判断主干）。\n" +
  "铁律：只归纳这一段的真实内容，绝不臆测其他段落，绝不编造本段未提到的概念。\n" +
  "只输出一个 JSON 对象（不要 markdown 围栏与多余文字），格式：" +
  '{"digest":"…","keywords":["…"],"headings":["…"]}。';

/** 单次成稿的 system prompt（正文 ≤ chunkChars 时用它，一次读全文）。 */
const OVERVIEW_SYSTEM =
  "你是严谨的学习资料导读编辑。用户会给出**一整份**学习资料正文，请为它写一份导读概览。\n" +
  "输出四项：\n" +
  "- gist：一句话定位（≤60 字）——这份资料在讲什么、给谁看；\n" +
  "- sections：主干脉络 1–6 段，**按资料原有顺序**，每段 " +
  '{"heading":"主题（≤20 字）","detail":"这一段讲了什么（≤80 字）"}；\n' +
  "- prerequisites：读前需知 0–3 条（每条 ≤40 字，如「需要 Python 基础」）；\n" +
  "- keywords：关键词 0–6 个（每个 ≤12 字）。\n" +
  "要求：只依据正文，绝不编造；sections 必须覆盖**全文**主干（含靠后的章节），不要只总结开头；\n" +
  "不要写「本文介绍了…」这类空话，直接给出内容本身。\n" +
  "只输出一个 JSON 对象（不要 markdown 围栏与多余文字），格式：" +
  '{"gist":"…","sections":[{"heading":"…","detail":"…"}],"prerequisites":["…"],"keywords":["…"]}。';

/**
 * 归并成稿（reduce）的 system prompt。
 * 明写「必须明显少于摘要条数」——否则小模型容易把各块摘要逐条搬运，交出的还是
 * 「分块摘要」而非「整篇概览」，这正是 map-reduce 最容易失效的地方。
 */
const OVERVIEW_MERGE_SYSTEM =
  "你是严谨的学习资料导读编辑。用户会给出**同一份长资料**各分段的归纳摘要（按原文顺序）。\n" +
  "请把它们**归并成一份整篇导读**，而不是逐段罗列。\n" +
  "输出四项：\n" +
  "- gist：一句话定位（≤60 字）——整份资料在讲什么；\n" +
  "- sections：主干脉络 1–6 段（**合并重复主题**、按资料原顺序），每段 " +
  '{"heading":"≤20 字","detail":"≤80 字"}；\n' +
  "- prerequisites：读前需知 0–3 条（≤40 字）；\n" +
  "- keywords：关键词 0–6 个（≤12 字，取最能代表全篇的）。\n" +
  "铁律：只依据给出的摘要，不引入摘要里没有的内容；sections 的条数必须**明显少于**\n" +
  "给出的摘要条数（要做合并归纳，不是逐条搬运）。\n" +
  "只输出一个 JSON 对象（不要 markdown 围栏与多余文字），格式：" +
  '{"gist":"…","sections":[{"heading":"…","detail":"…"}],"prerequisites":["…"],"keywords":["…"]}。';

/** 纯函数：构建分块归纳提示词（map 阶段，单块）。 */
export function buildChunkDigestMessages(input: {
  blockIndex: number;
  blockTotal: number;
  label: string;
  text: string;
}): ChatMessage[] {
  const where = input.label ? `（${input.label}）` : "";
  return [
    { role: "system", content: CHUNK_DIGEST_SYSTEM },
    {
      role: "user",
      content:
        `这是一份长资料的第 ${input.blockIndex + 1}/${input.blockTotal} 段${where}正文` +
        `（${input.text.length} 字）。请只归纳这一段：\n\n${input.text}`,
    },
  ];
}

/** 纯函数：构建单次成稿提示词（正文 ≤ chunkChars）。 */
export function buildOverviewMessages(input: {
  title: string;
  text: string;
}): ChatMessage[] {
  return [
    { role: "system", content: OVERVIEW_SYSTEM },
    {
      role: "user",
      content: `资料《${input.title || "(未命名)"}》全文如下（${input.text.length} 字）：\n\n${input.text}`,
    },
  ];
}

/** 纯函数：构建归并成稿提示词（reduce 阶段，输入为各块中部摘要）。 */
export function buildOverviewMergeMessages(input: {
  title: string;
  totalChars: number;
  digests: readonly AiChunkDigest[];
}): ChatMessage[] {
  const lines: string[] = [];
  let used = 0;
  let omitted = 0;
  for (let i = 0; i < input.digests.length; i++) {
    const d = input.digests[i];
    const line =
      `${i + 1}. ${d.digest}` +
      (d.headings.length > 0 ? `（主题：${d.headings.join("、")}）` : "");
    // 摘要总量超上限 → 按顺序截断并如实标注，不静默丢弃。
    if (used + line.length > OVERVIEW_LIMITS.reduceChars) {
      omitted = input.digests.length - i;
      break;
    }
    lines.push(line);
    used += line.length;
  }
  return [
    { role: "system", content: OVERVIEW_MERGE_SYSTEM },
    {
      role: "user",
      content:
        `资料《${input.title || "(未命名)"}》全文共 ${input.totalChars} 字，` +
        `分 ${input.digests.length} 段归纳如下：\n\n${lines.join("\n")}` +
        (omitted > 0 ? `\n\n（后续 ${omitted} 段摘要因长度省略）` : ""),
    },
  ];
}

/* ------------------------------------------------------------------ */
/* 3) 解析（纯函数）                                                   */
/* ------------------------------------------------------------------ */

/** 分块中部摘要（map 阶段单块产物）。 */
export interface AiChunkDigest {
  digest: string;
  keywords: string[];
  headings: string[];
}

/** 概览草稿（单次成稿 / 归并成稿的统一产物）。 */
export interface AiOverviewDraft {
  gist: string;
  sections: { heading: string; detail: string }[];
  prerequisites: string[];
  keywords: string[];
}

/** 字符串数组归一化：只收非空串 → 裁剪 → 去重 → 取前 max 项。 */
function strList(
  v: unknown,
  maxItems: number,
  maxChars: number,
): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of v) {
    const s = str(item)?.trim();
    if (!s) continue;
    const cut = s.slice(0, maxChars);
    if (seen.has(cut)) continue;
    seen.add(cut);
    out.push(cut);
    if (out.length >= maxItems) break;
  }
  return out;
}

/**
 * 纯函数：解析单块归纳响应。
 * `digest` 缺失 / 空白 / 非对象 → 抛 `request-failed`（由执行器决定跳过该块）。
 */
export function parseChunkDigest(raw: unknown): AiChunkDigest {
  if (!isRecord(raw)) {
    throw new AiProviderError("request-failed", "AI 分块归纳响应不是对象。");
  }
  const digest = str(raw.digest)?.trim();
  if (!digest) {
    throw new AiProviderError("request-failed", "AI 分块归纳未返回摘要。");
  }
  return {
    digest: digest.slice(0, OVERVIEW_LIMITS.digestChars),
    keywords: strList(raw.keywords, OVERVIEW_LIMITS.digestKeywordMax, OVERVIEW_LIMITS.keywordChars),
    headings: strList(raw.headings, OVERVIEW_LIMITS.digestHeadingMax, OVERVIEW_LIMITS.sectionHeadingChars),
  };
}

/**
 * 纯函数：解析概览成稿响应（裁剪 / 去重 / 上限）。
 *
 * 两条硬拒绝：`gist` 为空、`sections` 为空 —— 一个只有「一句话定位」的概览
 * 价值有限，宁要求重试也不落一个「看起来像概览」的空壳（D6 决策）。
 */
export function parseOverviewDraft(raw: unknown): AiOverviewDraft {
  if (!isRecord(raw)) {
    throw new AiProviderError("request-failed", "AI 概览响应不是对象。");
  }
  const gist = str(raw.gist)?.trim();
  if (!gist) {
    throw new AiProviderError("request-failed", "AI 概览未返回「一句话定位」。");
  }

  const sections: { heading: string; detail: string }[] = [];
  for (const item of Array.isArray(raw.sections) ? raw.sections : []) {
    if (!isRecord(item)) continue;
    const heading = str(item.heading)?.trim();
    const detail = str(item.detail)?.trim();
    if (!heading || !detail) continue; // 缺头或缺正文 → 该段无效
    sections.push({
      heading: heading.slice(0, OVERVIEW_LIMITS.sectionHeadingChars),
      detail: detail.slice(0, OVERVIEW_LIMITS.sectionDetailChars),
    });
    if (sections.length >= OVERVIEW_LIMITS.sectionMax) break;
  }
  if (sections.length === 0) {
    throw new AiProviderError("request-failed", "AI 概览未返回主干脉络（sections 为空）。");
  }

  return {
    gist: gist.slice(0, OVERVIEW_LIMITS.gistChars),
    sections,
    prerequisites: strList(raw.prerequisites, OVERVIEW_LIMITS.prereqMax, OVERVIEW_LIMITS.prereqChars),
    keywords: strList(raw.keywords, OVERVIEW_LIMITS.keywordMax, OVERVIEW_LIMITS.keywordChars),
  };
}

/* ------------------------------------------------------------------ */
/* 4) 执行器（单次成稿 / 分层归纳）                                    */
/* ------------------------------------------------------------------ */

/**
 * 生成阶段（进度文案用）。
 *
 * 说明：本类型是对方案 §4.3.2 `onProgress(i, n, label)` 的一处**追加**——
 * 单次成稿与归并阶段没有「第 i/n 块」，若不加 phase，UI 只能在 map 进度文案里
 * 硬套（方案 §7.2 却已为三者分别设计了文案）。追加第 4 个参数不影响既有调用方。
 */
export type OverviewPhase = "single" | "map" | "merge";

/** 进度回调：phase + 第 i/n 块 + 块标识（label 仅在 map 阶段有值）。 */
export type OverviewProgress = (
  i: number,
  n: number,
  label: string,
  phase: OverviewPhase,
) => void;

/**
 * 概览执行器：正文 ≤ chunkChars → 单次成稿；否则 map 逐块归纳 → reduce 归并成稿。
 *
 * 失败语义（诚实降级，不落半成品）：
 * - 单块归纳失败 → **跳过并计数**，继续后续块（长资料不该因一块坏掉全废）；
 * - 全部块失败 → 抛错；
 * - 归并输出不合规 → 抛错（由调用方保证不写库）。
 */
export async function summarizeDocumentWithAi(
  provider: AIProvider,
  input: {
    title: string;
    text: string;
    chapters?: readonly Chapter[];
    onProgress?: OverviewProgress;
  },
): Promise<{
  draft: AiOverviewDraft;
  mode: OverviewMode;
  chunks: number;
  /** map 阶段失败并跳过的块数（single 时为 0）。 */
  skipped: number;
}> {
  const text = input.text.trim();
  if (text.length === 0) {
    throw new AiProviderError("request-failed", "正文为空，无法生成概览。");
  }
  if (text.length > OVERVIEW_LIMITS.maxTextChars) {
    throw new AiProviderError(
      "request-failed",
      `资料过长（${text.length} 字，上限 ${OVERVIEW_LIMITS.maxTextChars}），请先精简或拆分后再生成。`,
    );
  }

  const blocks = planOverviewBlocks({ text, chapters: input.chapters });

  // 单块 ⟺ 单次成稿（chunkChars 与「单次上限」同口径）。
  if (blocks.length <= 1) {
    input.onProgress?.(1, 1, "", "single");
    const raw = await chatJson(
      provider,
      buildOverviewMessages({ title: input.title, text }),
      OVERVIEW_TEMPERATURE,
    );
    return { draft: parseOverviewDraft(raw), mode: "single", chunks: 1, skipped: 0 };
  }

  // map：串行逐块。单块失败跳过并计数，不阻断后续块。
  const digests: AiChunkDigest[] = [];
  let skipped = 0;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    input.onProgress?.(i + 1, blocks.length, b.label, "map");
    try {
      const raw = await chatJson(
        provider,
        buildChunkDigestMessages({
          blockIndex: i,
          blockTotal: blocks.length,
          label: b.label,
          text: text.slice(b.start, b.end),
        }),
        OVERVIEW_TEMPERATURE,
      );
      digests.push(parseChunkDigest(raw));
    } catch {
      skipped++;
    }
  }
  if (digests.length === 0) {
    throw new AiProviderError("request-failed", "所有分块归纳均失败，未能生成概览。");
  }

  // reduce：归并成稿。此阶段失败直接抛（不写库，旧概览不被破坏）。
  input.onProgress?.(blocks.length, blocks.length, "", "merge");
  const raw = await chatJson(
    provider,
    buildOverviewMergeMessages({
      title: input.title,
      totalChars: text.length,
      digests,
    }),
    OVERVIEW_TEMPERATURE,
  );
  return {
    draft: parseOverviewDraft(raw),
    mode: "map-reduce",
    chunks: blocks.length,
    skipped,
  };
}
