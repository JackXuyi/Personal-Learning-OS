/**
 * localStorage 持久化适配器——在浏览器预览中可跨刷新保留。
 *
 * 这是生产级 SQLite 后端（Tauri 侧）的*占位*实现。
 * 数据模型与 key 保持一致，因此后续切换只需改动一行的
 * 工厂函数。注意：localStorage 不得用于存放密钥。
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
import { InMemoryStorage } from "./memory";
import type { ImportedPackRecord, StorageAdapter } from "./types";

const KEY_DOCUMENTS = "plos.documents";
const KEY_CHAPTERS = "plos.chapters";
// RAG 存储层新增
const KEY_SECTIONS = "plos.sections";
const KEY_CHUNKS = "plos.chunks";
const KEY_KNOWLEDGE_UNITS = "plos.knowledge-units";
const KEY_KNOWLEDGE_RELATIONS = "plos.knowledge-relations";
const KEY_EMBEDDINGS = "plos.embeddings";
const KEY_PAPERS = "plos.papers";
const KEY_PAPER_DRAFTS = "plos.paper-drafts";
const KEY_PAPER_RESULTS = "plos.paper-results";
const KEY_GRAPH = "plos.graph";
const KEY_LEARNER = "plos.learner";
/** 学习者画像（F1）：与 LearnerState / Goal 同层，TauriStorage 自动继承。 */
const KEY_PROFILE = "plos.learner-profile";
/** 章级复述（F5）：新 key，无旧数据 → 零迁移。 */
const KEY_RESTATEMENTS = "plos.restatements";
/** 自测卡调度状态（F5 第 4 条）：新 key，无旧数据 → 零迁移。 */
const KEY_CARDS = "plos.flashcards";
/** 划线批注（F5 第 2 条）：新 key，无旧数据 → 零迁移。 */
const KEY_ANNOTATIONS = "plos.annotations";
const KEY_GOALS = "plos.goals";
const KEY_ACTIVE_GOAL = "plos.active-goal";
const KEY_EVIDENCE = "plos.evidence";
/** 目标级能力评测（F6）：三个新 key，无旧数据 → 零迁移。 */
const KEY_CAPABILITY_ITEMS = "plos.capability-items";
const KEY_CAPABILITY_RUNS = "plos.capability-runs";
const KEY_CAPABILITY_REPORTS = "plos.capability-reports";
/**
 * 学习者记忆（F9）：两个新 key，无旧数据 → 零迁移。
 *
 * ⚠️ `plos.memory.doc.v1` 的值是**纯 markdown 文本**，不是 JSON —— 落盘时
 * **绝不 `JSON.stringify`**（会多一层引号与转义，且 `\n` 变 `\\n`，用户拿编辑器
 * 打开磁盘镜像时会看到一行 `\n` 字面量）。这是本适配器唯一一处偏离「实体一律 JSON」
 * 的存储点，见方案 §4.3.4。
 */
const KEY_MEMORY_DOC = "plos.memory.doc.v1";
const KEY_MEMORY_META = "plos.memory.meta.v1";
/**
 * 已导入的社区知识包记录（F10）：新 key，无旧数据 → 零迁移。
 *
 * ⚠️ **必须进 `ALL_KEYS`** —— 否则 `clearAll()`（replace 导入 / 清库）跑完它还在盘上，
 * 下次打开会看到「清空了的库里仍列着已导入的包」（F9 的两个记忆 key 踩过同一个坑）。
 */
const KEY_IMPORTED_PACKS = "plos.knowledge-packs.v1";

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export class LocalStorageAdapter extends InMemoryStorage implements StorageAdapter {
  // 显式标注 string：子类（TauriStorage）要覆盖成别的字面量，
  // 若此处推导成 "local" 字面量类型，子类覆盖会报 TS2416。
  override readonly name: string = "local";

  constructor() {
    super();
    this.documents = new Map(
      load<SourceDocument[]>(KEY_DOCUMENTS, []).map((d) => [d.id, d]),
    );
    this.chaptersByDocument = new Map(
      Object.entries(load<Record<string, Chapter[]>>(KEY_CHAPTERS, {})),
    );
    // RAG 存储层：Section / Chunk / Knowledge / Relation / Embedding
    this.sections = new Map(load<Section[]>(KEY_SECTIONS, []).map((s) => [s.id, s]));
    this.chunks = new Map(load<Chunk[]>(KEY_CHUNKS, []).map((c) => [c.id, c]));
    this.knowledgeUnits = new Map(
      load<KnowledgeUnit[]>(KEY_KNOWLEDGE_UNITS, []).map((u) => [u.id, u]),
    );
    this.knowledgeRelations = new Map(
      load<KnowledgeRelation[]>(KEY_KNOWLEDGE_RELATIONS, []).map((r) => [r.id, r]),
    );
    this.embeddings = new Map(
      load<Embedding[]>(KEY_EMBEDDINGS, []).map((e) => [e.id, e]),
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
    this.profile = load<LearnerProfile | undefined>(KEY_PROFILE, undefined);
    this.restatements = new Map(
      load<Restatement[]>(KEY_RESTATEMENTS, []).map((r) => [r.id, r]),
    );
    this.cardStates = load<CardStateMap>(KEY_CARDS, {});
    this.annotations = new Map(
      load<Annotation[]>(KEY_ANNOTATIONS, []).map((a) => [a.id, a]),
    );
    this.goals = new Map(load<LearningGoal[]>(KEY_GOALS, []).map((g) => [g.id, g]));
    this.activeGoalId = load<string | undefined>(KEY_ACTIVE_GOAL, undefined);
    this.evidenceLog = load<EvidenceEntry[]>(KEY_EVIDENCE, []);
    // 目标级能力评测（F6）
    this.capabilityItems = new Map(
      Object.entries(load<Record<string, CapabilityItem[]>>(KEY_CAPABILITY_ITEMS, {})),
    );
    this.capabilityRuns = new Map(
      load<CapabilityRun[]>(KEY_CAPABILITY_RUNS, []).map((r) => [r.id, r]),
    );
    this.capabilityReports = new Map(
      load<CapabilityReport[]>(KEY_CAPABILITY_REPORTS, []).map((r) => [r.id, r]),
    );
    // 学习者记忆（F9）
    this.memoryDoc = load<string>(KEY_MEMORY_DOC, "");
    this.memoryMeta = load<MemoryDocMeta>(KEY_MEMORY_META, {
      lastWritten: {},
      dismissed: [],
      lastMergedAt: 0,
    });
    // 已导入的社区知识包（F10）：数组 → Map（key = contentHash）
    this.importedPacks = new Map(
      load<ImportedPackRecord[]>(KEY_IMPORTED_PACKS, []).map((r) => [r.contentHash, r]),
    );
  }

  /**
   * 持久化前剥离向量本体。
   *
   * 为什么：1000 chunk × 768 维的 JSON 约 15MB，必然击穿 localStorage 5–10MB 配额，
   * 一旦写失败会让**整个 persist() 抛错**，连带资料 / 章节 / 学习进度都写不进去。
   * 因此 localStorage 后端只持久化向量元数据；本会话内存镜像仍持有向量，
   * 刷新后 `listEmbeddingVectors` 返回空 → 检索自动降级为纯 FTS（与 D1-A 一致）。
   */
  private embeddingsForPersist(): Embedding[] {
    return [...this.embeddings.values()].map(({ vector: _vector, ...meta }) => meta);
  }

  /**
   * 只写「文档 / 章节」两个 key。
   *
   * 为什么拆出来：`TauriStorage` 需要在 **RAG 降级兜底** 路径上重写 localStorage
   * （如 `super.saveSection()` → `persist()`），但文档 / 章节**已下沉 SQLite**
   * （D12）—— 再写一次 `KEY_DOCUMENTS` 会：
   * ① 击穿配额（那是整库正文，正是下沉要躲的那堵墙）；
   * ② 让「冻结的迁移快照」变得新鲜可信 → 变成**假灾备**（看着有副本，其实过时）。
   */
  protected persistDocuments(): void {
    localStorage.setItem(KEY_DOCUMENTS, JSON.stringify([...this.documents.values()]));
    localStorage.setItem(
      KEY_CHAPTERS,
      JSON.stringify(Object.fromEntries(this.chaptersByDocument)),
    );
  }

  /**
   * 其余 key（22 个）。逐行原样搬自原 `persist()` —— **不改任何一行**。
   *
   * 与 `persistDocuments()` 的边界是「是否属于已下沉 SQLite 的实体」：
   * 将来再有实体下沉时，从这里移出去即可，`persist()` 本身不用动。
   */
  protected persistRest(): void {
    // RAG 存储层持久化
    localStorage.setItem(KEY_SECTIONS, JSON.stringify([...this.sections.values()]));
    localStorage.setItem(KEY_CHUNKS, JSON.stringify([...this.chunks.values()]));
    localStorage.setItem(
      KEY_KNOWLEDGE_UNITS,
      JSON.stringify([...this.knowledgeUnits.values()]),
    );
    localStorage.setItem(
      KEY_KNOWLEDGE_RELATIONS,
      JSON.stringify([...this.knowledgeRelations.values()]),
    );
    localStorage.setItem(KEY_EMBEDDINGS, JSON.stringify(this.embeddingsForPersist()));
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
    // 未填写 = 移除 key（而非写入字符串 "undefined"）：load 的 `raw ? … : fallback`
    // 会回落 undefined，与「未填写」语义一致。
    if (this.profile === undefined) localStorage.removeItem(KEY_PROFILE);
    else localStorage.setItem(KEY_PROFILE, JSON.stringify(this.profile));
    localStorage.setItem(KEY_RESTATEMENTS, JSON.stringify([...this.restatements.values()]));
    localStorage.setItem(KEY_CARDS, JSON.stringify(this.cardStates));
    localStorage.setItem(KEY_ANNOTATIONS, JSON.stringify([...this.annotations.values()]));
    localStorage.setItem(KEY_GOALS, JSON.stringify([...this.goals.values()]));
    localStorage.setItem(KEY_EVIDENCE, JSON.stringify(this.evidenceLog));
    // 目标级能力评测（F6）
    localStorage.setItem(
      KEY_CAPABILITY_ITEMS,
      JSON.stringify(Object.fromEntries(this.capabilityItems)),
    );
    localStorage.setItem(KEY_CAPABILITY_RUNS, JSON.stringify([...this.capabilityRuns.values()]));
    localStorage.setItem(
      KEY_CAPABILITY_REPORTS,
      JSON.stringify([...this.capabilityReports.values()]),
    );
    // 学习者记忆（F9）：文档是纯文本 → **直接 setItem，不 JSON.stringify**（见 key 处注释）
    localStorage.setItem(KEY_MEMORY_DOC, this.memoryDoc);
    localStorage.setItem(KEY_MEMORY_META, JSON.stringify(this.memoryMeta));
    // 已导入的社区知识包（F10）
    localStorage.setItem(KEY_IMPORTED_PACKS, JSON.stringify([...this.importedPacks.values()]));
  }

  protected persist() {
    this.persistDocuments();
    this.persistRest();
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

  // ===== RAG 存储层写操作（override 以触发持久化）=====
  override async saveSection(section: Section): Promise<void> {
    await super.saveSection(section);
    this.persist();
  }
  override async saveSections(sections: Section[]): Promise<void> {
    await super.saveSections(sections);
    this.persist();
  }
  override async deleteSection(id: string): Promise<void> {
    await super.deleteSection(id);
    this.persist();
  }

  override async saveChunk(chunk: Chunk): Promise<void> {
    await super.saveChunk(chunk);
    this.persist();
  }
  override async saveChunks(chunks: Chunk[]): Promise<void> {
    await super.saveChunks(chunks);
    this.persist();
  }
  override async deleteChunk(id: string): Promise<void> {
    await super.deleteChunk(id);
    this.persist();
  }
  override async deleteChunksByDocument(documentId: string): Promise<void> {
    await super.deleteChunksByDocument(documentId);
    this.persist();
  }

  override async saveKnowledgeUnit(unit: KnowledgeUnit): Promise<void> {
    await super.saveKnowledgeUnit(unit);
    this.persist();
  }
  override async saveKnowledgeUnits(units: KnowledgeUnit[]): Promise<void> {
    await super.saveKnowledgeUnits(units);
    this.persist();
  }
  override async deleteKnowledgeUnit(id: string): Promise<void> {
    await super.deleteKnowledgeUnit(id);
    this.persist();
  }

  override async saveRelation(relation: KnowledgeRelation): Promise<void> {
    await super.saveRelation(relation);
    this.persist();
  }
  override async saveRelations(relations: KnowledgeRelation[]): Promise<void> {
    await super.saveRelations(relations);
    this.persist();
  }
  override async deleteRelation(id: string): Promise<void> {
    await super.deleteRelation(id);
    this.persist();
  }

  override async saveEmbedding(embedding: Embedding): Promise<void> {
    await super.saveEmbedding(embedding);
    this.persist();
  }
  override async saveEmbeddings(embeddings: Embedding[]): Promise<void> {
    await super.saveEmbeddings(embeddings);
    this.persist();
  }
  override async deleteEmbedding(id: string): Promise<void> {
    await super.deleteEmbedding(id);
    this.persist();
  }
  override async deleteEmbeddingsByTarget(targetId: string): Promise<void> {
    await super.deleteEmbeddingsByTarget(targetId);
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
  override async saveProfile(profile: LearnerProfile | undefined): Promise<void> {
    await super.saveProfile(profile);
    this.persist();
  }
  override async saveRestatement(record: Restatement): Promise<void> {
    await super.saveRestatement(record);
    this.persist();
  }
  override async deleteRestatement(id: string): Promise<void> {
    await super.deleteRestatement(id);
    this.persist();
  }
  override async saveCardState(state: CardState): Promise<void> {
    await super.saveCardState(state);
    this.persist();
  }
  override async deleteCardStates(cardIds: string[]): Promise<void> {
    // 空数组短路：不做无意义的整库回写（单测 TC-EDGE-10）
    if (cardIds.length === 0) return;
    await super.deleteCardStates(cardIds);
    this.persist();
  }

  // ===== 划线批注（F5 第 2 条）写操作 override =====
  override async saveAnnotation(annotation: Annotation): Promise<void> {
    await super.saveAnnotation(annotation);
    this.persist();
  }
  override async deleteAnnotation(id: string): Promise<void> {
    await super.deleteAnnotation(id);
    this.persist();
  }
  override async deleteAnnotations(ids: string[]): Promise<void> {
    // 空数组短路：与 deleteCardStates 同体例（避免整库回写）
    if (ids.length === 0) return;
    await super.deleteAnnotations(ids);
    this.persist();
  }
  override async saveGoal(goal: LearningGoal): Promise<void> {
    await super.saveGoal(goal);
    this.persist();
  }
  /**
   * 删除目标：`super` 已级联清理该目标的能力数据（F6 / UC-08，见 memory.ts），
   * 故此处只需落盘 —— **不要**在此重复调用 `deleteCapabilityDataByGoal`。
   */
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

  // ===== 目标级能力评测（F6）写操作 override =====
  override async saveCapabilityItems(goalId: string, items: CapabilityItem[]): Promise<void> {
    await super.saveCapabilityItems(goalId, items);
    this.persist();
  }
  override async saveCapabilityRun(run: CapabilityRun): Promise<void> {
    await super.saveCapabilityRun(run);
    this.persist();
  }
  override async saveCapabilityReport(report: CapabilityReport): Promise<void> {
    await super.saveCapabilityReport(report);
    this.persist();
  }
  override async deleteCapabilityDataByGoal(goalId: string): Promise<void> {
    await super.deleteCapabilityDataByGoal(goalId);
    this.persist();
  }

  // ===== 学习者记忆（F9）写操作 override =====
  override async saveMemoryDoc(doc: string): Promise<void> {
    await super.saveMemoryDoc(doc);
    this.persist();
  }
  override async saveMemoryMeta(meta: MemoryDocMeta): Promise<void> {
    await super.saveMemoryMeta(meta);
    this.persist();
  }

  // ===== 已导入的社区知识包（F10）写操作 override =====
  // （`listImportedPacks` 是只读，无需 override —— 落盘只在写点触发。）
  override async saveImportedPack(record: ImportedPackRecord): Promise<void> {
    await super.saveImportedPack(record);
    this.persist();
  }
  override async deleteImportedPack(contentHash: string): Promise<void> {
    await super.deleteImportedPack(contentHash);
    this.persist();
  }

  /**
   * 本适配器负责的全部 key（清库真源）。
   *
   * ⚠️ 必须与 `persist()` 写入的 key 集合 + `KEY_ACTIVE_GOAL`（走独立路径、
   * 不随 `persist()`）保持一致；新增 key 时**两处同步**，否则就是「导出带走了、
   * 清库清不掉」的脏残留。**不含** `plos:settings:v1` / `plos:lang:v1`
   * 与两个迁移 flag（内部状态，见 clearAll 语义边界）。
   */
  private static readonly ALL_KEYS: readonly string[] = [
    KEY_DOCUMENTS,
    KEY_CHAPTERS,
    KEY_SECTIONS,
    KEY_CHUNKS,
    KEY_KNOWLEDGE_UNITS,
    KEY_KNOWLEDGE_RELATIONS,
    KEY_EMBEDDINGS,
    KEY_PAPERS,
    KEY_PAPER_DRAFTS,
    KEY_PAPER_RESULTS,
    KEY_GRAPH,
    KEY_LEARNER,
    KEY_PROFILE,
    KEY_RESTATEMENTS,
    KEY_CARDS,
    KEY_ANNOTATIONS,
    KEY_GOALS,
    KEY_ACTIVE_GOAL,
    KEY_EVIDENCE,
    KEY_CAPABILITY_ITEMS,
    KEY_CAPABILITY_RUNS,
    KEY_CAPABILITY_REPORTS,
    KEY_MEMORY_DOC,
    KEY_MEMORY_META,
    KEY_IMPORTED_PACKS,
  ];

  /**
   * 清空整库（replace 导入用）。
   *
   * 内存侧走基类的重建，落盘侧**逐个 `removeItem`** —— 刻意不调 `persist()`：
   * 那会把 24 个 key 写成 `"[]"` 垃圾值（且 `profile` 分支走 removeItem，
   * 同一方法里两种语义混淆）。清完就是「这台机器上没安装过数据」的状态，
   * 与 `load()` 的 `raw ? … : fallback` 回落语义一致。
   *
   * ⚠️ **F9 / D13-B（记忆例外）**：两个记忆 key 在 `ALL_KEYS` 里（不留在盘上成为
   * 「清不掉」的脏 key），但基类已把 `memoryDoc` / `memoryMeta` 裁成
   * 「只剩用户手写与改写过的行」—— 故 removeItem 之后**再把这份残留写回去**。
   * 顺序不能反（先写后删 = 白写）。
   */
  override async clearAll(): Promise<void> {
    await super.clearAll();
    for (const key of LocalStorageAdapter.ALL_KEYS) {
      try {
        localStorage.removeItem(key);
      } catch {
        /* 隐私模式 / 配额异常：内存已清空，落盘残留不阻塞主流程 */
      }
    }
    try {
      const hasKeptDoc = this.memoryDoc !== "";
      const hasIntent = this.memoryMeta.dismissed.length > 0;
      if (hasKeptDoc) localStorage.setItem(KEY_MEMORY_DOC, this.memoryDoc);
      if (hasKeptDoc || hasIntent) {
        localStorage.setItem(KEY_MEMORY_META, JSON.stringify(this.memoryMeta));
      }
    } catch {
      /* 同上：记忆是派生数据，写失败不阻塞清库（内存侧已正确） */
    }
  }
}
