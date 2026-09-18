/**
 * i18n → 服务层「文本契约」的映射（F9）。
 *
 * 为什么要单独一个模块：`memory-service.ts` / `memory-facts.ts` 需要两组文本，
 * 而这两组文本的**消费点有三处**（页面整理、AI 弹窗落库、通道 A 派生）。若在每处
 * 各自从 `m.memory.*` 拼装：
 * ① 同一份骨架会在三处各拼一遍（改一处忘两处 → 写进用户文档的节标题不一致）；
 * ② 派生文案（`MemoryFactTexts`）的拼装口径会漂移。
 *
 * ⚠️ 本模块只做**纯映射**（`Messages` → 契约对象），不碰 storage、不碰 React 状态。
 */
import type { MemoryDocScaffold, MemoryCategory } from "../../domain";
import type { Messages } from "../../i18n/types";
import type { MemoryFactTexts } from "./memory-facts";

/** 「会写进用户 markdown 文档」的骨架文案。 */
export function scaffoldOf(m: Messages): MemoryDocScaffold {
  const headings = {} as Record<MemoryCategory, string>;
  for (const [key, value] of Object.entries(m.memory.headings)) {
    headings[key as MemoryCategory] = value;
  }
  return {
    title: m.memory.title,
    intro: m.memory.intro,
    manualHeading: m.memory.manualHeading,
    headings,
  };
}

/**
 * 「最后整理：」前缀（合并器会在其后紧跟 `YYYY-MM-DD HH:mm`）。
 *
 * ⚠️ **必须 `trim()` 且不加尾随空格**：`lastMerged(v)` 是给 UI 看的模板
 * （`最后整理：今天 09:12`），而合并器拼的是 `> ${prefix}${时间戳}`。
 * 若在这里补一个空格，写出来的行会成为「最后整理： 2026-09-17 09:12」——
 * 与自动整理路径（本函数）产出的行**不一致**，用户改动过一次就会看到两种空格数。
 * 三个消费点（页面整理 / AI 弹窗落库 / 测试的黄金串）只认这一个函数。
 */
export function lastMergedPrefixOf(m: Messages): string {
  return m.memory.lastMerged("").trim();
}

/** 通道 A 的句子模板（这些句子同样会落进用户文档）。 */
export function factTextsOf(m: Messages): MemoryFactTexts {  return {
    cadenceWindow: (window, minutes) => m.memory.factCadenceWindow(window, minutes),
    cadenceWindowOnly: (window) => m.memory.factCadenceWindowOnly(window),
    reviewOnTime: () => m.memory.factReviewOnTime,
    reviewLate: (latency) => m.memory.factReviewLate(latency),
    reviewOverdue: () => m.memory.factReviewOverdue,
    latency: (ms) => {
      if (ms < 60_000) return m.memory.latencyMinutes(1);
      if (ms < 3_600_000) return m.memory.latencyMinutes(Math.round(ms / 60_000));
      if (ms < 86_400_000) return m.memory.latencyHours(Math.round(ms / 3_600_000));
      return m.memory.latencyDays(Math.round(ms / 86_400_000));
    },
    studyModeQuiz: (b) => m.memory.factStudyModeQuiz(b),
    studyModeReview: (b) => m.memory.factStudyModeReview(b),
    studyModeCard: (b) => m.memory.factStudyModeCard(b),
    studyModeRestatement: (b) => m.memory.factStudyModeRestatement(b),
    studyModeCapability: (b) => m.memory.factStudyModeCapability(b),
    kindLabel: {
      assessment: m.memory.kindAssessment,
      review: m.memory.kindReview,
      card: m.memory.kindCard,
      restatement: m.memory.kindRestatement,
      capability: m.memory.kindCapability,
    },
    outputCoverage: (pct) => m.memory.factOutputCoverage(pct),
    outputDensity: (per) => m.memory.factOutputDensity(per),
    outputNoteRatio: (pct) => m.memory.factOutputNoteRatio(pct),
  };
}
