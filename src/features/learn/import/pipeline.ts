/**
 * 共享导入管道（save → split → refine → saveChapters）。
 *
 * 从现状 ImportModal.splitAndPreview 抽取，成为「粘贴 / 本地文件 / GitHub」
 * 三类来源共用的执行器：任何来源归一化为 ImportUnit 后调用本模块。
 *
 * 阶段事件（onPhase）对齐现状 U5 五阶段：read → detect → refine → create → link；
 * ImportModal 传 onPhase + minPhaseMs 即可复刻原「每阶段最小可见时长」观感；
 * 单测不传 onPhase，pipeline 不做任何 UI 时序。
 *
 * 行为契约（与改造前一致）：
 * - 内容切不出章节（0 章）→ 仍保存资料，返回空 chapterIds（UI 展示「仅保存」）；
 * - AI 精修仅在传入 provider 且其就绪时发生，失败/未配置静默回退启发式（永不抛错）；
 * - 任何写入失败（如 localStorage 配额）向上抛，由调用方展示错误——不写半成品。
 */
import type { SourceDocument } from "../../../domain";
import { newId } from "../../../domain";
import type { StorageAdapter } from "../../../storage";
import type { AIProvider } from "../../../ai";
import { refineSplitResult } from "../../../ai";
import { splitDocument } from "../../../engine";
import type { ImportUnit, UnitResult, ImportSummary } from "./types";

/** 与 ImportModal 现状 PHASE_ORDER 一致。 */
export type ImportPhaseKey = "read" | "detect" | "refine" | "create" | "link";

export interface PipelineHooks {
  /** 阶段状态事件（UI 渲染五阶段进度）。 */
  onPhase?: (key: ImportPhaseKey, status: "active" | "done") => void;
  /** 每阶段最小可见时长（ms）；默认 0 = 无 UI 时序（测试友好）。 */
  minPhaseMs?: number;
}

export interface RunUnitOptions extends PipelineHooks {
  /** 持久化目标（默认由调用方传入全局 storage；测试注入内存后端）。 */
  storage: StorageAdapter;
  /** AI 精修 provider；不传或未配置 → 启发式切分直出。 */
  provider?: AIProvider;
  /** 切分参数（与现状 ImportModal 一致；测试可覆盖）。 */
  split?: { targetCharsPerChapter?: number; minParagraphsPerChapter?: number };
}

const DEFAULT_SPLIT = { targetCharsPerChapter: 1_600, minParagraphsPerChapter: 3 };

function settle(ms: number): Promise<void> {
  return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
}

/** 单份资料执行完整导入管道。0 章 = 仅保存（不写 chapters）。 */
export async function runUnitImport(unit: ImportUnit, opts: RunUnitOptions): Promise<UnitResult> {
  const { storage, provider } = opts;
  const onPhase = opts.onPhase ?? (() => {});
  const ms = opts.minPhaseMs ?? 0;

  const phase = async <T>(key: ImportPhaseKey, fn: () => Promise<T>): Promise<T> => {
    onPhase(key, "active");
    const out = await fn();
    if (ms > 0) await settle(ms);
    onPhase(key, "done");
    return out;
  };

  const doc: SourceDocument = {
    id: newId("doc"),
    title: unit.title.trim() || "Untitled",
    format: unit.format,
    ...(unit.source ? { source: unit.source } : {}),
    importedAt: Date.now(),
    status: "ready",
    textPreview: unit.text,
  };

  await phase("read", () => storage.saveDocument(doc));

  const heuristic = await phase("detect", async () => {
    const out = splitDocument(
      { documentId: doc.id, text: unit.text, format: unit.splitFormat },
      { ...DEFAULT_SPLIT, ...opts.split },
    );
    return out.chapters;
  });

  if (heuristic.length === 0) {
    return {
      unit, docId: doc.id, chapterIds: [], chapterTitles: [], totalPoints: 0,
      refined: false, merged: 0,
    };
  }

  // refine 仅在 provider 就绪时尝试（refineSplitResult 内部对失败/未配置静默回退）。
  const out = await phase("refine", () =>
    provider ? refineSplitResult(provider, heuristic, unit.text) : Promise.resolve({ chapters: heuristic, refined: false }),
  );
  const chapters = out.chapters;
  const merged = Math.max(0, heuristic.length - chapters.length);

  await phase("create", () => storage.saveChapters(doc.id, chapters));

  await phase("link", async () => {});

  return {
    unit,
    docId: doc.id,
    chapterIds: chapters.map((c) => c.id),
    chapterTitles: chapters.map((c) => c.title),
    totalPoints: chapters.reduce((n, c) => n + c.keyPoints.length, 0),
    refined: out.refined,
    merged,
  };
}

/** 批量导入：逐份串行执行，单份失败不阻断队列；收集成功与失败明细。 */
export async function runBatchImport(
  units: readonly ImportUnit[],
  opts: RunUnitOptions & {
    /** 每份开始前回调（UI 文件级进度：i/n · title）。 */
    onUnitStart?: (index: number, total: number, unit: ImportUnit) => void;
  },
): Promise<ImportSummary> {
  const summary: ImportSummary = { ok: [], failed: [] };
  for (let i = 0; i < units.length; i += 1) {
    const unit = units[i];
    opts.onUnitStart?.(i + 1, units.length, unit);
    try {
      const result = await runUnitImport(unit, opts);
      summary.ok.push(result);
    } catch (err) {
      summary.failed.push({
        title: unit.title,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return summary;
}
