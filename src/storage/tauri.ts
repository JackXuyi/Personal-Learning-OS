/**
 * Tauri SQLite 后端 —— RAG 存储层的生产实现（T7）。
 *
 * 分层：Section / Chunk / KnowledgeUnit / KnowledgeRelation / Embedding 五类实体
 * 走 `db_*` 命令落到 `app_data_dir/plos.db`；Document / Chapter / Paper / Goal /
 * LearnerState / Evidence 仍由父类（localStorage）承载——迁移期避免双写，
 * 待 T9 迁移工具上线后由 SQLite 全量接管。
 *
 * 降级（RAG Spec §45）：SQLite 命令抛错（命令未注册 / 建库失败 / 查询异常）时
 * 静默回退到父类同名方法，保证桌面端永不因存储故障而不可用。
 *
 * T9 迁移：首次确认 SQLite 可用时，把 localStorage 侧的遗留 RAG 数据一次性
 * 搬进 SQLite（`migrateLegacyRagData()`），幂等且失败不影响主流程。
 *
 * 序列化约定与 Rust `src-tauri/src/db/models.rs` 严格镜像：
 * - 顶层参数用 camelCase（`#[tauri::command]` 默认 ArgumentCase::Camel）；
 * - 嵌套结构体字段名也是 camelCase（models.rs 已加 rename_all）。
 */
import { invoke } from "@tauri-apps/api/core";
import type {
  Chunk,
  Embedding,
  EmbeddingTargetType,
  EmbeddingVector,
  KnowledgeRelation,
  KnowledgeUnit,
  Section,
} from "../domain";
import { LocalStorageAdapter } from "./local";
import type { RetrievalScope, StorageAdapter } from "./types";

// ===== DTO：Rust db/models.rs 的 TS 镜像（字段名 camelCase）=====

interface SectionDto {
  id: string;
  chapterId: string;
  documentId: string;
  title: string;
  level: number;
  idx: number;
  contentRefStart: number;
  contentRefEnd: number;
  createdAt: number;
}

interface ChunkDto {
  id: string;
  documentId: string;
  chapterId: string;
  sectionId?: string;
  content: string;
  position: number;
  tokenCount?: number;
  metadataHeading?: string;
  metadataPage?: number;
  metadataSourceLocation?: string;
  knowledgeIds: string[];
  createdAt: number;
}

interface KnowledgeUnitDto {
  id: string;
  title: string;
  kind: string;
  summary?: string;
  sourceDocumentId?: string;
  tags: string[];
  createdAt: number;
}

interface KnowledgeRelationDto {
  id: string;
  fromId: string;
  toId: string;
  relType: string;
  strength?: number;
  createdAt: number;
}

interface EmbeddingDto {
  id: string;
  targetType: string;
  targetId: string;
  model: string;
  vectorDim: number;
  /** 向量本体（v3）。写入时带上；读路径（listEmbeddings）不回传。 */
  vector?: number[];
  createdAt: number;
}

/** `db_list_embedding_vectors` 返回体（检索用轻量视图）。 */
interface EmbeddingVectorDto {
  targetId: string;
  model: string;
  dim: number;
  vector: number[];
}

// ===== 领域对象 ↔ DTO 映射 =====
// 差异点：TS 用嵌套对象（Section.contentRef / Chunk.metadata），
// SQLite 为列式存储故拆平；TS KnowledgeRelation 无 createdAt，写入时补当前时间。

function toSectionDto(s: Section): SectionDto {
  return {
    id: s.id,
    chapterId: s.chapterId,
    documentId: s.documentId,
    title: s.title,
    level: s.level,
    idx: s.index,
    contentRefStart: s.contentRef.start,
    contentRefEnd: s.contentRef.end,
    createdAt: s.createdAt,
  };
}

function fromSectionDto(d: SectionDto): Section {
  return {
    id: d.id,
    chapterId: d.chapterId,
    documentId: d.documentId,
    title: d.title,
    level: d.level,
    index: d.idx,
    contentRef: { start: d.contentRefStart, end: d.contentRefEnd },
    createdAt: d.createdAt,
  };
}

function toChunkDto(c: Chunk): ChunkDto {
  return {
    id: c.id,
    documentId: c.documentId,
    chapterId: c.chapterId,
    sectionId: c.sectionId,
    content: c.content,
    position: c.position,
    tokenCount: c.tokenCount,
    metadataHeading: c.metadata?.heading,
    metadataPage: c.metadata?.page,
    metadataSourceLocation: c.metadata?.sourceLocation,
    knowledgeIds: c.knowledgeIds ?? [],
    createdAt: c.createdAt,
  };
}

function fromChunkDto(d: ChunkDto): Chunk {
  const hasMetadata =
    d.metadataHeading !== undefined ||
    d.metadataPage !== undefined ||
    d.metadataSourceLocation !== undefined;
  return {
    id: d.id,
    documentId: d.documentId,
    chapterId: d.chapterId,
    sectionId: d.sectionId,
    content: d.content,
    position: d.position,
    tokenCount: d.tokenCount,
    knowledgeIds: d.knowledgeIds ?? [],
    ...(hasMetadata
      ? {
          metadata: {
            heading: d.metadataHeading,
            page: d.metadataPage,
            sourceLocation: d.metadataSourceLocation,
          },
        }
      : {}),
    createdAt: d.createdAt,
  };
}

function toUnitDto(u: KnowledgeUnit): KnowledgeUnitDto {
  return {
    id: u.id,
    title: u.title,
    kind: u.kind,
    summary: u.summary,
    sourceDocumentId: u.sourceDocumentId,
    tags: u.tags ?? [],
    createdAt: u.createdAt,
  };
}

function fromUnitDto(d: KnowledgeUnitDto): KnowledgeUnit {
  return {
    id: d.id,
    title: d.title,
    kind: d.kind as KnowledgeUnit["kind"],
    summary: d.summary,
    sourceDocumentId: d.sourceDocumentId,
    tags: d.tags ?? [],
    createdAt: d.createdAt,
  };
}

function toRelationDto(r: KnowledgeRelation): KnowledgeRelationDto {
  return {
    id: r.id,
    fromId: r.fromId,
    toId: r.toId,
    relType: r.type,
    strength: r.strength,
    // 领域类型无 createdAt：以写入时刻补齐（SQLite 列非空）。
    createdAt: Date.now(),
  };
}

function fromRelationDto(d: KnowledgeRelationDto): KnowledgeRelation {
  return {
    id: d.id,
    fromId: d.fromId,
    toId: d.toId,
    type: d.relType as KnowledgeRelation["type"],
    strength: d.strength,
  };
}

function toEmbeddingDto(e: Embedding): EmbeddingDto {
  return {
    id: e.id,
    targetType: e.targetType,
    targetId: e.targetId,
    model: e.model,
    vectorDim: e.vectorDim,
    // undefined 不写进 JSON（Rust 侧 serde default → None → SQL NULL）。
    ...(e.vector ? { vector: e.vector } : {}),
    createdAt: e.createdAt,
  };
}

function fromEmbeddingDto(d: EmbeddingDto): Embedding {
  return {
    id: d.id,
    targetType: d.targetType as Embedding["targetType"],
    targetId: d.targetId,
    model: d.model,
    vectorDim: d.vectorDim,
    createdAt: d.createdAt,
  };
}

/**
 * 遗留 RAG 数据迁移完成标记（存在 localStorage）。
 * 换版本号即可让下一次启动重新搬一次（例如修了迁移逻辑之后）。
 */
const RAG_MIGRATION_FLAG = "plos.rag.migrated.v1";

/** `db_status` 返回体（健康探针）。 */
export interface DbStatus {
  ready: boolean;
  counts: {
    sections: number;
    chunks: number;
    knowledgeUnits: number;
    relations: number;
    embeddings: number;
  };
}

/**
 * SQLite 调用结果：`ok: false` 表示不可用/失败，调用方应回退 localStorage。
 * 用判别式而非 `undefined`/`null`，是因为 Rust `Result<(), _>` 序列化成
 * `null`、`Option<T>` 的"无记录"也是 `null`——两者不能靠空值区分。
 */
type SqliteResult<T> = { ok: true; value: T } | { ok: false };

/**
 * 桌面端存储适配器：RAG 五类实体落 SQLite，其余沿用 localStorage。
 *
 * 注意：构造时**不**主动探测 SQLite（避免异步副作用），首次调用 RAG 方法时
 * 惰性探测；也可用 `probe()` 显式探测（迁移工具 / 设置页排障用）。
 */
export class TauriStorage extends LocalStorageAdapter implements StorageAdapter {
  override readonly name = "tauri";

  /** null = 未探测；true = 可用；false = 已降级。 */
  private sqliteReady: boolean | null = null;
  /** 降级告警只打一次，用独立标记（避免与 sqliteReady 的流分析互相干扰）。 */
  private warned = false;
  /** 一次性迁移任务（并发去重）；null = 尚未开始。 */
  private migration: Promise<number> | null = null;

  /** 探测 SQLite 是否就绪（并刷新内部状态）。 */
  async probe(): Promise<boolean> {
    try {
      await invoke<DbStatus>("db_status");
      const firstSuccess = this.sqliteReady !== true;
      this.sqliteReady = true;
      if (firstSuccess) await this.ensureMigration();
      return true;
    } catch {
      this.sqliteReady = false;
      return false;
    }
  }

  // ===== T9 · localStorage → SQLite 一次性迁移 =====

  /**
   * 把父类（localStorage）侧的遗留 RAG 数据搬进 SQLite。
   *
   * 触发时机：惰性——首次确认 SQLite 可用时（构造函数不做异步副作用）。
   *
   * 幂等三重保障：
   *  1) localStorage 标记 `RAG_MIGRATION_FLAG`；
   *  2) 写入全为 upsert（Rust 侧 ON CONFLICT DO UPDATE；chunk_knowledge /
   *     chunks_fts 先删后插），重复执行只覆盖不翻倍；
   *  3) 无遗留数据时立即返回。
   *
   * 为什么不清空 localStorage：SQLite 后续若故障会回退读 localStorage，
   * 留着副本等于一份免费灾备。
   *
   * @returns 搬移的实体总数；-1 = 失败（不写标记，下次启动重试）。
   */
  async migrateLegacyRagData(): Promise<number> {
    if (this.readMigrationFlag()) return 0;
    try {
      // 直接读父类内存镜像：LocalStorageAdapter 构造时已把全部 key 载入，
      // 而接口层没有 listAllSections 之类的全量方法，逐章遍历既低效又拿不全
      // （文档被删后残留的孤儿 Section 就漏了）。
      const sections = [...this.sections.values()];
      const chunks = [...this.chunks.values()];
      const units = [...this.knowledgeUnits.values()];
      const relations = [...this.knowledgeRelations.values()];
      const embeddings = [...this.embeddings.values()];
      const total =
        sections.length +
        chunks.length +
        units.length +
        relations.length +
        embeddings.length;
      if (total === 0) {
        this.writeMigrationFlag();
        return 0;
      }

      // 顺序：先本体后关联（无外键约束，仅为排障时日志可读）。
      if (sections.length > 0) {
        await invoke("db_save_sections", { sections: sections.map(toSectionDto) });
      }
      if (units.length > 0) {
        await invoke("db_save_knowledge_units", { units: units.map(toUnitDto) });
      }
      if (relations.length > 0) {
        await invoke("db_save_relations", { relations: relations.map(toRelationDto) });
      }
      if (chunks.length > 0) {
        await invoke("db_save_chunks", { chunks: chunks.map(toChunkDto) });
      }
      if (embeddings.length > 0) {
        await invoke("db_save_embeddings", { embeddings: embeddings.map(toEmbeddingDto) });
      }

      this.writeMigrationFlag();
      console.info(`[storage] 遗留 RAG 数据已迁入 SQLite：${total} 条`);
      return total;
    } catch (err) {
      console.warn("[storage] 遗留 RAG 数据迁移失败，下次启动重试", err);
      return -1;
    }
  }

  /** 首次确认 SQLite 可用后触发一次性迁移（并发安全）。 */
  private ensureMigration(): Promise<number> {
    this.migration ??= this.migrateLegacyRagData();
    return this.migration;
  }

  private readMigrationFlag(): boolean {
    try {
      return localStorage.getItem(RAG_MIGRATION_FLAG) === "1";
    } catch {
      return false; // localStorage 不可用 → 当作未迁移
    }
  }

  private writeMigrationFlag(): void {
    try {
      localStorage.setItem(RAG_MIGRATION_FLAG, "1");
    } catch {
      // 写不进去（配额 / 隐私模式）只影响效率：写入本身幂等，下次启动重来一遍。
    }
  }

  /** 清掉降级标记，下次调用重新探测（用户排障后手动重试）。 */
  resetHealth(): void {
    this.sqliteReady = null;
  }

  /** 当前是否处于降级态（未探测也算 false，语义是"尚未证明可用"）。 */
  get usingSqlite(): boolean {
    return this.sqliteReady === true;
  }

  /**
   * 统一 IPC 调用。失败只告警一次，之后本会话内直接走降级路径，
   * 避免每个方法都刷一遍控制台。
   */
  private async trySqlite<T>(
    cmd: string,
    args: Record<string, unknown>,
  ): Promise<SqliteResult<T>> {
    if (this.sqliteReady === false) return { ok: false };
    try {
      const value = await invoke<T>(cmd, args);
      const firstSuccess = this.sqliteReady !== true;
      this.sqliteReady = true;
      // 首次握手成功即触发遗留数据迁移（失败也不影响本次读取结果）。
      if (firstSuccess) await this.ensureMigration().catch(() => 0);
      return { ok: true, value };
    } catch (err) {
      if (!this.warned) {
        this.warned = true;
        console.warn(`[storage] SQLite 命令 ${cmd} 失败，回退 localStorage`, err);
      }
      this.sqliteReady = false;
      return { ok: false };
    }
  }

  // ===== Section =====

  override async listSections(chapterId: string): Promise<Section[]> {
    const r = await this.trySqlite<SectionDto[]>("db_list_sections", { chapterId });
    return r.ok ? r.value.map(fromSectionDto) : super.listSections(chapterId);
  }

  override async getSection(id: string): Promise<Section | undefined> {
    const r = await this.trySqlite<SectionDto | null>("db_get_section", { id });
    if (!r.ok) return super.getSection(id);
    return r.value ? fromSectionDto(r.value) : undefined;
  }

  override async saveSection(section: Section): Promise<void> {
    const r = await this.trySqlite("db_save_sections", {
      sections: [toSectionDto(section)],
    });
    if (!r.ok) await super.saveSection(section);
  }

  override async saveSections(sections: Section[]): Promise<void> {
    if (sections.length === 0) return;
    const r = await this.trySqlite("db_save_sections", {
      sections: sections.map(toSectionDto),
    });
    if (!r.ok) await super.saveSections(sections);
  }

  override async deleteSection(id: string): Promise<void> {
    const r = await this.trySqlite("db_delete_section", { id });
    if (!r.ok) await super.deleteSection(id);
  }

  override async sectionsByRange(
    documentId: string,
    start: number,
    end: number,
  ): Promise<Section[]> {
    const r = await this.trySqlite<SectionDto[]>("db_sections_by_range", {
      documentId,
      start,
      end,
    });
    return r.ok ? r.value.map(fromSectionDto) : super.sectionsByRange(documentId, start, end);
  }

  // ===== Chunk =====

  override async listChunks(chapterId: string): Promise<Chunk[]> {
    const r = await this.trySqlite<ChunkDto[]>("db_list_chunks", { chapterId });
    return r.ok ? r.value.map(fromChunkDto) : super.listChunks(chapterId);
  }

  override async listChunksByDocument(documentId: string): Promise<Chunk[]> {
    const r = await this.trySqlite<ChunkDto[]>("db_list_chunks_by_document", { documentId });
    return r.ok ? r.value.map(fromChunkDto) : super.listChunksByDocument(documentId);
  }

  override async getChunk(id: string): Promise<Chunk | undefined> {
    const r = await this.trySqlite<ChunkDto | null>("db_get_chunk", { id });
    if (!r.ok) return super.getChunk(id);
    return r.value ? fromChunkDto(r.value) : undefined;
  }

  override async saveChunk(chunk: Chunk): Promise<void> {
    const r = await this.trySqlite("db_save_chunks", { chunks: [toChunkDto(chunk)] });
    if (!r.ok) await super.saveChunk(chunk);
  }

  override async saveChunks(chunks: Chunk[]): Promise<void> {
    if (chunks.length === 0) return;
    const r = await this.trySqlite("db_save_chunks", { chunks: chunks.map(toChunkDto) });
    if (!r.ok) await super.saveChunks(chunks);
  }

  override async deleteChunk(id: string): Promise<void> {
    const r = await this.trySqlite("db_delete_chunk", { id });
    if (!r.ok) await super.deleteChunk(id);
  }

  override async chunksByKnowledge(knowledgeId: string): Promise<Chunk[]> {
    const r = await this.trySqlite<ChunkDto[]>("db_chunks_by_knowledge", { knowledgeId });
    return r.ok ? r.value.map(fromChunkDto) : super.chunksByKnowledge(knowledgeId);
  }

  override async deleteChunksByDocument(documentId: string): Promise<void> {
    const r = await this.trySqlite("db_delete_chunks_by_document", { documentId });
    if (!r.ok) await super.deleteChunksByDocument(documentId);
  }

  // ===== KnowledgeUnit =====

  override async listKnowledgeUnits(documentId?: string): Promise<KnowledgeUnit[]> {
    const r = await this.trySqlite<KnowledgeUnitDto[]>("db_list_knowledge_units", {
      documentId,
    });
    return r.ok ? r.value.map(fromUnitDto) : super.listKnowledgeUnits(documentId);
  }

  override async getKnowledgeUnit(id: string): Promise<KnowledgeUnit | undefined> {
    const r = await this.trySqlite<KnowledgeUnitDto | null>("db_get_knowledge_unit", { id });
    if (!r.ok) return super.getKnowledgeUnit(id);
    return r.value ? fromUnitDto(r.value) : undefined;
  }

  override async saveKnowledgeUnit(unit: KnowledgeUnit): Promise<void> {
    const r = await this.trySqlite("db_save_knowledge_units", {
      units: [toUnitDto(unit)],
    });
    if (!r.ok) await super.saveKnowledgeUnit(unit);
  }

  override async saveKnowledgeUnits(units: KnowledgeUnit[]): Promise<void> {
    if (units.length === 0) return;
    const r = await this.trySqlite("db_save_knowledge_units", {
      units: units.map(toUnitDto),
    });
    if (!r.ok) await super.saveKnowledgeUnits(units);
  }

  override async deleteKnowledgeUnit(id: string): Promise<void> {
    const r = await this.trySqlite("db_delete_knowledge_unit", { id });
    if (!r.ok) await super.deleteKnowledgeUnit(id);
  }

  // ===== KnowledgeRelation =====

  override async listRelations(unitId?: string): Promise<KnowledgeRelation[]> {
    const r = await this.trySqlite<KnowledgeRelationDto[]>("db_list_relations", { unitId });
    return r.ok ? r.value.map(fromRelationDto) : super.listRelations(unitId);
  }

  override async relationsOf(unitId: string): Promise<KnowledgeRelation[]> {
    const r = await this.trySqlite<KnowledgeRelationDto[]>("db_list_relations", { unitId });
    return r.ok ? r.value.map(fromRelationDto) : super.relationsOf(unitId);
  }

  override async prerequisitesOf(unitId: string): Promise<KnowledgeUnit[]> {
    const r = await this.trySqlite<KnowledgeUnitDto[]>("db_prerequisites_of", { unitId });
    return r.ok ? r.value.map(fromUnitDto) : super.prerequisitesOf(unitId);
  }

  override async saveRelation(relation: KnowledgeRelation): Promise<void> {
    const r = await this.trySqlite("db_save_relations", {
      relations: [toRelationDto(relation)],
    });
    if (!r.ok) await super.saveRelation(relation);
  }

  override async saveRelations(relations: KnowledgeRelation[]): Promise<void> {
    if (relations.length === 0) return;
    const r = await this.trySqlite("db_save_relations", {
      relations: relations.map(toRelationDto),
    });
    if (!r.ok) await super.saveRelations(relations);
  }

  override async deleteRelation(id: string): Promise<void> {
    const r = await this.trySqlite("db_delete_relation", { id });
    if (!r.ok) await super.deleteRelation(id);
  }

  // ===== Embedding =====

  override async listEmbeddings(targetType?: string): Promise<Embedding[]> {
    const r = await this.trySqlite<EmbeddingDto[]>("db_list_embeddings", { targetType });
    return r.ok ? r.value.map(fromEmbeddingDto) : super.listEmbeddings(targetType);
  }

  override async getEmbedding(id: string): Promise<Embedding | undefined> {
    const r = await this.trySqlite<EmbeddingDto | null>("db_get_embedding", { id });
    if (!r.ok) return super.getEmbedding(id);
    return r.value ? fromEmbeddingDto(r.value) : undefined;
  }

  override async saveEmbedding(embedding: Embedding): Promise<void> {
    const r = await this.trySqlite("db_save_embeddings", {
      embeddings: [toEmbeddingDto(embedding)],
    });
    if (!r.ok) await super.saveEmbedding(embedding);
  }

  override async saveEmbeddings(embeddings: Embedding[]): Promise<void> {
    if (embeddings.length === 0) return;
    const r = await this.trySqlite("db_save_embeddings", {
      embeddings: embeddings.map(toEmbeddingDto),
    });
    if (!r.ok) await super.saveEmbeddings(embeddings);
  }

  override async deleteEmbedding(id: string): Promise<void> {
    const r = await this.trySqlite("db_delete_embedding", { id });
    if (!r.ok) await super.deleteEmbedding(id);
  }

  override async deleteEmbeddingsByTarget(targetId: string): Promise<void> {
    const r = await this.trySqlite("db_delete_embeddings_by_target", { targetId });
    if (!r.ok) await super.deleteEmbeddingsByTarget(targetId);
  }

  override async listEmbeddingVectors(
    targetType: EmbeddingTargetType,
    targetIds?: readonly string[],
  ): Promise<EmbeddingVector[]> {
    const r = await this.trySqlite<EmbeddingVectorDto[]>("db_list_embedding_vectors", {
      targetType,
      targetIds: targetIds ? [...targetIds] : undefined,
    });
    return r.ok
      ? r.value.map((d) => ({
          targetId: d.targetId,
          model: d.model,
          dim: d.dim,
          vector: d.vector,
        }))
      : super.listEmbeddingVectors(targetType, targetIds);
  }

  // ===== 全文检索（FTS5）=====

  override async fullTextSearch(
    query: string,
    scope?: RetrievalScope,
    limit?: number,
  ): Promise<Chunk[]> {
    const r = await this.trySqlite<ChunkDto[]>("db_fts_search", {
      query,
      documentId: scope?.documentId,
      chapterId: scope?.chapterId,
      limit,
    });
    return r.ok ? r.value.map(fromChunkDto) : super.fullTextSearch(query, scope, limit);
  }
}
