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
  /**
   * 删除整份文档的全部 chunk（含 FTS 索引与 chunk_knowledge 关联）。
   * 重切分与删除资料时调用；幂等（文档无 chunk 时是空操作）。
   *
   * 注意：**不清 embeddings** —— 向量按 targetId 记录，调用方须在删除前先取出
   * 旧 chunk id 逐个 `deleteEmbeddingsByTarget`，否则会留下指不到 chunk 的孤儿向量。
   */
  deleteChunksByDocument(documentId: string): Promise<void>;

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
  /**
   * 取回向量本体（检索用）。
   * @param targetType 目标类型（当前检索只消费 "chunk"）
   * @param targetIds  传值时按目标过滤（减少传输量）；不传 = 该类型全量
   *
   * 未持有向量的后端返回空数组（如纯 localStorage 预览、向量尚未生成）——
   * 调用方据此降级为 FTS-only 检索，而不是当成错误。
   */
  listEmbeddingVectors(
    targetType: EmbeddingTargetType,
    targetIds?: readonly string[],
  ): Promise<EmbeddingVector[]>;

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

  // ===== 学习者画像（F1；缺省 = 未填写，绝不自动写默认值）=====
  /** 未填写返回 `undefined`（调用方据此走「现状行为」，不制造假画像）。 */
  getProfile(): Promise<LearnerProfile | undefined>;
  /** 传 `undefined` = 清除画像（UC-07）。 */
  saveProfile(profile: LearnerProfile | undefined): Promise<void>;

  // ===== 章级复述（F5；决策 D1-A：落库；不参与掌握度）=====
  /** 某章的全部复述记录（createdAt 降序）。 */
  listRestatements(chapterId: string): Promise<Restatement[]>;
  /**
   * **全量**复述（F9 记忆的跨章聚合用）。
   *
   * 为什么需要：`listRestatements` 按章取，而「你的复述通常覆盖到 N%」是**跨章**结论；
   * 逐章遍历要求调用方先读全部 Chapter[]（本方法让记忆模块只需一个数字 `chapterCount`）。
   * 与其他 `list*` 一致按 `createdAt` 降序；只读，无副作用。
   */
  listAllRestatements(): Promise<Restatement[]>;
  /** 按 id upsert（先落文本、后回填 feedback 均为本方法）。 */
  saveRestatement(record: Restatement): Promise<void>;
  deleteRestatement(id: string): Promise<void>;

  // ===== 自测卡调度状态（F5 第 4 条；决策 D4-A：只落状态，卡面每次由 Chapter 派生）=====
  /** 全部卡级调度状态（key = `DerivedCard.id`）。 */
  listCardStates(): Promise<CardStateMap>;
  /** 按 cardId upsert（评分与撤销均走本方法）。 */
  saveCardState(state: CardState): Promise<void>;
  /** 批量删除（孤儿清理 / 用户重置进度）；**空数组 = 无操作**。 */
  deleteCardStates(cardIds: string[]): Promise<void>;

  // ===== 划线批注（F5 第 2 条；决策 D4：不写证据流、不参与掌握度）=====
  /**
   * 某章的全部批注，**按 `start` 升序**（与正文阅读顺序一致，且是 DOM 消歧的
   * 顺序依据 D8）。无批注返回空数组（不抛错）。
   */
  listAnnotationsByChapter(chapterId: string): Promise<Annotation[]>;
  /** 某资料的全部批注（按 `start` 升序；重切分后重定位用）。 */
  listAnnotations(documentId: string): Promise<Annotation[]>;
  /**
   * **全量**批注（F9 记忆的划线密度/笔记占比用）。
   *
   * 同 `listAllRestatements`：跨资料聚合不该要求调用方先遍历文档列表。
   * 排序与 `listAnnotations` 一致（`start` 升序、同起点 `end` 兜底）。
   */
  listAllAnnotations(): Promise<Annotation[]>;
  /** 按 id upsert（新建 / 改笔记均为本方法）。 */
  saveAnnotation(annotation: Annotation): Promise<void>;
  /** 单条删除（用户手动删除）。幂等（删不存在的 id 不抛错）。 */
  deleteAnnotation(id: string): Promise<void>;
  /** 整批删除（孤儿清理 / 重切分后重定位失败）；**空数组 = 无操作**。 */
  deleteAnnotations(ids: string[]): Promise<void>;

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

  // ===== 目标级能力评测（F6；决策 D5-A：独立证据层，绝不写 LearnerState）=====
  /**
   * 某目标的能力项清单（`createdAt` 升序 = 展示顺序）。
   * 不存在的目标返回空数组（不抛错 —— 调用方据此走「建立能力框架」空态）。
   */
  listCapabilityItems(goalId: string): Promise<CapabilityItem[]>;
  /** 整批写回（清单编辑 = 全量覆盖）。**空数组 = 清空该目标清单**。 */
  saveCapabilityItems(goalId: string, items: CapabilityItem[]): Promise<void>;
  /** 某目标的全部评测运行（`createdAt` 降序）。 */
  listCapabilityRuns(goalId: string): Promise<CapabilityRun[]>;
  getCapabilityRun(id: string): Promise<CapabilityRun | undefined>;
  /** 按 id upsert（草稿作答、提交、评分回填均为本方法）。 */
  saveCapabilityRun(run: CapabilityRun): Promise<void>;
  /** 某目标的全部报告（`createdAt` 降序；append-only —— 重评产生新报告）。 */
  listCapabilityReports(goalId: string): Promise<CapabilityReport[]>;
  getCapabilityReport(id: string): Promise<CapabilityReport | undefined>;
  /** 按 id upsert；**报告不原地更新**（同 id 仅用于幂等重放）。 */
  saveCapabilityReport(report: CapabilityReport): Promise<void>;
  /** 目标级联清理（UC-08）：清空清单 + 删除该目标全部 run / report。幂等。 */
  deleteCapabilityDataByGoal(goalId: string): Promise<void>;

  /**
   * 清空整库（replace 导入的唯一手段，见
   * docs/data-portability-export-import-design-2026-09.md §4.3.2）。
   *
   * 语义边界：只清**本适配器负责的实体**（即导出白名单 20 项，见
   * `features/data/portability/backup-format.ts::BACKUP_FIELDS`）；
   * **不碰** UI 偏好（`plos:settings:v1` / `plos:lang:v1`）、**不碰**密钥
   * （Keychain）、**不碰**内部迁移标记（`plos.rag.migrated.v1` /
   * `plos.graph.migrated.v2`）与 Rust 侧日志配置。幂等。
   *
   * ⚠️ **例外（F9 / D13-B）**：学习者记忆**不整份清除** —— 系统可重算的条目丢掉，
   * 但**用户手写与改写过的行保留**（见 `domain/memory.ts::pruneMemoryDocForClear`）。
   * 理由：清库是清「可再生的学习资产」，而用户自己写的字不可再生。
   *
   * ⚠️ 新增实体时：本方法、导出白名单、导入写入顺序**三处必须同步** ——
   * 漏一处就是「导出带走了、恢复时被丢」的静默数据丢失。
   */
  clearAll(): Promise<void>;

  // ===== 学习者记忆（F9；缺省 = 空串 / 空元数据，绝不自动生成）=====
  /**
   * 记忆文档正文（markdown）。**未接入时返回 `""`**（调用方据此走空分支，零回归）。
   *
   * ⚠️ 这是**真源**：页面展示、AI 注入、磁盘镜像全部由它派生。
   * 解析一律走 `domain/memory.ts::parseMemoryDoc`（`ai/` 与 `features/` 共用）。
   */
  getMemoryDoc(): Promise<string>;
  /** 全量覆盖写入（文档是单个字符串，天然全量）。 */
  saveMemoryDoc(doc: string): Promise<void>;

  /** 文档侧元数据（`lastWritten` / `dismissed` / 时间戳）。缺省 = 空对象。 */
  getMemoryMeta(): Promise<MemoryDocMeta>;
  saveMemoryMeta(meta: MemoryDocMeta): Promise<void>;
}
