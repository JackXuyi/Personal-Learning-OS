/**
 * PDF 版式后处理（纯函数，零依赖，可 node 直测）。
 *
 * 为什么需要（G5）：pdf.js 的 `getTextContent()` 只保证「按绘制顺序」吐出文本项，
 * 直接 `str + hasEOL` 拼接会带来三类失真：
 * 1. **阅读顺序**：双栏排版会被逐行交错，左栏下一行接到右栏上一行之后；
 * 2. **行内断字**：同一行的多个 item 之间缺少必要的空格（`Hello` + `world`）；
 * 3. **折行割裂**：中文段落每视觉行都被硬换行，行尾英文连字符（`embed-` / `ding`）被保留。
 * 此外跨页的页眉/页脚/页码会被当成正文反复插入。
 *
 * 本模块不依赖 pdfjs（只吃 `transform` / `width` / `height` / `str` 这些字段），
 * 因此可以在 node 单测里用合成 item 精确验证每一类规则。
 *
 * 坐标约定：pdf.js 的 `transform = [a, b, c, d, e, f]`，`e` = x，`f` = 基线 y；
 * PDF 用户空间原点在**左下角**，故 y 越大越靠上——排序时 y 降序即「从上到下」。
 */

/** pdf.js text item 的最小子集（只声明本模块读取的字段）。 */
export interface PdfTextItem {
  str?: string;
  hasEOL?: boolean;
  width?: number;
  height?: number;
  /** `[a, b, c, d, e, f]`：e = x，f = 基线 y，d ≈ 字号（带符号）。 */
  transform?: number[];
}

export interface ReflowOptions {
  /** 页宽（pt）；用于分栏判定。缺省 / ≤0 时不分栏。 */
  pageWidth?: number;
}

/** 带坐标的文本项。 */
interface Placed {
  x: number;
  y: number;
  w: number;
  h: number;
  str: string;
}

/** 行数组里的「栏分界」哨兵：joinPageLines 视其为段落断点，且禁止跨栏拼接。 */
const COLUMN_BREAK = "";

const CJK_RE = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/;
/** 句末标点：中文折行合并到此为止（视作段末，不跨段合并）。 */
const CJK_TERMINAL_RE = /[。！？；：”"』】)）]$/;

function isCjk(ch: string | undefined): boolean {
  return ch !== undefined && CJK_RE.test(ch);
}

/** 中位数（不改动入参）。 */
function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** 抽取可定位的文本项；任一必要字段缺失即返回 null（调用方走退化路径）。 */
function toPlaced(items: readonly PdfTextItem[]): Placed[] | null {
  const out: Placed[] = [];
  for (const item of items) {
    if (typeof item.str !== "string" || item.str.length === 0) continue;
    const t = item.transform;
    if (!Array.isArray(t) || t.length < 6 || typeof t[4] !== "number" || typeof t[5] !== "number") {
      return null; // 有内容却无法定位 → 整页退化，保证确定性
    }
    out.push({
      x: t[4],
      y: t[5],
      w: typeof item.width === "number" && item.width > 0 ? item.width : item.str.length,
      h: typeof item.height === "number" && item.height > 0 ? item.height : Math.abs(t[3]) || 1,
      str: item.str,
    });
  }
  return out;
}

/** 退化路径：按绘制顺序 + hasEOL 拼接（与旧实现一致，保证不丢内容）。 */
function legacyLines(items: readonly PdfTextItem[]): string[] {
  let buf = "";
  const lines: string[] = [];
  for (const item of items) {
    if (typeof item.str !== "string") continue;
    buf += item.str;
    if (item.hasEOL) {
      lines.push(buf);
      buf = "";
    }
  }
  if (buf) lines.push(buf);
  return lines;
}

/** 按 y 聚类成视觉行（y 降序 = 从上到下，行内按 x 升序）。 */
function groupRows(placed: readonly Placed[]): Placed[][] {
  const tol = Math.max(1, median(placed.map((p) => p.h)) * 0.5);
  const sorted = [...placed].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: Placed[][] = [];
  let current: Placed[] = [];
  let anchorY = NaN;
  for (const p of sorted) {
    if (current.length > 0 && Math.abs(p.y - anchorY) > tol) {
      rows.push(current);
      current = [];
    }
    if (current.length === 0) anchorY = p.y;
    current.push(p);
  }
  if (current.length > 0) rows.push(current);
  for (const row of rows) row.sort((a, b) => a.x - b.x);
  return rows;
}

/** 行内拼接：按 x 间距补空格（防止 word 粘接），CJK 连排不补。 */
function rowToLine(row: readonly Placed[]): string {
  const fontSize = median(row.map((p) => p.h)) || 1;
  const gapThreshold = fontSize * 0.3;
  let line = "";
  let prevEnd = NaN;
  for (const p of row) {
    if (line !== "" && Number.isFinite(prevEnd) && p.x - prevEnd > gapThreshold) {
      line += " ";
    }
    line += p.str;
    prevEnd = p.x + p.w;
  }
  return line;
}

/**
 * 分栏判定：把一页的行重排为「通栏行 → 左栏 → 右栏」三组。
 *
 * 关键认识：双栏排版里**同一视觉行会同时包含左栏与右栏的文本**，所以不能用
 * 「整行归属某栏」来判定，必须**按文本项**归属。
 *
 * 判据（全部满足才拆栏，宁可不拆也不误拆）：
 * - 左栏项 ≥2 行、右栏项 ≥2 行（页数太少的证据不足）；
 * - 存在真实空白 gutter：左栏最右沿 < 右栏最左沿，且各自不越过中线；
 * - 越过中线的项（通栏标题 / 宽表）单独成组置于最前，不参与 gutter 计算。
 */
function columnize(rows: readonly Placed[][], pageWidth: number | undefined): Placed[][][] {
  // 行数过少（<3）不构成分栏证据；更细的护栏由下方「左右各 ≥2 行 + 真实 gutter」承担。
  if (!pageWidth || pageWidth <= 0 || rows.length < 3) return [[...rows]];
  const center = pageWidth / 2;
  const crossing = (p: Placed) => p.x < center && p.x + p.w > center;

  const body = rows.flat().filter((p) => !crossing(p));
  const leftItems = body.filter((p) => p.x + p.w / 2 < center);
  const rightItems = body.filter((p) => p.x + p.w / 2 >= center);
  if (leftItems.length === 0 || rightItems.length === 0) return [[...rows]];

  const leftMax = Math.max(...leftItems.map((p) => p.x + p.w));
  const rightMin = Math.min(...rightItems.map((p) => p.x));
  const gutterOk = leftMax < center && rightMin > center && leftMax < rightMin;

  const leftRowCount = rows.filter((r) => r.some((p) => !crossing(p) && p.x + p.w / 2 < center)).length;
  const rightRowCount = rows.filter((r) => r.some((p) => !crossing(p) && p.x + p.w / 2 >= center)).length;
  if (!gutterOk || leftRowCount < 2 || rightRowCount < 2) return [[...rows]];

  // 通栏行（如大标题）统一前置：其 y 天然高于正文块，顺序上无歧义。
  const head = rows.filter((r) => r.some(crossing));
  const rest = rows.filter((r) => !r.some(crossing));
  const left = rest
    .map((r) => r.filter((p) => p.x + p.w / 2 < center))
    .filter((r) => r.length > 0);
  const right = rest
    .map((r) => r.filter((p) => p.x + p.w / 2 >= center))
    .filter((r) => r.length > 0);
  return [head, left, right].filter((g) => g.length > 0);
}

/**
 * 把一页的 text item 重排为「阅读顺序正确的行数组」。
 *
 * 行内已补空格、已按分栏重排；栏与栏之间插入 `""` 哨兵。
 * `hasEOL` 不再使用（行边界由 y 聚类决定）——有 EOL 而无坐标时走退化路径。
 */
export function reflowPageItems(items: readonly PdfTextItem[], opts: ReflowOptions = {}): string[] {
  const placed = toPlaced(items);
  if (placed === null) return legacyLines(items);
  if (placed.length === 0) return [];

  const rows = groupRows(placed);
  const groups = columnize(rows, opts.pageWidth);
  const lines: string[] = [];
  groups.forEach((group, gi) => {
    if (gi > 0) lines.push(COLUMN_BREAK);
    for (const row of group) {
      const line = rowToLine(row);
      if (line.trim()) lines.push(line);
    }
  });
  return lines;
}

/** 页眉/页脚/页码行判定（纯页码、`Page x of y`、`第 x 页`、`x / y`）。 */
function isPageNumberLine(s: string): boolean {
  return (
    /^[-–—·\s]*\d{1,4}[-–—·\s]*$/.test(s) ||
    /^第\s*\d{1,4}\s*页$/.test(s) ||
    /^page\s+\d+(\s+of\s+\d+)?$/i.test(s) ||
    /^\d{1,4}\s*\/\s*\d{1,4}$/.test(s)
  );
}

/**
 * 跨页去噪：删掉「在 ≥50% 页面上重复出现的短行」（页眉/页脚）与纯页码行。
 *
 * 只在 ≥3 页时启用（页数太少时「重复」不构成证据）；长行（>40 字符）不参与，
 * 避免误删正文里反复出现的引用句。空白与栏哨兵原样保留。
 */
export function stripRunningHeads(pages: readonly (readonly string[])[]): string[][] {
  const copied = pages.map((p) => [...p]);
  if (pages.length < 3) return copied;

  const counts = new Map<string, number>();
  for (const page of pages) {
    for (const line of page) {
      const t = line.trim();
      if (!t || t.length > 40) continue;
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  const threshold = Math.ceil(pages.length * 0.5);
  const repeated = new Set(
    [...counts.entries()].filter(([, n]) => n >= threshold).map(([t]) => t),
  );

  return pages.map((page) =>
    page.filter((line) => {
      const t = line.trim();
      if (!t) return true; // 哨兵 / 空行
      return !(repeated.has(t) || isPageNumberLine(t));
    }),
  );
}

/**
 * 行合并：修复折行造成的割裂。
 *
 * - 行尾 `-` + 下一行小写字母 → 英文断词，去连字符直连；
 * - 行尾与下一行行首均为 CJK 且上一行不是句末 → 中文折行，直连不加空格；
 * - 其余情况保留换行（段落结构由此保留）；哨兵 `""` 输出为空行（段落断点）。
 */
export function joinPageLines(lines: readonly string[]): string {
  const out: string[] = [];
  for (const raw of lines) {
    if (raw === COLUMN_BREAK) {
      out.push("");
      continue;
    }
    const line = raw.trim();
    if (!line) continue;
    const prev = out[out.length - 1];
    if (prev !== undefined && prev !== "") {
      const prevTail = prev[prev.length - 1];
      const nextHead = line[0];
      if (prevTail === "-" && /^[a-z]/.test(nextHead)) {
        out[out.length - 1] = prev.slice(0, -1) + line;
        continue;
      }
      if (isCjk(prevTail) && isCjk(nextHead) && !CJK_TERMINAL_RE.test(prev)) {
        out[out.length - 1] = prev + line;
        continue;
      }
    }
    out.push(line);
  }
  return out.join("\n");
}

/** 疑似标题行：中文序号章名（第 X 章）/ Chapter N / 数字编号小节。 */
const HEADING_PATTERNS: RegExp[] = [
  /^第\s*[一二三四五六七八九十百千零两0-9]{1,6}\s*[章节篇部讲]\s*\S/,
  /^chapter\s+\d{1,3}\b/i,
  /^\d{1,2}(\.\d{1,2}){1,3}\s+\S/,
];

/**
 * 把 PDF 正文里的「疑似标题行」提升为 Markdown 标题（`## `）。
 *
 * PDF 没有结构标记，切分器只能按段落聚类——`## ` 是让「第 X 章」被识别成章节的
 * 唯一低成本手段。规则刻意保守：行必须短（≤40 字符）、不以句末标点结尾、
 * 且已带 `#` 的行不重复提升。
 */
export function promotePdfHeadings(text: string): { text: string; promoted: number } {
  let promoted = 0;
  const out = text.split("\n").map((raw) => {
    const line = raw.trim();
    if (!line || line.length > 40 || line.startsWith("#")) return raw;
    if (/[。！？；，]$/.test(line)) return raw;
    if (!HEADING_PATTERNS.some((re) => re.test(line))) return raw;
    promoted += 1;
    return `## ${line}`;
  });
  return { text: out.join("\n"), promoted };
}
