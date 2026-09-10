/**
 * Chunk 切分引擎（chunk-engine）—— RAG 索引链路的「步骤 1」纯函数层。
 *
 * 职责：把「章正文」切成若干 Chunk（向量化 / 全文检索的最小单位）。
 *
 * 设计约束：
 * - 全部纯函数，零依赖 React / storage / AI——调用方（index-chunks 服务）负责持久化；
 * - 确定性：同一输入恒得同一输出（`id` 除外，它由 newId 生成；`now` 可注入便于断言）；
 * - 不复制原文：Chunk.content 是章正文的**切片**，调用方用 contentRef 取出章正文喂进来；
 * - 依赖方向：只使用 domain 层的 `estimateTokenCount`（纯函数），不反向依赖。
 *
 * 与 splitter-engine 的分工：splitter 管「文档 → Chapter」（学习/测评的主单位），
 * chunk-engine 管「Chapter → Chunk」（检索的最小单位）。两者都是纯代码，
 * 与 AI 侧的 `index-service`（向量化）/ `analyze-service`（精修）严格解耦。
 */
import type { Chapter, Chunk, SourceDocument } from "../domain";
import { estimateTokenCount, newId, sortChaptersByOrder } from "../domain";

/** 段落聚合的目标 token 数（达到即 flush）。 */
export const DEFAULT_TARGET_TOKENS = 400;
/** 单块硬上限 token 数（超出必须二次切分）。 */
export const DEFAULT_HARD_MAX_TOKENS = 512;

export interface ChunkChapterInput {
  documentId: string;
  chapterId: string;
  /** 章标题（写入 `chunk.metadata.heading`，供检索结果展示上下文）。 */
  chapterTitle: string;
  /** 章正文（调用方用 `chapterBodyOf` 从 textPreview 取出）。 */
  text: string;
  /** 位置起始值（跨章全局递增，由调用方维护）。 */
  startPosition: number;
}

export interface ChunkOptions {
  /** 段落聚合目标 token 数（默认 400）。 */
  targetTokens?: number;
  /** 单块硬上限 token（默认 512）。 */
  hardMaxTokens?: number;
  /** 注入当前时间便于测试断言（默认 Date.now()）。 */
  now?: number;
}

/** 句末标点（含换行）：硬切时的优先断点。 */
const SENTENCE_END = "。！？!?\n";

/**
 * 切一章为若干 Chunk（确定性纯函数）。
 *
 * 算法：
 * 1. 按「连续 ≥2 换行」切段落（与 splitter-engine 的段落语义一致），空段丢弃；
 * 2. 逐段累计 token，达到 targetTokens 即 flush 成一块（块内段落用 "\n\n" 连接）；
 * 3. 单段超 hardMaxTokens → 二次切分：先二分出「token 不超预算」的最长前缀，
 *    再在该前缀内回退到最近的句末标点（断点须落在前缀 60% 之后，否则宁可硬截断）；
 * 4. 每块 `position` 从 startPosition 起连续递增，tokenCount 由 content 现算；
 * 5. 二次切分的续块会折叠块首空白（仅空白字符，正文内容不丢）。
 */
export function chunkChapter(input: ChunkChapterInput, options: ChunkOptions = {}): Chunk[] {
  const target = Math.max(1, options.targetTokens ?? DEFAULT_TARGET_TOKENS);
  const hardMax = Math.max(1, options.hardMaxTokens ?? DEFAULT_HARD_MAX_TOKENS);
  const now = options.now ?? Date.now();
  const title = input.chapterTitle.trim();

  if (input.text.trim().length === 0) return [];

  const out: Chunk[] = [];
  let position = input.startPosition;

  const emit = (content: string) => {
    const text = content.trim();
    if (text.length === 0) return; // 纯空白块不产出（不留空 chunk）
    out.push({
      id: newId("chk"),
      documentId: input.documentId,
      chapterId: input.chapterId,
      content: text,
      position,
      tokenCount: estimateTokenCount(text),
      knowledgeIds: [],
      // 章标题非空才写 metadata：空标题留 undefined，避免给检索结果塞空标签。
      ...(title ? { metadata: { heading: title } } : {}),
      createdAt: now,
    });
    position += 1;
  };

  let buffer: string[] = [];
  let buffered = 0;
  const flush = () => {
    if (buffer.length === 0) return;
    emit(buffer.join("\n\n"));
    buffer = [];
    buffered = 0;
  };

  for (const para of splitParagraphs(input.text)) {
    const tokens = estimateTokenCount(para);
    if (tokens > hardMax) {
      flush(); // 先清空累计，保证块内不混入超长段
      for (const piece of hardSplit(para, hardMax)) emit(piece);
      continue;
    }
    // 加上这一段会超目标 → 先把已有段落收成一块
    if (buffer.length > 0 && buffered + tokens > target) flush();
    buffer.push(para);
    buffered += tokens;
  }
  flush();

  return out;
}

/**
 * 一份文档的全部章 → 全量 Chunk[]（`position` 全局连续）。
 * 章正文为空（越界 / 无正文）的章直接跳过，不产出空块。
 */
export function chunkDocument(
  doc: Pick<SourceDocument, "id" | "textPreview">,
  chapters: readonly Chapter[],
  options: ChunkOptions = {},
): Chunk[] {
  const out: Chunk[] = [];
  let position = 0;
  for (const chapter of sortChaptersByOrder([...chapters])) {
    const text = chapterBodyOf(doc, chapter);
    if (text.trim().length === 0) continue;
    const pieces = chunkChapter(
      {
        documentId: doc.id,
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        text,
        startPosition: position,
      },
      options,
    );
    out.push(...pieces);
    position += pieces.length;
  }
  return out;
}

/**
 * 从文档正文中截出某章正文（越界夹取，与 `chapter-preview.ts` 同策略）。
 *
 * 夹取而非抛错：contentRef 是切分时算出的，若之后「替换正文」导致文本变短，
 * 旧区间会超出实际长度 —— UI 侧不应为历史数据买单。
 */
export function chapterBodyOf(
  doc: Pick<SourceDocument, "textPreview">,
  chapter: Pick<Chapter, "contentRef">,
): string {
  const body = doc.textPreview;
  if (!body) return "";
  const start = Math.max(0, Math.min(chapter.contentRef.start, body.length));
  const end = Math.max(start, Math.min(chapter.contentRef.end, body.length));
  return body.slice(start, end);
}

// ---------------------------------------------------------------- 内部工具

/** 按「连续 ≥2 换行」切段落，去掉段尾空白，丢弃空段。 */
function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+$/, ""))
    .filter((p) => p.trim().length > 0);
}

/**
 * 二分出「token 数不超过预算」的最长前缀长度。
 *
 * 前提：`estimateTokenCount` 对前缀单调不减（中文数与非中文字符数都只增不减），
 * 故可二分。返回长度 ≥ 1，保证调用方每次至少前进一个字符，不会死循环。
 */
function maxPrefixByTokens(text: string, budget: number): number {
  if (estimateTokenCount(text) <= budget) return text.length;
  let lo = 1;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (estimateTokenCount(text.slice(0, mid)) <= budget) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** 前缀内最后一个句末标点之后的位置（找不到返回 -1）。 */
function lastSentenceBreak(prefix: string): number {
  for (let i = prefix.length - 1; i >= 0; i -= 1) {
    if (SENTENCE_END.includes(prefix[i])) return i + 1;
  }
  return -1;
}

/**
 * 硬切超长段落：优先在句末标点断开，否则按最长合法前缀截断（不丢正文字符）。
 *
 * 断点须落在候选前缀的 60% 之后 —— 否则为了「看起来在句末断」会切出大量
 * 过短的块，反而不如硬截断（与 `chapter-preview.ts` 的 60% 规则同源）。
 */
function hardSplit(paragraph: string, hardMax: number): string[] {
  const pieces: string[] = [];
  let rest = paragraph;

  while (rest.length > 0 && estimateTokenCount(rest) > hardMax) {
    const limit = maxPrefixByTokens(rest, hardMax);
    const brk = lastSentenceBreak(rest.slice(0, limit));
    const cut = brk > 0 && brk >= limit * 0.6 ? brk : limit;
    pieces.push(rest.slice(0, cut));
    // 续块折叠块首空白（只丢空白，正文不丢）。
    rest = rest.slice(cut).replace(/^\s+/, "");
  }
  if (rest.length > 0) pieces.push(rest);

  return pieces;
}
