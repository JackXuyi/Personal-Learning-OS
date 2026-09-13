/**
 * 分析服务（analyze-service）—— 资料库的 AI 分析编排（纯 AI，可重跑）。
 *
 * 职责边界（docs/library-module-design-2026-09.md §2.1 硬契约）：
 * - 分析恒由 AI 执行：直接消费「抛错版」管道（refineChaptersWithAi /
 *   extractChapterConceptsWithAi），失败向上抛，绝不静默回退成代码结果；
 * - AI 未配置 → 抛 not-configured（UI 禁用按钮 + 提示，不做降级）；
 * - 本模块绝不 import splitter-engine 的切分函数（只用 applyChapterRefine
 *   把分析建议写回章节；切分与分析互不调用）；
 * - 分析只写 title / keyPoints / unitIds / doc.analysis，从不改 chapter.id
 *   与 contentRef → learnerState 与试卷范围在分析前后完全稳定，可安全重跑；
 * - ③ 要点分析额外写 `Chapter.keyPointRefs`（要点 ↔ 原文引用）与概念
 *   `KnowledgeUnit.evidence`；两者都只写**由代码定位**的字符区间。
 * - ④ 概览（整篇级）：AI 读正文出导读，写 `doc.overview`；**不依赖切分**
 *   （无章节时按段落分块），因此不像 ①②③ 那样要求已切分。
 */
import type { Chapter, DocumentOverview, SourceDocument } from "../../domain";
import type { StorageAdapter } from "../../storage";
import type { AIProvider } from "../../ai";
import {
  refineChaptersBatched,
  extractKeyPointsMapped,
  extractConceptsMapped,
} from "../../ai/pipelines";
import type { OverviewProgress } from "../../ai/overview-pipeline";
import { summarizeDocumentWithAi } from "../../ai/overview-pipeline";
import { applyChapterRefine } from "../../engine/splitter-engine";
import { replaceChapterConcepts } from "../../engine/graph-engine";
import { anchorToDocument } from "./evidence-anchor";
import { aiErrPreview, aiLog } from "../../ai/log";

export type AnalyzeErrorKind =
  | "not-configured"
  | "no-body"
  | "no-chapters"
  | "failed";

export class AnalyzeServiceError extends Error {
  constructor(
    readonly kind: AnalyzeErrorKind,
    message: string,
  ) {
    super(message);
  }
}

/** ① 章节分析：重写标题、提炼要点、合并过碎小节（不改章 id 与区间）。 */
export interface AnalyzeChaptersResult {
  chapters: Chapter[];
  /** 标题或要点发生变化的章数。 */
  changed: number;
  /** AI 判定并合并的过碎小节数。 */
  merged: number;
  /** 精修批次数（>1 表示长资料走了分批）。 */
  batches: number;
  /** 失败的批数（>0 时这些章的标题/要点保持原样，未精修）。 */
  failedBatches: number;
  analyzedAt: number;
}

/** ② 概念分析：逐章抽取知识概念与关系，写入全局图谱。 */
export interface AnalyzeConceptsResult {
  ok: number;
  failed: { chapterId: string; title: string; reason: string }[];
  units: number;
  relations: number;
  /** 因单块失败而跳过的块数（>0 时该章概念可能不完整）。 */
  skippedBlocks: number;
  /** AI 归并失败、回退代码级合并的章数（D6）。 */
  mergeFallbacks: number;
  analyzedAt: number;
}

export interface AnalyzeChaptersOptions {
  storage: StorageAdapter;
  provider: AIProvider;
  /** 分析所用模型标识（仅展示用；由调用方从设置层读出）。 */
  model?: string;
  now?: number;
}

export interface AnalyzeConceptsOptions {
  storage: StorageAdapter;
  provider: AIProvider;
  model?: string;
  /** true = 只补未提炼的章；false（默认）= 全部重新分析（覆盖旧概念）。 */
  onlyMissing?: boolean;
  /**
   * 进度回调。第 4 参数为**块级进度**（长章分块时才有值；短章不传，
   * 与改造前的 `(i, total, chapter)` 调用方式完全兼容）。
   */
  onProgress?: (
    i: number,
    total: number,
    chapter: Chapter,
    block?: { block: number; blocks: number },
  ) => void;
  now?: number;
}

/** ③ 要点分析：逐章抽取要点 + 原文摘录，锚定后写入 Chapter.keyPointRefs。 */
export interface AnalyzeKeyPointsResult {
  ok: number;
  failed: { chapterId: string; title: string; reason: string }[];
  /** 成功锚定并写回的引用条数。 */
  refs: number;
  /** quote 未能在原文定位、因而被丢弃的条数（要点本身不写入）。 */
  unanchored: number;
  /** 因单块失败而跳过的块数（>0 时该章要点可能不完整）。 */
  skippedBlocks: number;
  /** AI 归并失败、回退代码级合并的章数（D6）。 */
  mergeFallbacks: number;
  analyzedAt: number;
}

export interface AnalyzeKeyPointsOptions {
  storage: StorageAdapter;
  provider: AIProvider;
  model?: string;
  /** 进度回调；第 4 参数为块级进度（同概念分析）。 */
  onProgress?: (
    i: number,
    total: number,
    chapter: Chapter,
    block?: { block: number; blocks: number },
  ) => void;
  now?: number;
}

/** ① 章节分析执行序：校验 → 抛错版管道 → applyChapterRefine → 一次性写库。 */
export async function analyzeChaptersNow(
  doc: SourceDocument,
  chapters: readonly Chapter[],
  opts: AnalyzeChaptersOptions,
): Promise<AnalyzeChaptersResult> {
  const { storage, provider, model, now = Date.now() } = opts;
  if (!provider.isConfigured()) {
    throw new AnalyzeServiceError("not-configured", "AI 未配置。");
  }
  if (chapters.length === 0) {
    throw new AnalyzeServiceError("no-chapters", "还没有章节，先切分。");
  }
  const text = doc.textPreview ?? "";
  if (text.trim().length === 0) {
    throw new AnalyzeServiceError("no-body", "这份资料没有正文。");
  }

  const startedAt = Date.now();
  // 分批精修：长资料不再因「整篇 >6 万字 / >24 章」被静默跳过；单批失败只丢该批
  // （failedBatches），其余批照常生效。全部批失败 → refines 为空 → changed = 0，
  // 由 UI 给出「无建议」提示（替代改造前的静默）。
  const { refines, batches, failedBatches } = await refineChaptersBatched(provider, chapters, text);
  const next = applyChapterRefine([...chapters], refines);

  const merged = Math.max(0, chapters.length - next.length);
  const changed = next.filter((c, i) => {
    const prev = chapters[i];
    return (
      !prev ||
      c.title !== prev.title ||
      c.keyPoints.join("\u0001") !== prev.keyPoints.join("\u0001")
    );
  }).length;

  await storage.saveChapters(doc.id, next);
  await storage.saveDocument({
    ...doc,
    analysis: { ...doc.analysis, ...(model ? { model } : {}), chaptersAt: now },
  });
  aiLog("info", "analyze", "章节分析完成", {
    doc: doc.id,
    chapters: next.length,
    changed,
    merged,
    batches,
    failedBatches,
    ms: Date.now() - startedAt,
  });
  return { chapters: next, changed, merged, batches, failedBatches, analyzedAt: now };
}

/** ② 概念分析执行序：逐章串行、单章失败不阻断；全部完成后一次性写库。 */
export async function analyzeConceptsNow(
  doc: SourceDocument,
  chapters: readonly Chapter[],
  opts: AnalyzeConceptsOptions,
): Promise<AnalyzeConceptsResult> {
  const { storage, provider, model, onlyMissing = false, onProgress, now = Date.now() } = opts;
  if (!provider.isConfigured()) {
    throw new AnalyzeServiceError("not-configured", "AI 未配置。");
  }

  const targets = onlyMissing
    ? chapters.filter((c) => c.unitIds.length === 0)
    : chapters;
  const text = doc.textPreview ?? "";
  let graph = await storage.getGraph();
  const startedAt = Date.now();
  const failed: AnalyzeConceptsResult["failed"] = [];
  const touched = new Map<string, Chapter>(); // chapterId → 更新 unitIds 后的章
  let units = 0;
  let relations = 0;
  let skippedBlocks = 0;
  let mergeFallbacks = 0;

  for (let i = 0; i < targets.length; i++) {
    const c = targets[i];
    onProgress?.(i + 1, targets.length, c);
    try {
      const body = text.slice(c.contentRef.start, c.contentRef.end);
      // 章内 map-reduce：长章自动分块，不再因单章超长抛错。
      // 原文锚定：锚定回调由本层注入（`ai/` 不得依赖 `features/`），产出的
      // evidence 已是文档绝对区间；锚不上的条目不携带 evidence（概念照常入库，
      // 诚实降级，不伪造出处）。
      const out = await extractConceptsMapped(provider, {
        chapterTitle: c.title,
        text: body,
        documentId: doc.id,
        anchor: (quote) => anchorToDocument(body, quote, c.contentRef.start),
        onBlock: (k, K) =>
          onProgress?.(i + 1, targets.length, c, K > 1 ? { block: k, blocks: K } : undefined),
      });
      graph = replaceChapterConcepts(graph, c.unitIds, {
        units: out.units,
        relations: out.relations,
      });
      touched.set(c.id, { ...c, unitIds: out.units.map((u) => u.id) });
      units += out.units.length;
      relations += out.relations.length;
      skippedBlocks += out.skippedBlocks;
      if (out.mergeFallback) mergeFallbacks++;
    } catch (err) {
      // 排查日志：每章失败都可见（UI 只显示汇总，控制台保留逐章原因）。
      aiLog("warn", "analyze", "章概念分析失败", {
        doc: doc.id,
        chapter: c.title,
        reason: aiErrPreview(err),
      });
      failed.push({
        chapterId: c.id,
        title: c.title,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 一次性写库：图 + 章（unitIds）+ 资料分析时间。
  await storage.saveGraph(graph);
  await storage.saveChapters(doc.id, chapters.map((c) => touched.get(c.id) ?? c));
  await storage.saveDocument({
    ...doc,
    analysis: { ...doc.analysis, ...(model ? { model } : {}), conceptsAt: now },
  });
  aiLog("info", "analyze", "概念分析完成", {
    doc: doc.id,
    ok: targets.length - failed.length,
    failed: failed.length,
    units,
    relations,
    skippedBlocks,
    mergeFallbacks,
    ms: Date.now() - startedAt,
  });
  return {
    ok: targets.length - failed.length,
    failed,
    units,
    relations,
    skippedBlocks,
    mergeFallbacks,
    analyzedAt: now,
  };
}

/**
 * ③ 要点分析执行序：逐章（串行、单章失败不阻断）抽取「要点 + 原文摘录」，
 * 用 `anchorToDocument` 把摘录锚定成文档绝对区间，最后一次性写库。
 *
 * 与概念分析的两点差异：
 * - 要点**必须**带原文出处，`parseKeyPointDrafts` 已把无 quote 的条目过滤掉；
 * - 锚定失败的条目直接丢弃（只计数，不算失败）——宁可少一条要点，也不给一条
 *   跳过去找不到原文的「引用」（P0-3 不伪造内容）。
 *
 * 单一真源：`keyPoints` 与 `keyPointRefs[].point` 同步写入。但当某章
 * **一条都没锚上**时保留原有 `keyPoints`，避免把代码切分产出的要点抹成空。
 */
export async function analyzeKeyPointsNow(
  doc: SourceDocument,
  chapters: readonly Chapter[],
  opts: AnalyzeKeyPointsOptions,
): Promise<AnalyzeKeyPointsResult> {
  const { storage, provider, model, onProgress, now = Date.now() } = opts;
  if (!provider.isConfigured()) {
    throw new AnalyzeServiceError("not-configured", "AI 未配置。");
  }
  if (chapters.length === 0) {
    throw new AnalyzeServiceError("no-chapters", "还没有章节，先切分。");
  }
  const text = doc.textPreview ?? "";
  if (text.trim().length === 0) {
    throw new AnalyzeServiceError("no-body", "这份资料没有正文。");
  }

  const failed: AnalyzeKeyPointsResult["failed"] = [];
  const touched = new Map<string, Chapter>();
  const startedAt = Date.now();
  let refs = 0;
  let unanchored = 0;
  let skippedBlocks = 0;
  let mergeFallbacks = 0;

  for (let i = 0; i < chapters.length; i++) {
    const c = chapters[i];
    onProgress?.(i + 1, chapters.length, c);
    try {
      const body = text.slice(c.contentRef.start, c.contentRef.end);
      // 章内 map-reduce：长章自动分块 → 逐块提炼 → 引用式归并。
      // refs 的 quote/start/end 全部由代码侧候选产出（AI 只挑条目与措辞）。
      const out = await extractKeyPointsMapped(provider, {
        chapterTitle: c.title,
        text: body,
        // 锚定回调：纯 AI 层不依赖 features，由本层注入（闭包持有章的绝对偏移）。
        anchor: (quote) => anchorToDocument(body, quote, c.contentRef.start),
        onBlock: (k, K) =>
          onProgress?.(i + 1, chapters.length, c, K > 1 ? { block: k, blocks: K } : undefined),
      });

      touched.set(c.id, {
        ...c,
        keyPointRefs: out.refs,
        // 全军覆没时保留原要点，不把已有数据抹空。
        ...(out.refs.length > 0 ? { keyPoints: out.refs.map((r) => r.point) } : {}),
      });
      refs += out.refs.length;
      unanchored += out.unanchored;
      skippedBlocks += out.skippedBlocks;
      if (out.mergeFallback) mergeFallbacks++;
    } catch (err) {
      // 排查日志：每章失败都可见（UI 只显示汇总，控制台保留逐章原因）。
      aiLog("warn", "analyze", "章要点分析失败", {
        doc: doc.id,
        chapter: c.title,
        reason: aiErrPreview(err),
      });
      failed.push({
        chapterId: c.id,
        title: c.title,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await storage.saveChapters(doc.id, chapters.map((c) => touched.get(c.id) ?? c));
  await storage.saveDocument({
    ...doc,
    analysis: { ...doc.analysis, ...(model ? { model } : {}), keyPointsAt: now },
  });
  aiLog("info", "analyze", "要点分析完成", {
    doc: doc.id,
    ok: chapters.length - failed.length,
    failed: failed.length,
    refs,
    unanchored,
    skippedBlocks,
    mergeFallbacks,
    ms: Date.now() - startedAt,
  });
  return {
    ok: chapters.length - failed.length,
    failed,
    refs,
    unanchored,
    skippedBlocks,
    mergeFallbacks,
    analyzedAt: now,
  };
}

/* ------------------------------------------------------------------ */
/* ④ 概览（整篇级 AI 总结 → doc.overview）                             */
/* ------------------------------------------------------------------ */

export interface GenerateOverviewOptions {
  storage: StorageAdapter;
  provider: AIProvider;
  /** 分析所用模型标识（仅展示用）。 */
  model?: string;
  onProgress?: OverviewProgress;
  now?: number;
}

export interface GenerateOverviewResult {
  overview: DocumentOverview;
  /** map 阶段跳过（AI 失败）的块数；> 0 时 UI 需告知覆盖范围。 */
  skipped: number;
}

/**
 * 概览生成执行序：校验 → 管道 → 组装 `DocumentOverview` → 写库。
 *
 * 与另三条分析的关键差异：**不校验「有没有章节」**。概览只依赖正文，
 * 未切分的资料同样能出概览（无章时按段落分块）—— 因此这里**不抛 no-chapters**。
 *
 * 单一真源：时间戳只写 `overview.generatedAt`，不另写 `analysis.overviewAt`。
 * 写入是**整体覆盖**：`saveDocument({ ...doc, overview })` 只在成功后执行，
 * 因此失败时旧概览原样保留（不破坏已有数据）。
 */
export async function generateOverviewNow(
  doc: SourceDocument,
  chapters: readonly Chapter[],
  opts: GenerateOverviewOptions,
): Promise<GenerateOverviewResult> {
  const { storage, provider, model, onProgress, now = Date.now() } = opts;
  if (!provider.isConfigured()) {
    throw new AnalyzeServiceError("not-configured", "AI 未配置。");
  }
  const text = doc.textPreview ?? "";
  if (text.trim().length === 0) {
    throw new AnalyzeServiceError("no-body", "这份资料没有正文。");
  }

  const startedAt = Date.now();
  // 直接消费「抛错版」管道：长度超限 / 解析不合规都由它抛类型化错误。
  const { draft, mode, chunks, skipped } = await summarizeDocumentWithAi(provider, {
    title: doc.title,
    text,
    chapters,
    ...(onProgress ? { onProgress } : {}),
  });

  const overview: DocumentOverview = {
    ...draft,
    generatedAt: now,
    sourceChars: text.length,
    mode,
    ...(mode === "map-reduce" ? { chunks } : {}),
    ...(model ? { model } : {}),
  };
  await storage.saveDocument({ ...doc, overview });
  aiLog("info", "analyze", "概览生成完成", {
    doc: doc.id,
    mode,
    skipped,
    chunks,
    ms: Date.now() - startedAt,
  });
  return { overview, skipped };
}
