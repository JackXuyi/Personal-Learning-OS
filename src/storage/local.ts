/**
 * localStorage 持久化适配器——在浏览器预览中可跨刷新保留。
 *
 * 这是生产级 SQLite 后端（Tauri 侧）的*占位*实现。
 * 数据模型与 key 保持一致，因此后续切换只需改动一行的
 * 工厂函数。注意：localStorage 不得用于存放密钥。
 */
import type {
  Chapter,
  EvidenceEntry,
  KnowledgeGraph,
  LearnerState,
  LearningGoal,
  Paper,
  PaperAnswers,
  PaperResult,
  SourceDocument,
} from "../domain";
import { InMemoryStorage } from "./memory";
import type { StorageAdapter } from "./types";

const KEY_DOCUMENTS = "plos.documents";
const KEY_CHAPTERS = "plos.chapters";
const KEY_PAPERS = "plos.papers";
const KEY_PAPER_DRAFTS = "plos.paper-drafts";
const KEY_PAPER_RESULTS = "plos.paper-results";
const KEY_GRAPH = "plos.graph";
const KEY_LEARNER = "plos.learner";
const KEY_GOALS = "plos.goals";
const KEY_ACTIVE_GOAL = "plos.active-goal";
const KEY_EVIDENCE = "plos.evidence";

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
    this.chaptersByDocument = new Map(
      Object.entries(load<Record<string, Chapter[]>>(KEY_CHAPTERS, {})),
    );
    this.papers = new Map(load<Paper[]>(KEY_PAPERS, []).map((p) => [p.id, p]));
    this.paperDrafts = new Map(
      Object.entries(load<Record<string, PaperAnswers>>(KEY_PAPER_DRAFTS, {})),
    );
    this.paperResults = new Map(
      load<PaperResult[]>(KEY_PAPER_RESULTS, []).map((r) => [r.paperId, r]),
    );
    this.graph = load<KnowledgeGraph>(KEY_GRAPH, { units: [], relations: [] });
    this.learnerState = load<LearnerState>(KEY_LEARNER, { byUnit: {} });
    this.goals = new Map(load<LearningGoal[]>(KEY_GOALS, []).map((g) => [g.id, g]));
    this.activeGoalId = load<string | undefined>(KEY_ACTIVE_GOAL, undefined);
    this.evidenceLog = load<EvidenceEntry[]>(KEY_EVIDENCE, []);
  }

  private persist() {
    localStorage.setItem(KEY_DOCUMENTS, JSON.stringify([...this.documents.values()]));
    localStorage.setItem(
      KEY_CHAPTERS,
      JSON.stringify(Object.fromEntries(this.chaptersByDocument)),
    );
    localStorage.setItem(KEY_PAPERS, JSON.stringify([...this.papers.values()]));
    localStorage.setItem(
      KEY_PAPER_DRAFTS,
      JSON.stringify(Object.fromEntries(this.paperDrafts)),
    );
    localStorage.setItem(
      KEY_PAPER_RESULTS,
      JSON.stringify([...this.paperResults.values()]),
    );
    localStorage.setItem(KEY_GRAPH, JSON.stringify(this.graph));
    localStorage.setItem(KEY_LEARNER, JSON.stringify(this.learnerState));
    localStorage.setItem(KEY_GOALS, JSON.stringify([...this.goals.values()]));
    localStorage.setItem(KEY_EVIDENCE, JSON.stringify(this.evidenceLog));
  }

  override async saveDocument(doc: SourceDocument): Promise<void> {
    await super.saveDocument(doc);
    this.persist();
  }
  override async deleteDocument(id: string): Promise<void> {
    await super.deleteDocument(id);
    this.persist();
  }
  override async saveChapters(documentId: string, chapters: Chapter[]): Promise<void> {
    await super.saveChapters(documentId, chapters);
    this.persist();
  }
  override async savePaper(paper: Paper): Promise<void> {
    await super.savePaper(paper);
    this.persist();
  }
  override async deletePaper(id: string): Promise<void> {
    await super.deletePaper(id);
    this.persist();
  }
  override async savePaperDraft(paperId: string, answers: PaperAnswers): Promise<void> {
    await super.savePaperDraft(paperId, answers);
    this.persist();
  }
  override async savePaperResult(result: PaperResult): Promise<void> {
    await super.savePaperResult(result);
    this.persist();
  }
  override async deletePaperResult(paperId: string): Promise<void> {
    await super.deletePaperResult(paperId);
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
  /** activeGoalId 单独落 localStorage（独立 key，不随全量 persist）。 */
  override async setActiveGoal(id: string | undefined): Promise<void> {
    this.activeGoalId = id;
    try {
      if (id === undefined) localStorage.removeItem(KEY_ACTIVE_GOAL);
      else localStorage.setItem(KEY_ACTIVE_GOAL, id);
    } catch {
      /* 写失败不阻塞主流程（回退首个目标语义由 getActiveGoal 兜底） */
    }
  }

  override async appendEvidence(entry: EvidenceEntry): Promise<void> {
    await super.appendEvidence(entry);
    this.persist();
  }
}
