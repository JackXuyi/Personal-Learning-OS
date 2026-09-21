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
  Annotation,
  CapabilityItem,
  CapabilityReport,
  CapabilityRun,
  CardState,
  CardStateMap,
  Chapter,
  Chunk,
  Embedding,
  EmbeddingTargetType,
  EmbeddingVector,
  EvidenceEntry,
  KnowledgeGraph,
  KnowledgeRelation,
  KnowledgeUnit,
  LearnerProfile,
  LearnerState,
  LearningGoal,
  MemoryDocMeta,
  Paper,
  PaperAnswers,
  PaperResult,
  Restatement,
  Section,
  SourceDocument,
} from "../domain";
import { pruneMemoryDocForClear, sortChaptersByOrder } from "../domain";
import type { RetrievalScope, StorageAdapter } from "./types";

/**
 * 证据日志上限（超出丢最旧）。
 *
 * ⚠️ 口径唯一来源：`features/progress/analytics.ts` 的裁剪提示判定从这里导入，
 * 不得在 UI 侧或派生层重写 5000（否则改上限时两处漂移 —— F2「两把尺子」的同类陷阱）。
 *
 * 500 → 5000（F3 D2）：500 条按每天 3 条只够约 5 个月，热力图会显示「以前没学习」
 * 的假空窗。容量核算：5000 × ~150 B ≈ 750 KB << localStorage 5 MB 配额
 * （见 docs/progress-analytics-design-2026-09.md §4.3）。
 */
export const EVIDENCE_LOG_MAX = 5000;

export class InMemoryStorage implements StorageAdapter {
  readonly name: string = "memory";
  protected documents = new Map<string, SourceDocument>();
  protected chaptersByDocument = new Map<string, Chapter[]>();
  protected papers = new Map<string, Paper>();
  protected paperDrafts = new Map<string, PaperAnswers>();
  protected paperResults = new Map<string, PaperResult>();
  protected graph: KnowledgeGraph = { units: [], relations: [] };
  protected learnerState: LearnerState = { byUnit: {} };
  /** 学习者画像（F1）。缺省 undefined = 未填写（不制造假画像）。 */
  protected profile: LearnerProfile | undefined;
  /** 章级复述（F5）。key = Restatement.id。 */
  protected restatements = new Map<string, Restatement>();
  /** 自测卡调度状态（F5 第 4 条）。key = DerivedCard.id；只存调度，不存卡面。 */
  protected cardStates: CardStateMap = {};
  /** 划线批注（F5 第 2 条）。key = Annotation.id。 */
  protected annotations = new Map<string, Annotation>();
  protected goals = new Map<string, LearningGoal>();
  protected activeGoalId: string | undefined;
  protected evidenceLog: EvidenceEntry[] = [];
  /** 能力项清单（F6）。key = goalId（每目标一份，顺序即展示顺序）。 */
  protected capabilityItems = new Map<string, CapabilityItem[]>();
  /** 评测运行（F6）。key = CapabilityRun.id。 */
  protected capabilityRuns = new Map<string, CapabilityRun>();
  /** 能力报告（F6，append-only）。key = CapabilityReport.id。 */
  protected capabilityReports = new Map<string, CapabilityReport>();
  /** 学习者记忆文档（F9）。真源是**一段 markdown 文本**，不是实体集合。 */
  protected memoryDoc = "";
  /** 记忆文档元数据（F9）：`lastWritten` / `dismissed` / 时间戳。 */
  protected memoryMeta: MemoryDocMeta = { lastWritten: {}, dismissed: [], lastMergedAt: 0 };

  // RAG 存储层：Section / Chunk / Knowledge / Relation / Embedding
  protected sections = new Map<string, Section>();
  protected chunks = new Map<string, Chunk>();
  protected knowledgeUnits = new Map<string, KnowledgeUnit>();
  protected knowledgeRelations = new Map<string, KnowledgeRelation>();
  protected embeddings = new Map<string, Embedding>();

  // ===== 文档 / 章节的内存镜像维护（protected 纯方法；两个子类共用 · D12）=====
  //
  // 抽出来的理由：`LocalStorageAdapter` 需要「写内存 → persist()」，`TauriStorage`
  // 需要「写内存 → 写 SQLite」。**内存那一半必须只有一份实现** —— 尤其
  // `forgetDocument` 里「删资料级联删批注」这条规则，抄两份就是两把尺子。
  //
  // 这三个方法**只碰内存**，不落盘、不做 IO，也不 await（因此可以在临界区里用）。

  /** 记住一份资料（纯内存）。 */
  protected rememberDocument(doc: SourceDocument): void {
    this.documents.set(doc.id, doc);
  }

  /** 忘掉一份资料（纯内存）：资料本体 + 其章节 + 归属它的批注。 */
  protected forgetDocument(id: string): void {
    this.documents.delete(id);
    // 级联清理：删除文档时一并移除其章节，保持数据一致性。
    this.chaptersByDocument.delete(id);
    // 级联清理（F5 第 2 条）：批注归属资料，资料没了批注即成孤儿 → 一并删除。
    for (const [annId, ann] of this.annotations) {
      if (ann.documentId === id) this.annotations.delete(annId);
    }
  }

  /** 整批替换某资料的章节（纯内存；排序口径唯一 = `sortChaptersByOrder`）。 */
  protected rememberChapters(documentId: string, chapters: Chapter[]): void {
    this.chaptersByDocument.set(documentId, sortChaptersByOrder(chapters));
  }

  async listDocuments(): Promise<SourceDocument[]> {
    return [...this.documents.values()];
  }
  async getDocument(id: string): Promise<SourceDocument | undefined> {
    return this.documents.get(id);
  }
  async saveDocument(doc: SourceDocument): Promise<void> {
    this.rememberDocument(doc);
  }
  async deleteDocument(id: string): Promise<void> {
    this.forgetDocument(id);
  }

  async listChapters(documentId: string): Promise<Chapter[]> {
    return sortChaptersByOrder(this.chaptersByDocument.get(documentId) ?? []);
  }
  async saveChapters(documentId: string, chapters: Chapter[]): Promise<void> {
    this.rememberChapters(documentId, chapters);
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
  /**
   * 删除整份文档的全部 chunk（幂等）。
   * 内存版没有独立的 chunk_knowledge 关联表（chunk 自带 knowledgeIds），
   * 故只需删 chunk 本体；向量由调用方先行清理（见契约注释）。
   */
  async deleteChunksByDocument(documentId: string): Promise<void> {
    for (const [id, c] of this.chunks) {
      if (c.documentId === documentId) this.chunks.delete(id);
    }
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
  /**
   * 取回向量本体（检索用）。只返回**持有向量**（vector 非空）的记录。
   * targetIds 传值时按目标过滤；内存后端总是能拿到（测试可覆盖向量检索）。
   */
  async listEmbeddingVectors(
    targetType: EmbeddingTargetType,
    targetIds?: readonly string[],
  ): Promise<EmbeddingVector[]> {
    const wanted = targetIds ? new Set(targetIds) : undefined;
    const out: EmbeddingVector[] = [];
    for (const e of this.embeddings.values()) {
      if (e.targetType !== targetType) continue;
      if (wanted && !wanted.has(e.targetId)) continue;
      if (!e.vector || e.vector.length === 0) continue;
      out.push({
        targetId: e.targetId,
        model: e.model,
        dim: e.vector.length,
        vector: e.vector,
      });
    }
    return out;
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

  async getProfile(): Promise<LearnerProfile | undefined> {
    return this.profile;
  }
  async saveProfile(profile: LearnerProfile | undefined): Promise<void> {
    this.profile = profile;
  }

  // ===== 章级复述（F5）=====
  async listRestatements(chapterId: string): Promise<Restatement[]> {
    return [...this.restatements.values()]
      .filter((r) => r.chapterId === chapterId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }
  async saveRestatement(record: Restatement): Promise<void> {
    this.restatements.set(record.id, record);
  }
  /** 全量复述（F9 跨章聚合用）：与 `listRestatements` 同排序口径（`createdAt` 降序）。 */
  async listAllRestatements(): Promise<Restatement[]> {
    return [...this.restatements.values()].sort((a, b) => b.createdAt - a.createdAt);
  }
  async deleteRestatement(id: string): Promise<void> {
    this.restatements.delete(id);
  }

  // ===== 自测卡调度状态（F5 第 4 条）=====
  async listCardStates(): Promise<CardStateMap> {
    return { ...this.cardStates };
  }
  async saveCardState(state: CardState): Promise<void> {
    this.cardStates[state.cardId] = state;
  }
  async deleteCardStates(cardIds: string[]): Promise<void> {
    for (const id of cardIds) delete this.cardStates[id];
  }

  // ===== 划线批注（F5 第 2 条）=====
  async listAnnotationsByChapter(chapterId: string): Promise<Annotation[]> {
    return [...this.annotations.values()].filter((a) => a.chapterId === chapterId).sort(byStart);
  }
  async listAnnotations(documentId: string): Promise<Annotation[]> {
    return [...this.annotations.values()].filter((a) => a.documentId === documentId).sort(byStart);
  }
  /** 全量批注（F9 跨资料聚合用）：与 `listAnnotations` 同排序口径（`start` 全序升序）。 */
  async listAllAnnotations(): Promise<Annotation[]> {
    return [...this.annotations.values()].sort(byStart);
  }
  async saveAnnotation(annotation: Annotation): Promise<void> {
    this.annotations.set(annotation.id, annotation);
  }
  async deleteAnnotation(id: string): Promise<void> {
    this.annotations.delete(id);
  }
  async deleteAnnotations(ids: string[]): Promise<void> {
    for (const id of ids) this.annotations.delete(id);
  }

  async listGoals(): Promise<LearningGoal[]> {
    return [...this.goals.values()];
  }
  async saveGoal(goal: LearningGoal): Promise<void> {
    this.goals.set(goal.id, goal);
  }
  /**
   * 删除目标 + **级联清理该目标的能力数据**（UC-08；F6）。
   *
   * 级联放在基类而非 `local.ts`：memory 后端（单测 / SSR）同样必须无残留
   * —— 否则「删除目标后换后端仍有孤儿报告」类 bug 只在测试里隐形。
   */
  async deleteGoal(id: string): Promise<void> {
    this.goals.delete(id);
    await this.deleteCapabilityDataByGoal(id);
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

  // ===== 目标级能力评测（F6）=====
  async listCapabilityItems(goalId: string): Promise<CapabilityItem[]> {
    return [...(this.capabilityItems.get(goalId) ?? [])].sort((a, b) => a.createdAt - b.createdAt);
  }
  async saveCapabilityItems(goalId: string, items: CapabilityItem[]): Promise<void> {
    // 空数组 = 清空：删 key 而不是留空数组，避免 listCapabilityItems 语义分叉。
    if (items.length === 0) this.capabilityItems.delete(goalId);
    else this.capabilityItems.set(goalId, [...items]);
  }
  async listCapabilityRuns(goalId: string): Promise<CapabilityRun[]> {
    return [...this.capabilityRuns.values()]
      .filter((r) => r.goalId === goalId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }
  async getCapabilityRun(id: string): Promise<CapabilityRun | undefined> {
    return this.capabilityRuns.get(id);
  }
  async saveCapabilityRun(run: CapabilityRun): Promise<void> {
    this.capabilityRuns.set(run.id, run);
  }
  async listCapabilityReports(goalId: string): Promise<CapabilityReport[]> {
    return [...this.capabilityReports.values()]
      .filter((r) => r.goalId === goalId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }
  async getCapabilityReport(id: string): Promise<CapabilityReport | undefined> {
    return this.capabilityReports.get(id);
  }
  async saveCapabilityReport(report: CapabilityReport): Promise<void> {
    this.capabilityReports.set(report.id, report);
  }
  async deleteCapabilityDataByGoal(goalId: string): Promise<void> {
    this.capabilityItems.delete(goalId);
    for (const [id, r] of this.capabilityRuns) {
      if (r.goalId === goalId) this.capabilityRuns.delete(id);
    }
    for (const [id, r] of this.capabilityReports) {
      if (r.goalId === goalId) this.capabilityReports.delete(id);
    }
  }

  async listEvidence(): Promise<EvidenceEntry[]> {
    return [...this.evidenceLog].sort((a, b) => b.at - a.at);
  }
  async appendEvidence(entry: EvidenceEntry): Promise<void> {
    this.evidenceLog.push(entry);
    // 上限见 EVIDENCE_LOG_MAX 注释（F3 D2：500 → 5000）。超出保留最新。
    if (this.evidenceLog.length > EVIDENCE_LOG_MAX) {
      this.evidenceLog = this.evidenceLog.slice(-EVIDENCE_LOG_MAX);
    }
  }

  /**
   * 原子「查重后追加」（契约见 `StorageAdapter.appendEvidenceUnless`）。
   *
   * ⚠️ **临界区**：`some()` 与 `appendEvidence()` 之间**不得插入任何 `await`** ——
   * 单线程 JS 下这段同步路径就是原子的，一 `await` 就会让并发的第二次调用重新
   * 读到「尚无」并重复写入（这正是本方法要消灭的缺陷）。
   *
   * `this.appendEvidence` 走**动态派发**：`LocalStorageAdapter` 覆写了它，因而
   * 命中时也会落盘，本层无需再写一份上限/落盘逻辑（避免「两把尺子」）。
   */
  async appendEvidenceUnless(
    entry: EvidenceEntry,
    predicate: (existing: EvidenceEntry) => boolean,
  ): Promise<boolean> {
    if (this.evidenceLog.some(predicate)) return false;
    await this.appendEvidence(entry);
    return true;
  }

  /**
   * 清空整库（replace 导入用，见
   * docs/data-portability-export-import-design-2026-09.md §4.3.2）。
   *
   * 用「重新赋值」而不是 `Map.clear()`：与构造函数初值**逐字段同形**
   * （含 `learnerState = { byUnit: {} }`、`profile = undefined`、
   * `activeGoalId = undefined`、`evidenceLog = []`），避免将来新增字段时
   * 漏清一处而无人发现。字段清单与构造函数一一对应。
   *
   * ⚠️ **唯一例外：学习者记忆（F9 / D13-B）** —— 清库清的是「可再生的学习资产」，
   * 而记忆文档里**用户手写与改写过的行不可再生**。故先经
   * `pruneMemoryDocForClear` 裁掉系统可重算的条目、留下用户自己的字
   * （在清掉整库后，那些派生的「你常在深夜学习」就失去了依据，留着即错误）。
   */
  async clearAll(): Promise<void> {
    const keptMemory = pruneMemoryDocForClear(this.memoryDoc, this.memoryMeta);
    this.documents = new Map();
    this.chaptersByDocument = new Map();
    this.papers = new Map();
    this.paperDrafts = new Map();
    this.paperResults = new Map();
    this.graph = { units: [], relations: [] };
    this.learnerState = { byUnit: {} };
    this.profile = undefined;
    this.restatements = new Map();
    this.cardStates = {};
    this.annotations = new Map();
    this.goals = new Map();
    this.activeGoalId = undefined;
    this.evidenceLog = [];
    this.capabilityItems = new Map();
    this.capabilityRuns = new Map();
    this.capabilityReports = new Map();
    this.sections = new Map();
    this.chunks = new Map();
    this.knowledgeUnits = new Map();
    this.knowledgeRelations = new Map();
    this.embeddings = new Map();
    this.memoryDoc = keptMemory.doc;
    this.memoryMeta = keptMemory.meta;
  }

  // ===== 学习者记忆（F9）=====
  async getMemoryDoc(): Promise<string> {
    return this.memoryDoc;
  }
  async saveMemoryDoc(doc: string): Promise<void> {
    this.memoryDoc = doc;
  }
  /**
   * `lastWritten` / `dismissed` **深一层的浅拷贝**：调用方拿到独立对象，
   * 改它不会污染存储内部状态（与 `listCardStates` 同形态）。
   */
  async getMemoryMeta(): Promise<MemoryDocMeta> {
    return {
      ...this.memoryMeta,
      lastWritten: { ...this.memoryMeta.lastWritten },
      dismissed: [...this.memoryMeta.dismissed],
    };
  }
  async saveMemoryMeta(meta: MemoryDocMeta): Promise<void> {
    this.memoryMeta = meta;
  }
}

/**
 * 批注排序：`start` 升序，同起点用 `end` 兜底（保证全序，避免同起点时
 * 排序不稳定 → 顺序贪心消歧（D8）的结果在不同引擎上飘）。
 */
function byStart(a: Annotation, b: Annotation): number {
  return a.start - b.start || a.end - b.end;
}
