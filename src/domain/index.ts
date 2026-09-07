/**
 * 领域层 —— Personal Learning OS 的五核心对象。
 *
 * 1. SourceDocument —— 用户自己的知识来源。
 * 2. Knowledge（KnowledgeUnit）—— 从文档抽取出的语义单元。
 * 3. KnowledgeGraph —— 知识单元之间如何关联。
 * 4. LearnerState —— 用户此刻真正掌握了什么。
 * 5. LearningGoal —— 整个系统的入口。
 *
 * 以及支撑学习闭环的类型：assessment、evidence、gaps 与 next actions。
 */

export * from "./document";
export * from "./knowledge";
export * from "./learner";
export * from "./goal";
export * from "./assessment";
export * from "./plan";

/** 确定性的、无依赖的 id 生成器（契合 local-first 理念）。 */
export function newId(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${rand}`;
}
