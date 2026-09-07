/**
 * Learning Loop — the orchestration demo that proves the closed loop:
 *
 *   Document → Knowledge → Graph → Assess → Mastery → Next Action
 *
 * `buildRagDemoDataset()` mirrors the README career example (AI Application
 * Engineer) so the scaffold can demonstrate the loop end-to-end without any
 * imported documents or an AI provider.
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
import { RAG_UNIT_IDS } from "../domain";
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
    { id: "rag", title: "RAG", kind: "concept", tags: [], summary: "Retrieval-Augmented Generation pipeline." },
    { id: RAG_UNIT_IDS.retrieval, title: "Retrieval", kind: "concept", tags: [], summary: "Retrieve relevant passages." },
    { id: RAG_UNIT_IDS.embedding, title: "Embedding", kind: "concept", tags: [], summary: "Vectorize text into embeddings." },
    { id: RAG_UNIT_IDS.chunking, title: "Chunking", kind: "concept", tags: [], summary: "Split documents into meaningful chunks." },
    { id: RAG_UNIT_IDS.reranking, title: "Reranking", kind: "concept", tags: [], summary: "Re-order retrieved candidates by relevance." },
    { id: RAG_UNIT_IDS.evaluation, title: "Evaluation", kind: "concept", tags: [], summary: "Measure retrieval quality (recall / NDCG…)." },
    { id: RAG_UNIT_IDS.production, title: "Production", kind: "skill", tags: [], summary: "Ship RAG systems reliably." },
    { id: "vector-search", title: "Vector Search", kind: "concept", tags: [], summary: "Similarity search over embeddings." },
    { id: "agent", title: "Agent", kind: "concept", tags: [], summary: "AI agents that plan and act." },
    { id: "react", title: "React", kind: "skill", tags: ["remediation"], summary: "UI library for interfaces." },
    { id: "typescript", title: "TypeScript", kind: "skill", tags: [], summary: "Typed JavaScript." },
    { id: "python", title: "Python", kind: "skill", tags: [], summary: "General-purpose language for AI." },
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

  // Mastery values straight from the README learner-state example.
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
    title: "AI Application Engineer",
    description: "README career example: prove the learning loop on a real goal.",
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
      title: "RAG study notes",
      format: "markdown",
      importedAt: NOW - 40 * MS_PER_DAY,
      status: "ready",
      source: "user notes",
    },
  ];

  return { goal, graph, learnerState: { byUnit }, documents };
}

export interface LoopSnapshot {
  goal: LearningGoal;
  actions: NextAction[];
  next: NextAction | undefined;
  /** Readiness: mastered-units / required-units. */
  readiness: number;
  /** Mastery snapshot for every unit in the graph (for UI badges). */
  masteryByUnit: Record<string, number>;
}

/**
 * Seed-if-empty then run the loop for a goal. This is the pipeline the
 * dashboard drives — swap the demo dataset for real storage data as the
 * MVP features land.
 */
export async function runLearningLoop(
  storage: StorageAdapter,
  goalId?: string,
): Promise<LoopSnapshot> {
  await seedDemoIfEmpty(storage);

  const goals = await storage.listGoals();
  const goal = goals.find((g) => g.id === goalId) ?? goals[0];
  if (!goal) throw new Error("No learning goal found.");

  const graph = await storage.getGraph();
  const learnerState = await storage.getLearnerState();

  const actions = createLearningPlanner().buildPlan({ goal, graph, learnerState });
  const next = createRecommendationEngine().recommendNext(actions);

  const mastered = goal.requiredUnitIds.filter(
    (id) => (learnerState.byUnit[id]?.mastery ?? 0) >= 0.8,
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
