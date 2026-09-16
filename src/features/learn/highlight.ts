/**
 * 原文高亮（highlight）—— 在**渲染结果 DOM** 中定位并包裹高亮。
 *
 * 两套口径，必须分清（docs/learn-highlight-note-design-2026-09.md §3.1.5 / §8.4）：
 *
 * 1. **持久划线层**（F5 第 2 条新增）：数据源是 `Annotation.quote`，定位方式是
 *    **在渲染后的 DOM 文本上做字面匹配**（`locateRangeInDom`）。它**不假设**
 *    「DOM 文本与源串等长」—— 后者已于 2026-09-16 用真实库实测证伪
 *    （44/44 章 DOM 文本都短于源串，中位 −2.0%，因为 `\n` / 行尾空白 /
 *    `### ` 前缀不进文本节点），而「quote 字面可见」这个前提弱得多、真实成立。
 * 2. **瞬时锚点层**（既有：`?at=` / QA 引用 / 复述引用跳转）：由
 *    `highlightSourceRange(root, text, start, end)` 负责 —— 先把**源串区间**切成
 *    quote，再在 DOM 文本上做同一套字面匹配（T12 / 决策 D10）。
 *    ⚠️ 旧实现 `highlightRange` 把源串偏移直接当 DOM 文本偏移喂给 `TreeWalker`，
 *    已实测 44/44 章系统性偏前 → **已删除**，勿再引入「两偏移相等」的假设。
 *
 * ⚠️ **两层必须分离**（决策 D6）：两层的 `<mark>` 带不同属性，清除函数各管一层。
 * 否则一次 `?at=` 跳转就会把用户辛苦划的线全抹掉（旧实现 `clearHighlights` 是
 * `querySelectorAll("mark")` 无差别清除）。
 *
 * 约束：纯 DOM 操作、无 React、无 IO；调用方在 effect 里调用。
 * ⚠️ 包裹一律**分段**处理（`markDomRange`）：跨行区间会跨越多个 `<p>`，
 * 若整体 `extractContents` 会把块级结构搅坏（mark 里塞进多个段落）。
 */
import { bestOccurrence, locateQuoteInDomText } from "./evidence-anchor";

/** 瞬时锚点层标记属性（与持久划线层区分，见 D6）。 */
const ANCHOR_ATTR = "data-plos-anchor";
/** 持久划线层标记属性。 */
const ANNOTATION_ATTR = "data-plos-annotation";

const MARK_CLASS = "bg-primary/15 rounded-sm";
/** 持久划线的观感：底色更实 + 下划线，与瞬时锚点一眼可分。 */
const ANNOTATION_CLASS = "plos-annotation bg-primary/20 border-b border-primary/50 rounded-sm";

/**
 * 锚点高亮窗口：从锚点起高亮这么多个字符（够看清上下文，又不至于糊满屏）。
 *
 * 共享常量 —— 「资料内容 Tab」的 `?at=` 跳转与「章内提问」的引用跳转用同一窗口，
 * 两处口径必须一致（`detail/ContentTab.tsx` 与 `ChapterReaderPage.tsx`）。
 */
export const HIGHLIGHT_WINDOW = 120;

/** 把 `<mark>` 还原成普通文本（保持子节点原位）。 */
function unwrapMark(mark: Element): void {
  const parent = mark.parentNode;
  if (!parent) return;
  while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
  parent.removeChild(mark);
}

/**
 * 清除 root 内的**瞬时锚点**高亮（D6 收窄）。
 *
 * ⚠️ 旧实现是 `querySelectorAll("mark")` —— 无差别清除。持久划线也用 `<mark>`，
 * 于是任何一次 `?at=` 跳转都会把用户划线一起抹掉（视觉上「闪一下就没了」）。
 * 收窄为「只清带 ANCHOR_ATTR 的」，持久层交给 `unwrapMarks`。
 */
export function clearHighlights(root: HTMLElement): void {
  root.querySelectorAll(`mark[${ANCHOR_ATTR}]`).forEach(unwrapMark);
}

/** 剥掉 root 内全部**持久划线** mark（章切换 / 数据变化后重画前调用）。 */
export function unwrapMarks(root: HTMLElement): void {
  root.querySelectorAll(`mark[${ANNOTATION_ATTR}]`).forEach(unwrapMark);
}

/**
 * 在 root 内高亮**源串区间** `[start, end)` 并滚动到视野中央。
 *
 * 与旧 `highlightRange` 的根本区别（T12 / 决策 D10）：**不再假设
 * 「源串偏移 === DOM 文本偏移」**。旧口径实测 44/44 章系统性偏前（中位 −2.0%、
 * 最大 −6.1%），因为 `\n` / 行尾空白 / `### ` 前缀都不进文本节点。新口径改为
 * 「**先由源串切出 quote，再在 DOM 文本上做字面匹配**」—— 前提弱得多、真实成立。
 *
 * 三级候选降级（命中即止）：
 *   ① 原文区间（`locateQuoteInDomText` 内部消化精确 + 折叠空白两档）；
 *   ② 剥掉 GFM 行内/行首标记（`**` `_` `` ` ` `` `[]()` `url` `### `）—— 这些字符
 *      **DOM 文本里根本不存在**，抹掉后往往正好重建出可见文本；
 *   ③ 以标记符/空白切分后取**最长纯文本片段** —— 兜 ② 仍无法重建的残余情形。
 *
 * 每次候选匹配都经 `bestOccurrence` **按左侧上下文消歧**：同一段文字在文档里
 * 出现多次时取「前文最像源串前文」的那一处（真实库实测：不做消歧会跳到
 * 2.6 万字符外的另一处同构片段上）。
 *
 * 全 miss → 返回 `false` 且**零副作用**（静默不跳）—— **绝不错位高亮**。
 * 「点原文但没跳」是可接受的降级；「跳到错处」会让人以为资料变了。
 *
 * @returns 是否命中（调用方不需要区分「未命中」与「参数越界」，两者都是零副作用）。
 */
export function highlightSourceRange(
  root: HTMLElement,
  text: string,
  start: number,
  end: number,
): boolean {
  const candidates = sourceRangeCandidates(text, start, end);
  if (candidates.length === 0) return false;

  const dom = domTextSegments(root);
  if (dom.total === 0) return false;

  // 左侧上下文（**源串**口径）：同一段文字在文档里出现多次时用它消歧。
  // ⚠️ 用未 clamp 的 `start` 之前的内容 —— `text` 与 `start` 同源，偏移可直接用。
  const from = Number.isFinite(start) ? Math.max(0, Math.floor(start)) : 0;
  const ctx = text.slice(Math.max(0, from - CONTEXT_CHARS), from);

  for (const quote of candidates) {
    // 在「全部出现位置」中选前文最像的那一处（T12：绝不错位到另一处相同文字）
    const hit = bestOccurrence(dom.text, quote, ctx);
    if (!hit) continue;
    const located = buildHit(dom, hit.start, hit.end);
    if (!located) continue;

    // ⚠️ 顺序不可颠倒：新 mark 也带 ANCHOR_ATTR，先包后清会把刚包的一起剥掉。
    // `clearHighlights` 只剥 mark（**保留文本节点原位**），故上面算出的 `dom`
    // 与 `located.range` 在清除后依然有效。
    clearHighlights(root);
    markDomRange(located.range, ANCHOR_ATTR, MARK_CLASS, root);

    // 滚动到视野中央（以区间起点所在元素为锚，沿用既有观感）。
    located.range.startContainer.parentElement?.scrollIntoView({
      block: "center",
      behavior: "smooth",
    });
    return true;
  }
  return false;
}

/** 消歧用的左侧上下文字数（够判别重复段落，又不至于把上下文拉得太远）。 */
const CONTEXT_CHARS = 60;

/**
 * 由**源串区间**生成候选 quote 列表（按命中优先级排序）—— **纯函数、零 DOM**。
 *
 * 抽出来的理由（本仓库已踩过的根因）：候选降级是 T12 的**全部智力所在**，
 * 而它不需要 DOM。留在这里会被迫用结构替身测；抽成纯函数后
 * `tests/annotation.test.ts` 可直跑断言（`rules/no-headless-browser-validation`）。
 *
 * @returns 去空、去重的候选；区间非法 / 越界到无内容时返回 `[]`
 *          （→ 调用方零副作用返回，不抛错）。
 */
export function sourceRangeCandidates(text: string, start: number, end: number): string[] {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
  // clamp 到源串内：越界不是错误，而是「这段正文不在这里」
  const s = Math.max(0, Math.min(start, text.length));
  const e = Math.max(s, Math.min(end, text.length));
  if (e <= s) return [];

  const raw = text.slice(s, e);
  return [raw, stripInlineMarkup(raw), longestPlainFragment(raw)]
    .map((c) => c.trim())
    // 短候选一律丢弃（**三档统一**）：`"ab"` 这种串在长文里必然多处出现，
    // 拿它匹配就是错位高亮的温床。宁可零候选 → 静默不跳（D10 的取舍）。
    .filter((c) => c.length >= MIN_FRAGMENT_CHARS)
    .filter((c, i, arr) => arr.indexOf(c) === i); // 去重
}

/**
 * 候选片段最小长度。
 *
 * ⚠️ 刻意**严于** `ANNOTATION_LIMITS.minQuoteChars`（2）：那个常量管「用户主动划线
 * 的最小信息量」，这里管「自动定位的可信度」—— 2 个字符在整篇正文里必然多处出现，
 * 拿它去匹配正是「错位高亮」的温床。宁可放弃候选（静默不跳）。
 *
 * ⚠️ **三档统一适用**（含候选 ① 原文区间）：短串的歧义与它来自哪一档无关。
 * 代价是「短区间不跳」—— 而 `?at=` 恒带 `HIGHLIGHT_WINDOW`（120 字）窗口，
 * 真正会短的是 QA / 复述的引文区间，那类引文本身即完整句子。
 */
const MIN_FRAGMENT_CHARS = 4;

/**
 * 候选 ②：抹掉行首标记（`### ` / `> ` / `- ` / `1. `）与行内标记，
 * 尽量把 quote 还原成**渲染后实际可见**的字面。
 *
 * 若第 2 段「候选 ③」也要用同一套语法，再抽常量 —— 现在只有一处消费，
 * 内联在这里比提前抽象更好读。
 */
function stripInlineMarkup(s: string): string {
  let out = s;
  out = out.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  out = out.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  out = out.replace(/https?:\/\/\S+/g, "");
  out = out.replace(/[*_`~]/g, "");
  // 行首标记：仅在「行首」位置剥（正文中间的 `#` 是普通字符，不能碰）
  out = out.replace(/^[ \t]*(?:#{1,6}|>|[-*+]|\d+[.)])[ \t]+/gm, "");
  // ATX 闭合式标题的尾部 `###`
  out = out.replace(/[ \t]+#+[ \t]*$/gm, "");
  return out;
}

/**
 * 候选 ③：以标记符 / 空白切分，取**最长纯文本片段**。
 *
 * 兜「② 抹平后仍对不上」的残余情形（如窗口边界恰好切在标记中间）。
 * 片段短于 `MIN_FRAGMENT_CHARS` 一律丢弃 —— 短片段多处出现，宁可不跳。
 */
function longestPlainFragment(s: string): string {
  const parts = s.split(/[*_`~\[\]()<>|#\s]+/).filter((p) => p.length >= MIN_FRAGMENT_CHARS);
  if (parts.length === 0) return "";
  return parts.reduce((a, b) => (b.length > a.length ? b : a));
}

/** DOM 文本的一段（一个文本节点在 DOM 文本中的位置）。 */
interface DomSegment {
  node: Text;
  /** 该节点首字符在 DOM 文本中的下标。 */
  domStart: number;
  len: number;
}

interface DomText {
  text: string;
  segs: DomSegment[];
  /** DOM 文本总长（= segs 累加，便于取哨兵）。 */
  total: number;
}

/** 拼接 root 内全部文本节点（`TreeWalker SHOW_TEXT` 顺序）并记录各段起点。 */
function domTextSegments(root: HTMLElement): DomText {
  const segs: DomSegment[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let acc = 0;
  let node = walker.nextNode();
  while (node) {
    const text = node as Text;
    segs.push({ node: text, domStart: acc, len: text.data.length });
    acc += text.data.length;
    node = walker.nextNode();
  }
  return { text: segs.map((s) => s.node.data).join(""), segs, total: acc };
}

interface DomPoint {
  node: Text;
  offset: number;
}

/**
 * DOM 文本下标 → (文本节点, 节点内偏移)。二分查找。
 * 允许 `i === total`（哨兵：落在最后一个节点末尾），越界返回 `undefined`。
 */
function domOffsetToPoint(dom: DomText, i: number): DomPoint | undefined {
  if (dom.segs.length === 0) return undefined;
  const target = Math.max(0, Math.min(i, dom.total));
  let lo = 0;
  let hi = dom.segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (dom.segs[mid].domStart + dom.segs[mid].len < target) lo = mid + 1;
    else hi = mid;
  }
  const seg = dom.segs[lo];
  if (target > seg.domStart + seg.len) return undefined;
  return { node: seg.node, offset: Math.max(0, Math.min(target - seg.domStart, seg.len)) };
}

function rangeOf(a: DomPoint, b: DomPoint): Range {
  const range = document.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  return range;
}

/**
 * 包高亮 mark —— **按文本节点分段**，逐段 `surroundContents`。
 *
 * 为什么不分段整体包裹：跨行区间跨越多个 `<p>`，整体 `extractContents()` 会把
 * mark 塞进块级元素之间，破坏段落结构（视觉上「两段被粘成一块」）。
 * 分段后每段都在**单个文本节点内**，`surroundContents` 必定成功且不越块。
 *
 * ⚠️ 片段必须**从后往前**处理：先包靠前的片段会改变后续片段的节点结构。
 */
function markDomRange(range: Range, attr: string, className: string, root: HTMLElement): void {
  const segs = textSegmentsInRange(range, root);
  for (let i = segs.length - 1; i >= 0; i--) {
    const seg = segs[i];
    const mark = document.createElement("mark");
    mark.setAttribute(attr, "");
    mark.className = className;
    const r = document.createRange();
    r.setStart(seg.node, seg.start);
    r.setEnd(seg.node, seg.end);
    r.surroundContents(mark);
  }
}

/** Range 覆盖到的**每个文本节点内的片段**（每段都落在单一文本节点内）。 */
function textSegmentsInRange(
  range: Range,
  root: HTMLElement,
): { node: Text; start: number; end: number }[] {
  const out: { node: Text; start: number; end: number }[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const text = node as Text;
    // 与 range 求交：起点/终点容器之外一律取整段。
    if (range.intersectsNode(text)) {
      const start = text === range.startContainer ? range.startOffset : 0;
      const end = text === range.endContainer ? range.endOffset : text.data.length;
      if (end > start) out.push({ node: text, start, end });
    }
    node = walker.nextNode();
  }
  return out;
}

/** DOM 文本上的定位结果。 */
export interface DomHit {
  range: Range;
  /** 命中的 DOM 文本区间（左闭右开）——用于「顺序贪心」把下一次搜索挪到其后。 */
  textStart: number;
  textEnd: number;
}

/**
 * 在 DOM 文本上定位 `quote`。
 *
 * 匹配口径（两档：精确 → 移除式折叠 D7）的**唯一实现**在
 * `evidence-anchor.localeQuoteInDomText`（纯函数、可直跑 node 单测）——
 * 本函数只负责「把 DOM 文本下标换成 Range」，不再重复一份匹配逻辑。
 *
 * @param from 起搜位置（DOM 文本下标）。顺序贪心（D8）靠它避免同 quote 重复命中同一处。
 * @returns 未命中返回 `undefined`（调用方据此走「未定位到」的诚实降级）。
 */
export function locateRangeInDom(root: HTMLElement, quote: string, from = 0): DomHit | undefined {
  const dom = domTextSegments(root);
  if (dom.total === 0) return undefined;
  const hit = locateQuoteInDomText(dom.text, quote, from);
  if (!hit) return undefined;
  return buildHit(dom, hit.start, hit.end);
}

function buildHit(dom: DomText, textStart: number, textEnd: number): DomHit | undefined {
  const a = domOffsetToPoint(dom, textStart);
  const b = domOffsetToPoint(dom, textEnd);
  if (!a || !b) return undefined;
  return { range: rangeOf(a, b), textStart, textEnd };
}

/**
 * 一次性画全部持久划线。
 *
 * ⚠️ 入参 `quotes` 必须**按源串 `start` 升序**（决策 D8）：DOM 文本偏移与源串
 * 偏移虽不等长，但**单调同序**，故「源串顺序 = DOM 顺序」，顺序贪心即可把
 * 重复出现的 quote 逐一对位。命中后用 `textEnd` 作为下一次的 `from`，
 * 保证同一条 quote 不会重复高亮同一处。
 *
 * @returns **成功命中的下标数组**（与 `quotes` 下标对应）——调用方据此标注
 *          「正文中未定位到」，**不删记录**。
 */
export function markRanges(root: HTMLElement, quotes: readonly string[]): number[] {
  // ① 先全部解出 Range（此时 DOM 未被包裹，偏移稳定）
  const hits: DomHit[] = [];
  const okIdx: number[] = [];
  let from = 0;
  for (let i = 0; i < quotes.length; i++) {
    const hit = locateRangeInDom(root, quotes[i], from);
    if (!hit) continue;
    hits.push(hit);
    okIdx.push(i);
    from = hit.textEnd;
  }
  // ② 从后往前包裹（先包靠前的会让后续区间偏移失效）
  for (let i = hits.length - 1; i >= 0; i--) {
    markDomRange(hits[i].range, ANNOTATION_ATTR, ANNOTATION_CLASS, root);
  }
  return okIdx;
}

/**
 * 滚动到某条 quote 并**闪烁提示**（右栏「我的划线」回看用）。
 *
 * 与 `markRanges` 的分工：本函数只负责「跳过去看一眼」，不重画整层高亮。
 *
 * ⚠️ 与 `highlightSourceRange` 同样走 `bestOccurrence`（**左侧上下文消歧**）：
 * 否则同一条划线在文档里出现两次时会跳到**另一处**去 —— 而回看场景下还有
 * 批注自带的 `start` 可换算上下文，不消歧纯属浪费。
 *
 * @param context 该划线在**源串**中左侧的一段文本（调用方按 `Annotation.start` 换算）。
 * @returns 是否命中（未命中返回 false，调用方保留条目并标注「正文中未定位到」）。
 */
export function scrollToQuote(root: HTMLElement, quote: string, context = ""): boolean {
  const dom = domTextSegments(root);
  if (dom.total === 0) return false;
  const hit = bestOccurrence(dom.text, quote, context);
  if (!hit) return false;
  const point = domOffsetToPoint(dom, hit.start);
  const host = point?.node.parentElement ?? null;
  host?.scrollIntoView({ block: "center", behavior: "smooth" });
  flashElement(host);
  return true;
}

/** 闪一下（600ms 后移除）—— 用现成的 `animate-pulse`，不新增 CSS 与 hex。 */
function flashElement(el: HTMLElement | null): void {
  if (!el) return;
  el.classList.add("animate-pulse");
  window.setTimeout(() => el.classList.remove("animate-pulse"), 600);
}
