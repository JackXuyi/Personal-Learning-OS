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
 *   与 contentRef → learnerState 与试卷范围在分析前后完全稳定，可安全重跑。
 */
import type { Chapter, SourceDocument } from "../../domain";
import type { StorageAdapter } from "../../storage";
import type { AIProvider } from "../../ai";
import {
  refineChaptersWithAi,
  extractChapterConceptsWithAi,
} from "../../ai/pipelines";
import { applyChapterRefine } from "../../engine/splitter-engine";
import { replaceChapterConcepts } from "../../engine/graph-engine";

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
  analyzedAt: number;
}

/** ② 概念分析：逐章抽取知识概念与关系，写入全局图谱。 */
export interface AnalyzeConceptsResult {
  ok: number;
  failed: { chapterId: string; title: string; reason: string }[];
  units: number;
  relations: number;
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
  onProgress?: (i: number, total: number, chapter: Chapter) => void;
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

  // 直接消费「抛错版」管道：失败向上抛，绝不静默回退成代码结果（诚实降级）。
  // 尺寸超限时管道返回 []（视作「无建议」），不视为失败。
  const refines = await refineChaptersWithAi(provider, chapters, text);
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
  return { chapters: next, changed, merged, analyzedAt: now };
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
  const failed: AnalyzeConceptsResult["failed"] = [];
  const touched = new Map<string, Chapter>(); // chapterId → 更新 unitIds 后的章
  let units = 0;
  let relations = 0;

  for (let i = 0; i < targets.length; i++) {
    const c = targets[i];
    onProgress?.(i + 1, targets.length, c);
    try {
      const body = text.slice(c.contentRef.start, c.contentRef.end);
      const out = await extractChapterConceptsWithAi(provider, {
        chapterTitle: c.title,
        text: body,
      });
      graph = replaceChapterConcepts(graph, c.unitIds, {
        units: out.units,
        relations: out.relations,
      });
      touched.set(c.id, { ...c, unitIds: out.units.map((u) => u.id) });
      units += out.units.length;
      relations += out.relations.length;
    } catch (err) {
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
  return { ok: targets.length - failed.length, failed, units, relations, analyzedAt: now };
}
