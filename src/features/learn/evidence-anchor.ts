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
 * 折叠**全部空白**（换行 / 空格 / 制表 / 全角空格一律**移除**，而不是压成空格）。
 *
 * 为什么需要第二档（F5 第 2 条决策 D7，docs/learn-highlight-note-design-2026-09.md §8.3）：
 * `PlainTextRenderer` 逐行渲染 → 换行符**不存在于任何文本节点**，而容器的
 * `whitespace-pre-wrap` 也只在**行内**保留空白。于是 DOM 文本里既没有换行，
 * 也无法用「压成空格」的 `foldWhitespace` 对齐 —— 跨行选区（quote 含 `\n`）
 * 在折叠档上必然 miss。本档把两侧空白一律移除，跨行区间才能对齐。
 *
 * ⚠️ 代价：**行内空格差异也被忽略**（假命中风险）→ 调用方（`highlight.ts`）
 * 必须配合「源串 start 升序 + 顺序贪心」消歧（D8），并接受
 * 「宁可不高亮，也不错位高亮」的降级姿态。
 */
export function foldToNone(s: string): FoldedText {
  const folded: string[] = [];
  const map: number[] = [];
  for (let i = 0; i < s.length; i++) {
    // 与 foldWhitespace 共用同一个 isWhitespace —— 空白判定只有一处实现。
    if (isWhitespace(s[i])) continue;
    folded.push(s[i]);
    map.push(i);
  }
  // map 补一位哨兵：便于取区间右端点（end 不含），与 foldWhitespace 同约定。
  map.push(s.length);
  return { folded: folded.join(""), map };
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

/**
 * 在**渲染后的 DOM 文本**上定位 `quote`（F5 第 2 条：划线回显与 `?at=` 跳转共用）。
 *
 * 与 `locateQuote` 的分工（**两把尺子，刻意不同**）：
 * | | `locateQuote` | 本函数 |
 * |---|---|---|
 * | 输入 | **源串**（`textPreview` 切片） | **DOM 文本**（文本节点按序相接） |
 * | 档 2 折叠 | `foldWhitespace`（连续空白**压成空格**） | `foldToNone`（空白**全部移除**） |
 * | 为什么 | AI 摘录常把换行写成空格，压成空格仍能对齐 | DOM 里**没有换行符**（逐行渲染），
 * 压成空格必然 miss；只有「移除式」对齐才对得上跨行选区 |
 *
 * 抽出为纯函数（而非埋在 `highlight.ts` 的 DOM 代码里）的理由：**它是定位正确性的
 * 全部所在**（两档匹配 + `from` 顺序贪心消歧），必须能被 node 单测直跑 ——
 * 否则只能靠起浏览器验证，而本仓库禁止无头浏览器校验。
 *
 * @param from 起搜位置（DOM 文本下标）：顺序贪心（D8）靠它让重复 quote 逐一对位。
 */
export function locateQuoteInDomText(
  domText: string,
  quote: string,
  from = 0,
): { start: number; end: number } | undefined {
  const q = quote?.trim() ?? "";
  if (q.length === 0 || !domText) return undefined;
  const at = Math.max(0, Math.min(from, domText.length));

  // 档 1：精确。
  const exact = domText.indexOf(q, at);
  if (exact >= 0) return { start: exact, end: exact + q.length };

  // 档 2：移除式折叠（D7）。折叠后下标 → 原始 DOM 文本下标，需补回 `at`。
  const sliced = domText.slice(at);
  const foldedDom = foldToNone(sliced);
  const foldedQuote = foldToNone(q);
  if (foldedQuote.folded.length === 0) return undefined;
  const hit = foldedDom.folded.indexOf(foldedQuote.folded);
  if (hit < 0) return undefined;

  const start = at + (foldedDom.map[hit] ?? 0);
  const end = at + (foldedDom.map[hit + foldedQuote.folded.length] ?? sliced.length);
  if (end <= start) return undefined;
  return { start, end };
}

/**
 * 在 DOM 文本上定位 quote，并在**多次出现**时用左侧上下文消歧（T12 / D10）。
 *
 * 为什么需要：`?at=` / 引文跳转给的是「一个区间」，而**同一段文字在文档里出现多次
 * 是常态**（页眉页脚、模板句、重复出现的表头、mermaid 源码里的同构片段）。
 * 取首个命中会把用户送到**另一处**去 —— 这恰恰是 D10 承诺要杜绝的「错位」。
 *
 * 消歧依据：源串在目标区间**左侧的那几十个字**。同一段原文在文档里重复时，
 * 前文几乎不可能也一模一样；用「前文折叠后的最长公共后缀长度」打分，
 * 分高者即真身。这是 W3C Web Annotation 的 `TextQuoteSelector` 思路
 * （quote + prefix/suffix 消歧），只是把 suffix 让给了「区间只取单点」的简单性。
 *
 * ⚠️ 仍然只认**字面**：本函数只在「quote 真实出现在 DOM 文本里的若干位置」之间
 * 挑选，不会为不存在的字面伪造位置。
 *
 * @param context 源串中紧跟目标区间之前的一段文本（建议 40–80 字）。
 * @param limit 枚举上限（防御性；正常文档同段文字重复次数远小于此）。
 * @returns 得分最高的出现位置；无命中返回 `undefined`。
 */
export function bestOccurrence(
  domText: string,
  quote: string,
  context: string,
  limit = 8,
): { start: number; end: number } | undefined {
  if (!domText) return undefined;
  const ctx = foldToNone(context ?? "").folded;
  let cursor = 0;
  let best: { start: number; end: number } | undefined;
  let bestScore = -1;
  for (let i = 0; i < limit; i++) {
    const hit = locateQuoteInDomText(domText, quote, cursor);
    if (!hit) break;
    let score = 0;
    if (ctx.length > 0) {
      const overlap = commonSuffixLen(
        // 多取 2 倍长度再折叠：折叠会吃掉空白，取宽一点才不会把上下文截短
        foldToNone(domText.slice(Math.max(0, hit.start - ctx.length * 2), hit.start)).folded,
        ctx,
      );
      // ⚠️ 门槛：中文正文里两个无关片段也可能共尾一两个「。」/「，」，
      // 若把这种偶合当证据，就会为了「1 个字符的相似」丢掉「首个出现」这个
      // 确定性默认。重叠不足 `MIN_CONTEXT_MATCH` 一律按「无证据」计（score 0）。
      if (overlap >= MIN_CONTEXT_MATCH) score = overlap;
    }
    if (score > bestScore) {
      bestScore = score;
      best = hit;
    }
    if (hit.end <= cursor) break; // 防御：游标不前进即退出，避免死循环
    cursor = hit.end;
  }
  return best;
}

/** 上下文被视为「有效证据」所需的最小公共后缀长度（见 `bestOccurrence` 的门槛说明）。 */
const MIN_CONTEXT_MATCH = 4;

/** 两串的公共后缀长度（中文正文靠它衡量「前文像不像」）。 */
function commonSuffixLen(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[a.length - 1 - i] === b[b.length - 1 - i]) i += 1;
  return i;
}
