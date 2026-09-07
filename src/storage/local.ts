/**
 * localStorage-persisted adapter — survives reloads in browser preview.
 *
 * This is the *placeholder* for the production SQLite backend (Tauri side).
 * Data model and keys stay identical, so the switch later is a one-line
 * factory change. Note: localStorage must not be used for secrets.
 */
import type {
  KnowledgeGraph,
  LearnerState,
  LearningGoal,
  SourceDocument,
} from "../domain";
import { InMemoryStorage } from "./memory";
import type { StorageAdapter } from "./types";

const KEY_DOCUMENTS = "plos.documents";
const KEY_GRAPH = "plos.graph";
const KEY_LEARNER = "plos.learner";
const KEY_GOALS = "plos.goals";

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export class LocalStorageAdapter extends InMemoryStorage implements StorageAdapter {
  override readonly name = "local";

  constructor() {
    super();
    this.documents = new Map(
      load<SourceDocument[]>(KEY_DOCUMENTS, []).map((d) => [d.id, d]),
    );
    this.graph = load<KnowledgeGraph>(KEY_GRAPH, { units: [], relations: [] });
    this.learnerState = load<LearnerState>(KEY_LEARNER, { byUnit: {} });
    this.goals = new Map(load<LearningGoal[]>(KEY_GOALS, []).map((g) => [g.id, g]));
  }

  private persist() {
    localStorage.setItem(KEY_DOCUMENTS, JSON.stringify([...this.documents.values()]));
    localStorage.setItem(KEY_GRAPH, JSON.stringify(this.graph));
    localStorage.setItem(KEY_LEARNER, JSON.stringify(this.learnerState));
    localStorage.setItem(KEY_GOALS, JSON.stringify([...this.goals.values()]));
  }

  override async saveDocument(doc: SourceDocument): Promise<void> {
    await super.saveDocument(doc);
    this.persist();
  }
  override async deleteDocument(id: string): Promise<void> {
    await super.deleteDocument(id);
    this.persist();
  }
  override async saveGraph(graph: KnowledgeGraph): Promise<void> {
    await super.saveGraph(graph);
    this.persist();
  }
  override async saveLearnerState(state: LearnerState): Promise<void> {
    await super.saveLearnerState(state);
    this.persist();
  }
  override async saveGoal(goal: LearningGoal): Promise<void> {
    await super.saveGoal(goal);
    this.persist();
  }
  override async deleteGoal(id: string): Promise<void> {
    await super.deleteGoal(id);
    this.persist();
  }
}
