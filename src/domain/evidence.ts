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
 * - subjectId 语义 = 章 id（V2 章级主对象）；目标级证据用 `subjectKind:"goal"`
 *   显式区分主体类型（F6），缺省仍是 chapter —— 旧数据零回归；
 *   概念层（N5）证据回归时扩展 kind 即可；
 * - 幂等由写入口负责（如按 sourceId 查重），本类型不承担去重逻辑。
 */

/**
 * 证据动作类型。
 *
 * ⚠️ 这是**跨切面**扩展点：新增 kind 时两处消费点必须同步修正（见
 * features/evidence-label.ts::evidenceActionKey 的说明），否则会被
 * 静默显示成「复习要点」。
 */
export type EvidenceKind = "assessment" | "review" | "restatement" | "card" | "capability";

/**
 * 一次证据行。
 * - assessment：测评判卷完成（delta = 该章掌握度净变化，verdict = pass/fail 达标判定）；
 * - review：复习要点提交（delta = 0，verdict = 自评档 forget/hard/good/easy）；
 * - restatement：费曼式复述的显式「安排复习」（delta = 0，verdict = 覆盖率派生的
 *   SelfRating 键）。复述**不改掌握度** —— mastery 唯一写方仍是卷面（见
 *   docs/learn-feynman-restatement-design-2026-09.md §3.4 G1）；
 * - card：自测卡四档评分（delta = 0，verdict = SelfRating 键，sourceId = DerivedCard.id）。
 *   卡片**不改掌握度** —— 其调度状态（`CardState`）与 `LearnerState` 无通路
 *   （见 docs/learn-flashcard-design-2026-09.md §13 D6）；
 * - capability：目标级能力评测出报告（delta = 0，verdict = "pass"|"fail" 综合达标，
 *   `subjectKind = "goal"`，subjectId = **目标 id**，sourceId = CapabilityReport.id）。
 *   能力评测**不改掌握度** —— mastery 唯一写方仍是卷面（见
 *   docs/goal-capability-assessment-design-2026-09.md §13 D5）。
 */
export interface EvidenceEntry {
  /** 事件发生时间（epoch ms）。 */
  at: number;
  kind: EvidenceKind;
  /**
   * 证据主体 —— 章级为章 id；`subjectKind: "goal"` 时为**目标 id**（F6）。
   */
  subjectId: string;
  /**
   * 主体类型（F6 新增；**缺省 = `"chapter"`**，旧数据零回归）。
   *
   * 为什么需要：`subjectId` 原有语义唯一（章 id），而能力评测的主体是目标 ——
   * 消费点（`HomePage` 证据行）必须据此选标题反查策略，否则会把 goalId 当章 id
   * 解析失败后**显示裸 id**。
   */
  subjectKind?: "chapter" | "goal";
  /** 判定结果：assessment / capability → "pass"|"fail"；review / restatement / card → SelfRating 键。 */
  verdict?: string;
  /** 掌握度净变化（0..1，可负；review / restatement / card / capability 恒 0）。 */
  delta: number;
  /**
   * 幂等去重来源（assessment = 试卷 id；restatement = 复述记录 id；
   * card = DerivedCard.id；capability = CapabilityReport.id；写入口按此查重）。
   */
  sourceId?: string;
}

/** assessment 达标/未达标判定键（卷面 ≥ MASTERY_THRESHOLD 为 pass）。 */
export const EVIDENCE_VERDICT_PASS = "pass";
export const EVIDENCE_VERDICT_FAIL = "fail";
