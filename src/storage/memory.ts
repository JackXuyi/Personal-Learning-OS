/**
 * 内存存储（In-memory storage）——零配置默认方案。
 *
 * 用于开发/浏览器预览，并作为持久化适配器的基类。所有方法均为 async，
 * 以便后续接入 SQLite 后端时无需改动调用点。
 */
import type {
  Chapter,
  KnowledgeGraph,
  LearnerState,
  LearningGoal,
  Paper,
  PaperAnswers,
  PaperResult,
  SourceDocument,
} from "../domain";
import { sortChaptersByOrder } from "../domain";
import type { StorageAdapter } from "./types";

export class InMemoryStorage implements StorageAdapter {
  readonly name: string = "memory";
  protected documents = new Map<string, SourceDocument>();
  protected chaptersByDocument = new Map<string, Chapter[]>();
  protected papers = new Map<string, Paper>();
  protected paperDrafts = new Map<string, PaperAnswers>();
  protected paperResults = new Map<string, PaperResult>();
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
    // 级联清理：删除文档时一并移除其章节，保持数据一致性。
    this.chaptersByDocument.delete(id);
  }

  async listChapters(documentId: string): Promise<Chapter[]> {
    return sortChaptersByOrder(this.chaptersByDocument.get(documentId) ?? []);
  }
  async saveChapters(documentId: string, chapters: Chapter[]): Promise<void> {
    this.chaptersByDocument.set(documentId, sortChaptersByOrder(chapters));
  }

  async listPapers(): Promise<Paper[]> {
    return [...this.papers.values()].sort((a, b) => b.createdAt - a.createdAt);
  }
  async savePaper(paper: Paper): Promise<void> {
    this.papers.set(paper.id, paper);
  }
  async getPaperDraft(paperId: string): Promise<PaperAnswers | undefined> {
    return this.paperDrafts.get(paperId);
  }
  async savePaperDraft(paperId: string, answers: PaperAnswers): Promise<void> {
    this.paperDrafts.set(paperId, answers);
  }
  async listPaperResults(): Promise<PaperResult[]> {
    return [...this.paperResults.values()].sort((a, b) => b.createdAt - a.createdAt);
  }
  async savePaperResult(result: PaperResult): Promise<void> {
    this.paperResults.set(result.paperId, result);
  }
  async deletePaperResult(paperId: string): Promise<void> {
    this.paperResults.delete(paperId);
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
