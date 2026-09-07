/**
 * 学习闭环 —— 验证「闭环」可运行的编排 demo：
 *
 *   Document → Knowledge → Graph → Assess → Mastery → Next Action
 *
 * `buildRagDemoDataset()` 镜像 README 的职业案例（AI 应用工程师），让脚手架
 * 在没有任何导入文档或 AI Provider 的情况下端到端演示整个闭环。
 */
import type {
  CognitiveLevel,
  KnowledgeGraph,
  LearnerState,
  LearningGoal,
  NextAction,
  SourceDocument,
  UnitMastery,
} from "../domain";
import { MASTERY_THRESHOLD, RAG_UNIT_IDS } from "../domain";
import type { StorageAdapter } from "../storage";
import { createLearningPlanner } from "./learning-planner";
import { createRecommendationEngine } from "./recommendation-engine";

const MS_PER_DAY = 86_400_000;
const NOW = Date.now();

export interface DemoDataset {
  goal: LearningGoal;
  graph: KnowledgeGraph;
  learnerState: LearnerState;
  documents: SourceDocument[];
}

function demoUnit(mastery: number, cognitiveLevel: CognitiveLevel): UnitMastery {
  const attempts = Math.round(mastery * 20);
  return {
    mastery,
    confidence: Math.round(mastery * 0.9 * 100) / 100,
    attempts,
    correctCount: Math.round(attempts * mastery),
    cognitiveLevel,
    misconceptions: [],
    lastReviewedAt: NOW - Math.round((1 - mastery) * 10 + 2) * MS_PER_DAY,
    lastAssessmentAt: NOW - 3 * MS_PER_DAY,
    applicationAbility: Math.round(mastery * 0.9 * 100) / 100,
    interviewAbility: Math.round(mastery * 0.6 * 100) / 100,
  };
}

export function buildRagDemoDataset(): DemoDataset {
  const unitList: Array<{
    id: string;
    title: string;
    kind: "concept" | "skill";
    tags: string[];
    summary: string;
  }> = [
    { id: "rag", title: "RAG", kind: "concept", tags: [], summary: "检索增强生成（Retrieval-Augmented Generation）流水线。" },
    { id: RAG_UNIT_IDS.retrieval, title: "检索", kind: "concept", tags: [], summary: "从资料库检索相关段落。" },
    { id: RAG_UNIT_IDS.embedding, title: "Embedding", kind: "concept", tags: [], summary: "把文本向量化为 embedding。" },
    { id: RAG_UNIT_IDS.chunking, title: "分块", kind: "concept", tags: [], summary: "把文档切成有意义的块。" },
    { id: RAG_UNIT_IDS.reranking, title: "重排序", kind: "concept", tags: [], summary: "按相关性对检索结果重新排序。" },
    { id: RAG_UNIT_IDS.evaluation, title: "评估", kind: "concept", tags: [], summary: "度量检索质量（召回率 / NDCG…）。" },
    { id: RAG_UNIT_IDS.production, title: "生产部署", kind: "skill", tags: [], summary: "让 RAG 系统可靠上线。" },
    { id: "vector-search", title: "向量检索", kind: "concept", tags: [], summary: "基于 embedding 的相似度搜索。" },
    { id: "agent", title: "智能体", kind: "concept", tags: [], summary: "能够规划并自主行动的 AI 智能体。" },
    { id: "react", title: "React", kind: "skill", tags: ["remediation"], summary: "用于构建界面的 UI 库。" },
    { id: "typescript", title: "TypeScript", kind: "skill", tags: [], summary: "带类型的 JavaScript。" },
    { id: "python", title: "Python", kind: "skill", tags: [], summary: "AI 领域的通用编程语言。" },
  ];
  const graph: KnowledgeGraph = {
    units: unitList.map((u, i) => ({ ...u, createdAt: NOW - (i + 1) * MS_PER_DAY })),
    relations: [
      { id: "rel-1", fromId: RAG_UNIT_IDS.retrieval, toId: "rag", type: "child" },
      { id: "rel-2", fromId: RAG_UNIT_IDS.embedding, toId: "rag", type: "child" },
      { id: "rel-3", fromId: RAG_UNIT_IDS.chunking, toId: "rag", type: "child" },
      { id: "rel-4", fromId: RAG_UNIT_IDS.reranking, toId: "rag", type: "child" },
      { id: "rel-5", fromId: RAG_UNIT_IDS.evaluation, toId: "rag", type: "child" },
      { id: "rel-6", fromId: "vector-search", toId: "rag", type: "related" },
      { id: "rel-7", fromId: RAG_UNIT_IDS.reranking, toId: RAG_UNIT_IDS.evaluation, type: "prerequisite" },
      { id: "rel-8", fromId: "rag", toId: RAG_UNIT_IDS.production, type: "application" },
    ],
  };

  // 掌握度数值直接取自 README 的学习者状态示例。
  const byUnit: Record<string, UnitMastery> = {
    rag: demoUnit(0.72, "understand"),
    [RAG_UNIT_IDS.retrieval]: demoUnit(0.82, "apply"),
    [RAG_UNIT_IDS.embedding]: demoUnit(0.76, "apply"),
    [RAG_UNIT_IDS.chunking]: demoUnit(0.71, "apply"),
    [RAG_UNIT_IDS.reranking]: demoUnit(0.43, "understand"),
    [RAG_UNIT_IDS.evaluation]: demoUnit(0.28, "remember"),
    [RAG_UNIT_IDS.production]: demoUnit(0.36, "remember"),
    "vector-search": demoUnit(0.61, "apply"),
    agent: demoUnit(0.35, "remember"),
    react: demoUnit(0.92, "create"),
    typescript: demoUnit(0.89, "create"),
    python: demoUnit(0.73, "apply"),
  };

  const goal: LearningGoal = {
    id: "goal-ai-app-engineer",
    type: "career",
    title: "AI 应用工程师",
    description: "README 职业案例：用真实目标验证学习闭环。",
    importance: "high",
    requiredUnitIds: [
      RAG_UNIT_IDS.reranking,
      RAG_UNIT_IDS.evaluation,
      "rag",
      "vector-search",
      "react",
      "typescript",
    ],
    createdAt: NOW,
  };

  const documents: SourceDocument[] = [
    {
      id: "doc-rag-notes",
      title: "RAG 学习笔记",
      format: "markdown",
      importedAt: NOW - 40 * MS_PER_DAY,
      status: "ready",
      source: "用户笔记",
    },
  ];

  return { goal, graph, learnerState: { byUnit }, documents };
}

export interface LoopSnapshot {
  goal: LearningGoal;
  actions: NextAction[];
  next: NextAction | undefined;
  /** 就绪度：已掌握单元数 / 所需单元数。 */
  readiness: number;
  /** 图谱中每个单元的掌握度快照（供 UI 徽标使用）。 */
  masteryByUnit: Record<string, number>;
}

/**
 * 空库则播种 demo，再为指定目标跑一遍闭环。这是仪表盘驱动的流水线 ——
 * 随着 MVP 功能落地，把 demo 数据集换成真实存储数据即可。
 */
export async function runLearningLoop(
  storage: StorageAdapter,
  goalId?: string,
): Promise<LoopSnapshot> {
  await seedDemoIfEmpty(storage);

  const goals = await storage.listGoals();
  const goal = goals.find((g) => g.id === goalId) ?? goals[0];
  if (!goal) throw new Error("未找到学习目标。");

  const graph = await storage.getGraph();
  const learnerState = await storage.getLearnerState();

  const actions = createLearningPlanner().buildPlan({ goal, graph, learnerState });
  const next = createRecommendationEngine().recommendNext(actions);

  const mastered = goal.requiredUnitIds.filter(
    (id) => (learnerState.byUnit[id]?.mastery ?? 0) >= MASTERY_THRESHOLD,
  ).length;
  const readiness =
    goal.requiredUnitIds.length === 0 ? 0 : mastered / goal.requiredUnitIds.length;

  const masteryByUnit: Record<string, number> = {};
  for (const unit of graph.units) {
    masteryByUnit[unit.id] = learnerState.byUnit[unit.id]?.mastery ?? 0;
  }

  return { goal, actions, next, readiness, masteryByUnit };
}

export async function seedDemoIfEmpty(storage: StorageAdapter): Promise<void> {
  const existing = await storage.listGoals();
  if (existing.length > 0) return;
  const dataset = buildRagDemoDataset();
  await storage.saveGoal(dataset.goal);
  await storage.saveGraph(dataset.graph);
  await storage.saveLearnerState(dataset.learnerState);
  for (const doc of dataset.documents) await storage.saveDocument(doc);
}
