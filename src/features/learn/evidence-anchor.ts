/**
 * 原文锚定（evidence-anchor）—— 把 AI 给的摘录定位回原文字符区间。
 *
 * 设计原则（docs/library-detail-page-design-2026-09.md §4.3 / §8.3）：
 * - **不信 AI 的偏移量**：AI 只负责给 `quote`（verbatim 摘录），`start/end`
 *   一律由本模块用 indexOf 算出来。AI 自报偏移在换行/全角/截断场景下
 *   经常漂移，交给它等于把可溯源这条承诺架空。
 * - **诚实降级**：定位不到就返回 `undefined`，由调用方省略 evidence，
 *   绝不用「近似位置」糊一个区间上去（P0-3 不伪造内容）。
 * - 纯函数、零 IO、零 React —— 可直跑 node 单测。
 */

/** 单条 quote 允许的最大长度（防 AI 灌水：把整章当摘录塞回来）。 */
export const MAX_QUOTE_CHARS = 2000;

/** 折叠空白后的字符 → 原始字符串下标的映射表。 */
export interface FoldedText {
  /** 折叠后的字符串（连续空白 → 单个空格，首尾 trim 由调用方决定）。 */
  folded: string;
  /** map[i] = folded 第 i 个字符在原始串中的下标。 */
  map: number[];
}

/**
 * 折叠空白并建立「折叠后下标 → 原始下标」映射。
 *
 * 用途：AI 摘录常把原文的换行 / 缩进 / 全角空格写成单个半角空格，
 * 直接 indexOf 必然 miss。折叠后匹配成功，再用 map 把区间还原回
 * 原始串的绝对偏移，才能正确高亮。
 */
export function foldWhitespace(s: string): FoldedText {
  const folded: string[] = [];
  const map: number[] = [];
  let pendingSpace = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (isWhitespace(ch)) {
      // 串首空白丢弃；连续空白压成一个半角空格，锚点取第一个空白字符。
      if (folded.length === 0) continue;
      if (pendingSpace) continue;
      pendingSpace = true;
      folded.push(" ");
      map.push(i);
    } else {
      pendingSpace = false;
      folded.push(ch);
      map.push(i);
    }
  }
  // 尾部空白折叠成的一个空格要去掉（否则 "a\n" → "a " 会多出一个锚点）。
  while (folded.length > 0 && folded[folded.length - 1] === " ") {
    folded.pop();
    map.pop();
  }
  // map 补一位哨兵：便于取区间右端点（end 不含）。
  map.push(s.length);
  return { folded: folded.join(""), map };
}

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\u3000" ||
    ch === "\u00a0" || ch === "\ufeff";
}

/**
 * 在 `body` 中定位 `quote`，返回**相对 body** 的 [start, end)。
 *
 * 两档匹配：
 *   档 1 —— `indexOf` 精确匹配（快路径，绝大多数命中）；
 *   档 2 —— 折叠空白后匹配，再经映射表还原原始偏移。
 *
 * @returns 命中返回区间；`quote` 为空 / 超长 / 两档都未命中返回 `undefined`。
 */
export function locateQuote(
  body: string,
  quote: string,
): { start: number; end: number } | undefined {
  const q = quote?.trim() ?? "";
  if (q.length === 0 || q.length > MAX_QUOTE_CHARS) return undefined;
  if (!body) return undefined;

  // 档 1：精确。
  const exact = body.indexOf(q);
  if (exact >= 0) return { start: exact, end: exact + q.length };

  // 档 2：折叠空白（AI 摘录里换行/缩进被改写的场景）。
  const bodyFold = foldWhitespace(body);
  const quoteFold = foldWhitespace(q);
  if (quoteFold.folded.length === 0) return undefined;
  const hit = bodyFold.folded.indexOf(quoteFold.folded);
  if (hit < 0) return undefined;

  const start = bodyFold.map[hit];
  const endIdx = hit + quoteFold.folded.length; // 右端点：下一字符的原始起点
  const end = bodyFold.map[endIdx] ?? body.length;
  if (end <= start) return undefined;
  return { start, end };
}

/**
 * 便捷：定位并叠加章起始偏移 → **文档绝对区间**。
 *
 * @param body  章正文（doc.textPreview.slice(contentRef.start, contentRef.end)）
 * @param quote AI 给出的原文摘录
 * @param base  章在文档中的起始偏移（Chapter.contentRef.start）
 */
export function anchorToDocument(
  body: string,
  quote: string,
  base: number,
): { start: number; end: number } | undefined {
  const hit = locateQuote(body, quote);
  if (!hit) return undefined;
  return { start: base + hit.start, end: base + hit.end };
}

/** 区间有效（非负、左闭右开、起点小于终点）。 */
export function isValidRange(r: { start: number; end: number } | undefined): boolean {
  return !!r && r.start >= 0 && r.end > r.start;
}
