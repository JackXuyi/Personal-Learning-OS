/**
 * 章节精修 · 分批执行 —— 把「整篇一次调用」的 AI 精修改成「按批调用 + 全局下标重映射」。
 *
 * 为什么需要：`pipelines.ts` 原来对整篇设硬门槛 —— 全文 > 60,000 字或章数 > 24
 * 就**静默 `return []`**（界面显示「分析完成」但 `changed = 0`，用户以为点了没用）。
 * 长资料（GitHub 合并 Markdown / 长 PDF）因此永远拿不到标题提炼与要点补充。
 *
 * 分批依据（关键）：**由「输出长度」反推，而不是输入长度**。
 * 精修的输出是「每章一条 JSON（标题 + 2–5 条要点）」，小模型 `max_tokens` 截断
 * 是最常见失败模式 —— 12 章 ≈ 2–3k 字符输出，能稳定装进 4k token 预算；
 * 而输入侧（章摘录）有独立护栏，避免提示词撑爆上下文。
 *
 * 跨批合并（D5）：`applyChapterRefine` 按**全局 index** 顺序统一应用，
 * 因此批首章标 `mergeIntoPrevious` 会并入上一批的末章 —— 语义天然正确，
 * 不需要额外禁止（「是否过碎」只看该章自身，不需要看上一章是否同批）。
 */
import type { Chapter } from "../domain";
import type { ChapterRefine } from "../engine/splitter-engine";
import type { AIProvider, ChatMessage } from "./types";
import { AiProviderError } from "./types";
import { PIPELINE_LIMITS, TEMPERATURE, chatJson, isRecord, str } from "./pipeline-core";
import { excerptOf } from "./text-blocks";

/** 精修提示词里每章摘录的字符上限（与出题上下文同量级，够 AI 判断章讲什么）。 */
const REFINE_EXCERPT_CHARS = 700;

const REFINE_SYSTEM =
  "你是严谨的学习资料章节编辑。用户会给出按启发式切出的章节列表（每章附正文摘录）。" +
  "请对每一章给出精修建议，三项职责：\n" +
  "1) 标题 title：把占位/泛化标题（如「第 3 节」）或过于啰嗦的标题改成准确简洁的章标题（≤24 字）；已恰当的保持原样；\n" +
  "2) 学习要点 keyPoints：依据本章正文提炼 2–5 条陈述式要点，每条 ≤60 字、可判对错，绝不编造正文没有的内容；\n" +
  "3) 边界修正 mergeIntoPrevious：仅当该章明显过碎（不足以独立成章，如只有一两句过渡内容）时置 true，表示并入上一章；若该章是整篇资料的第一章则必须为 false。\n" +
  "只输出一个 JSON 数组（不要 markdown 围栏、不要多余文字），元素格式：" +
  '{"index":0,"title":"章标题","keyPoints":["要点1","要点2"],"mergeIntoPrevious":false}。';

/* ------------------------------------------------------------------ */
/* 1) 分批规划（纯函数）                                               */
/* ------------------------------------------------------------------ */

/** 一个精修批次：本批要处理的章 + 它们在**整篇**中的下标。 */
export interface RefineBatch {
  index: number;
  /** `chapter` 交给提示词；`globalIndex` 用于把批内 index 还原成整篇下标。 */
  chapters: { chapter: Chapter; globalIndex: number }[];
}

/**
 * 纯函数：按「章数上限」与「摘录字符上限」双约束把章分组（**保持原顺序**）。
 *
 * 两条约束任一将被突破就收批 —— 章数是主约束（决定输出长度），
 * 摘录字符是副约束（决定输入长度）。单个章自身超限时不特殊处理：
 * 它自成一批，交由提示词侧的 700 字摘录截断兜住。
 */
export function planRefineBatches(
  chapters: readonly Chapter[],
  text: string,
  opts?: { maxChapters?: number; maxExcerptChars?: number },
): RefineBatch[] {
  const maxChapters = Math.max(1, opts?.maxChapters ?? PIPELINE_LIMITS.refineBatchChapters);
  const maxExcerptChars = Math.max(
    REFINE_EXCERPT_CHARS,
    opts?.maxExcerptChars ?? PIPELINE_LIMITS.refineBatchExcerptChars,
  );

  const batches: RefineBatch[] = [];
  let cur: RefineBatch["chapters"] = [];
  let curChars = 0;

  for (let i = 0; i < chapters.length; i++) {
    const c = chapters[i];
    // 摘录长度与 `buildRefineMessages` 同口径（同一 `excerptOf` + 同一上限），
    // 因此这里的字符预算是真实预算，不是估算。
    const len = excerptOf(text, c.contentRef.start, c.contentRef.end, REFINE_EXCERPT_CHARS).length;
    if (cur.length > 0 && (cur.length >= maxChapters || curChars + len > maxExcerptChars)) {
      batches.push({ index: batches.length, chapters: cur });
      cur = [];
      curChars = 0;
    }
    cur.push({ chapter: c, globalIndex: i });
    curChars += len;
  }
  if (cur.length > 0) batches.push({ index: batches.length, chapters: cur });
  return batches;
}

/* ------------------------------------------------------------------ */
/* 2) 提示词与解析（纯函数，自 pipelines.ts 迁入）                      */
/* ------------------------------------------------------------------ */

/**
 * 纯函数：构建精修提示词（供单测与执行器复用）。
 *
 * `text` 恒为**整篇正文**：章用 `contentRef` 从全文取摘录，因此分批时
 * 只需把章列表换成子集，正文不必切片（也避免了跨批摘录边界出错）。
 */
export function buildRefineMessages(
  chapters: readonly Chapter[],
  text: string,
): ChatMessage[] {
  const lines = chapters.map((c, i) => {
    const excerpt = excerptOf(text, c.contentRef.start, c.contentRef.end, REFINE_EXCERPT_CHARS);
    return `[${i}] 标题「${c.title || "(空)"}」\n正文摘录：${excerpt || "(无正文)"}`;
  });
  return [
    { role: "system", content: REFINE_SYSTEM },
    {
      role: "user",
      content: `章节列表如下（共 ${chapters.length} 项，index 即本批数组下标）：\n\n${lines.join("\n\n")}`,
    },
  ];
}

/** 纯函数：解析 AI 精修响应 → 规范化建议（交给 engine.applyChapterRefine 应用）。 */
export function parseChapterRefines(raw: unknown, chapterCount: number): ChapterRefine[] {
  if (!Array.isArray(raw)) {
    throw new AiProviderError("request-failed", "AI 精修响应不是数组。");
  }
  const out: ChapterRefine[] = [];
  for (const item of raw.slice(0, chapterCount * 2)) {
    if (!isRecord(item)) continue;
    const index = item.index;
    if (typeof index !== "number" || !Number.isInteger(index)) continue;
    const title = str(item.title);
    const kpRaw = item.keyPoints;
    const keyPoints = Array.isArray(kpRaw) ? kpRaw.filter((k): k is string => typeof k === "string") : undefined;
    out.push({
      index,
      ...(title ? { title } : {}),
      ...(keyPoints && keyPoints.length > 0 ? { keyPoints } : {}),
      ...(typeof item.mergeIntoPrevious === "boolean" ? { mergeIntoPrevious: item.mergeIntoPrevious } : {}),
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 3) 执行器                                                           */
/* ------------------------------------------------------------------ */

/**
 * 分批精修：逐批 `chatJson` → **批内 index 重映射为整篇 index** → 聚合。
 *
 * 失配语义：**单批失败只丢该批**（`failedBatches` 计数），其余批照常生效 ——
 * 长资料不该因一批失败整篇作废。调用方据 `failedBatches > 0` 提示「N 章未精修」。
 */
export async function refineChaptersBatched(
  provider: AIProvider,
  chapters: readonly Chapter[],
  text: string,
): Promise<{ refines: ChapterRefine[]; batches: number; failedBatches: number }> {
  const batches = planRefineBatches(chapters, text);
  const refines: ChapterRefine[] = [];
  let failedBatches = 0;

  for (const batch of batches) {
    try {
      const raw = await chatJson(
        provider,
        buildRefineMessages(batch.chapters.map((x) => x.chapter), text),
        TEMPERATURE.refine,
      );
      // 批内 index → 整篇 index（D5：跨批 mergeIntoPrevious 由 applyChapterRefine 统一处理）
      for (const r of parseChapterRefines(raw, batch.chapters.length)) {
        const globalIndex = batch.chapters[r.index]?.globalIndex;
        if (globalIndex === undefined) continue;
        refines.push({ ...r, index: globalIndex });
      }
    } catch {
      failedBatches++;
    }
  }

  return { refines, batches: batches.length, failedBatches };
}
