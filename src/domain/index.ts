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
 *
 * V2（章节化学习）新增核心对象：
 * 6. Chapter —— 资料切分出的章节（文档 → 章 → 概念 的中间层），
 *    学习 / 出卷 / 掌握度 / 计划的主单位。
 *
 * RAG 五层存储（§4.3）：
 * 7. Section —— Chapter 下的逻辑分段（可选三层结构）
 * 8. Chunk —— 向量化与全文检索的基础单位
 * 9. Embedding —— 向量化元数据
 */

export * from "./document";
export * from "./knowledge";
export * from "./learner";
export * from "./goal";
export * from "./assessment";
export * from "./plan";
export * from "./chapter";
export * from "./quiz";
export * from "./evidence";
export * from "./section";
export * from "./chunk";
export * from "./embedding";

/** 确定性的、无依赖的 id 生成器（契合 local-first 理念）。 */
export function newId(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${rand}`;
}
