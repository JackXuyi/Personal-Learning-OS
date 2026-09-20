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
import type { MergeStats } from "./memory-doc-merge";

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
export function factTextsOf(m: Messages): MemoryFactTexts {
  return {
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

/**
 * 页头动作报告的各行文案（0–3 行）—— **只列真正发生过的动作**。
 *
 * 为什么收在这里（而不是写在 `MemoryPage` 里拼）：它是 i18n 文本的**选取规则**，
 * 与 `scaffoldOf` / `factTextsOf` 同类；放在页面里就只能靠肉眼看，而 strip-types
 * 跑不了 `.tsx`。
 *
 * 三条判据：
 * 1. `updated + added + keptMine` 全零 → **不显示主句**（「更新 0 条 · 新增 0 条」是噪声）；
 * 2. `dismissedNow`（用户删掉的、不再写回）与 `trimmed`（文档满额淘汰最旧系统行）
 *    与「更新 / 新增」不是同一类动作，用户对它们的关心程度也不同 → **各自成句**；
 * 3. 全零时显示 `reportNone` 而**不是**静默：用户重进页面需要知道系统确实跑过了
 *    （一张永远沉默的页头更让人困惑）。
 *
 * `stats === undefined`（本轮还没跑完）→ `[]`，调用侧什么都不渲染。
 */
export function reportLinesOf(stats: MergeStats | undefined, m: Messages): string[] {
  if (!stats) return [];
  const { updated, added, keptMine, dismissedNow, trimmed } = stats;
  const lines: string[] = [];
  if (updated + added + keptMine > 0) lines.push(m.memory.report(updated, added, keptMine));
  if (dismissedNow > 0) lines.push(m.memory.reportDismissedNow(dismissedNow));
  if (trimmed > 0) lines.push(m.memory.reportTrimmed(trimmed));
  return lines.length > 0 ? lines : [m.memory.reportNone];
}
