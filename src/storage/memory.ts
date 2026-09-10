/**
 * 内存存储（In-memory storage）——零配置默认方案。
 *
 * 用于开发/浏览器预览，并作为持久化适配器的基类。所有方法均为 async，
 * 以便后续接入 SQLite 后端时无需改动调用点。
 *
 * RAG 存储层（V2 N0）：新增 Section / Chunk / KnowledgeUnit / KnowledgeRelation
 * / Embedding 五类实体的内存实现，供检索引擎与概念抽取消费。
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
import { sortChaptersByOrder } from "../domain";
import type { RetrievalScope, StorageAdapter } from "./types";

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
  protected activeGoalId: string | undefined;
  protected evidenceLog: EvidenceEntry[] = [];

  // RAG 存储层：Section / Chunk / Knowledge / Relation / Embedding
  protected sections = new Map<string, Section>();
  protected chunks = new Map<string, Chunk>();
  protected knowledgeUnits = new Map<string, KnowledgeUnit>();
  protected knowledgeRelations = new Map<string, KnowledgeRelation>();
  protected embeddings = new Map<string, Embedding>();

  async listDocuments(): Promise<SourceDocument[]> {
    return [...this.documents.values()];
  }
  async getDocument(id: string): Promise<SourceDocument | undefined> {
    return this.documents.get(id);
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

  // ===== Section 层 =====
  async listSections(chapterId: string): Promise<Section[]> {
    return [...this.sections.values()]
      .filter((s) => s.chapterId === chapterId)
      .sort((a, b) => a.index - b.index);
  }
  async getSection(id: string): Promise<Section | undefined> {
    return this.sections.get(id);
  }
  async saveSection(section: Section): Promise<void> {
    this.sections.set(section.id, section);
  }
  async saveSections(sections: Section[]): Promise<void> {
    for (const s of sections) this.sections.set(s.id, s);
  }
  async deleteSection(id: string): Promise<void> {
    this.sections.delete(id);
  }
  async sectionsByRange(
    documentId: string,
    start: number,
    end: number,
  ): Promise<Section[]> {
    return [...this.sections.values()]
      .filter(
        (s) =>
          s.documentId === documentId &&
          s.contentRef.start >= start &&
          s.contentRef.end <= end,
      )
      .sort((a, b) => a.index - b.index);
  }

  // ===== Chunk 层 =====
  async listChunks(chapterId: string): Promise<Chunk[]> {
    return [...this.chunks.values()]
      .filter((c) => c.chapterId === chapterId)
      .sort((a, b) => a.position - b.position);
  }
  async listChunksByDocument(documentId: string): Promise<Chunk[]> {
    return [...this.chunks.values()]
      .filter((c) => c.documentId === documentId)
      .sort((a, b) => a.position - b.position);
  }
  async getChunk(id: string): Promise<Chunk | undefined> {
    return this.chunks.get(id);
  }
  async saveChunk(chunk: Chunk): Promise<void> {
    this.chunks.set(chunk.id, chunk);
  }
  async saveChunks(chunks: Chunk[]): Promise<void> {
    for (const c of chunks) this.chunks.set(c.id, c);
  }
  async deleteChunk(id: string): Promise<void> {
    this.chunks.delete(id);
  }
  async chunksByKnowledge(knowledgeId: string): Promise<Chunk[]> {
    return [...this.chunks.values()].filter((c) =>
      c.knowledgeIds.includes(knowledgeId),
    );
  }

  // ===== KnowledgeUnit 层 =====
  async listKnowledgeUnits(documentId?: string): Promise<KnowledgeUnit[]> {
    const all = [...this.knowledgeUnits.values()];
    return documentId ? all.filter((u) => u.sourceDocumentId === documentId) : all;
  }
  async getKnowledgeUnit(id: string): Promise<KnowledgeUnit | undefined> {
    return this.knowledgeUnits.get(id);
  }
  async saveKnowledgeUnit(unit: KnowledgeUnit): Promise<void> {
    this.knowledgeUnits.set(unit.id, unit);
  }
  async saveKnowledgeUnits(units: KnowledgeUnit[]): Promise<void> {
    for (const u of units) this.knowledgeUnits.set(u.id, u);
  }
  async deleteKnowledgeUnit(id: string): Promise<void> {
    this.knowledgeUnits.delete(id);
  }

  // ===== KnowledgeRelation 层 =====
  async listRelations(unitId?: string): Promise<KnowledgeRelation[]> {
    const all = [...this.knowledgeRelations.values()];
    return unitId ? all.filter((r) => r.fromId === unitId || r.toId === unitId) : all;
  }
  async relationsOf(unitId: string): Promise<KnowledgeRelation[]> {
    return [...this.knowledgeRelations.values()].filter(
      (r) => r.fromId === unitId || r.toId === unitId,
    );
  }
  async prerequisitesOf(unitId: string): Promise<KnowledgeUnit[]> {
    const prereqIds = [...this.knowledgeRelations.values()]
      .filter((r) => r.toId === unitId && r.type === "prerequisite")
      .map((r) => r.fromId);
    return [...this.knowledgeUnits.values()].filter((u) => prereqIds.includes(u.id));
  }
  async saveRelation(relation: KnowledgeRelation): Promise<void> {
    this.knowledgeRelations.set(relation.id, relation);
  }
  async saveRelations(relations: KnowledgeRelation[]): Promise<void> {
    for (const r of relations) this.knowledgeRelations.set(r.id, r);
  }
  async deleteRelation(id: string): Promise<void> {
    this.knowledgeRelations.delete(id);
  }

  // ===== Embedding 层 =====
  async listEmbeddings(targetType?: string): Promise<Embedding[]> {
    const all = [...this.embeddings.values()];
    return targetType ? all.filter((e) => e.targetType === targetType) : all;
  }
  async getEmbedding(id: string): Promise<Embedding | undefined> {
    return this.embeddings.get(id);
  }
  async saveEmbedding(embedding: Embedding): Promise<void> {
    this.embeddings.set(embedding.id, embedding);
  }
  async saveEmbeddings(embeddings: Embedding[]): Promise<void> {
    for (const e of embeddings) this.embeddings.set(e.id, e);
  }
  async deleteEmbedding(id: string): Promise<void> {
    this.embeddings.delete(id);
  }
  async deleteEmbeddingsByTarget(targetId: string): Promise<void> {
    for (const [id, e] of this.embeddings) {
      if (e.targetId === targetId) this.embeddings.delete(id);
    }
  }

  // ===== Evidence 链 =====
  async listEvidenceBySubject(subjectId: string): Promise<EvidenceEntry[]> {
    return this.evidenceLog
      .filter((e) => e.subjectId === subjectId)
      .sort((a, b) => b.at - a.at);
  }

  /**
   * 全文检索（内存降级实现：大小写不敏感子串匹配）。
   * 生产环境（Tauri SQLite）由 FTS5 承担；此处保证浏览器预览可用。
   */
  async fullTextSearch(
    query: string,
    scope?: RetrievalScope,
    limit = 10,
  ): Promise<Chunk[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    let candidates = [...this.chunks.values()];
    if (scope?.documentId) {
      candidates = candidates.filter((c) => c.documentId === scope.documentId);
    }
    if (scope?.chapterId) {
      candidates = candidates.filter((c) => c.chapterId === scope.chapterId);
    }
    if (scope?.sectionId) {
      candidates = candidates.filter((c) => c.sectionId === scope.sectionId);
    }
    if (scope?.knowledgeId) {
      candidates = candidates.filter((c) => c.knowledgeIds.includes(scope.knowledgeId!));
    }
    return candidates
      .filter((c) => c.content.toLowerCase().includes(q))
      .sort((a, b) => a.position - b.position)
      .slice(0, limit);
  }

  async listPapers(): Promise<Paper[]> {
    return [...this.papers.values()].sort((a, b) => b.createdAt - a.createdAt);
  }
  async savePaper(paper: Paper): Promise<void> {
    this.papers.set(paper.id, paper);
  }
  async deletePaper(id: string): Promise<void> {
    // 级联语义：试卷本体 + 答题草稿 + 判卷结果一并移除。
    this.papers.delete(id);
    this.paperDrafts.delete(id);
    this.paperResults.delete(id);
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

  async getActiveGoal(): Promise<LearningGoal | undefined> {
    const all = [...this.goals.values()];
    if (this.activeGoalId) {
      const preferred = all.find((g) => g.id === this.activeGoalId);
      if (preferred) return preferred;
    }
    return all[0]; // id 失效 / 未设置 → 回退首个目标
  }
  async setActiveGoal(id: string | undefined): Promise<void> {
    this.activeGoalId = id;
  }

  async listEvidence(): Promise<EvidenceEntry[]> {
    return [...this.evidenceLog].sort((a, b) => b.at - a.at);
  }
  async appendEvidence(entry: EvidenceEntry): Promise<void> {
    this.evidenceLog.push(entry);
    // 简单上限防无限增长（本地应用规模足够）。
    if (this.evidenceLog.length > 500) {
      this.evidenceLog = this.evidenceLog.slice(-500);
    }
  }
}
