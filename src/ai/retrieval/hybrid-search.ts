/**
 * 混合检索编排（hybrid-search）—— FTS + 向量双路 → RRF 融合 → 展示信息补全。
 *
 * 这是 RAG 链路的下游消费点（docs/rag-wiring-design-2026-09.md §5.1-C）：
 * 在 `/learn` 搜索框里，元信息匹配（标题 / 来源 / 章标题 / 要点）继续由页面本地
 * 过滤承担，本模块负责**正文内容**这一层——此前完全缺失的能力。
 *
 * 降级策略(贯穿全流程,任何一步失败都不抛错,只退回 FTS):
 * - 无本地 Embedder(浏览器预览 / 未配置模型)→ 只跑 FTS,`mode = "fulltext"`;
 * - 库里尚无向量(尚未建索引)→ 只跑 FTS;
 * - embedding 请求失败 → 只跑 FTS。
 *
 * 注意:查询向量走的是**本地 Embedder**(`ai/embedding.ts`),不是
 * `AIProvider`——向量化与「当前使用模型」无关(D5),因此入参是 embedder
 * 而非 provider。
 *
 * 约束:依赖 `StorageAdapter` 与 `Embedder` 契约,不依赖 React。
 */
import type { Chunk, EmbeddingTargetType } from "../../domain";
import type { Embedder } from "../embedding";
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
  /** 不传(浏览器预览 / 未配置本地向量模型)→ 仅全文检索。 */
  embedder?: Embedder;
  /** 既有:只作用于 FTS 路(下推 SQL)。向量路**不**受此约束,见 `restrictChunkIds`。 */
  scope?: RetrievalScope;
  /**
   * 新增:把检索锁在这些 chunk 内 —— **两路同时生效**。
   *
   * 为什么必须新增而不是复用 `scope`: `scope` 对向量路无效,而向量路是
   * 「全库 top-N 召回再回表」,若只在融合后过滤,范围内的 chunk 没进全库
   * top-N 时会漏召回(范围内实际有内容却返回 0 条)。正确做法是在**候选阶段**
   * 就把向量集合限死:把本集合传给 `listEmbeddingVectors("chunk", ids)`
   * (该接口本就支持按 targetIds 过滤)。
   *
   * 语义:`undefined` = 不限范围(既有行为);`[]` = 明确「范围内无内容」
   * → 直接返回空结果,**不退化成全库检索**。
   */
  restrictChunkIds?: readonly string[];
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
 * 范围限定（两个不同口径，别混用）：
 * - `scope`   —— 只作用于 FTS 路（下推到 SQL）；向量路不受它约束。
 * - `restrictChunkIds` —— **两路同时生效**（向量候选在检索前就按集合限死，
 *   FTS 结果在融合前再过滤一次保证口径一致）。`[]` 直接短路返回空。
 */
export async function hybridSearch(
  query: string,
  opts: HybridSearchOptions,
): Promise<HybridSearchResult> {
  const limit = Math.max(1, opts.limit ?? 8);
  const recall = Math.max(1, opts.recall ?? 20);
  const q = query.trim();
  if (q.length === 0) return { hits: [], mode: "fulltext" };

  // 空集合 = 明确「范围内无内容」：短路，绝不退化成全库（否则「章内提问」会串章）。
  if (opts.restrictChunkIds && opts.restrictChunkIds.length === 0) {
    return { hits: [], mode: "fulltext" };
  }

  const { storage, embedder } = opts;
  const byId = new Map<string, Chunk>();

  // ---- 路 1：FTS（全量库检索，含 trigram 中文能力）----
  const fts = await storage.fullTextSearch(q, opts.scope, recall);
  for (const c of fts) byId.set(c.id, c);
  const ftsIds = fts.map((c) => c.id);

  // ---- 路 2:向量(本地 Embedder 不存在即跳过)----
  let vecIds: string[] = [];
  if (embedder) {
    try {
      const vectors = await embedder.embed([q]);
      const queryVec = vectors[0];
      if (queryVec && queryVec.length > 0) {
        // restrictChunkIds 传 undefined 时保持既有「全量候选」行为；
        // 传集合时在**候选阶段**就限死范围（缺口 A 的核心修复）。
        const candidates = await storage.listEmbeddingVectors(TARGET_TYPE, opts.restrictChunkIds);
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

  // ---- 融合前按范围过滤 FTS 路（scope 已下推，但显式限制保证两路口径一致）----
  const allow = opts.restrictChunkIds ? new Set(opts.restrictChunkIds) : undefined;
  const inRange = (id: string) => !allow || allow.has(id);

  const fused = fuseRankings([ftsIds.filter(inRange), vecIds], { limit });
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
