/**
 * In-memory storage — the zero-setup default.
 *
 * Used during development/browser preview and as a base class for the
 * persisted adapters. All methods are async so swapping in the SQLite
 * backend later does not change call sites.
 */
import type {
  KnowledgeGraph,
  LearnerState,
  LearningGoal,
  SourceDocument,
} from "../domain";
import type { StorageAdapter } from "./types";

export class InMemoryStorage implements StorageAdapter {
  readonly name: string = "memory";
  protected documents = new Map<string, SourceDocument>();
  protected graph: KnowledgeGraph = { units: [], relations: [] };
  protected learnerState: LearnerState = { byUnit: {} };
  protected goals = new Map<string, LearningGoal>();

  async listDocuments(): Promise<SourceDocument[]> {
    return [...this.documents.values()];
  }
  async saveDocument(doc: SourceDocument): Promise<void> {
    this.documents.set(doc.id, doc);
  }
  async deleteDocument(id: string): Promise<void> {
    this.documents.delete(id);
  }

  async getGraph(): Promise<KnowledgeGraph> {
    return this.graph;
  }
  async saveGraph(graph: KnowledgeGraph): Promise<void> {
    this.graph = graph;
  }

  async getLearnerState(): Promise<LearnerState> {
    return this.learnerState;
  }
  async saveLearnerState(state: LearnerState): Promise<void> {
    this.learnerState = state;
  }

  async listGoals(): Promise<LearningGoal[]> {
    return [...this.goals.values()];
  }
  async saveGoal(goal: LearningGoal): Promise<void> {
    this.goals.set(goal.id, goal);
  }
  async deleteGoal(id: string): Promise<void> {
    this.goals.delete(id);
  }
}
