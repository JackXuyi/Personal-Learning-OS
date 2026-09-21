/**
 * Tauri SQLite 后端 —— 存储层的生产实现。
 *
 * 分层（v5 起）：
 * - 走 `db_*` 命令落到 `app_data_dir/plos.db`：**Document / Chapter**（v5 下沉 ·
 *   D12，见 docs/community-knowledge-pack-design-2026-09.md §8.19）+ 原 RAG 五类
 *   （Section / Chunk / KnowledgeUnit / KnowledgeRelation / Embedding）；
 * - 仍由父类（localStorage）承载：Paper / Goal / LearnerState / LearnerProfile /
 *   Evidence / Restatement / CardState / Annotation / Capability* / MemoryDoc。
 *
 * ⚠️ 降级策略**按实体分档**（这不是不一致，是刻意的）：
 * - **RAG 五类是可重算的派生数据** → SQLite 命令抛错时静默回退父类同名方法
 *   （最坏是「索引旧了」），保证桌面端永不因存储故障而不可用；
 * - **Document / Chapter 是不可再生的原始资产**（且 `textPreview` 是所有字符偏移
 *   的基准）→ **失败必须抛 `StorageUnavailableError`**，绝不落 localStorage。
 *   半写会让库**脑裂**（SQLite 一半 + localStorage 一半），比直接报错难排查得多。
 *
 * 迁移：首次确认 SQLite 可用时，把 localStorage 侧的遗留数据一次性搬进 SQLite
 * （RAG 五类 / 概念图 blob / 文档 + 章节），三段串行、各自幂等、互不影响。
 *
 * 序列化约定与 Rust `src-tauri/src/db/models.rs` 严格镜像：
 * - 顶层参数用 camelCase（`#[tauri::command]` 默认 ArgumentCase::Camel）；
 * - 嵌套结构体字段名也是 camelCase（models.rs 已加 rename_all）。
 */
import { invoke } from "@tauri-apps/api/core";
import type {
  Chapter,
  ChapterStatus,
  Chunk,
  DocumentFormat,
  DocumentStatus,
  Embedding,
  EmbeddingTargetType,
  EmbeddingVector,
  KnowledgeGraph,
  KnowledgeRelation,
  KnowledgeUnit,
  Section,
  SourceDocument,
} from "../domain";
import { sortChaptersByOrder } from "../domain";
import {
  diffIds,
  fromRelationDto,
  fromUnitDto,
  mergeGraph,
  splitGraph,
  toRelationDto,
  toUnitDto,
} from "./graph-split";
import type { KnowledgeRelationDto, KnowledgeUnitDto } from "./graph-split";
import { StorageUnavailableError } from "./errors";
import { LocalStorageAdapter } from "./local";
import type { RetrievalScope, StorageAdapter } from "./types";

/**
 * `invoke` 的最小结构类型。
 *
 * 可注入 → node 单测能直跑本类新增的四条硬逻辑（迁移次序 / 镜像载入 / 失败抛错 /
 * 清库次序）。这四条**与 Tauri 运行时无关**，但恰是本次最容易写错的地方。
 * 与 `features/learn/import/github.ts` 的 `FetchLike` 注入**同一条范式**
 * （不引 mock 框架、不改生产接线 —— `createStorage()` 仍是无参 `new TauriStorage()`）。
 */
export type InvokeLike = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

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

// ===== DTO：SourceDocument / Chapter（v5 下沉 · D12）=====
//
// ⚠️ `ord` ↔ `order` 的映射点**只有 toChapterDto / fromChapterDto 两处**
// （SQL 列名避开保留字 `order`，同 `sections.idx` 先例）。别在别处再出现一次 `ord`。

interface DocumentDto {
  id: string;
  title: string;
  format: string;
  status: string;
  path?: string;
  uri?: string;
  source?: string;
  importedAt: number;
  rawSizeBytes?: number;
  /** 正文快照 —— 最大的一列（100 MiB 量级知识包的主体就在这）。 */
  textPreview?: string;
  goalIds?: string[];
  analysis?: SourceDocument["analysis"];
  overview?: SourceDocument["overview"];
}

interface ChapterDto {
  id: string;
  documentId: string;
  /** SQL 列名 `ord`；TS 领域字段是 `Chapter.order`。 */
  ord: number;
  title: string;
  contentRefStart: number;
  contentRefEnd: number;
  status: string;
  createdAt: number;
  keyPoints: string[];
  keyPointRefs?: Chapter["keyPointRefs"];
  unitIds: string[];
}

/**
 * 领域对象 → DTO。可选字段**缺省时不写键**（而非写 `undefined`）：
 * Rust 侧 `#[serde(default)]` 收到「键不存在」→ `None` → SQL NULL。
 */
function toDocumentDto(d: SourceDocument): DocumentDto {
  return {
    id: d.id,
    title: d.title,
    format: d.format,
    status: d.status,
    importedAt: d.importedAt,
    ...(d.path !== undefined ? { path: d.path } : {}),
    ...(d.uri !== undefined ? { uri: d.uri } : {}),
    ...(d.source !== undefined ? { source: d.source } : {}),
    ...(d.rawSizeBytes !== undefined ? { rawSizeBytes: d.rawSizeBytes } : {}),
    ...(d.textPreview !== undefined ? { textPreview: d.textPreview } : {}),
    ...(d.goalIds !== undefined ? { goalIds: d.goalIds } : {}),
    ...(d.analysis !== undefined ? { analysis: d.analysis } : {}),
    ...(d.overview !== undefined ? { overview: d.overview } : {}),
  };
}

/**
 * DTO → 领域对象。
 *
 * ⚠️ 用 `!= null`（而非 `!== undefined`）是有意的双保险：Rust 侧 `DocumentOut`
 * 已带 `skip_serializing_if`，缺省字段不会出现在 JSON 里；但假 `invoke` 或将来
 * 有人给 DTO 加回 `null` 时，`null` 一旦落进领域对象，下次 round-trip 的深比较
 * 就会因 `null !== undefined` 失败且 typecheck 查不出来。
 */
function fromDocumentDto(d: DocumentDto): SourceDocument {
  return {
    id: d.id,
    title: d.title,
    format: d.format as DocumentFormat,
    status: d.status as DocumentStatus,
    importedAt: d.importedAt,
    ...(d.path != null ? { path: d.path } : {}),
    ...(d.uri != null ? { uri: d.uri } : {}),
    ...(d.source != null ? { source: d.source } : {}),
    ...(d.rawSizeBytes != null ? { rawSizeBytes: d.rawSizeBytes } : {}),
    ...(d.textPreview != null ? { textPreview: d.textPreview } : {}),
    ...(d.goalIds != null ? { goalIds: d.goalIds } : {}),
    ...(d.analysis != null ? { analysis: d.analysis } : {}),
    ...(d.overview != null ? { overview: d.overview } : {}),
  };
}

function toChapterDto(c: Chapter): ChapterDto {
  return {
    id: c.id,
    documentId: c.documentId,
    ord: c.order,
    title: c.title,
    contentRefStart: c.contentRef.start,
    contentRefEnd: c.contentRef.end,
    status: c.status,
    createdAt: c.createdAt,
    keyPoints: c.keyPoints,
    ...(c.keyPointRefs !== undefined ? { keyPointRefs: c.keyPointRefs } : {}),
    unitIds: c.unitIds,
  };
}

function fromChapterDto(d: ChapterDto): Chapter {
  return {
    id: d.id,
    documentId: d.documentId,
    order: d.ord,
    title: d.title,
    contentRef: { start: d.contentRefStart, end: d.contentRefEnd },
    keyPoints: d.keyPoints ?? [],
    ...(d.keyPointRefs != null ? { keyPointRefs: d.keyPointRefs } : {}),
    unitIds: d.unitIds ?? [],
    status: d.status as ChapterStatus,
    createdAt: d.createdAt,
  };
}

/**
 * 镜像重建：章节按 `documentId` 分组。
 *
 * ⚠️ **组内不再排序** —— SQL 侧 `ORDER BY document_id ASC, ord ASC` 已保证有序，
 * 这里再排一次就是「同一口径两处实现」（将来改了排序规则会有一处漏改）。
 */
function groupChaptersByDocument(rows: ChapterDto[]): Map<string, Chapter[]> {
  const out = new Map<string, Chapter[]>();
  for (const row of rows) {
    const list = out.get(row.documentId);
    if (list) list.push(fromChapterDto(row));
    else out.set(row.documentId, [fromChapterDto(row)]);
  }
  return out;
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

/**
 * 概念图（`plos.graph` blob → knowledge_units / knowledge_relations 两表）迁移标记。
 *
 * 为什么新开 v2 号而不复用上面那个：存量用户升级前 RAG 迁移已把 v1 置位，
 * 重用 v1 会让图迁移被「已迁移」短路掉，图永远进不了 SQLite。
 */
const GRAPH_MIGRATION_FLAG = "plos.graph.migrated.v2";

/**
 * 遗留文档 / 章节迁移标记（v5 / D12）。
 *
 * ⚠️ **必须新开 v3 号**：存量用户升级前 RAG 迁移已把 v1 置位 —— 复用 v1 会让
 * 文档迁移被「已迁移」**短路**，整库资料永远进不了 SQLite（且症状是「看起来
 * 一切正常，只是没搬」，比报错难发现得多）。与 `GRAPH_MIGRATION_FLAG` 同一条教训。
 */
const DOCS_MIGRATION_FLAG = "plos.docs.migrated.v3";

/** `db_status` 返回体（健康探针）。 */
export interface DbStatus {
  ready: boolean;
  counts: {
    /** v5 起：资料与章节也落库（排障区确认「文档真的进去了」的唯一证据）。 */
    documents: number;
    chapters: number;
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

  /**
   * 注入式 IPC，默认即真 `invoke`（见 `InvokeLike` 的注释）。
   *
   * ⚠️ **刻意不写成 TS 参数属性**（`constructor(private readonly call: …)`）：
   * 本仓库单测用 `node --experimental-strip-types` 直跑，而 strip-only 模式
   * **不支持参数属性**（`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`）。任何**间接**
   * import 到本文件的测试（如 `tests/chapter-edit.test.ts`）都会当场炸，
   * 且报错指向这一行、与测试意图毫无关系 —— 排查成本极高。显式字段等价且安全。
   */
  private readonly call: InvokeLike;

  constructor(call: InvokeLike = invoke) {
    super();
    this.call = call;
  }

  /** null = 未探测；true = 可用；false = 已降级。 */
  private sqliteReady: boolean | null = null;
  /** 降级告警只打一次，用独立标记（避免与 sqliteReady 的流分析互相干扰）。 */
  private warned = false;
  /** 一次性迁移任务（并发去重）；null = 尚未开始。 */
  private migration: Promise<number> | null = null;

  /** 文档镜像是否已从 SQLite 载入（D12：一次性，会话内常驻）。 */
  private docsHydrated = false;

  /**
   * 本后端**不设应用层容量上限**（D16）。
   *
   * ⚠️ 这一行**不是冗余**：父类（`InMemoryStorage`）随后就会给出
   * `PACK_LOCAL_STORE_BUDGET_BYTES` 的值，**不覆写就是继承 4 MiB** —— 那会让
   * 「文档已下沉 SQLite、装得下任意大小」这个结论在代码层失效。下一轮重构请勿
   * 把它当「漏写的默认值」删掉。
   *
   * ⚠️ `override` 修饰符**必须保留**：父类（`InMemoryStorage`）已给出
   * `PACK_LOCAL_STORE_BUDGET_BYTES`（4 MiB），不覆写就是继承它 —— 那会让「文档已
   * 下沉 SQLite、装得下任意大小」这个结论在代码层失效。下一轮重构请勿把它当
   * 「漏写的默认值」删掉。
   */
  override readonly storeCapacityBytes?: number = undefined;

  /** 探测 SQLite 是否就绪（并刷新内部状态）。 */
  async probe(): Promise<boolean> {
    try {
      await this.call<DbStatus>("db_status");
      const firstSuccess = this.sqliteReady !== true;
      this.sqliteReady = true;
      if (firstSuccess) await this.ensureMigration();
      return true;
    } catch {
      this.sqliteReady = false;
      return false;
    }
  }

  // ===== 文档 / 章节（v5 下沉 · D12）=====

  /**
   * 保证「先迁移、后使用」，并按需把文档镜像从 SQLite 载入（一次性）。
   *
   * ⚠️ **所有**文档 / 章节方法（**读或写**）的第一步都必须是它。
   * 只给读方法加是不够的：若先走一次写（`saveDocument` → `db_save_documents`）
   * 再触发迁移，迁移就会拿 localStorage 的**旧快照**去覆盖刚写进去的数据
   * （`db_save_documents` 是 upsert 语义，同 id 直接覆盖）。
   *
   * ⚠️ 载入失败**抛错**，不静默降级为空库、也不返回旧快照 ——
   * 静默的旧数据比报错危险（用户以为看到的是全部资料）。
   */
  private async ensureDocs(): Promise<void> {
    if (this.docsHydrated) return;
    await this.ensureMigration();
    const docs = await this.trySqlite<DocumentDto[]>("db_list_documents", {});
    const chapters = await this.trySqlite<ChapterDto[]>("db_list_chapters_all", {});
    if (!docs.ok || !chapters.ok) throw new StorageUnavailableError("db_list_documents");
    this.documents = new Map(docs.value.map((d) => [d.id, fromDocumentDto(d)]));
    this.chaptersByDocument = groupChaptersByDocument(chapters.value);
    this.docsHydrated = true;
  }

  override async listDocuments(): Promise<SourceDocument[]> {
    await this.ensureDocs();
    return [...this.documents.values()];
  }

  override async getDocument(id: string): Promise<SourceDocument | undefined> {
    await this.ensureDocs();
    return this.documents.get(id);
  }

  /**
   * ⚠️ 失败**抛错**，不落 localStorage —— 见类头「降级策略按实体分档」。
   * 文档是不可再生的原始资产，兜底会产出脑裂库。
   */
  override async saveDocument(doc: SourceDocument): Promise<void> {
    await this.ensureDocs();
    const r = await this.trySqlite("db_save_documents", { documents: [toDocumentDto(doc)] });
    if (!r.ok) throw new StorageUnavailableError("db_save_documents");
    this.rememberDocument(doc); // 基类纯内存方法（§8.19.2）
  }

  /** 一条命令的事务内删 `documents` + 其全部 `chapters`。 */
  override async deleteDocument(id: string): Promise<void> {
    await this.ensureDocs();
    const r = await this.trySqlite("db_delete_document", { id });
    if (!r.ok) throw new StorageUnavailableError("db_delete_document");
    this.forgetDocument(id); // 含批注级联
  }

  override async listChapters(documentId: string): Promise<Chapter[]> {
    await this.ensureDocs();
    return sortChaptersByOrder(this.chaptersByDocument.get(documentId) ?? []);
  }

  /** 语义 = **整批替换该资料的章节集**（与内存侧 `rememberChapters` 严格同构）。 */
  override async saveChapters(documentId: string, chapters: Chapter[]): Promise<void> {
    await this.ensureDocs();
    const list = sortChaptersByOrder(chapters);
    const r = await this.trySqlite("db_save_chapters", {
      documentId,
      chapters: list.map(toChapterDto),
    });
    if (!r.ok) throw new StorageUnavailableError("db_save_chapters");
    this.rememberChapters(documentId, list);
  }

  /**
   * 文档 / 章节不再落 localStorage（真源 = SQLite · D12）。
   *
   * ⚠️ 空实现**不是漏写**：`plos.documents` / `plos.chapters` 冻结为迁移时的
   * 快照，只在 `clearAll` 时被清掉。补上它会：① 击穿配额（整库正文，正是下沉
   * 要躲的那堵墙）；② 让快照变得新鲜可信 → 变成**假灾备**。
   *
   * 触发场景（都是 RAG 侧的降级兜底路径，父类 `persist()` 会调到这里）：
   * `super.saveSection()` / `super.saveChunk()` / … 失败回退时。
   */
  protected override persistDocuments(): void {
    /* 见方法注释：刻意空实现 */
  }

  // ===== 迁移工具（`tauri.ts` 旧注释里的「T9 迁移工具」= 本条 + RAG / 图两条）=====

  /**
   * 把父类（localStorage）侧的遗留文档 / 章节搬进 SQLite。
   *
   * ⚠️ 必须用**裸 `this.call`** 而非 `trySqlite`：本方法由 `ensureMigration`
   * 调用，而 `trySqlite` 首次成功时会回头 `await ensureMigration()` →
   * **自等待死锁**（`migrateLegacyGraph` 已踩过同一条坑并在注释里写明）。
   *
   * ⚠️ 章节按「资料」为单位迁（`db_save_chapters` 是资料级替换语义）——
   * 不为此另造一条 bulk 命令：**一个语义只留一条命令**。
   *
   * 只增不删、**不清源**：localStorage 侧保留为灾备 + 浏览器预览数据源。
   *
   * @returns 搬移的实体总数（资料数 + 章节数）；-1 = 失败（**不写标记**，下次重试）。
   */
  async migrateLegacyDocuments(): Promise<number> {
    if (this.readDocsFlag()) return 0;
    try {
      // 直接读父类内存镜像：LocalStorageAdapter 构造时已把两个 key 载入，
      // 且此刻 `ensureDocs` 尚未替换镜像（它先 await 迁移再载入）。
      const docs = [...this.documents.values()];
      const groups = [...this.chaptersByDocument.entries()].filter(([, list]) => list.length > 0);
      const total = docs.length + groups.reduce((n, [, list]) => n + list.length, 0);
      if (total === 0) {
        this.writeDocsFlag();
        return 0;
      }

      if (docs.length > 0) {
        await this.call("db_save_documents", { documents: docs.map(toDocumentDto) });
      }
      for (const [documentId, list] of groups) {
        await this.call("db_save_chapters", {
          documentId,
          chapters: sortChaptersByOrder(list).map(toChapterDto),
        });
      }
      this.writeDocsFlag();
      console.info(`[storage] 遗留文档 / 章节已迁入 SQLite：${docs.length} 份资料`);
      return total;
    } catch (err) {
      console.warn("[storage] 遗留文档 / 章节迁移失败，下次启动重试", err);
      return -1;
    }
  }

  private readDocsFlag(): boolean {
    try {
      return localStorage.getItem(DOCS_MIGRATION_FLAG) === "1";
    } catch {
      return false; // localStorage 不可用 → 当作未迁移
    }
  }

  private writeDocsFlag(): void {
    try {
      localStorage.setItem(DOCS_MIGRATION_FLAG, "1");
    } catch {
      // 同 writeMigrationFlag：写入幂等，写失败只是下次重来。
    }
  }

  // ===== localStorage → SQLite 一次性迁移 =====

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
        await this.call("db_save_sections", { sections: sections.map(toSectionDto) });
      }
      if (units.length > 0) {
        await this.call("db_save_knowledge_units", { units: units.map(toUnitDto) });
      }
      if (relations.length > 0) {
        await this.call("db_save_relations", { relations: relations.map(toRelationDto) });
      }
      if (chunks.length > 0) {
        await this.call("db_save_chunks", { chunks: chunks.map(toChunkDto) });
      }
      if (embeddings.length > 0) {
        await this.call("db_save_embeddings", { embeddings: embeddings.map(toEmbeddingDto) });
      }

      this.writeMigrationFlag();
      console.info(`[storage] 遗留 RAG 数据已迁入 SQLite：${total} 条`);
      return total;
    } catch (err) {
      console.warn("[storage] 遗留 RAG 数据迁移失败，下次启动重试", err);
      return -1;
    }
  }

  /**
   * 首次确认 SQLite 可用后触发一次性迁移（并发安全）。
   *
   * **三段**迁移串行且各自幂等：RAG 五类实体（v1 flag）→ 概念图 blob（v2 flag）
   * → 文档 / 章节（v3 flag）。前一段失败不影响后一段尝试（反之亦然）。
   *
   * ⚠️ 顺序不可调：文档迁移必须**最后**跑。前两段走 `trySqlite` 之外的裸 `this.call`，
   * 但它们读写的是 `sections` / `chunks` / `graph` 这些**未下沉**的镜像 —— 与文档
   * 无关；反过来把文档放前面也一样安全。放在最后只是为了让日志顺序与
   * 「先 RAG、后文档」的心智模型一致。
   */
  private ensureMigration(): Promise<number> {
    this.migration ??= (async () => {
      const rag = await this.migrateLegacyRagData();
      const graph = await this.migrateLegacyGraph();
      const docs = await this.migrateLegacyDocuments();
      return Math.max(rag, 0) + Math.max(graph, 0) + Math.max(docs, 0);
    })();
    return this.migration;
  }

  /**
   * 把父类 blob（`plos.graph`）里的概念图搬进 SQLite 两表（D3）。
   *
   * 只增不删、**不清源**：blob 保留为灾备 + 浏览器预览数据源。
   *
   * 注意：这里必须用**裸 `this.call`** 而非 `trySqlite` —— 本方法由 `ensureMigration`
   * 调用，而 `trySqlite` 首次成功时会回头 await `ensureMigration()`，形成自等待死锁。
   *
   * @returns 搬移的实体总数；-1 = 失败（不写标记，下次启动重试）。
   */
  async migrateLegacyGraph(): Promise<number> {
    if (this.readGraphFlag()) return 0;
    try {
      // 直接读父类内存镜像 `this.graph`：构造时已从 localStorage 载入。
      const { units, relations } = splitGraph(this.graph);
      if (units.length + relations.length === 0) {
        this.writeGraphFlag();
        return 0;
      }
      if (units.length > 0) {
        await this.call("db_save_knowledge_units", { units });
      }
      if (relations.length > 0) {
        await this.call("db_save_relations", { relations });
      }
      this.writeGraphFlag();
      console.info(
        `[storage] 遗留概念图已迁入 SQLite：${units.length} units / ${relations.length} relations`,
      );
      return units.length + relations.length;
    } catch (err) {
      console.warn("[storage] 遗留概念图迁移失败，下次启动重试", err);
      return -1;
    }
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

  private readGraphFlag(): boolean {
    try {
      return localStorage.getItem(GRAPH_MIGRATION_FLAG) === "1";
    } catch {
      return false;
    }
  }

  private writeGraphFlag(): void {
    try {
      localStorage.setItem(GRAPH_MIGRATION_FLAG, "1");
    } catch {
      // 同 writeMigrationFlag：写入幂等，写失败只是下次重来。
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
      const value = await this.call<T>(cmd, args);
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

  // ===== 知识图谱（getGraph / saveGraph ↔ 两表聚合）=====

  /**
   * 读图：SQLite 两表聚合成 `KnowledgeGraph`。
   *
   * 先 `ensureMigration()` 再查表，消除「首次读取早于迁移」的竞态——否则升级后
   * 第一次 getGraph 会拿到空图，界面闪一下「无概念」。
   * 两表任一失败 → 整体回退父类 blob（不做半份聚合：units 有 relations 无的图会
   * 让 GraphView 全丢边）。
   */
  override async getGraph(): Promise<KnowledgeGraph> {
    await this.ensureMigration();
    const units = await this.trySqlite<KnowledgeUnitDto[]>("db_list_knowledge_units", {});
    const relations = await this.trySqlite<KnowledgeRelationDto[]>("db_list_relations", {});
    if (!units.ok || !relations.ok) return super.getGraph();
    return mergeGraph(units.value, relations.value);
  }

  /**
   * 写图：拆行 upsert + diff-delete + blob 双写。
   *
   * diff-delete 是必需的：概念抽取是「整图替换」语义（analyze-service 重抽一章会
   * 换掉该章概念），只 upsert 会把被替换的旧概念永久留在表里（级联删除同理）。
   * 表规模为个人学习资料量级（百级 units / 千级 relations），逐条删可接受。
   *
   * 任一步失败 → 整体回退父类（仅 localStorage），行为与现状一致；成功路径也仍写
   * blob（D3 不清源：灾备 + 浏览器预览读得到）。
   */
  override async saveGraph(graph: KnowledgeGraph): Promise<void> {
    await this.ensureMigration();
    const { units, relations } = splitGraph(graph);
    const savedUnits = await this.trySqlite("db_save_knowledge_units", { units });
    const savedRelations = await this.trySqlite("db_save_relations", { relations });
    if (!savedUnits.ok || !savedRelations.ok) {
      await super.saveGraph(graph);
      return;
    }
    const currentUnits = await this.trySqlite<KnowledgeUnitDto[]>("db_list_knowledge_units", {});
    const currentRelations = await this.trySqlite<KnowledgeRelationDto[]>("db_list_relations", {});
    if (currentUnits.ok && currentRelations.ok) {
      for (const id of diffIds(currentUnits.value, units)) {
        await this.trySqlite("db_delete_knowledge_unit", { id });
      }
      for (const id of diffIds(currentRelations.value, relations)) {
        await this.trySqlite("db_delete_relation", { id });
      }
    }
    await super.saveGraph(graph);
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

  /**
   * 清空整库（replace 导入用，见
   * docs/data-portability-export-import-design-2026-09.md §4.3.2）。
   *
   * ⚠️ 顺序不可颠倒：RAG 五类 + 文档 / 章节的真源都在 SQLite，只清父类
   * （localStorage）会留下旧 chunk / section / 向量 / 资料 → FTS 检索会返回用户
   * 以为已删除的段落，属于**静默错数据**，比报错严重。因此 `db_clear_library`
   * 失败时**抛错中止**，由导入服务转成 `sqlite-blocked` 分类让 UI 明说
   * 「本机数据库未清空，已取消」。
   *
   * 这里刻意用**裸 `this.call`** 而非 `trySqlite`：后者的 `sqliteReady === false`
   * 是「本会话此前失败过」的短路缓存，不是「库里没有数据」的事实 —— 拿缓存当
   * 许可去跳过清库，正是上面那种静默错数据的入口。清库要么真清，要么明确失败。
   *
   * ⚠️ 命令名 v5 起由 `db_clear_rag` 改为 `db_clear_library`（清 **9** 表：
   * 原 7 张 + `chapters` + `documents`）。改名与 Rust 侧注册**必须同批**落地，
   * 否则运行时 `Command not found`。
   */
  override async clearAll(): Promise<void> {
    try {
      await this.call("db_clear_library");
    } catch (err) {
      throw new Error(`db_clear_library failed: ${String(err)}`);
    }
    await super.clearAll();
  }
}
