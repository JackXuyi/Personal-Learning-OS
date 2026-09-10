/**
 * 混合检索编排（hybrid-search）—— FTS + 向量双路 → RRF 融合 → 展示信息补全。
 *
 * 这是 RAG 链路的下游消费点（docs/rag-wiring-design-2026-09.md §5.1-C）：
 * 在 `/learn` 搜索框里，元信息匹配（标题 / 来源 / 章标题 / 要点）继续由页面本地
 * 过滤承担，本模块负责**正文内容**这一层——此前完全缺失的能力。
 *
 * 降级策略（贯穿全流程，任何一步失败都不抛错，只退回 FTS）：
 * - provider 未配置 / 无 `embed` 能力 → 只跑 FTS，`mode = "fulltext"`；
 * - 库里尚无向量（浏览器预览 / 尚未建索引）→ 只跑 FTS；
 * - embedding 请求失败 → 只跑 FTS。
 *
 * 约束：依赖 `StorageAdapter` 与 `AIProvider` 契约，不依赖 React。
 */
import type { Chunk, EmbeddingTargetType } from "../../domain";
import type { AIProvider } from "../types";
import type { RetrievalScope, StorageAdapter } from "../../storage";
import { cosineTopK } from "./vector-search";
import { fuseRankings } from "./rrf";

/** 检索消费的向量目标类型（当前仅 chunk 级）。 */
const TARGET_TYPE: EmbeddingTargetType = "chunk";

export interface SearchHit {
  chunk: Chunk;
  /** 所属资料标题（查不到时为空串）。 */
  docTitle: string;
  /** 所属章标题（查不到时为空串）。 */
  chapterTitle: string;
  /** 该命中是否由向量路贡献（UI 可标注「语义命中」）。 */
  semantic: boolean;
}

export interface HybridSearchOptions {
  storage: StorageAdapter;
  /** 不传 / 未配置 / 无 embed 能力 → 仅全文检索。 */
  provider?: AIProvider;
  scope?: RetrievalScope;
  /** 最终返回条数（默认 8）。 */
  limit?: number;
  /** 每路召回条数（默认 20）。 */
  recall?: number;
}

export interface HybridSearchResult {
  hits: SearchHit[];
  /** `hybrid` = 向量路参与了；`fulltext` = 仅全文检索（UI 据此显示徽标）。 */
  mode: "hybrid" | "fulltext";
}

/**
 * FTS + 向量双路检索 → RRF 融合 → 补全文档/章标题。
 *
 * 向量路的 scope 说明：`scope` 只作用于 FTS 路（下推到 SQL）。向量路是
 * 「先按相似度召回 chunk 再回表」，若将来需要按范围限定，应在 `cosineTopK`
 * 之后按 chunk 的 documentId/chapterId 过滤；当前产品入口（资料库全局搜索）
 * 不需要，故不做多余过滤。
 */
export async function hybridSearch(
  query: string,
  opts: HybridSearchOptions,
): Promise<HybridSearchResult> {
  const limit = Math.max(1, opts.limit ?? 8);
  const recall = Math.max(1, opts.recall ?? 20);
  const q = query.trim();
  if (q.length === 0) return { hits: [], mode: "fulltext" };

  const { storage, provider } = opts;
  const byId = new Map<string, Chunk>();

  // ---- 路 1：FTS（全量库检索，含 trigram 中文能力）----
  const fts = await storage.fullTextSearch(q, opts.scope, recall);
  for (const c of fts) byId.set(c.id, c);
  const ftsIds = fts.map((c) => c.id);

  // ---- 路 2：向量（能力不存在即跳过）----
  let vecIds: string[] = [];
  if (provider?.isConfigured() && typeof provider.embed === "function") {
    try {
      const vectors = await provider.embed([q]);
      const queryVec = vectors[0];
      if (queryVec && queryVec.length > 0) {
        const candidates = await storage.listEmbeddingVectors(TARGET_TYPE);
        if (candidates.length > 0) {
          const { hits } = cosineTopK(queryVec, candidates, recall);
          const chunks = await Promise.all(hits.map((h) => storage.getChunk(h.targetId)));
          for (const c of chunks) if (c) byId.set(c.id, c);
          // 回表失败的命中（chunk 已删但向量残留）直接剔除，不进融合
          vecIds = hits.map((h) => h.targetId).filter((id) => byId.has(id));
        }
      }
    } catch {
      // 向量路任何异常都静默降级：检索不该因为 embedding 不可用而整体失败。
      vecIds = [];
    }
  }

  // ---- 融合 ----
  const fused = fuseRankings([ftsIds, vecIds], { limit });
  const chunks = fused
    .map((id) => byId.get(id))
    .filter((c): c is Chunk => c !== undefined);

  const { docTitles, chapterTitles } = await loadTitles(storage, chunks);
  const ftsSet = new Set(ftsIds);

  return {
    hits: chunks.map((chunk) => ({
      chunk,
      docTitle: docTitles.get(chunk.documentId) ?? "",
      chapterTitle: chapterTitles.get(chunk.chapterId) ?? "",
      semantic: !ftsSet.has(chunk.id),
    })),
    mode: vecIds.length > 0 ? "hybrid" : "fulltext",
  };
}

/** 批量取「文档标题」与「章标题」（按 documentId 去重，避免 N 次 listChapters）。 */
async function loadTitles(
  storage: StorageAdapter,
  chunks: readonly Chunk[],
): Promise<{ docTitles: Map<string, string>; chapterTitles: Map<string, string> }> {
  const docTitles = new Map<string, string>();
  for (const d of await storage.listDocuments()) docTitles.set(d.id, d.title);

  const chapterTitles = new Map<string, string>();
  const docIds = new Set(chunks.map((c) => c.documentId));
  for (const docId of docIds) {
    for (const ch of await storage.listChapters(docId)) chapterTitles.set(ch.id, ch.title);
  }
  return { docTitles, chapterTitles };
}
