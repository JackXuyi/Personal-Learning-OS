/**
 * 存储抽象 —— 一切触及用户本地数据的入口。
 *
 * 该契约让应用与具体存储解耦：当前运行在内存 + localStorage 后端
 * （浏览器预览），后续将切换到 Tauri 的 SQLite / 文件系统后端，
 * 业务逻辑无需任何改动。
 *
 * RAG 存储层扩展（V2 N0）：新增 Section / Chunk / KnowledgeUnit / 
 * KnowledgeRelation / Embedding / 全文搜索能力。
 */
import type {
  Chapter,
  Chunk,
  Embedding,
  EvidenceEntry,
  KnowledgeGraph,
  KnowledgeRelation,
  KnowledgeUnit,
  LearnerState,
  LearningGoal,
  Paper,
  PaperAnswers,
  PaperResult,
  Section,
  SourceDocument,
} from "../domain";

/** RAG 检索范围限定（用于 fullTextSearch / vectorSearch 等）。 */
export interface RetrievalScope {
  documentId?: string;
  chapterId?: string;
  sectionId?: string;
  knowledgeId?: string;
  goalId?: string;
}

export interface StorageAdapter {
  readonly name: string;

  // ===== 文档（知识库）=====
  listDocuments(): Promise<SourceDocument[]>;
  /** 单份资料（详情页按 id 取；不存在返回 undefined）。 */
  getDocument(id: string): Promise<SourceDocument | undefined>;
  saveDocument(doc: SourceDocument): Promise<void>;
  deleteDocument(id: string): Promise<void>;

  // ===== 章节（V2 章节化学习主对象；切分/微调后整批写回）=====
  listChapters(documentId: string): Promise<Chapter[]>;
  saveChapters(documentId: string, chapters: Chapter[]): Promise<void>;

  // ===== Section 层（RAG 三层结构）=====
  listSections(chapterId: string): Promise<Section[]>;
  getSection(id: string): Promise<Section | undefined>;
  saveSection(section: Section): Promise<void>;
  saveSections(sections: Section[]): Promise<void>;
  deleteSection(id: string): Promise<void>;
  /** 按正文区间查询（用于从 Chapter 切片快速定位 Sections）。 */
  sectionsByRange(documentId: string, start: number, end: number): Promise<Section[]>;

  // ===== Chunk 层（向量化与全文检索基础单位）=====
  listChunks(chapterId: string): Promise<Chunk[]>;
  listChunksByDocument(documentId: string): Promise<Chunk[]>;
  getChunk(id: string): Promise<Chunk | undefined>;
  saveChunk(chunk: Chunk): Promise<void>;
  saveChunks(chunks: Chunk[]): Promise<void>;
  deleteChunk(id: string): Promise<void>;
  /** 按知识单元查询相关 Chunks。 */
  chunksByKnowledge(knowledgeId: string): Promise<Chunk[]>;

  // ===== KnowledgeUnit 层（概念/技能原子语义）=====
  listKnowledgeUnits(documentId?: string): Promise<KnowledgeUnit[]>;
  getKnowledgeUnit(id: string): Promise<KnowledgeUnit | undefined>;
  saveKnowledgeUnit(unit: KnowledgeUnit): Promise<void>;
  saveKnowledgeUnits(units: KnowledgeUnit[]): Promise<void>;
  deleteKnowledgeUnit(id: string): Promise<void>;

  // ===== KnowledgeRelation 层（知识图谱边）=====
  listRelations(unitId?: string): Promise<KnowledgeRelation[]>;
  relationsOf(unitId: string): Promise<KnowledgeRelation[]>;
  prerequisitesOf(unitId: string): Promise<KnowledgeUnit[]>;
  saveRelation(relation: KnowledgeRelation): Promise<void>;
  saveRelations(relations: KnowledgeRelation[]): Promise<void>;
  deleteRelation(id: string): Promise<void>;

  // ===== Embedding 层（向量化元数据）=====
  listEmbeddings(targetType?: string): Promise<Embedding[]>;
  getEmbedding(id: string): Promise<Embedding | undefined>;
  saveEmbedding(embedding: Embedding): Promise<void>;
  saveEmbeddings(embeddings: Embedding[]): Promise<void>;
  deleteEmbedding(id: string): Promise<void>;
  deleteEmbeddingsByTarget(targetId: string): Promise<void>;

  // ===== Evidence 链（改进查询）=====
  listEvidence(): Promise<EvidenceEntry[]>;
  listEvidenceBySubject(subjectId: string): Promise<EvidenceEntry[]>;
  appendEvidence(entry: EvidenceEntry): Promise<void>;

  // ===== 全文搜索（FTS5，P0 MVP）=====
  /**
   * FTS5 查询：返回 Chunk 列表。
   * @param query 查询词（自动 FTS5 转义）
   * @param scope 检索范围（可选）
   * @param limit 返回条数（默认 10）
   */
  fullTextSearch(query: string, scope?: RetrievalScope, limit?: number): Promise<Chunk[]>;

  // ===== 试卷（V2 章节化测评；/quiz 历史列表按 createdAt 倒序）=====
  listPapers(): Promise<Paper[]>;
  savePaper(paper: Paper): Promise<void>;
  /**
   * 删除试卷本体（资料级联清理用）。
   * 级联语义：同时移除该 paperId 的答题草稿（paperDrafts）与判卷结果（paperResults）。
   */
  deletePaper(id: string): Promise<void>;

  // ===== 答题草稿：paperId → 未交卷的作答快照（P4 答题页草稿暂存）=====
  getPaperDraft(paperId: string): Promise<PaperAnswers | undefined>;
  savePaperDraft(paperId: string, answers: PaperAnswers): Promise<void>;

  // ===== 判卷结果（T6 交卷即落库；T7 报告页消费 / 判卷撤销回滚）=====
  listPaperResults(): Promise<PaperResult[]>;
  savePaperResult(result: PaperResult): Promise<void>;
  deletePaperResult(paperId: string): Promise<void>;

  // ===== 知识图谱=====
  getGraph(): Promise<KnowledgeGraph>;
  saveGraph(graph: KnowledgeGraph): Promise<void>;

  // ===== 学习者状态=====
  getLearnerState(): Promise<LearnerState>;
  saveLearnerState(state: LearnerState): Promise<void>;

  // ===== 目标（多目标，U0 数据准备；docs/ui-workbench-plan-2026-09.md §7.2）=====
  listGoals(): Promise<LearningGoal[]>;
  saveGoal(goal: LearningGoal): Promise<void>;
  deleteGoal(id: string): Promise<void>;

  // ===== 目标 · 当前上下文（activeGoal）=====
  // 语义：返回 activeGoalId 指向的目标；id 失效/未设置时回退列表首个目标；
  //       列表为空返回 undefined（seed 由学习闭环 seedDemoIfEmpty 负责）。
  getActiveGoal(): Promise<LearningGoal | undefined>;
  /** id 传 undefined = 清除偏好（读取时回退首个目标）。 */
  setActiveGoal(id: string | undefined): Promise<void>;
}
