/**
 * 网页 DOM → Markdown 输出层（F8 范围 5 核心）。
 *
 * 为何自写输出层（同 `docx-markdown.ts` 的 D6 立场）：Readability 给的是**清理过的
 * HTML 片段**（`article.content`），不是 Markdown；而「HTML→Markdown」既没有可信的
 * 零依赖库（turndown 要 DOM 全局），也不能直接丢给切分引擎 —— 切分只认
 * `#` / `##` 标题（`splitter-engine.ts::mdHeadingMaxLevel` 默认 2）。
 *
 * ⚠️ 本模块**刻意不 import 任何 DOM 库**：节点用结构类型描述（`HtmlDomNode`），
 *    生产喂 webview 的真实节点、单测喂 `linkedom` 的节点，两边都不需要真 `Document`。
 *    测试**不 import 任何 `.tsx`**（`--experimental-strip-types` 不支持 JSX）。
 *
 * 两条实测驱动的设计（方案 §3.3）：
 * - **必须自己跳噪声标签**：Readability 在内容量不足时会把 `nav` 残留在 `content` 里
 *   （小文档实测），不能假定它清干净了；
 * - **必须做标题层级归一化**（D6-A）：Readability 会把 `h1` 降级为 `h2`，而页面用
 *   `h3` / `h4` 当小节的情况很常见 ⇒ 原样透传会**一个章节都切不出来**。
 */
/**
 * 结构化 DOM 类型（按实测形状声明）：只要 `tagName` / `textContent` / `children`。
 * 生产喂 webview 的真实节点（`Element` 结构上满足）、单测喂 `linkedom` 的节点，
 * 两边都不需要真 `Document` ⇒ 本模块零 DOM 依赖、node 可直测。
 * ⚠️ 形状由 `tests/import-web.test.ts` 的契约守卫锁住。
 */
export interface HtmlDomNode {
  tagName?: string;
  textContent?: string | null;
  children?: ArrayLike<HtmlDomNode>;
}

/**
 * 整棵跳过的噪声标签（**不依赖 Readability 清干净**，见模块头注释）。
 * 图片不在此列 —— `img` 需单独计数（跳过但不静默）。
 */
const SKIP_TAGS = new Set([
  "nav",
  "header",
  "footer",
  "aside",
  "form",
  "button",
  "select",
  "input",
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "canvas",
  "iframe",
  "video",
  "audio",
]);

/** 有序 / 无序列表的缩进单位（GFM 每层两个空格）。 */
const LIST_INDENT = "  ";

/** 产出的块（**结构化，不拼字符串后再用正则改** —— 见 `render` 的注释）。 */
type Block = { kind: "heading"; level: number; text: string } | { kind: "text"; text: string };

export interface HtmlMarkdownResult {
  /** 产出的 Markdown 正文（块间单空行、首尾去空白）。 */
  text: string;
  /** 识别到的标题数。 */
  headings: number;
  /** 产出的 GFM 表格数（单行表降级为文本，不计入）。 */
  tables: number;
  /** 跳过的图片数（正文**绝不**内联 base64，与 DOCX 先例一致）。 */
  skippedImages: number;
  /** **归一化前**的标题层级范围（排障用：最浅 N / 最深 M；无标题时 `min=1, max=0`）。 */
  levels: { min: number; max: number };
}

/** 遍历期累计量（随参数传递，避免模块级可变状态）。 */
interface WalkAcc {
  blocks: Block[];
  levels: number[];
  tables: number;
}

/** 小写标签名（缺 `tagName` 的节点——文本节点——返回空串）。 */
function tagOf(node: HtmlDomNode): string {
  return (node.tagName ?? "").toLowerCase();
}

/** `children` 归一为数组（生产是 `HTMLCollection`，单测可能是普通数组）。 */
function childArray(node: HtmlDomNode): HtmlDomNode[] {
  return node.children ? Array.from(node.children) : [];
}

/** `h1`..`h6` → 1..6；其它标签 `undefined`。 */
function headingLevel(tag: string): number | undefined {
  if (tag.length !== 2 || tag[0] !== "h") return undefined;
  const n = tag.charCodeAt(1) - 48;
  return n >= 1 && n <= 6 ? n : undefined;
}

/**
 * 行内文本：折叠空白为单空格。
 * `<a>` 只取文字、**不产链接语法**（D7）—— 共享管道的 `stripMarkdownNoise`
 * 本就把 `[t](u)` 拍平成 `t`，页内相对 href 出库即无意义，产出来再被拍平是白做一层。
 */
function inlineText(el: HtmlDomNode): string {
  return (el.textContent ?? "").trim().replace(/\s+/g, " ");
}

/**
 * 保结构文本（`pre` / `blockquote` 用）：归一换行符、只去掉首尾空行，
 * **完全保留行内缩进**。
 *
 * ⚠️ 刻意不像 `inlineText` 那样折叠空白：代码块的缩进就是语义，
 *    按行 `trim` 会把 Python 代码拍成一行平铺。
 */
function rawText(el: HtmlDomNode): string {
  return (el.textContent ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "");
}

/** 文本块（空内容不产块，避免制造多余空行）。 */
function pushText(el: HtmlDomNode, acc: WalkAcc): void {
  const text = inlineText(el);
  if (text) acc.blocks.push({ kind: "text", text });
}

/** 代码块：fenced（`pre` 内文本原样，含缩进）。 */
function pushPre(el: HtmlDomNode, acc: WalkAcc): void {
  const raw = rawText(el);
  if (!raw.trim()) return;
  acc.blocks.push({ kind: "text", text: `\`\`\`\n${raw}\n\`\`\`` });
}

/** 引用块：逐行加 `> ` 前缀。 */
function pushQuote(el: HtmlDomNode, acc: WalkAcc): void {
  const raw = rawText(el);
  if (!raw.trim()) return;
  acc.blocks.push({ kind: "text", text: raw.split("\n").map((l) => `> ${l}`).join("\n") });
}

/**
 * `li` 自身的文本（排除嵌套列表那部分，让嵌套单独成块）。
 *
 * ⚠️ 必须从 `textContent` **减去**子列表文本，不能用 `children` 过滤：
 *    `children` 只含**元素**子节点、不含文本节点（实测 `linkedom` 与浏览器一致），
 *    `<li>父项<ul>…</ul></li>` 的 `children` 只有 `ul` ⇒ 过滤后会得到空串、
 *    把「父项」整段丢掉（本模块首跑即在 `TC-EDGE-15c` 暴露此缺陷）。
 *    减法是「子列表全文」的首次匹配；`li` 内出现同文的旁支列表才会误减，可忽略。
 */
function liOwnText(li: HtmlDomNode): string {
  let own = li.textContent ?? "";
  for (const child of childArray(li)) {
    const tag = tagOf(child);
    if (tag !== "ul" && tag !== "ol") continue;
    const sub = child.textContent ?? "";
    if (sub) own = own.replace(sub, "");
  }
  return own.trim().replace(/\s+/g, " ");
}

/** 列表：`ul` → `- ` / `ol` → `1. `；嵌套列表缩进一层（`depth`）。 */
function pushList(node: HtmlDomNode, acc: WalkAcc, ordered: boolean, depth: number): void {
  const indent = LIST_INDENT.repeat(Math.min(depth, 6));
  let index = 0;
  for (const li of childArray(node)) {
    if (tagOf(li) !== "li") continue;
    index += 1;
    const own = liOwnText(li);
    if (own) acc.blocks.push({ kind: "text", text: `${indent}${ordered ? `${index}.` : "-"} ${own}` });
    // 嵌套列表单独成块（跟随父项下方，缩进 +1）。
    for (const sub of childArray(li)) {
      const tag = tagOf(sub);
      if (tag === "ul" || tag === "ol") pushList(sub, acc, tag === "ol", depth + 1);
    }
  }
}

/** 收集 `table` 下的 `tr`（穿透 `thead` / `tbody` / `tfoot`）。 */
function collectRows(node: HtmlDomNode, out: HtmlDomNode[]): void {
  for (const child of childArray(node)) {
    const tag = tagOf(child);
    if (tag === "tr") out.push(child);
    else if (tag === "thead" || tag === "tbody" || tag === "tfoot") collectRows(child, out);
  }
}

/** 单元格文本（`|` 转义；换行压平，避免把一行表格拆成两行）。 */
function cellText(cell: HtmlDomNode): string {
  return inlineText(cell).replace(/\|/g, "\\|");
}

/**
 * 表格 → GFM 行。
 *
 * - 0 行 → 无内容；
 * - 1 行 → **不制造假表头**，降级为一行文本（与 `docx-markdown.ts` 同口径）；
 * - ≥2 行 → 首行作表头 + `| --- |` 分隔行 + 余行（列数取各行最大值，短行补空单元格）。
 */
function pushTable(table: HtmlDomNode, acc: WalkAcc): void {
  const rows: HtmlDomNode[] = [];
  collectRows(table, rows);
  const grid = rows.map((row) =>
    childArray(row)
      .filter((c) => {
        const t = tagOf(c);
        return t === "td" || t === "th";
      })
      .map(cellText),
  );
  const nonEmpty = grid.filter((r) => r.length > 0);
  if (nonEmpty.length === 0) return;
  if (nonEmpty.length === 1) {
    acc.blocks.push({ kind: "text", text: (nonEmpty[0] ?? []).join(" ") });
    return;
  }
  const cols = Math.max(...nonEmpty.map((r) => r.length));
  const line = (cells: string[]): string => {
    const padded = [...cells];
    while (padded.length < cols) padded.push("");
    return `| ${padded.join(" | ")} |`;
  };
  const sep = `| ${Array.from({ length: cols }, () => "---").join(" | ")} |`;
  acc.blocks.push({ kind: "text", text: [line(nonEmpty[0] ?? []), sep, ...nonEmpty.slice(1).map(line)].join("\n") });
  acc.tables += 1;
}

/**
 * 全树统计将被跳过的图片（**独立一遍遍历**）。
 *
 * ⚠️ 不放在块级 `walk` 里就近计数：图片常嵌在 `<p>` / `<li>` / `<td>` 内部
 *    （Readability 产出里尤其如此），而那些标签是**叶子处理**（取 `textContent`
 *    后不再递归）⇒ 就近计数会系统性漏掉绝大多数图片。独立遍历同时天然避免
 *    「嵌套列表里重复计一遍」的问题。
 * 噪声子树（`nav` / `footer`…）里的图标不计 —— 它们本就整棵不进正文。
 */
function countImages(node: HtmlDomNode): number {
  let n = 0;
  for (const el of childArray(node)) {
    const tag = tagOf(el);
    if (SKIP_TAGS.has(tag)) continue;
    if (tag === "img") {
      n += 1;
      continue;
    }
    n += countImages(el);
  }
  return n;
}

/** 块级遍历。未知标签（`div` / `section` / `article` / `span`…）透明递归。 */
function walk(node: HtmlDomNode, acc: WalkAcc): void {
  for (const el of childArray(node)) {
    const tag = tagOf(el);
    if (SKIP_TAGS.has(tag)) continue;
    const level = headingLevel(tag);
    if (level !== undefined) {
      const text = inlineText(el);
      if (!text) continue; // 空标题不产行，也不计入 levels
      acc.levels.push(level);
      acc.blocks.push({ kind: "heading", level, text });
      continue;
    }
    if (tag === "p") {
      pushText(el, acc);
      continue;
    }
    if (tag === "pre") {
      pushPre(el, acc);
      continue;
    }
    if (tag === "blockquote") {
      pushQuote(el, acc);
      continue;
    }
    if (tag === "ul" || tag === "ol") {
      pushList(el, acc, tag === "ol", 0);
      continue;
    }
    if (tag === "table") {
      pushTable(el, acc);
      continue;
    }
    if (tag === "img") {
      // **不内联、不产占位符**：单计数（与 DOCX 的「绝不内联 base64」同口径）。
      // 计数在 `countImages` 里全树做一遍（见那里的注释），此处只需不产出内容。
      continue;
    }
    walk(el, acc);
  }
}

/**
 * DOM 子树 → Markdown。
 *
 * ⚠️ 标题层级归一化（D6-A）在**渲染期**做，不在拼接后的字符串上做正则替换：
 *    由原层级整体上移（页面最浅标题 → `#`）可以让 `h3` / `h4` 当小节的页面也能切出章节。
 *    用结构化块而非「改已拼好的行」，是因为代码块内容里同样可能出现行首 `#` ——
 *    对字符串做正则位移会把它一起改掉。**刻意不删标题行**：`#` 后无正文时引擎自己会
 *    识别成「文档主标题」不成章（`splitter-engine.ts:115-128`），删了反而要额外判据。
 */
export function htmlNodesToMarkdown(root: HtmlDomNode): HtmlMarkdownResult {
  const acc: WalkAcc = { blocks: [], levels: [], tables: 0 };
  walk(root, acc);

  const min = acc.levels.length > 0 ? Math.min(...acc.levels) : 1;
  const shift = min - 1;
  const parts = acc.blocks
    .map((b) => {
      if (b.kind !== "heading") return b.text;
      const level = Math.min(6, Math.max(1, b.level - shift));
      return `${"#".repeat(level)} ${b.text}`;
    })
    .filter((s) => s.trim() !== "");

  return {
    text: parts.join("\n\n").trim(),
    headings: acc.levels.length,
    tables: acc.tables,
    skippedImages: countImages(root),
    levels: { min, max: acc.levels.length > 0 ? Math.max(...acc.levels) : 0 },
  };
}
