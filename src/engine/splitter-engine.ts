/**
 * 章节切分引擎（splitter-engine）—— 三步学习闭环「步骤 1」的纯函数层。
 *
 * 职责：把一份资料（纯文本）启发式切分为有序的 Chapter 列表。
 * - Markdown：按标题（默认 # / ##）切分；无标题时降级为段落聚类。
 * - TXT / 纯文本：按空行分段，聚类到目标体量后成章。
 *
 * 设计约束：
 * - 全部为纯函数，不触碰存储 / Provider——调用方（store / UI）负责持久化；
 * - 产出仅含 Chapter 元数据 + contentRef 正文切片引用（不复制原文）；
 * - keyPoints 在无 AI 时用「正文首句摘要」兜底（AI 提炼属 N3/T12 提示词管线）；
 * - 附带人工微调原语（rename / merge / reorder），供 N1 切分预览 UI 使用。
 *
 * AI 精修（标题提炼 / 边界修正 / keyPoints 生成）在 N3/T12 作为可选的
 * post-process 接入，本模块签名保持不变（input → SplitResult）。
 */
import type { Chapter } from "../domain";
import { newId } from "../domain";

export type SplitFormat = "markdown" | "txt" | "auto";
export type SplitStrategy = "headings" | "paragraphs";

export interface SplitOptions {
  /** 自动格式探测失败/无标题时的段落聚类目标体量（默认 1600 字符）。 */
  targetCharsPerChapter?: number;
  /** Markdown 标题切分识别的最大层级（默认 2：# 与 ##）。 */
  mdHeadingMaxLevel?: number;
  /** 单段也可独立成章的最小段落数（段落聚类用，默认 3）。 */
  minParagraphsPerChapter?: number;
}

export interface SplitInput {
  documentId: string;
  /** 正文纯文本（Markdown 原样，或已抽出的纯文本）。 */
  text: string;
  /** 格式：auto 时按正文特征探测（默认 auto）。 */
  format?: SplitFormat;
  /** 注入当前时间便于测试断言（默认 Date.now()）。 */
  now?: number;
}

export interface SplitResult {
  chapters: Chapter[];
  /** 切分策略（headings = 标题切分；paragraphs = 段落聚类），供 UI 展示。 */
  strategy: SplitStrategy;
  /** 识别出的「文档主标题」（markdown 中正文为空的顶层 # 标题），供 UI 建议文档名。 */
  documentHeading?: string;
}

// ---------------------------------------------------------------- 主入口

export function splitDocument(input: SplitInput, options: SplitOptions = {}): SplitResult {
  const { documentId, text, now = Date.now() } = input;
  const format = resolveFormat(input.format ?? "auto", text);

  if (text.trim().length === 0) return { chapters: [], strategy: "paragraphs" };

  if (format === "markdown") {
    const headingSplit = splitByHeadings(documentId, text, now, options);
    if (headingSplit.strategy === "headings") return headingSplit;
  }
  return splitByParagraphs(documentId, text, now, options);
}

function resolveFormat(format: SplitFormat, text: string): "markdown" | "txt" {
  if (format === "markdown" || format === "txt") return format;
  // auto 探测：行首出现 1-2 级 ATX 标题即可视为 markdown。
  return /^#{1,2}\s+\S/m.test(text) ? "markdown" : "txt";
}

// ------------------------------------------------- Markdown 标题切分

interface HeadingBoundary {
  level: number;      // ATX 层级（# = 1）
  lineStart: number;   // 标题行在全文中的字符起点
  contentStart: number; // 标题行结束后（含换行）的字符起点
  title: string;        // 清理后的标题文本
}

function splitByHeadings(
  documentId: string,
  text: string,
  now: number,
  options: SplitOptions,
): SplitResult {
  const maxLevel = options.mdHeadingMaxLevel ?? 2;
  const boundaries: HeadingBoundary[] = [];

  // 逐行扫描，记录每行起点与标题边界（保持字符级 offset，不丢内容）。
  const lines = text.split(/(?<=\n)/);
  let offset = 0;
  for (const line of lines) {
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m && m[1].length <= maxLevel) {
      boundaries.push({
        level: m[1].length,
        lineStart: offset,
        contentStart: offset + line.length,
        title: cleanTitle(m[2]),
      });
    }
    offset += line.length;
  }

  if (boundaries.length === 0) return { chapters: [], strategy: "paragraphs" };

  // 文档主标题识别：唯一的顶层 # 且其后到下一标题间无正文 → 视为文档大标题，
  // 不单独成章（避免「# 书名」被建成一个空壳章）；标题文本记入 documentHeading。
  let documentHeading: string | undefined;
  if (
    boundaries.length > 1 &&
    boundaries[0].level === 1 &&
    !boundaries.slice(1).some((b) => b.level === 1)
  ) {
    const gap = text.slice(boundaries[0].contentStart, boundaries[1].lineStart);
    if (gap.trim().length === 0) {
      documentHeading = boundaries[0].title;
      boundaries.shift();
    }
  }

  const chapters: Chapter[] = [];

  for (let i = 0; i < boundaries.length; i++) {
    const b = boundaries[i];
    const nextStart = i + 1 < boundaries.length ? boundaries[i + 1].lineStart : text.length;
    // 第一章从 0 开始（吸收标题前的导言，避免丢内容）；后续章从各自标题行开始。
    const start = chapters.length === 0 ? 0 : b.lineStart;
    const body = text.slice(start, nextStart);

    if (body.trim().length === 0) {
      // 空正文章节：若位于最前（无已建章），其标题视为文档主标题；否则直接丢弃。
      if (chapters.length === 0 && documentHeading === undefined) {
        documentHeading = b.title;
      }
      continue;
    }

    chapters.push({
      id: newId("chp"),
      documentId,
      order: chapters.length + 1,
      title: b.title,
      contentRef: { start, end: nextStart },
      keyPoints: summarize(firstBodyLines(body)),
      unitIds: [],
      status: "not-started",
      createdAt: now,
    });
  }

  if (chapters.length === 0) {
    // 全部为空（纯标题文档）：至少保留主标题为一个空章骨架，避免数据不可见。
    return {
      chapters: [
        {
          id: newId("chp"),
          documentId,
          order: 1,
          title: documentHeading ?? "未命名",
          contentRef: { start: 0, end: text.length },
          keyPoints: [],
          unitIds: [],
          status: "not-started",
          createdAt: now,
        },
      ],
      strategy: "headings",
      documentHeading,
    };
  }

  return { chapters, strategy: "headings", documentHeading };
}

// ------------------------------------------------- 段落聚类（TXT / 无标题文本）

interface Segment {
  start: number;
  end: number;
  content: string;
}

/** 按空行切出段落区间（trim 段内容；区间起点终点取 trim 后，空白归两段之间）。 */
function segmentByBlankLines(text: string): Segment[] {
  const segments: Segment[] = [];
  // 用「连续 ≥2 个换行 = 段分隔」的语义切分：先按空行切，再聚合行块。
  const parts = text.split(/\n\s*\n/);
  let cursor = 0;
  for (const part of parts) {
    const start = text.indexOf(part, cursor);
    const end = start + part.length;
    cursor = end;
    const content = part.replace(/\s+$/, "");
    if (content.trim().length > 0) {
      segments.push({ start, end, content });
    }
  }
  return segments;
}

function splitByParagraphs(
  documentId: string,
  text: string,
  now: number,
  options: SplitOptions,
): SplitResult {
  const target = options.targetCharsPerChapter ?? 1600;
  const minParagraphs = options.minParagraphsPerChapter ?? 3;
  const segments = segmentByBlankLines(text);

  if (segments.length === 0) {
    // 无空行分隔：整段即一章。
    return {
      chapters: [
        {
          id: newId("chp"),
          documentId,
          order: 1,
          title: "第 1 节",
          contentRef: { start: 0, end: text.length },
          keyPoints: summarize(text),
          unitIds: [],
          status: "not-started",
          createdAt: now,
        },
      ],
      strategy: "paragraphs",
    };
  }

  const chapters: Chapter[] = [];
  let acc: Segment[] = [];
  let accChars = 0;

  const flush = () => {
    if (acc.length === 0) return;
    const first = acc[0];
    const last = acc[acc.length - 1];
    const body = text.slice(first.start, last.end);
    chapters.push({
      id: newId("chp"),
      documentId,
      order: chapters.length + 1,
      title: `第 ${chapters.length + 1} 节`,
      contentRef: { start: first.start, end: last.end },
      keyPoints: summarize(body),
      unitIds: [],
      status: "not-started",
      createdAt: now,
    });
    acc = [];
    accChars = 0;
  };

  for (const seg of segments) {
    acc.push(seg);
    accChars += seg.content.length;
    const enoughChars = accChars >= target;
    const enoughParagraphs = acc.length >= minParagraphs && accChars >= Math.ceil(target / 2);
    if (enoughChars || enoughParagraphs) flush();
  }
  flush(); // 收尾：余量不足也成章，不丢内容

  return { chapters, strategy: "paragraphs" };
}

// ------------------------------------------------- 工具：标题清理 / 摘要

/** 清理标题行内联标记：加粗 / 行内代码 / 链接 / 首尾空白。 */
function cleanTitle(raw: string): string {
  return raw
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .trim();
}

/**
 * 取章正文用于摘要：移除正文中所有标题行（章切片可能含文档主标题 / 章标题），
 * 避免「## 章名」之类标题文本成为要点；contentRef 不受影响。
 */
function firstBodyLines(body: string): string {
  return body.replace(/^#{1,6}\s+.*$/gm, "").replace(/^\n+/, "");
}

/** 本地兜底要点：正文首句，截断至 max 字符。 */
export function summarize(text: string, max = 80): string[] {
  const t = text.trim();
  if (t.length === 0) return [];
  const firstSentence = t.split(/(?<=[。！？.!?])\s*/)[0];
  const sliced = firstSentence.length <= max ? firstSentence : `${firstSentence.slice(0, max)}…`;
  return sliced.length > 0 ? [sliced] : [];
}

// ------------------------------------------------- AI 精修应用（N3/T12 提示词管线消费）

/** 单章 AI 精修建议（index 为 chapters 按 order 升序后的下标；引擎侧应用，纯函数）。 */
export interface ChapterRefine {
  /** 章节在输入数组中的下标（0-based）。 */
  index: number;
  /** 精修后的章标题（空/缺省 → 保持原样）。 */
  title?: string;
  /** 精修后的学习要点（替换原 keyPoints；空数组 → 保持原样）。 */
  keyPoints?: string[];
  /** 该章内容过碎，并入上一章（边界修正；下标 0 忽略）。 */
  mergeIntoPrevious?: boolean;
}

/**
 * 把 AI 精修建议应用到启发式切分结果（纯函数，T12 消费点调用）。
 *
 * 规则：
 * - 只接受 index 合法且去重的建议（后者覆盖前者）；title/keyPoints 各自
 *   清洗后应用（title 截断至 40 字去换行；keyPoints 每条约 80 字、至多 5 条）；
 * - mergeIntoPrevious：把该章并入其上一章（区间取并集、标题留首章、要点合并
 *   截断至 6 条）；连续的 merge 会自然累积成同一章（第 i 章并入上一章后，
 *   第 i+1 章再并入「上一章」即并入累积后的章）；
 * - 返回数组保持输入顺序并重写 order（order 不变量不被破坏）。
 */
export function applyChapterRefine(
  chapters: Chapter[],
  refines: readonly ChapterRefine[],
): Chapter[] {
  if (refines.length === 0) return chapters;

  const byIndex = new Map<number, ChapterRefine>();
  for (const r of refines) {
    if (Number.isInteger(r.index) && r.index >= 0 && r.index < chapters.length) {
      byIndex.set(r.index, r);
    }
  }
  if (byIndex.size === 0) return chapters;

  const out: Chapter[] = [];
  for (let i = 0; i < chapters.length; i++) {
    let cur = chapters[i];
    const refine = byIndex.get(i);
    if (refine) {
      const title = cleanRefinedTitle(refine.title);
      const keyPoints = cleanRefinedKeyPoints(refine.keyPoints);
      cur = {
        ...cur,
        title: title ?? cur.title,
        keyPoints: keyPoints ?? cur.keyPoints,
      };
      if (refine.mergeIntoPrevious && out.length > 0) {
        const prev = out[out.length - 1];
        out[out.length - 1] = {
          ...prev,
          contentRef: { start: prev.contentRef.start, end: cur.contentRef.end },
          keyPoints: [...prev.keyPoints, ...cur.keyPoints].slice(0, 6),
        };
        continue;
      }
    }
    out.push(cur);
  }

  return out.map((c, i) => ({ ...c, order: i + 1 }));
}

/** 清洗 AI 标题：去空白换行、截断至 40 字；空串返回 undefined（保持原样）。 */
function cleanRefinedTitle(title: string | undefined): string | undefined {
  if (!title) return undefined;
  const t = title.replace(/\s+/g, " ").trim();
  return t.length === 0 ? undefined : t.slice(0, 40);
}

/** 清洗 AI 要点：每条去空白截断至 80 字、剔空、至多 5 条；无有效条目返回 undefined。 */
function cleanRefinedKeyPoints(keyPoints: string[] | undefined): string[] | undefined {
  if (!keyPoints || keyPoints.length === 0) return undefined;
  const cleaned = keyPoints
    .map((k) => k.replace(/\s+/g, " ").trim())
    .filter((k) => k.length > 0)
    .map((k) => (k.length <= 80 ? k : `${k.slice(0, 80)}…`));
  return cleaned.length === 0 ? undefined : cleaned.slice(0, 5);
}

// ------------------------------------------------- 人工微调原语（N1 切分预览 UI 使用）

/** 重命名章节（返回新数组；不改 order / 区间）。 */
export function renameChapter(chapters: Chapter[], chapterId: string, title: string): Chapter[] {
  return chapters.map((c) => (c.id === chapterId ? { ...c, title: title.trim() || c.title } : c));
}

/**
 * 合并同一文档中连续的一段章节（含 fromId..toId，均需存在且相邻；入参按 order 升序）。
 * 区间取合并段的并集，标题保留首章，keyPoints 合并截断；合并章落在被合并段原位。
 */
export function mergeChapters(
  chapters: Chapter[],
  fromId: string,
  toId: string,
): { chapters: Chapter[]; merged: Chapter | undefined } {
  const ids = chapters.map((c) => c.id);
  const from = ids.indexOf(fromId);
  const to = ids.indexOf(toId);
  if (from === -1 || to === -1 || from > to) return { chapters, merged: undefined };

  const merged: Chapter = {
    ...chapters[from],
    contentRef: { start: chapters[from].contentRef.start, end: chapters[to].contentRef.end },
    title: chapters[from].title,
    keyPoints: [...chapters[from].keyPoints, ...chapters[to].keyPoints].slice(0, 5),
  };
  const next = [...chapters.slice(0, from), merged, ...chapters.slice(to + 1)];
  return { chapters: renumber(next), merged };
}

/** 按指定 id 顺序重排章节并重写 order；未列出的保持原相对顺序附后。 */
export function reorderChapters(chapters: Chapter[], orderedIds: string[]): Chapter[] {
  const byId = new Map(chapters.map((c) => [c.id, c]));
  const next: Chapter[] = [];
  for (const id of orderedIds) {
    const c = byId.get(id);
    if (c) {
      next.push(c);
      byId.delete(id);
    }
  }
  for (const c of byId.values()) next.push(c); // 未列出的保持在后
  return renumber(next);
}

/**
 * 重写 order 为连续 1..n（merge/reorder 后保持不变量）。
 * 注意：保持传入数组顺序，不做排序——调用方负责传入有序列表。
 */
function renumber(chapters: Chapter[]): Chapter[] {
  return chapters.map((c, i) => ({ ...c, order: i + 1 }));
}
