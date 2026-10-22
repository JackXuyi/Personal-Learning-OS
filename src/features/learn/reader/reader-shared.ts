/**
 * 阅读页跨栏共用的派生（三栏 + 容器都要用，改一处漏两处的代价是
 * 「译文指纹对不上 / 卡片计数按未过滤的脏要点算 / 划线锚错位」）。
 *
 * 收在这里的三件事，以前各自在页面里抄了不止一遍：
 * - `bodyOf` —— 章正文切片（译文指纹、划线定位、卡片统计的共同入参）；
 * - `usefulKeyPointsOf` —— 要点质量门（与生成侧 `cleanKeyPoints` 同一判据）；
 * - `contextOf` —— 划线在**源串**中的左侧上下文（定位消歧的唯一依据）。
 */
import { isUsefulKeyPoint } from "../../../lib/text-quality";
import type { Annotation, Chapter, SourceDocument } from "../../../domain";

/** 章正文（文档快照的章内切片）。缺快照 → 空串（无内容是合法状态，不是错误）。 */
export function bodyOf(doc: SourceDocument, chapter: Chapter): string {
  return doc.textPreview?.slice(chapter.contentRef.start, chapter.contentRef.end) ?? "";
}

/**
 * 过质量门的要点 —— 存量脏要点（PDF 抽取把编号标题糊进正文 → 断句切出碎片
 * `"4."`）不再渲染成只有编号的知识芯片，也不再用作导语。
 */
export function usefulKeyPointsOf(chapter: Chapter): string[] {
  return chapter.keyPoints.filter(isUsefulKeyPoint);
}

/** Why it matters 导语：要点首条优先；无要点时回退正文首句（去标题行）截断。 */
export function leadOf(keyPoints: readonly string[], body: string): string | undefined {
  if (keyPoints.length > 0) return keyPoints[0];
  const first = body
    .split("\n")
    .map((s) => s.trim())
    .find((s) => s && !/^#{1,6}\s/.test(s));
  if (!first) return undefined;
  return first.length > 96 ? `${first.slice(0, 96)}…` : first;
}

/**
 * 某条划线在**源串**中的左侧上下文（供定位消歧用）。
 *
 * `Annotation.start` 是**文档绝对偏移**，先换算成章内相对再取前 60 字
 * （与 `highlightSourceRange` 内部的 `CONTEXT_CHARS` 同量级）。
 */
export function contextOf(doc: SourceDocument, chapter: Chapter, a: Annotation): string {
  const local = a.start - chapter.contentRef.start;
  return bodyOf(doc, chapter).slice(Math.max(0, local - 60), local);
}
