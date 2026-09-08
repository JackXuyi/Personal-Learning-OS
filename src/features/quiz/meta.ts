/**
 * /quiz 系列页面共享的展示辅助 —— 卷型元信息、范围可读标签、相对时间。
 *
 * 出卷 UI 三步弹层（范围 → 模式 → 生成）在 NewQuiz 里用这些信息做
 * 模式卡片（题量与时长预览），答题页与试卷中心用于卷卡与范围标签。
 * 文案走 i18n 字典（m.quiz.* / m.chapter.*），m 缺省中文保旧调用兼容。
 */
import type { Chapter, PaperMode, PaperScope, QuizType } from "../../domain";
import { isSubjectiveType, PAPER_MODE_DURATION_MIN } from "../../domain";
import type { PaperQuestion } from "../../domain";
import { zh, type Messages } from "../../i18n";

/** 模式 → 支持的最小章数（向导中决定哪些模式可选）。 */
export const MODE_MIN_CHAPTERS: Record<Exclude<PaperMode, "retake">, number> = {
  "unit-test": 1,
  "stage-test": 2,
  "final-test": 3,
};

/** 模式 → 一行可读说明（配比 + 时长），供模式卡片副标题。 */
export function modeHint(
  mode: PaperMode,
  chapterCount: number,
  m: Messages = zh,
): string {
  const duration = PAPER_MODE_DURATION_MIN[mode];
  switch (mode) {
    case "unit-test":
      return m.quiz.hintUnit(duration);
    case "stage-test":
      return m.quiz.hintStage(chapterCount, duration);
    case "final-test":
      return m.quiz.hintFinal(chapterCount, duration);
    case "retake":
      return m.quiz.hintRetake(duration);
  }
}

/** 模式全称（含补考）。 */
export function modeLabel(mode: PaperMode, m: Messages = zh): string {
  return m.quiz.mode[mode];
}

/** 章序号区间 → 「第 1–3 章」/「第 2 章」。 */
export function orderRange(first: number, last: number, m: Messages = zh): string {
  return first === last ? m.chapter.ordinal(first) : m.chapter.range(first, last);
}

/** 范围可读标签：如「第 1–3 章 · 3 章」。 */
export function scopeLabel(
  scope: PaperScope,
  allChapters: Chapter[],
  m: Messages = zh,
): string {
  const count = scope.chapterIds.length;
  const first = allChapters.find((c) => c.id === scope.chapterIds[0]);
  const last = allChapters.find(
    (c) => c.id === scope.chapterIds[scope.chapterIds.length - 1],
  );
  const range =
    first && last
      ? orderRange(first.order, last.order, m)
      : m.chapter.ordinal(1); // 缺章时仅作占位，随后仍带 count
  return m.quiz.rangeWithCount(range, count);
}

/** 题型 → 短徽标文案（选项/对错/文本）。 */
export function typeBadgeText(type: QuizType, m: Messages = zh): string {
  return m.quiz.typeBadge[type];
}

/** 判断一道题是否「主观需 AI 批改」（前端用于 pending 标识）。 */
export function needsAI(q: PaperQuestion): boolean {
  return isSubjectiveType(q.type);
}

/** 「3 分钟前」样式的相对时间。 */
export function ago(at: number, m: Messages = zh): string {
  const diff = Math.max(0, Date.now() - at);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return m.cmd.time.now;
  if (min < 60) return m.cmd.time.minAgo(min);
  const hour = Math.floor(min / 60);
  if (hour < 24) return m.cmd.time.hourAgo(hour);
  const day = Math.floor(hour / 24);
  return m.cmd.time.dayAgo(day);
}
