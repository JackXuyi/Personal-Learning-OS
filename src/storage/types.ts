/**
 * Storage abstraction — everything that touches the user's local data.
 *
 * The contract keeps the app storage-agnostic: today it runs on an in-memory
 * + localStorage backend (browser preview), and later it will run on the
 * Tauri SQLite/filesystem backend without touching business logic.
 */
import type {
  KnowledgeGraph,
  LearnerState,
  LearningGoal,
  SourceDocument,
} from "../domain";

export interface StorageAdapter {
  readonly name: string;

  // Documents (Knowledge Base)
  listDocuments(): Promise<SourceDocument[]>;
  saveDocument(doc: SourceDocument): Promise<void>;
  deleteDocument(id: string): Promise<void>;

  // Knowledge Graph
  getGraph(): Promise<KnowledgeGraph>;
  saveGraph(graph: KnowledgeGraph): Promise<void>;

  // Learner State
  getLearnerState(): Promise<LearnerState>;
  saveLearnerState(state: LearnerState): Promise<void>;

  // Goals
  listGoals(): Promise<LearningGoal[]>;
  saveGoal(goal: LearningGoal): Promise<void>;
  deleteGoal(id: string): Promise<void>;
}
