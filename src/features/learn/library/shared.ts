/**
 * 资料库共享小工具（列表页卡片 / 详情页页头共用）。
 * 遵循 engineering-code-style：纯函数 + i18n 字典，不硬编码文案。
 */
import type { Chapter, DocumentFormat, LearnerState } from "../../../domain";
import { isDueReview, sortChaptersByOrder } from "../../../domain";
import { MASTERY_THRESHOLD } from "../../../domain";
import type { Messages } from "../../../i18n";

/** 格式徽标文案（DocumentFormat → 字典，缺失回退）。 */
export function formatLabel(format: DocumentFormat, m: Messages): string {
  const table = m.learn.format as unknown as Record<string, string>;
  return table[format] ?? table.fallback ?? format;
}

/**
 * 「继续学习」的目标章：按 order 取**第一个未达标**的章。
 *
 * 全部达标时返回第一章（当作复习入口，由调用方决定文案）。
 * 无章返回 `undefined`。纯函数，阈值复用 `MASTERY_THRESHOLD`（与达标线同源）。
 */
export function nextStudyChapter(
  chapters: Chapter[],
  learner?: LearnerState | null,
): Chapter | undefined {
  const ordered = sortChaptersByOrder(chapters);
  if (ordered.length === 0) return undefined;
  return (
    ordered.find(
      (c) => (learner?.byUnit[c.id]?.mastery ?? 0) < MASTERY_THRESHOLD,
    ) ?? ordered[0]
  );
}

/** 该资料是否已全部达标（供「继续学习 / 去复习」文案切换）。 */
export function isDocMastered(
  chapters: Chapter[],
  learner?: LearnerState | null,
): boolean {
  if (chapters.length === 0) return false;
  return chapters.every(
    (c) => (learner?.byUnit[c.id]?.mastery ?? 0) >= MASTERY_THRESHOLD,
  );
}

/** 短日期（随界面语言）：9/8 或 Sep 8。 */
export function shortDate(at: number, lang: "zh" | "en"): string {
  const locale = lang === "zh" ? "zh-CN" : "en-US";
  return new Intl.DateTimeFormat(locale, {
    month: lang === "zh" ? "numeric" : "short",
    day: "numeric",
  }).format(new Date(at));
}

/** 资料卡状态点语义（只描述状态，色值由 UI 层 token 决定）。 */
export type DocStatus = "unsplit" | "reviewDue" | "mastered" | "learning";

/**
 * 卡片状态（列表页状态点用）：未切分 → 到期待复习 → 已达标 → 进行中。
 *
 * 优先级说明：**到期待复习优先于已达标**——已达标的章若 `nextReviewAt` 已过期，
 * 卡面应提示「该复习了」（防遗忘），而不是显示一切正常。
 * 数据全部来自 chapters + learner，纯函数，无副作用。
 */
export function docStatus(
  chapters: Chapter[],
  learner?: LearnerState | null,
  now: number = Date.now(),
): DocStatus {
  if (chapters.length === 0) return "unsplit";
  if (chapters.some((c) => isDueReview(learner?.byUnit[c.id], now))) return "reviewDue";
  if (isDocMastered(chapters, learner)) return "mastered";
  return "learning";
}

/**
 * 最近一次已排期的复习时间（各章 `nextReviewAt` 最小值）。
 *
 * 语义：这张卡「下一次该复习」的时刻（可能已过期）。无排期（要点自评 / 出卷
 * 都还没写过）返回 `undefined`，卡面不显示复习徽标——诚实降级，不编造日期。
 */
export function nextReviewOf(
  chapters: Chapter[],
  learner?: LearnerState | null,
): number | undefined {
  let min: number | undefined;
  for (const c of chapters) {
    const at = learner?.byUnit[c.id]?.nextReviewAt;
    if (at === undefined) continue;
    if (min === undefined || at < min) min = at;
  }
  return min;
}
