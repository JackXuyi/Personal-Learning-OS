/**
 * 切分服务（split-service）—— 资料库的手动切分编排（纯代码，零 AI）。
 *
 * 职责边界（docs/library-module-design-2026-09.md §2.1 硬契约）：
 * - 切分恒由代码执行（engine/splitter-engine.splitDocument，确定性纯函数）；
 * - 同一正文 + 同一参数结果恒等 → 失败不重试（重试无意义）；
 * - 本模块绝不 import ai/*（类型即约束：SplitRunOptions 无 provider）；
 * - 重新切分时经 resplit-mastery 做掌握度同源迁移（先算后写，不留半成品）。
 */
import type { Chapter, SourceDocument } from "../../domain";
import type { StorageAdapter } from "../../storage";
import { splitDocument } from "../../engine/splitter-engine";
import type { SplitStrategy } from "../../engine/splitter-engine";
import { matchResplit, remapLearnerStateOnResplit } from "./resplit-mastery";

export type SplitMode = "initial" | "resplit";

export class SplitServiceError extends Error {
  constructor(
    readonly kind: "no-body" | "no-chapters",
    message: string,
  ) {
    super(message);
  }
}

export interface SplitRunOptions {
  storage: StorageAdapter;
  /** 切分参数（缺省沿用引擎默认：1600 字符 / 3 段 / 2 级标题）。 */
  split?: {
    targetCharsPerChapter?: number;
    mdHeadingMaxLevel?: number;
    minParagraphsPerChapter?: number;
  };
  /** 注入当前时间便于测试断言。 */
  now?: number;
}

export interface SplitRunResult {
  mode: SplitMode;
  chapters: Chapter[];
  /** headings（标题切分）/ paragraphs（段落聚类）。 */
  strategy: SplitStrategy;
  /** 切分前章数（首次为 0）。 */
  previousChapters: number;
  /** 重新切分时同源继承掌握度的章数。 */
  carriedMastery: number;
  /** 旧章中未能同源、掌握度被丢弃的章数。 */
  droppedMastery: number;
}

/**
 * 首次切分 / 重新切分（同一实现，按旧章数自动判定 mode）。
 * 确定性、无 AI、无重试；失败抛类型化错误且不覆盖旧章。
 */
export async function splitDocumentNow(
  doc: SourceDocument,
  opts: SplitRunOptions,
): Promise<SplitRunResult> {
  const { storage, now = Date.now() } = opts;
  const text = doc.textPreview ?? "";
  if (text.trim().length === 0) {
    throw new SplitServiceError("no-body", "这份资料没有正文。");
  }

  const old = await storage.listChapters(doc.id);
  const heuristic = splitDocument(
    { documentId: doc.id, text, format: "auto", now },
    { ...opts.split },
  );
  if (heuristic.chapters.length === 0) {
    throw new SplitServiceError("no-chapters", "没有切出章节。");
  }
  // 到这里切分已完成，且全程零 AI、零重试 —— 纯函数确定性产出。

  // 先算迁移，再一次性写库（任一写失败不会留下半成品：先章节后掌握度）。
  const matches = matchResplit(old, heuristic.chapters);
  const learner = await storage.getLearnerState();
  const remapped =
    matches.length > 0
      ? remapLearnerStateOnResplit(learner, matches)
      : { state: learner, carried: 0, dropped: 0 };

  await storage.saveChapters(doc.id, heuristic.chapters);
  if (remapped.carried > 0) await storage.saveLearnerState(remapped.state);

  return {
    mode: old.length > 0 ? "resplit" : "initial",
    chapters: heuristic.chapters,
    strategy: heuristic.strategy,
    previousChapters: old.length,
    carriedMastery: remapped.carried,
    droppedMastery: remapped.dropped,
  };
}
