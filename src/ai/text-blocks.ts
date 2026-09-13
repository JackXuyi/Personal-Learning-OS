/**
 * 通用文本分块纯函数 —— 「概览」与「章内 map-reduce」共用的分块内核。
 *
 * 来源：本模块的内核原为 `overview-pipeline.ts` 的私有实现（`collectBoundaries`
 * / `cutByBoundaries` / `splitEvenly`）。长章 map-reduce 需要同一套「语义边界
 * 优先」的切块逻辑，故抽出并泛化，**不复制第二份**。
 *
 * 依赖约束：本模块零 AI、零 React、零 storage —— 只做字符串运算，
 * 因此可在 node 单测里直跑（`--experimental-strip-types`）。
 *
 * 不变式（由单测守住）：
 * - `blocks[0].start === 0`、末块 `end === text.length`（不留尾巴）；
 * - `blocks[i].end === blocks[i + 1].start`（拼接各块切片 === 原文）；
 * - `blocks.length <= maxChunks`。
 */

/** 一段连续正文（相对传入 `text` 的区间，start 含 / end 不含）。 */
export interface TextBlock {
  index: number;
  /** 相对传入 text 的区间，start 含 / end 不含。 */
  start: number;
  end: number;
}

export interface PlanTextBlocksInput {
  text: string;
  /**
   * 不跨切的语义边界（章起点等）；段落空行由内部补全。
   * 越界值会被夹取到 `[1, len - 1]` 之外则忽略。
   */
  anchorOffsets?: readonly number[];
  /** 目标块尺寸（字符）；非正数时按 `ceil(len / maxChunks)` 自适应。 */
  chunkChars: number;
  maxChunks: number;
}

/**
 * 收集「允许切开」的位置（升序、去重、去端点）。
 *
 * 两类候选：
 * - **传入的语义边界**（章起点 / 章内锚点）：章是切分器算好的语义单元，
 *   保证**不跨章切**（跨章切会把两章中段拼一起，归并阶段容易串味）；
 * - **段落空行**：`\n\n` 之后。用于两种情况：无章节时退化为按段落分块；
 *   单章本身超限时在章内二次切分（避免把 markdown 围栏或表格行切一半）。
 */
function collectBoundaries(text: string, anchorOffsets: readonly number[]): number[] {
  const len = text.length;
  const set = new Set<number>();
  for (const o of anchorOffsets) {
    const at = Math.max(0, Math.min(o, len));
    if (at > 0 && at < len) set.add(at);
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
 * 纯函数：把正文规划成 ≤ maxChunks 块（连续、无重叠、覆盖全文）。
 *
 * 空 / 纯空白正文 → `[]`（不抛错，由调用方决定提示）。
 */
export function planTextBlocks(input: PlanTextBlocksInput): TextBlock[] {
  const { text } = input;
  const maxChunks = Math.max(1, Math.floor(input.maxChunks));
  // chunkChars 非正 → 按块数上限自适应（保证最终块数收敛到 maxChunks）。
  const chunkChars =
    input.chunkChars > 0 ? input.chunkChars : Math.max(1, Math.ceil(text.length / maxChunks));

  if (text.trim().length === 0) return [];
  // 与「单次成稿」同门槛：只要装得下就只出一块。
  if (text.length <= chunkChars) {
    return [{ index: 0, start: 0, end: text.length }];
  }

  const boundaries = collectBoundaries(text, input.anchorOffsets ?? []);
  let ranges = cutByBoundaries(text, boundaries, chunkChars);

  if (ranges.length > maxChunks) {
    // 放大块尺寸重跑：chunk = ceil(len / maxChunks) 时块数上界即 maxChunks。
    ranges = cutByBoundaries(text, boundaries, Math.ceil(text.length / maxChunks));
  }
  if (ranges.length > maxChunks) {
    // 极端边界分布（如每章都比目标块略小）仍超限 → 兜底算术均分。
    // 这一步会放弃「不跨边界」的语义约束，换取块数硬保证。
    ranges = splitEvenly(text.length, maxChunks);
  }

  return ranges.map((r, i) => ({ index: i, start: r.start, end: r.end }));
}

/**
 * 章内分块的自适应块尺寸：`clamp(ceil(len / maxChunks), min, max)`。
 *
 * 语义：短章（`len` 小）得到 `min`，即「装得下就单块」；长章按块数上限反推
 * 尺寸，并夹在 `[min, max]` 内 —— 保证调用次数可控（≤ maxChunks 次）。
 */
export function adaptiveChunkChars(
  len: number,
  opts: { min: number; max: number; maxChunks: number },
): number {
  const byCount = Math.ceil(Math.max(0, len) / Math.max(1, opts.maxChunks));
  return Math.min(opts.max, Math.max(opts.min, byCount));
}

/**
 * 取正文摘录：去 markdown 标题行 → 压空白 → 截断加省略号。
 *
 * 原为 `pipelines.ts` 的私有 `chapterExcerpt`；被「章节精修提示词」与
 * 「出题上下文章节摘录」复用，现下沉到本模块（签名与行为逐字节保持）。
 */
export function excerptOf(text: string, start: number, end: number, maxChars: number): string {
  const raw = text
    .slice(start, end)
    .replace(/^#{1,6}\s+.*$/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  if (raw.length === 0) return "";
  return raw.length <= maxChars ? raw : `${raw.slice(0, maxChars)}…`;
}
