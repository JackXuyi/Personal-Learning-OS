/**
 * 特征层共享的展示映射 —— 供 Home / Study / Assessment / Career 复用，
 * 避免各页各自维护一份中文标签表。
 */
import type { ActionKind, GoalType, KnowledgeKind } from "../domain";

const KIND_LABELS: Record<KnowledgeKind, string> = {
  concept: "概念",
  skill: "技能",
  fact: "事实",
  procedure: "流程",
  principle: "原理",
};

/** 知识单元类型中文标签。 */
export function kindLabel(kind: KnowledgeKind): string {
  return KIND_LABELS[kind] ?? kind;
}

const UNIT_TITLES: Record<string, string> = {
  "rag-retrieval": "检索",
  "rag-embedding": "Embedding",
  "rag-chunking": "分块",
  "rag-reranking": "重排序",
  "rag-evaluation": "评估",
  "rag-production": "生产部署",
  "vector-search": "向量检索",
  agent: "智能体",
  react: "React",
  typescript: "TypeScript",
  python: "Python",
  rag: "RAG",
};

const ACTION_LABELS: Record<ActionKind, string> = {
  learn: "学习",
  review: "复习",
  practice: "练习",
  remediation: "补救",
  assessment: "测评",
  explore: "探索",
};

const GOAL_TYPE_LABELS: Record<GoalType, string> = {
  career: "职业",
  study: "学习",
  exam: "考试",
  personal: "个人",
  research: "研究",
  project: "项目",
};

const IMPORTANCE_LABELS: Record<string, string> = {
  high: "高",
  medium: "中",
  low: "低",
};

/** 知识单元中文名（回退到原始 id）。 */
export function unitTitle(unitId: string): string {
  return UNIT_TITLES[unitId] ?? unitId;
}

/** 动作类型中文标签。 */
export function actionKindLabel(kind: ActionKind): string {
  return ACTION_LABELS[kind] ?? kind;
}

/** 目标类型中文标签。 */
export function goalTypeLabel(type: GoalType): string {
  return GOAL_TYPE_LABELS[type] ?? type;
}

/** 重要性中文标签。 */
export function importanceLabel(importance: string): string {
  return IMPORTANCE_LABELS[importance] ?? importance;
}
