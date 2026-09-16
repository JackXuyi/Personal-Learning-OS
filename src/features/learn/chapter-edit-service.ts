/**
 * 章节编辑服务（chapter-edit-service）—— 人工微调的落库编排（纯代码，零 AI）。
 *
 * 职责边界（与 split-service 对称，docs/chapter-edit-design-2026-09.md §4.3.3）：
 * - 切分管「文档 → 章节」的初次生产，本模块管「章节 → 章节」的人工修正；
 * - 执行序严格对齐 split-service：先算（含掌握度迁移）→ 一次性写库 → 重建 chunk，
 *   任一写失败都不留半成品；
 * - 章节结构变更必然要重建 chunk（rename 改 heading / merge 改 chapterId /
 *   reorder 改 position），不按操作分支做优化——少一个分支就少一类脏数据；
 * - 本模块绝不 import ai/*（向量重算由调用方在成功后异步触发）。
 */
import type { Chapter, SourceDocument } from "../../domain";
import type { StorageAdapter } from "../../storage";
import {
  mergeChapterRange,
  renameChapter,
  reorderChapters,
} from "../../engine/chapter-edit-engine";
import { rebuildChunks } from "./index-chunks";
import { relinkAnnotations } from "./annotation-service";
import { remapMasteryOnChapterEdit } from "./resplit-mastery";

/** 一次人工编辑动作。 */
export type ChapterEdit =
  | { kind: "rename"; chapterId: string; title: string }
  | { kind: "merge"; fromId: string; toId: string }
  | { kind: "reorder"; orderedIds: string[] };

export type ChapterEditErrorKind = "no-chapters" | "chapter-not-found" | "invalid-range";

export class ChapterEditError extends Error {
  readonly kind: ChapterEditErrorKind;
  // 不用 TS 参数属性（constructor(readonly kind)）——那属于 strip-only 模式不支持的
  // 语法糖，会让本模块无法被 `--experimental-strip-types` 直跑的单测导入。
  constructor(kind: ChapterEditErrorKind, message: string) {
    super(message);
    this.name = "ChapterEditError";
    this.kind = kind;
  }
}

export interface ChapterEditOptions {
  storage: StorageAdapter;
  /** 当前章节（**必须按 order 升序**；调用方从文档详情页传入）。 */
  chapters: readonly Chapter[];
  edit: ChapterEdit;
}

export interface ChapterEditResult {
  /** 编辑后的章节（按 order 升序）。 */
  chapters: Chapter[];
  /** 被并吞的章数（非 merge 时为 0）。 */
  absorbed: number;
  /** 掌握度迁移：被写入保留章的键数（0 或 1）/ 被删除的旧键数。 */
  carriedMastery: number;
  droppedMastery: number;
  /** 重建的 chunk 条数（短路未写库时为 0）。 */
  chunks: number;
  /**
   * 【F5 第 2 条】划线批注按 `quote` 重新定位成功的条数。
   *
   * 只有 merge 会改 `contentRef`（rename 改 heading、reorder 改顺序 → 区间不动），
   * 故 rename / reorder 恒为 0；但统一调用一次 `relinkAnnotations` 而不是按操作
   * 分支判断 —— 少一个分支就少一类漏迁移（与「结构已变必重建 chunk」同思路）。
   */
  annotationsRelinked: number;
  /** 划线批注再也定位不到、已删除的条数。 */
  annotationsDropped: number;
}

/**
 * 应用一次章节编辑并落库。
 *
 * 校验失败（无章节 / 章 id 不存在 / 合并区间无效）抛 `ChapterEditError`，
 * **不写入任何数据**；rename 与 reorder 检测到无实际变化时短路返回（零写盘）。
 */
export async function applyChapterEdit(
  doc: Pick<SourceDocument, "id" | "textPreview">,
  opts: ChapterEditOptions,
): Promise<ChapterEditResult> {
  const { storage, chapters, edit } = opts;
  if (chapters.length === 0) throw new ChapterEditError("no-chapters", "还没有章节。");

  let next: Chapter[];
  let merge: { keepId: string; absorbedIds: string[] } | undefined;

  switch (edit.kind) {
    case "rename": {
      if (!chapters.some((c) => c.id === edit.chapterId)) {
        throw new ChapterEditError("chapter-not-found", "章节不存在。");
      }
      next = renameChapter([...chapters], edit.chapterId, edit.title);
      // 值未变（含空串回退原名）→ 不写库。
      if (next.every((c, i) => c.title === chapters[i].title)) {
        return unchanged(chapters);
      }
      break;
    }
    case "merge": {
      const exists = (id: string) => chapters.some((c) => c.id === id);
      if (!exists(edit.fromId) || !exists(edit.toId)) {
        throw new ChapterEditError("chapter-not-found", "章节不存在。");
      }
      const r = mergeChapterRange([...chapters], edit.fromId, edit.toId);
      // 单章（from === to）或区间反向：无被吞章 = 无效合并。
      if (!r.merged || r.absorbedIds.length === 0) {
        throw new ChapterEditError("invalid-range", "合并范围无效。");
      }
      next = r.chapters;
      merge = { keepId: r.merged.id, absorbedIds: r.absorbedIds };
      break;
    }
    case "reorder": {
      next = reorderChapters([...chapters], edit.orderedIds);
      if (next.every((c, i) => c.id === chapters[i].id)) {
        return unchanged(chapters);
      }
      break;
    }
  }

  // 先算迁移，再一次性写库：任一写失败不会留下「章节已改、掌握度未跟」的半成品。
  const learner = await storage.getLearnerState();
  const remapped = remapMasteryOnChapterEdit(learner, merge);

  await storage.saveChapters(doc.id, next);
  if (remapped.carried > 0 || remapped.dropped > 0) {
    await storage.saveLearnerState(remapped.state);
  }

  // 结构已变 → 必须重建 chunk（heading / chapterId / position 三者都可能失效）。
  const { chunks } = await rebuildChunks(doc, next, storage);

  // F5 第 2 条：合并会改写章节区间 → 划线批注按 quote 重定位（命中改写区间 /
  // 未命中删除）。必须在 saveChapters 之后。本调用自身吞掉存储异常，
  // 不会把「批注没跟上」升级成「章节编辑失败」。
  const relink = await relinkAnnotations({ documentId: doc.id, storage });

  return {
    chapters: next,
    absorbed: merge?.absorbedIds.length ?? 0,
    carriedMastery: remapped.carried,
    droppedMastery: remapped.dropped,
    chunks,
    annotationsRelinked: relink.relinked,
    annotationsDropped: relink.dropped,
  };
}

/** 无实际变化时的短路结果（零写盘）。 */
function unchanged(chapters: readonly Chapter[]): ChapterEditResult {
  return {
    chapters: [...chapters],
    absorbed: 0,
    carriedMastery: 0,
    droppedMastery: 0,
    chunks: 0,
    // 无实际变化 → 区间未动 → 无需重定位（也确实零写盘）。
    annotationsRelinked: 0,
    annotationsDropped: 0,
  };
}
