/**
 * Evidence log（§7.1 薄层，docs/ui-workbench-plan-2026-09.md §7.1）。
 *
 * 记录「学习证据」的一次持久化事件：测评判卷完成 / 复习要点提交。
 * UI 侧（Today Recent Evidence / My Learner / 未来 /evidence 页）统一读这张表，
 * 取代 U1 期「从试卷结果临时组装」的实现。
 *
 * 约束：
 * - 只存结构数据（subjectId/delta/verdict 为枚举或数值），展示文案由 UI 按
 *   当前界面语言映射，不把 i18n 字符串写进存储；
 * - subjectId 语义 = 章 id（V2 章级主对象）；概念层（N5）证据回归时扩展 kind 即可；
 * - 幂等由写入口负责（如按 sourceId 查重），本类型不承担去重逻辑。
 */

/** 证据动作类型。 */
export type EvidenceKind = "assessment" | "review";

/**
 * 一次证据行。
 * - assessment：测评判卷完成（delta = 该章掌握度净变化，verdict = pass/fail 达标判定）；
 * - review：复习要点提交（delta = 0，verdict = 自评档 forget/hard/good/easy）。
 */
export interface EvidenceEntry {
  /** 事件发生时间（epoch ms）。 */
  at: number;
  kind: EvidenceKind;
  /** 证据主体 —— V2 为章 id。 */
  subjectId: string;
  /** 判定结果：assessment → "pass"|"fail"；review → SelfRating 键。 */
  verdict?: string;
  /** 掌握度净变化（0..1，可负；review 恒 0）。 */
  delta: number;
  /** 幂等去重来源（assessment = 试卷 id；写入口按此查重）。 */
  sourceId?: string;
}

/** assessment 达标/未达标判定键（卷面 ≥ MASTERY_THRESHOLD 为 pass）。 */
export const EVIDENCE_VERDICT_PASS = "pass";
export const EVIDENCE_VERDICT_FAIL = "fail";
