/**
 * 存储抽象 —— 一切触及用户本地数据的入口。
 *
 * 该契约让应用与具体存储解耦：当前运行在内存 + localStorage 后端
 * （浏览器预览），后续将切换到 Tauri 的 SQLite / 文件系统后端，
 * 业务逻辑无需任何改动。
 */
import type {
  Chapter,
  KnowledgeGraph,
  LearnerState,
  LearningGoal,
  SourceDocument,
} from "../domain";

export interface StorageAdapter {
  readonly name: string;

  // 文档（知识库）
  listDocuments(): Promise<SourceDocument[]>;
  saveDocument(doc: SourceDocument): Promise<void>;
  deleteDocument(id: string): Promise<void>;

  // 章节（V2 章节化学习主对象；切分/微调后整批写回）
  listChapters(documentId: string): Promise<Chapter[]>;
  saveChapters(documentId: string, chapters: Chapter[]): Promise<void>;

  // 知识图谱
  getGraph(): Promise<KnowledgeGraph>;
  saveGraph(graph: KnowledgeGraph): Promise<void>;

  // 学习者状态
  getLearnerState(): Promise<LearnerState>;
  saveLearnerState(state: LearnerState): Promise<void>;

  // 目标
  listGoals(): Promise<LearningGoal[]>;
  saveGoal(goal: LearningGoal): Promise<void>;
  deleteGoal(id: string): Promise<void>;
}
