/**
 * DOCX 文档 AST → Markdown（F8 范围 3 核心）。
 *
 * 为何自写输出层（`docs/library-import-docx-design-2026-09.md` D6）：
 * mammoth 的成品输出**不能同时满足**两个已确认决策 ——
 * `convertToMarkdown` 不产 GFM 表格（表格降级为逐行段落），
 * `convertToHtml` 有表格但 HTML→Markdown 在 Node 需 DOM（破坏「纯逻辑 node 直跑」纪律）。
 * ⇒ mammoth 只当**读取器**（`mammoth-reader.ts`），Markdown 由本模块产。
 *
 * ⚠️ 本模块**刻意不 import mammoth**：AST 用结构类型描述（`MammothNode`），
 *    单测可直接喂**字面量 AST**，不必构造真 DOCX 字节、不依赖 mammoth 内部形状。
 *
 * ⚠️ 标题判定为何必须含**字号层**（实测 4/4 份真实文档）：
 *    真实 DOCX 的 `styleId` 全为空、`outlineLvl` 全为 0，标题**靠 `w:sz` 字号 + 粗体**表达
 *    （见方案 §3.3a）。只认命名样式 ⇒ 真实文档识别数为 0。
 */
import { isHeadingShape, isNumberedHeading } from "./heading-patterns";

/**
 * mammoth AST 节点的**结构类型描述**（按实测形状声明，非 mammoth 的正式契约）。
 *
 * ⚠️ 刻意用「宽 `type: string` + 全可选字段」的单一结构，而不是精确判别式联合：
 *    `transformDocument` 在 mammoth 的 `index.d.ts` 里只声明为 `(element: any) => any`，
 *    精确联合会给出**假的类型安全**（宽 type 成员无法被判别式收窄，最终仍要塞断言）。
 *    这里让未知形状自然退化为「无文本」，既零断言也不抛错。
 *    ⚠️ 形状由 `tests/import-docx.test.ts` 的契约守卫（TC-DOCX-17）锁住。
 */
export interface MammothNode {
  /** 块级实测：`paragraph` / `table`；行内实测：`run` / `hyperlink` / `text` / `image` / `tab` / `break`… */
  type: string;
  /** 子节点（段落 → run；run → text；表格 → 行 → 单元格 → 段落）。 */
  children?: readonly MammothNode[];
  /** 文本值（仅 `text` 节点有）。 */
  value?: string;
  /** 段落样式 id / 名称（实测真实文档均为 `null`）。 */
  styleId?: string | null;
  styleName?: string | null;
  /** run 是否粗体（实测 boolean）。 */
  isBold?: boolean;
  /** ⚠️ run 字号，单位＝**磅**（Word 的 `w:sz` 是半磅，mammoth 已除 2：实测 `w:sz=48` → `24`）。 */
  fontSize?: number | null;
  /** 列表信息（实测 `{ isOrdered: boolean, level: string }`；`level` 是字符串）。 */
  numbering?: { isOrdered?: boolean; level?: string } | null;
}

/** 标题证据来源（`headingVia` 的键；排障与结果卡可观测性）。 */
export type HeadingVia = "style" | "styleNum" | "size" | "pattern";

export interface DocxMarkdownResult {
  /** 产出的 Markdown 正文（已归并空行、首尾去空白）。 */
  text: string;
  /** 识别到的标题数。 */
  headings: number;
  /** 各证据层命中的标题数 —— `size` 占比高说明该文档「靠字号分层」（真实文档常态）。 */
  headingVia: Record<string, number>;
  /** 产出的 GFM 表格数（单行表降级为段落，不计入）。 */
  tables: number;
  /** 跳过的图片节点数（正文**绝不**内联 base64）。 */
  skippedImages: number;
}

/** `Heading 1` / `标题 2` 形态的命名样式。 */
const HEADING_STYLE_RE = /^(?:heading|标题)\s*([1-6])$/i;

/**
 * 字号显著性倍数（相对正文基准）。
 * 实测 1.15 足以区分 12pt ↔ 14pt（14/12 ≈ 1.167），又不会误吞 11pt ↔ 12pt（1.09）。
 * ——这是本模块**唯一**的字号阈值；长度/标点护栏一律走 `heading-patterns.isHeadingShape`（不设第二把尺子）。
 */
const SIZE_HEADING_RATIO = 1.15;

/** 列表嵌套缩进（GFM 每个 level 两个空格）。 */
const LIST_INDENT = "  ";

/** 遍历期累计量（避免每层返回值都拼一个对象）。 */
interface Stats {
  headings: number;
  via: Record<string, number>;
  tables: number;
  images: number;
}

/** 行内文本 + 其中的图片计数。 */
interface InlineText {
  text: string;
  images: number;
}

/**
 * 递归收集行内文本。
 *
 * - `text` → 取值（实测 `value` 是 string）；
 * - `image` → **显式跳过**（mammoth 的 markdown writer 会把图片内联成 `data:image/png;base64,…`，
 *   实测单份简历首屏即数百 KB；我们走自己的 writer，只计数不产出）；
 * - `tab` / `break` → 一个空格（Word 的 `<w:tab/>` / `<w:br/>` 若直接丢弃会让相邻文本粘连）；
 * - 其它（`bookmarkStart` / `noteReference` / `checkbox`…）→ 仅递归子节点，自身不产文本。
 *
 * ⚠️ 多 run 拼接**不插入**任何分隔符：源文档里的空格已在 `text.value` 内，
 *    再补一个空格会把中文句子拆出多余空白。
 */
function inlineText(node: MammothNode): InlineText {
  let text = "";
  let images = 0;
  const walk = (n: MammothNode) => {
    if (n.type === "text") {
      text += n.value ?? "";
      return;
    }
    if (n.type === "image") {
      images += 1;
      return;
    }
    if (n.type === "tab" || n.type === "break") {
      text += " ";
      return;
    }
    for (const child of n.children ?? []) walk(child);
  };
  walk(node);
  return { text, images };
}

/** 段落文本（块级段落 → 纯文本，图片等非文本节点被跳过）。 */
function paragraphText(para: MammothNode): InlineText {
  return inlineText(para);
}

/**
 * 段落「主字号」：按**字符长度加权**取众数。
 *
 * ⚠️ 不能按 run 数或段落数加权：正文段长、标题段短，按 run 数会被标题的高密度 run 翻盘。
 * ⚠️ 无号 run 的文本不参与加权（不进 map）——否则「未设字号」会被当成一个字号档位。
 */
function paragraphFontSize(para: MammothNode): number | undefined {
  const weight = new Map<number, number>();
  const walk = (n: MammothNode) => {
    const size = n.fontSize;
    if (typeof size === "number" && size > 0) {
      const len = inlineText(n).text.length;
      // 空 run 也记 1 个权重单位（避免整段被「有字号但无文本」的 run 抹平）。
      weight.set(size, (weight.get(size) ?? 0) + Math.max(1, len));
    }
    for (const child of n.children ?? []) walk(child);
  };
  walk(para);
  let best: number | undefined;
  let bestWeight = 0;
  for (const [size, w] of weight) {
    if (w > bestWeight) {
      best = size;
      bestWeight = w;
    }
  }
  return best;
}

/** 正文基准字号：全文字符加权最多的字号（跨段落汇总）。 */
function baseFontSize(paras: readonly MammothNode[]): number | undefined {
  const weight = new Map<number, number>();
  for (const para of paras) {
    const size = paragraphFontSize(para);
    if (size === undefined) continue;
    weight.set(size, (weight.get(size) ?? 0) + Math.max(1, paragraphText(para).text.length));
  }
  let best: number | undefined;
  let bestWeight = 0;
  for (const [size, w] of weight) {
    if (w > bestWeight) {
      best = size;
      bestWeight = w;
    }
  }
  return best;
}

/** 字号档位（显著大于基准的字号，**降序** ⇒ 下标即层级序号）。 */
function sizeTiers(paras: readonly MammothNode[], base: number | undefined): number[] {
  if (base === undefined) return [];
  const seen = new Set<number>();
  for (const para of paras) {
    const size = paragraphFontSize(para);
    if (size !== undefined && size > base * SIZE_HEADING_RATIO) seen.add(size);
  }
  return [...seen].sort((a, b) => b - a);
}

/** 一层标题判定结果。 */
interface HeadingHit {
  level: number;
  via: HeadingVia;
}

/**
 * 四层标题判定（`undefined` = 正文）。
 *
 * L1 `pStyle` 命名样式（Word 标准做法，最高证据级；实测真实文档命中率为 0）
 * L1' 中文版 Word / WPS 的 `styleId` 为纯数字 `"1".."6"`
 * ——（前置：非空、≤40 字符、不以句末标点结尾、未带 `#`）
 * L3 字号显著大于正文基准 ⇒ **档位排名即层级**（实测主力）
 * L4 编号形态兜底 ⇒ 一律 `##`（与 `promotePdfHeadings` 同档，跨来源一致）
 *
 * ⚠️ 层级**保持 1:1**，不做「整体下移一级」归一化：对「唯一 H1 + 多个 H2」的文档，
 *    下移会把 H2 变成 `###` 而**失去全部切章能力**（`mdHeadingMaxLevel` 默认 2）。
 */
function headingLevelOf(
  para: MammothNode,
  size: number | undefined,
  base: number | undefined,
  tiers: readonly number[],
  text: string,
): HeadingHit | undefined {
  const named = HEADING_STYLE_RE.exec(para.styleId ?? para.styleName ?? "");
  if (named) return { level: Number(named[1]), via: "style" };
  if (para.styleId && /^[1-6]$/.test(para.styleId)) {
    return { level: Number(para.styleId), via: "styleNum" };
  }
  if (!isHeadingShape(text)) return undefined;
  if (size !== undefined && base !== undefined && size > base * SIZE_HEADING_RATIO) {
    const rank = tiers.indexOf(size) + 1;
    return { level: Math.min(6, Math.max(1, rank)), via: "size" };
  }
  if (isNumberedHeading(text)) return { level: 2, via: "pattern" };
  return undefined;
}

/** 单元格文本：段内用 `<br>` 连接（避免造出假段落），`|` 转义，换行压平。 */
function cellText(cell: MammothNode, stats: Stats): string {
  const parts: string[] = [];
  for (const child of cell.children ?? []) {
    if (child.type !== "paragraph") continue;
    const got = paragraphText(child);
    stats.images += got.images;
    const trimmed = got.text.trim();
    if (trimmed) parts.push(trimmed);
  }
  return parts.join("<br>").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/**
 * 表格 → GFM 行。
 *
 * - 0 行 → 无内容，返回空；
 * - 1 行 → **不制造假表头**，降级为一行段落；
 * - ≥2 行 → 首行作表头 + `| --- |` 分隔行 + 余行（列数取各行最大值，短行补空单元格，
 *   保证 GFM 语义完整 —— 少一格会被渲染器**截断**成丢数据）。
 */
function tableToGfm(table: MammothNode, stats: Stats): string[] {
  const rows = (table.children ?? []).filter((r) => r.type === "tableRow");
  if (rows.length === 0) return [];
  const grid = rows.map((row) =>
    (row.children ?? []).filter((c) => c.type === "tableCell").map((cell) => cellText(cell, stats)),
  );
  if (grid.length === 1) return [grid[0]?.join(" ") ?? ""];
  const cols = Math.max(...grid.map((r) => r.length));
  if (cols === 0) return [];
  const line = (cells: string[]): string => {
    const padded = [...cells];
    while (padded.length < cols) padded.push("");
    return `| ${padded.join(" | ")} |`;
  };
  const sep = `| ${Array.from({ length: cols }, () => "---").join(" | ")} |`;
  return [line(grid[0] ?? []), sep, ...grid.slice(1).map(line)];
}

/** 块级遍历：段落 → 标题/列表/正文；表格 → GFM；其它块级（实测不出现）→ 忽略并计图。 */
export function docxNodesToMarkdown(nodes: readonly MammothNode[]): DocxMarkdownResult {
  // 基准与档位只看**顶层段落**：表格内段落不参与（否则一份全是表格的文档会把基准拉偏）。
  const paras = nodes.filter((n) => n.type === "paragraph");
  const base = baseFontSize(paras);
  const tiers = sizeTiers(paras, base);
  const stats: Stats = { headings: 0, via: {}, tables: 0, images: 0 };

  const lines: string[] = [];
  for (const node of nodes) {
    if (node.type === "table") {
      const gfm = tableToGfm(node, stats);
      if (gfm.length === 0) continue;
      lines.push(...gfm);
      if (gfm.length > 1) stats.tables += 1;
      continue;
    }
    if (node.type !== "paragraph") {
      stats.images += inlineText(node).images;
      continue;
    }
    const got = paragraphText(node);
    stats.images += got.images;
    const text = got.text.trim();
    if (!text) {
      lines.push("");
      continue;
    }
    const hit = headingLevelOf(node, paragraphFontSize(node), base, tiers, text);
    if (hit) {
      stats.headings += 1;
      stats.via[hit.via] = (stats.via[hit.via] ?? 0) + 1;
      lines.push(`${"#".repeat(hit.level)} ${text}`);
      continue;
    }
    const level = Number.parseInt(node.numbering?.level ?? "0", 10);
    // 缩进档位夹到 6：Word 列表层级最多 9 级，异常值不应把正文推出一屏。
    const indent =
      Number.isFinite(level) && level > 0 ? LIST_INDENT.repeat(Math.min(level, 6)) : "";
    if (node.numbering) {
      lines.push(`${indent}${node.numbering.isOrdered === false ? "-" : "1."} ${text}`);
      continue;
    }
    lines.push(text);
  }

  const text = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return {
    text,
    headings: stats.headings,
    headingVia: stats.via,
    tables: stats.tables,
    skippedImages: stats.images,
  };
}
