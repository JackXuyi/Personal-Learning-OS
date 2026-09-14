/**
 * 章内提问的上下文检索（chapter-context）—— 两段式范围检索 + 上下文拼装。
 *
 * 设计（docs/learn-chapter-qa-design-2026-09.md §8.3）：
 * - **第 ① 段（本章）**：先取本章全部 chunk id 作为硬边界，把范围**同时**交给
 *   `hybridSearch` 的 `restrictChunkIds` 与 `scope`（前者锁向量候选、后者下推
 *   FTS 的 SQL）。仅靠 `scope` 会让向量路从全库召回，答案可能引用到别的资料。
 * - **第 ② 段（同资料其他章）**：本章命中不足 `MIN_CHAPTER_HITS` 时才扩，
 *   并把已命中的 chunk 排除在外，避免重复占位（决策 D1：跨章不跨资料）。
 * - **绝不静默退化为全库**：本章无 chunk 直接返回空（`candidates === 0`），
 *   由调用方渲染「未建索引」空态。
 *
 * 约束：零 React、零 `features/` 依赖（分层红线），可直跑 node 单测。
 */
import type { StorageAdapter } from "../../storage";
import type { Embedder } from "../embedding";
import { hybridSearch } from "./hybrid-search";

/** 本章命中少于此值时触发「扩展到同资料其他章」。 */
export const MIN_CHAPTER_HITS = 2;
/** 单次提问注入模型的片段条数上限。 */
export const CHAPTER_QA_LIMIT = 6;
/** 注入模型的上下文总字符上限（小模型上下文护栏）。 */
export const CHAPTER_QA_CONTEXT_CHARS = 6_000;
/** 单条片段字符上限（防单块吃满上下文）。 */
export const CONTEXT_BLOCK_CHARS = 1_200;

export interface ChapterContextOptions {
  storage: StorageAdapter;
  embedder?: Embedder;
  chapterId: string;
  documentId: string;
  /** 检索词：用户问题原文（不做改写，保持可解释）。 */
  query: string;
}

/** 注入模型的一段上下文（编号与提示词里的 `[n]` 对应）。 */
export interface ContextBlock {
  /** 1..n，与提示词里的片段编号对应。 */
  index: number;
  chunkId: string;
  chapterId: string;
  chapterTitle: string;
  text: string;
}

export interface ChapterContext {
  /** 已按「片段 n」编号的上下文块（已截断到上限）。 */
  blocks: ContextBlock[];
  /** chapter = 仅本章命中足够；document = 已扩到同资料其他章。 */
  scopeUsed: "chapter" | "document";
  /** 本章范围内的 chunk 总数（0 → 调用方判 `empty`，不进 AI）。 */
  candidates: number;
  /** 检索模式（转发 `hybridSearch` 的 mode，UI 可标注「仅全文检索」）。 */
  mode: "hybrid" | "fulltext";
}

export async function retrieveChapterContext(
  opts: ChapterContextOptions,
): Promise<ChapterContext> {
  const { storage, embedder, chapterId, documentId, query } = opts;

  // ① 本章范围：先把 chunk id 取出来，作为向量候选与融合过滤的硬边界
  const ownChunks = await storage.listChunks(chapterId);
  if (ownChunks.length === 0) {
    // 本章无 chunk：不静默退化成全库，交给调用方渲染「无索引」空态
    return { blocks: [], scopeUsed: "chapter", candidates: 0, mode: "fulltext" };
  }

  const ownIds = ownChunks.map((c) => c.id);
  const own = await hybridSearch(query, {
    storage,
    embedder,
    scope: { chapterId }, // FTS 下推
    restrictChunkIds: ownIds, // 向量候选过滤（缺口 A）
    limit: CHAPTER_QA_LIMIT,
  });

  const picked = [...own.hits];
  let scopeUsed: "chapter" | "document" = "chapter";
  let mode = own.mode;

  // ② 本章命中不足 → 扩到同资料其他章（决策 D1）
  if (picked.length < MIN_CHAPTER_HITS) {
    const restIds = (await storage.listChunksByDocument(documentId))
      .filter((c) => c.chapterId !== chapterId)
      .map((c) => c.id);
    if (restIds.length > 0) {
      const wide = await hybridSearch(query, {
        storage,
        embedder,
        scope: { documentId },
        restrictChunkIds: restIds,
        limit: CHAPTER_QA_LIMIT - picked.length,
      });
      picked.push(...wide.hits);
      scopeUsed = "document";
      // 混合模式下，只要有一路是 hybrid 就算 hybrid
      if (wide.mode === "hybrid") mode = "hybrid";
    }
  }

  if (picked.length === 0) {
    return { blocks: [], scopeUsed, candidates: ownChunks.length, mode };
  }

  // ③ 拼装上下文：去重（同 chunk 只留首次）→ 编号 → 逐条截断 → 总量截断
  const seen = new Set<string>();
  const blocks: ContextBlock[] = [];
  let used = 0;
  for (const hit of picked) {
    if (seen.has(hit.chunk.id)) continue;
    seen.add(hit.chunk.id);
    const text = hit.chunk.content.slice(0, CONTEXT_BLOCK_CHARS);
    if (used + text.length > CHAPTER_QA_CONTEXT_CHARS) break; // 超上限即停，不截半
    used += text.length;
    blocks.push({
      index: blocks.length + 1,
      chunkId: hit.chunk.id,
      chapterId: hit.chunk.chapterId,
      chapterTitle: hit.chapterTitle,
      text,
    });
  }
  return { blocks, scopeUsed, candidates: ownChunks.length, mode };
}
