/**
 * 特征层共享的展示映射 —— 供 Home / Study / Assessment / Career 复用。
 *
 * i18n 收敛（docs/i18n-design-2026-09.md §5）：
 * - 枚举 UI 标签（kind / action / goalType / importance）已迁入字典 `m.units.*`，
 *   新页面直接读 `m.units.kind[kind]`；actionKindLabel 等遗留函数待
 *   PlanPage / QuizReportPage 迁移后一并删除；
 * - 本文件保留「数据性」工具：单元标题回退（unitTitle）与达标阈值。
 */
import type { ActionKind } from "../domain";
import { MASTERY_THRESHOLD } from "../domain";

const ACTION_LABELS: Record<ActionKind, string> = {
  learn: "学习",
  review: "复习",
  practice: "练习",
  remediation: "补救",
  assessment: "测评",
  explore: "探索",
  "learn-chapter": "学本章",
  "chapter-quiz": "测本章",
  "retake-quiz": "补考",
  "review-points": "复习要点",
};

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

/** 知识单元中文名（回退到原始 id）—— 数据性回退，不随界面语言切换。 */
export function unitTitle(unitId: string): string {
  return UNIT_TITLES[unitId] ?? unitId;
}

/**
 * 就绪度达标阈值。特征层共享：Home 目标梯度 / 职业页都以此为刻度。
 * 与领域引擎（planner / mastery-engine / quiz 判分）同源 ——
 * 统一引用 domain 常量，避免重复（business-logic-review P1-阈值重复已收敛）。
 */
export const GOAL_TARGET = MASTERY_THRESHOLD;

/**
 * @deprecated 枚举标签已迁入字典 `m.units.action[kind]`。
 * 遗留待删：PlanPage / QuizReportPage / ReviewSession 迁移完成后移除。
 */
export function actionKindLabel(kind: ActionKind): string {
  return ACTION_LABELS[kind] ?? kind;
}
