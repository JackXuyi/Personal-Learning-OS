/**
 * localStorage 持久化适配器——在浏览器预览中可跨刷新保留。
 *
 * 这是生产级 SQLite 后端（Tauri 侧）的*占位*实现。
 * 数据模型与 key 保持一致，因此后续切换只需改动一行的
 * 工厂函数。注意：localStorage 不得用于存放密钥。
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
import { InMemoryStorage } from "./memory";
import type { StorageAdapter } from "./types";

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
    localStorage.setItem(KEY_EMBEDDINGS, JSON.stringify([...this.embeddings.values()]));
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
