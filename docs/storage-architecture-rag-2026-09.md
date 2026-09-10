# RAG 存储系统架构方案

| 字段 | 内容 |
|------|------|
| 作者 | WorkBuddy |
| 日期 | 2026-09-10 |
| 状态 | ✅ 已确认 · 执行阶段 · 用户确认时间 2026-09-10 13:20 UTC+8 |
| 关联需求 | 用户文档：《RAG & Knowledge Retrieval Architecture Spec v1.0》 · 完整五层存储 + 双后端适配 |
| 决策依据 | 完整方案 + 完整章节化存储 + 立即 SQLite 迁移 |
| **确认决策** | ① Chunk 产生：两阶段切分（Chapter 现状 + semanticChunk 异步）② Rust 库：sqlx + Tokio ③ 向量库：P1 决策，现在占位 |

---

## 1. 背景

### 1.1 业务痛点

PLOS 当前存储架构（`src/storage/local.ts` + localStorage）为**占位实现**，仅支持文档、章节、试卷、学习状态的扁平持久化，**不支持** RAG 核心能力：

1. **知识层级缺失**：无 Section / Chunk 表；无语义分割指标；
2. **检索不可用**：无 FTS5 全文索引；无向量索引；无 Section/Chunk 级检索；
3. **知识图谱悬空**：KnowledgeUnit/Relation 表结构存在但无检索联动；无 Evidence 来源回溯；
4. **后端依赖清晰但无实现**：Tauri 端（Rust）需要 SQLite 命令集，当前 `src-tauri` 无数据库初始化、迁移、查询层。

### 1.2 触发原因

- **MVP 验收路径**：用户提出 RAG 为知识检索引擎的基础设施，不能靠向量搜索单一依赖。需完整五层建模。
- **架构时间敏感**：localStorage 占位只支持 ~5–10MB；RAG 索引（向量 + 全文）将快速溢出。必须提前定案 SQLite 表结构，同步 Rust 适配器。
- **分阶段实施**：P0 章节切分 + P1 知识抽取 + P2 向量索引，但**数据模型必须一次定义**，避免后期迁移。

### 1.3 与现有模块关系

| 模块 | 现状 | V2 影响 |
|------|------|--------|
| `src/storage/types.ts` | 定义 `StorageAdapter` 契约 | 扩展新增 Chunk/Section/Knowledge/Evidence 方法 |
| `src/storage/memory.ts` | 内存哈希表实现 | 增加对应数据结构（哈希表 + 简单索引） |
| `src/storage/local.ts` | localStorage 适配器 | 同步新 key；体积护栏；迁移钩子 |
| `src-tauri/src/lib.rs` | Tauri 命令入口 | 新增 SQLite 初始化、查询命令（与 TypeScript 接口镜像） |
| `src-tauri/src/db.rs`（新） | 无 | SQLite 表定义 + 迁移策略 |
| `src/engine/retrieval/`（新） | 无 | 消费 Chunk/KnowledgeUnit/Evidence 层 API |
| `src/ai/pipelines.ts` | 知识抽取与向量化 | 输出写入 KnowledgeUnit / Embedding 表 |

> 核心约束（`rules/layer-import-boundaries.mdc`）：UI 不 import Tauri；数据访问仅经 `StorageAdapter`；Rust ↔ TS 通过 IPC `invoke` 解耦。

### 1.4 不做会有什么影响

- localStorage 溢出 → RAG 功能不可用（缺索引）；
- 表结构不定案 → 后期知识抽取、向量化无处落地；
- Rust 端无数据库 → 无法支持大文档、并发检索。

---

## 2. 方案目标

| 类型 | 描述 |
|------|------|
| **主要目标** | 设计一套完整的五层存储架构（Document → Chapter → Section → Chunk → KnowledgeUnit + Evidence），支持 SQLite 后端迁移；定义 TypeScript StorageAdapter 扩展接口与 Rust 数据库初始化 SQL；MVP 实现 localStorage 占位 + Rust SQLite 初始版（P0 表结构就位，查询层分阶段补齐）。 |
| **非目标** | ① 不实现 Vector 向量存储（存储表预留，但具体向量库选型/嵌入 lib 延后 P1）；② 不做 Tauri 完整查询命令集（P0 仅 CRUD 基础，复杂查询/聚合类命令后补）；③ 不做数据迁移工具（手工验证后再自动化）；④ 不做全文搜索优化（FTS5 表创建就位，查询分阶段优化）。 |
| **成功标准** | ① 数据模型完整定案：五层表结构 + 字段清单（对齐 RAG Spec §5-§26）；② StorageAdapter 扩展接口完整：Chunk/Section/KnowledgeUnit/Evidence/Embedding CRUD + 查询方法签名；③ SQLite 表 SQL 定义完成：所有表 + FTS5 索引 + 字段注释；④ Rust 端数据库初始化代码就位：`src-tauri/src/db.rs` + `lib.rs` 命令注册；⑤ localStorage 占位实现：新增表的内存实现 + 键前缀一致；⑥ typecheck 0 error；⑦ 方案文档含迁移路径说明（含数据导入脚本伪代码）。 |

---

## 3. 项目现状

### 3.1 相关代码与模块

| 位置 | 现状 | 影响 |
|------|------|------|
| `src/domain/*.ts` | Document / Chapter / KnowledgeUnit / Evidence 类型已定义 | 新增 Section / Chunk / Embedding 域类型；验证 Relation 完整性 |
| `src/storage/types.ts` | `StorageAdapter` 含 document / chapter / paper / evidence / goal | 扩展：+section / chunk / knowledge / embedding 方法 |
| `src/storage/memory.ts` | `InMemoryStorage` 内存哈希表实现 | 增加 Map<sectionId, Section> / Map<chunkId, Chunk> / … |
| `src/storage/local.ts` | localStorage 占位 + KEY_* 前缀 | 新增 KEY_SECTIONS / KEY_CHUNKS / KEY_KNOWLEDGE / KEY_EMBEDDINGS / KEY_EVIDENCE_CHAIN |
| `src-tauri/src/lib.rs` | Tauri 命令入口（当前无 DB 逻辑） | 新增 `#[tauri::command] db_init()` / `chunk_create()` / … 与 TypeScript 镜像 |
| `src-tauri/src/db.rs`（新） | 无 | SQLite 表定义、迁移管理器、schema 版本 |
| `package.json` | 前端依赖 | 无需新增（localStorage 占位无额外依赖） |
| `src-tauri/Cargo.toml` | Rust 依赖 | 新增 `sqlx` / `rusqlite` 或 `tauri-plugin-sql`（选型见 §4.1） |

### 3.2 相关文档与约定

- `README.md`：format 支持声明含 PDF · Markdown；storage 为占位实现（需更新）。
- `docs/learning-system-v2-design-2026-09.md` §3.1：章节为一等实体 + 正文切片引用 `Chapter.contentRef: ChapterRange`。
- `docs/knowledge-import-design-2026-09.md`：文档导入后切分为 Chapter；新增 Section/Chunk 应在切分后生成。
- 用户文档《RAG & Knowledge Retrieval Architecture Spec v1.0》 §3–§60：五层模型定案、Retrieval API、Context Builder 需求。
- `rules/layer-import-boundaries.mdc`：UI ↔ Tauri 仅 IPC；数据访问仅经 StorageAdapter。
- `skills/pre-task-technical-design`：本方案按工作流产出。

### 3.3 约束与依赖

| 约束 | 说明 | 对策 |
|------|------|------|
| **localStorage 占位上限** | 单域 ~5–10MB；RAG 索引快速溢出 | P0 完成 SQLite 迁移路径定案；localStorage 作过渡（支持到 P1 中期）；护栏：单文档 textPreview ≤ 1.5MB；全部 embedding 延后 P1 |
| **Tauri SQL 方案选型** | `sqlx`（compile-time checked、async）vs `rusqlite`（同步、轻量） | 建议 `sqlx` + Tokio（对齐前端 async 风格），后补 `tauri-plugin-sql` 官方集成 |
| **向量存储不在本方案** | 向量库选型（SQLite vector / LanceDB / Qdrant）后续决定 | 表结构预留 `Embedding` 表，字段不强依赖具体库；P1 选型时填空 |
| **Chunk 切分依赖** | Chunk 何时产生？由 splitter-engine 还是导入管道？ | 推荐：导入 → splitDocument → Chapter（现状）+ 并行 semanticChunk（新）→ Chunk；P0 章级检索，P1 chunk 级检索 |
| **前端浏览器预览** | WebView 支持 SQLite？ | 否，仅 Tauri 主进程可用。浏览器预览继续用 localStorage（运行时检测 `isTauri()`） |
| **Node / Vite** | node ≥22；相对导入为主 | StorageAdapter 扩展接口纯 TS，无额外构建需求 |

---

## 4. 技术架构

### 4.1 总体架构

```text
┌────────────────────────────────────────────────────────────────┐
│                         React UI Layer                          │
│  (features/learn / features/quiz / features/plan …)            │
│  · 通过 Zustand store → useLoopStore                            │
│  · 仅调用 storage 接口（不直接 invoke）                          │
└─────────────────────────┬──────────────────────────────────────┘
                          │
                 StorageAdapter 接口
                          │
        ┌─────────────────┼─────────────────┐
        ↓                 ↓                 ↓
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│   Memory     │  │  localStorage│  │  Tauri IPC   │
│  Storage     │  │  Adapter     │  │  → SQLite    │
│  (tests)     │  │  (browser)   │  │  (desktop)   │
└──────────────┘  └──────────────┘  └──────┬───────┘
                                           │
                                ┌──────────↓──────────┐
                                │                     │
                            ┌───↓────┐       ┌───────↓────┐
                            │ SQLite  │       │  Query     │
                            │ Tables  │       │  Layer     │
                            │  +      │       │  (sqlx /   │
                            │ FTS5    │       │   Rust)    │
                            └────────┘       └────────────┘
```

**核心决策**：

1. **双后端适配**：内存（单测）+ localStorage（浏览器预览）+ SQLite（Tauri 桌面）；业务逻辑仅依赖 `StorageAdapter`。
2. **同步 TypeScript 与 Rust**：TS 方的 StorageAdapter 接口 ↔ Rust 的 SQLite schema；通过 IPC 镜像维持一致。
3. **分层隔离**：Query layer（sqlx）独立于 domain 逻辑；UI 无 invoke 依赖。

### 4.2 模块职责

| 模块/文件 | 职责 | 技术选型 | 状态 |
|-----------|------|----------|------|
| `src/domain/{document,chapter,section,chunk,knowledge,evidence}.ts` | 域模型类型定义（纯 TS） | TypeScript interfaces | 部分新增（Section/Chunk/Embedding） |
| `src/storage/types.ts` | StorageAdapter 契约扩展 | TypeScript interface | 扩展 6 类方法组 |
| `src/storage/memory.ts` | 内存实现（单测 + 降级） | Map<> + 简单过滤 | 新增数据结构 |
| `src/storage/local.ts` | localStorage 适配器 | JSON 序列化 + localStorage API | 新增 key + 体积检查 |
| `src/stores/useLoopStore.ts` | 选择存储后端工厂 | isTauri() 条件分支 | 轻改（后端工厂） |
| `src-tauri/src/db.rs`（新） | SQLite 表定义 + 迁移 | SQL DDL + sqlx migrate | 新建 |
| `src-tauri/src/query.rs`（新） | 查询层（SELECT/INSERT/UPDATE） | sqlx 异步查询 | 新建（分阶段） |
| `src-tauri/src/lib.rs` | Tauri 命令注册 | `#[tauri::command]` macro | 新增 db_* 命令 |
| `src/ai/retrieval/`（新） | 检索引擎（消费 Chunk/Knowledge 层） | 纯 TS + StorageAdapter | 后续新增 |
| `tests/storage-*.test.ts` | 存储层单测 | 内存后端注入 | 新增 |

### 4.3 数据模型与 API

#### 4.3.1 五层领域模型

```ts
// src/domain/document.ts（现状扩展）
export interface SourceDocument {
  id: string;
  title: string;
  format: DocumentFormat;  // "pdf" | "markdown" | "txt" | …
  path?: string;
  uri?: string;
  source?: string;
  importedAt: number;
  status: DocumentStatus;  // "imported" | "parsing" | "ready" | "failed"
  rawSizeBytes?: number;
  textPreview?: string;
  analysis?: { chaptersAt?: number; conceptsAt?: number; model?: string };
}

// src/domain/chapter.ts（现状，无改动）
export interface Chapter {
  id: string;
  documentId: string;
  order: number;
  title: string;
  contentRef: ChapterRange;  // { start, end } 正文切片
  keyPoints: string[];
  unitIds: string[];  // 留位概念 IDs
  status: ChapterStatus;
  createdAt: number;
}

// src/domain/section.ts（新增）
/**
 * Section 是 Chapter 下的逻辑分段（可选，支持三层结构）。
 * 例：Chapter 7 下可有 7.1、7.2、7.3 多个 Section。
 * 搜索时可在 Section 粒度返回结果。
 */
export interface Section {
  id: string;
  chapterId: string;
  documentId: string;
  title: string;
  level: number;  // 标题级数（1-6 对应 H1-H6）
  index: number;  // 章内序号
  contentRef: ChapterRange;  // 正文切片
  createdAt: number;
}

// src/domain/chunk.ts（新增）
/**
 * Chunk 是向量化与全文检索的基础单位。
 * 由 semanticChunk 引擎产生（将 Section/Paragraph 分割为语义块）。
 */
export interface Chunk {
  id: string;
  documentId: string;
  chapterId: string;
  sectionId?: string;
  content: string;  // 实际正文（≤ 512 tokens 建议）
  position: number;  // 在整文中的序号
  tokenCount?: number;
  knowledgeIds: string[];  // 关联的 KnowledgeUnit IDs
  metadata?: {
    heading?: string;
    page?: number;
    sourceLocation?: string;  // "7.2" 等
  };
  createdAt: number;
}

// src/domain/knowledge.ts（现状扩展）
export interface KnowledgeUnit {
  id: string;
  title: string;
  kind: KnowledgeKind;  // "concept" | "skill" | "fact" | "procedure" | "principle"
  summary?: string;
  sourceDocumentId?: string;
  tags: string[];
  createdAt: number;
}

export interface KnowledgeRelation {
  id: string;
  fromId: string;
  toId: string;
  type: RelationType;  // "prerequisite" | "related" | "parent" | "child" | …
  strength?: number;  // [0, 1]
  createdAt: number;
}

// src/domain/evidence.ts（现状，扩展留位）
export interface EvidenceEntry {
  at: number;
  kind: EvidenceKind;  // "assessment" | "review"
  subjectId: string;  // 章 id（或后续概念 id）
  verdict?: string;
  delta: number;
  sourceId?: string;
  createdAt: number;  // 新增，便于查询排序
}

// src/domain/embedding.ts（新增）
/**
 * Embedding 表记录向量化结果。
 * 具体向量库选型延后，本表仅记录元数据。
 */
export interface Embedding {
  id: string;
  targetType: "chunk" | "knowledge" | "chapter";
  targetId: string;
  model: string;  // "qwen-1.5b" | "openai-3-small" | …
  vectorDim: number;  // 向量维度（便于查询检查）
  createdAt: number;
  // 实际向量存储在向量库或单独的 BLOB 表中（P1 决策）
}
```

#### 4.3.2 StorageAdapter 扩展接口

```ts
// src/storage/types.ts（扩展）
export interface StorageAdapter {
  readonly name: string;

  // ===== 现状 Section（保留）=====
  listDocuments(): Promise<SourceDocument[]>;
  getDocument(id: string): Promise<SourceDocument | undefined>;
  saveDocument(doc: SourceDocument): Promise<void>;
  deleteDocument(id: string): Promise<void>;

  // ===== Section 层（新增）=====
  listSections(chapterId: string): Promise<Section[]>;
  getSection(id: string): Promise<Section | undefined>;
  saveSection(section: Section): Promise<void>;
  saveSections(sections: Section[]): Promise<void>;
  deleteSection(id: string): Promise<void>;
  /** 按正文区间查询（用于从 Chapter 切片快速定位 Sections） */
  sectionsByRange(documentId: string, start: number, end: number): Promise<Section[]>;

  // ===== Chunk 层（新增）=====
  listChunks(chapterId: string): Promise<Chunk[]>;
  listChunksByDocument(documentId: string): Promise<Chunk[]>;
  getChunk(id: string): Promise<Chunk | undefined>;
  saveChunk(chunk: Chunk): Promise<void>;
  saveChunks(chunks: Chunk[]): Promise<void>;
  deleteChunk(id: string): Promise<void>;
  /** 按知识单元查询相关 Chunks */
  chunksByKnowledge(knowledgeId: string): Promise<Chunk[]>;

  // ===== KnowledgeUnit 层（新增）=====
  listKnowledgeUnits(documentId?: string): Promise<KnowledgeUnit[]>;
  getKnowledgeUnit(id: string): Promise<KnowledgeUnit | undefined>;
  saveKnowledgeUnit(unit: KnowledgeUnit): Promise<void>;
  saveKnowledgeUnits(units: KnowledgeUnit[]): Promise<void>;
  deleteKnowledgeUnit(id: string): Promise<void>;

  // ===== KnowledgeRelation 层（新增）=====
  listRelations(unitId?: string): Promise<KnowledgeRelation[]>;
  relationsOf(unitId: string): Promise<KnowledgeRelation[]>;
  prerequisitesOf(unitId: string): Promise<KnowledgeUnit[]>;
  saveRelation(relation: KnowledgeRelation): Promise<void>;
  saveRelations(relations: KnowledgeRelation[]): Promise<void>;
  deleteRelation(id: string): Promise<void>;

  // ===== Embedding 层（新增）=====
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

  // ===== 全文搜索（新增）=====
  /**
   * FTS5 查询：返回 Chunk + 上下文。
   * @param query 查询词（自动 FTS5 转义）
   * @param scope { documentId?: string; chapterId?: string } 检索范围
   * @param limit 返回条数
   */
  fullTextSearch(query: string, scope?: RetrievalScope, limit?: number): Promise<Chunk[]>;

  // ===== 其他（现状保留）=====
  listChapters(documentId: string): Promise<Chapter[]>;
  saveChapters(documentId: string, chapters: Chapter[]): Promise<void>;
  // … paper / learner / goal / …（现状保留）
}
```

---

## 5. 存储分层设计

### 5.1 SQLite 表结构（Rust 侧 SQL DDL）

```sql
-- 文档层
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  format TEXT NOT NULL CHECK(format IN ('pdf', 'markdown', 'txt', 'docx', 'epub', 'web', 'note', 'code', 'image', 'custom')),
  path TEXT,
  uri TEXT,
  source TEXT,
  imported_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('imported', 'parsing', 'ready', 'failed')),
  raw_size_bytes INTEGER,
  text_preview TEXT,
  analysis_chapters_at INTEGER,
  analysis_concepts_at INTEGER,
  analysis_model TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

-- 章层
CREATE TABLE IF NOT EXISTS chapters (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL,
  title TEXT NOT NULL,
  content_ref_start INTEGER NOT NULL,
  content_ref_end INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'not-started' CHECK(status IN ('not-started', 'learning', 'ready', 'mastered', 'retake')),
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  UNIQUE(document_id, ord),
  FOREIGN KEY(document_id) REFERENCES documents(id)
);

-- 小节层（可选，支持三层结构）
CREATE TABLE IF NOT EXISTS sections (
  id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  title TEXT NOT NULL,
  level INTEGER NOT NULL CHECK(level BETWEEN 1 AND 6),
  idx INTEGER NOT NULL,
  content_ref_start INTEGER NOT NULL,
  content_ref_end INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  FOREIGN KEY(chapter_id) REFERENCES chapters(id) ON DELETE CASCADE,
  FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
);

-- 块层（用于检索/向量化）
CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  section_id TEXT,
  content TEXT NOT NULL,
  position INTEGER NOT NULL,
  token_count INTEGER,
  metadata_heading TEXT,
  metadata_page INTEGER,
  metadata_source_location TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY(chapter_id) REFERENCES chapters(id) ON DELETE CASCADE,
  FOREIGN KEY(section_id) REFERENCES sections(id) ON DELETE SET NULL
);

-- Chunk 与 KnowledgeUnit 的多对多关系
CREATE TABLE IF NOT EXISTS chunk_knowledge (
  chunk_id TEXT NOT NULL,
  knowledge_id TEXT NOT NULL,
  PRIMARY KEY(chunk_id, knowledge_id),
  FOREIGN KEY(chunk_id) REFERENCES chunks(id) ON DELETE CASCADE,
  FOREIGN KEY(knowledge_id) REFERENCES knowledge_units(id) ON DELETE CASCADE
);

-- 知识单元
CREATE TABLE IF NOT EXISTS knowledge_units (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('concept', 'skill', 'fact', 'procedure', 'principle')),
  summary TEXT,
  source_document_id TEXT,
  tags TEXT,  -- JSON array 序列化
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  FOREIGN KEY(source_document_id) REFERENCES documents(id) ON DELETE SET NULL
);

-- 知识关系
CREATE TABLE IF NOT EXISTS knowledge_relations (
  id TEXT PRIMARY KEY,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('prerequisite', 'related', 'parent', 'child', 'example', 'contrast', 'application', 'source')),
  strength REAL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  FOREIGN KEY(from_id) REFERENCES knowledge_units(id) ON DELETE CASCADE,
  FOREIGN KEY(to_id) REFERENCES knowledge_units(id) ON DELETE CASCADE
);

-- 向量化元数据
CREATE TABLE IF NOT EXISTS embeddings (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL CHECK(target_type IN ('chunk', 'knowledge', 'chapter')),
  target_id TEXT NOT NULL,
  model TEXT NOT NULL,
  vector_dim INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  UNIQUE(target_type, target_id, model)
);

-- 证据日志
CREATE TABLE IF NOT EXISTS evidence_entries (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  at INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('assessment', 'review')),
  subject_id TEXT NOT NULL,
  verdict TEXT,
  delta REAL NOT NULL,
  source_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

-- ===== 全文搜索索引 =====
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  id UNINDEXED,
  content,
  chapter_id UNINDEXED,
  document_id UNINDEXED
);

-- 触发器：keep chunks_fts 与 chunks 同步
CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(id, content, chapter_id, document_id) 
  VALUES (new.id, new.content, new.chapter_id, new.document_id);
END;

CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
  DELETE FROM chunks_fts WHERE id = old.id;
END;

-- ===== 索引优化 =====
CREATE INDEX IF NOT EXISTS idx_chapters_doc ON chapters(document_id);
CREATE INDEX IF NOT EXISTS idx_sections_chapter ON sections(chapter_id);
CREATE INDEX IF NOT EXISTS idx_chunks_chapter ON chunks(chapter_id);
CREATE INDEX IF NOT EXISTS idx_chunks_section ON chunks(section_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_doc ON knowledge_units(source_document_id);
CREATE INDEX IF NOT EXISTS idx_evidence_subject ON evidence_entries(subject_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_target ON embeddings(target_type, target_id);

-- ===== Schema 版本管理 =====
CREATE TABLE IF NOT EXISTS _schema_version (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

INSERT OR IGNORE INTO _schema_version(version) VALUES (1);
```

### 5.2 Tauri Rust 侧初始化与查询层

```rs
// src-tauri/src/db.rs（新增）
use sqlx::sqlite::{SqlitePool, SqliteConnectOptions};
use std::str::FromStr;

pub async fn init_db(db_path: &str) -> Result<SqlitePool, Box<dyn std::error::Error>> {
  let options = SqliteConnectOptions::from_str(&format!("sqlite://{}", db_path))?
    .create_if_missing(true);
  
  let pool = SqlitePool::connect_with(options).await?;
  
  // 执行 DDL（从上方 SQL 脚本）
  sqlx::query(include_str!("./db_schema.sql")).execute(&pool).await?;
  
  Ok(pool)
}

pub async fn save_chunk(
  pool: &SqlitePool,
  chunk: &Chunk,
) -> Result<(), sqlx::Error> {
  sqlx::query(
    "INSERT INTO chunks (id, document_id, chapter_id, section_id, content, position, token_count, metadata_heading, metadata_page, metadata_source_location, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(&chunk.id)
    .bind(&chunk.document_id)
    .bind(&chunk.chapter_id)
    .bind(&chunk.section_id)
    .bind(&chunk.content)
    .bind(chunk.position)
    .bind(chunk.token_count)
    .bind(&chunk.metadata.as_ref().map(|m| &m.heading))
    .bind(chunk.metadata.as_ref().and_then(|m| m.page))
    .bind(&chunk.metadata.as_ref().map(|m| &m.source_location))
    .bind(chunk.created_at)
    .execute(pool)
    .await?;
  
  // 关联 knowledge_ids
  for kid in &chunk.knowledge_ids {
    sqlx::query("INSERT INTO chunk_knowledge (chunk_id, knowledge_id) VALUES (?, ?)")
      .bind(&chunk.id)
      .bind(kid)
      .execute(pool)
      .await?;
  }
  
  Ok(())
}

pub async fn fts_search(
  pool: &SqlitePool,
  query: &str,
  document_id: Option<&str>,
  limit: i64,
) -> Result<Vec<(String, String, String)>, sqlx::Error> {
  // FTS5 查询（返回 id, content, chapter_id）
  let mut sql = "SELECT id, content, chapter_id FROM chunks_fts WHERE content MATCH ?".to_string();
  if document_id.is_some() {
    sql.push_str(" AND document_id = ?");
  }
  sql.push_str(" LIMIT ?");
  
  let mut query_builder = sqlx::query_as::<_, (String, String, String)>(&sql)
    .bind(query);
  if let Some(doc_id) = document_id {
    query_builder = query_builder.bind(doc_id);
  }
  query_builder = query_builder.bind(limit);
  
  query_builder.fetch_all(pool).await
}
```

### 5.3 localStorage 占位实现（扩展）

```ts
// src/storage/local.ts（扩展）
import type { Chunk, Section, KnowledgeUnit, KnowledgeRelation, Embedding } from "../domain";
import { InMemoryStorage } from "./memory";

const KEY_SECTIONS = "plos.sections";
const KEY_CHUNKS = "plos.chunks";
const KEY_KNOWLEDGE_UNITS = "plos.knowledge-units";
const KEY_KNOWLEDGE_RELATIONS = "plos.knowledge-relations";
const KEY_EMBEDDINGS = "plos.embeddings";
// … 其他现状 key …

export class LocalStorageAdapter extends InMemoryStorage implements StorageAdapter {
  override readonly name = "local";

  constructor() {
    super();
    
    // 现状初始化
    this.documents = new Map(
      load<SourceDocument[]>(KEY_DOCUMENTS, []).map((d) => [d.id, d]),
    );
    // … 其他现状 …

    // 新增初始化
    this.sections = new Map(
      load<Section[]>(KEY_SECTIONS, []).map((s) => [s.id, s]),
    );
    this.chunks = new Map(
      load<Chunk[]>(KEY_CHUNKS, []).map((c) => [c.id, c]),
    );
    this.knowledgeUnits = new Map(
      load<KnowledgeUnit[]>(KEY_KNOWLEDGE_UNITS, []).map((u) => [u.id, u]),
    );
    this.knowledgeRelations = new Map(
      load<KnowledgeRelation[]>(KEY_KNOWLEDGE_RELATIONS, []).map((r) => [r.id, r]),
    );
    this.embeddings = new Map(
      load<Embedding[]>(KEY_EMBEDDINGS, []).map((e) => [e.id, e]),
    );
  }

  private persist() {
    // 现状保存 …
    localStorage.setItem(KEY_SECTIONS, JSON.stringify([...this.sections.values()]));
    localStorage.setItem(KEY_CHUNKS, JSON.stringify([...this.chunks.values()]));
    localStorage.setItem(KEY_KNOWLEDGE_UNITS, JSON.stringify([...this.knowledgeUnits.values()]));
    localStorage.setItem(KEY_KNOWLEDGE_RELATIONS, JSON.stringify([...this.knowledgeRelations.values()]));
    localStorage.setItem(KEY_EMBEDDINGS, JSON.stringify([...this.embeddings.values()]));
  }

  override async saveSection(section: Section): Promise<void> {
    await super.saveSection(section);
    this.persist();
  }

  override async saveChunk(chunk: Chunk): Promise<void> {
    await super.saveChunk(chunk);
    this.persist();
  }

  // … 其他扩展方法 …
}
```

---

## 6. 迁移路径（localStorage → SQLite）

### 6.1 迁移策略

```text
Phase 1（P0.5）：定案表结构 + localStorage 占位
  ↓
Phase 2（N0）：Rust SQLite 初始化 + 基础 CRUD 命令
  ↓
Phase 3（N1）：数据导入脚本（本地 Dev）+ 验证
  ↓
Phase 4（N2）：生产迁移工具（Tauri 启动时自动迁移）
  ↓
Phase 5（N3+）：localStorage 下线
```

### 6.2 导入脚本伪代码（Python）

```python
import json
import sqlite3

def migrate_plos(json_export, db_path):
  """将 localStorage export 导入 SQLite。"""
  conn = sqlite3.connect(db_path)
  
  # 导入 documents
  for doc in json_export['documents']:
    conn.execute(
      "INSERT INTO documents (id, title, format, ...) VALUES (?, ?, ?, ...)",
      (doc['id'], doc['title'], doc['format'], ...)
    )
  
  # 导入 chapters
  for chapter in json_export['chapters']:
    conn.execute(
      "INSERT INTO chapters (id, document_id, ord, title, content_ref_start, content_ref_end, status, created_at) "
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      (chapter['id'], chapter['documentId'], chapter['order'], chapter['title'],
       chapter['contentRef']['start'], chapter['contentRef']['end'],
       chapter['status'], chapter['createdAt'])
    )
  
  # 导入 chunks / knowledge 等新表
  # …
  
  conn.commit()
  conn.close()
```

### 6.3 启动时自动迁移（Tauri 侧伪代码）

```rs
// src-tauri/src/main.rs
#[cfg(target_os = "macos")]
fn main() {
  let app_data_dir = tauri::api::path::app_data_dir(...);
  let db_path = app_data_dir.join("plos.db");
  
  // 检查是否需要迁移
  if should_migrate() {
    migrate_from_localstorage(&db_path)?;
  }
  
  let pool = init_db(db_path.to_str().unwrap()).await?;
  
  tauri::Builder::default()
    .manage(pool)
    .build(tauri::generate_context!())
    .expect("error while running tauri application")
    .run(|_app_handle, event| match event {
      TauriEvent::CloseRequested { .. } => {}
    });
}
```

---

## 7. API 签名清单

### 7.1 Tauri 命令（TypeScript → Rust IPC）

```ts
// src-tauri/src/lib.rs（注册）
#[tauri::command]
async fn db_init(pool: State<'_, SqlitePool>) -> Result<(), String> { … }

#[tauri::command]
async fn chunk_save(pool: State<'_, SqlitePool>, chunk: Chunk) -> Result<(), String> { … }

#[tauri::command]
async fn section_save(pool: State<'_, SqlitePool>, section: Section) -> Result<(), String> { … }

#[tauri::command]
async fn fts_search(
  pool: State<'_, SqlitePool>,
  query: String,
  document_id: Option<String>,
  limit: i64,
) -> Result<Vec<Chunk>, String> { … }

#[tauri::command]
async fn knowledge_save(pool: State<'_, SqlitePool>, unit: KnowledgeUnit) -> Result<(), String> { … }

// … 其他命令 …
```

### 7.2 TypeScript StorageAdapter 方法

```ts
// 完整签名（仅列新增部分）
interface StorageAdapter {
  // === 现状 ===
  listDocuments(): Promise<SourceDocument[]>;
  // …

  // === 新增 ===
  listSections(chapterId: string): Promise<Section[]>;
  saveSection(section: Section): Promise<void>;
  saveSections(sections: Section[]): Promise<void>;
  deleteSection(id: string): Promise<void>;
  sectionsByRange(documentId: string, start: number, end: number): Promise<Section[]>;

  listChunks(chapterId: string): Promise<Chunk[]>;
  listChunksByDocument(documentId: string): Promise<Chunk[]>;
  saveChunk(chunk: Chunk): Promise<void>;
  saveChunks(chunks: Chunk[]): Promise<void>;
  deleteChunk(id: string): Promise<void>;
  chunksByKnowledge(knowledgeId: string): Promise<Chunk[]>;

  listKnowledgeUnits(documentId?: string): Promise<KnowledgeUnit[]>;
  saveKnowledgeUnit(unit: KnowledgeUnit): Promise<void>;
  saveKnowledgeUnits(units: KnowledgeUnit[]): Promise<void>;

  listRelations(unitId?: string): Promise<KnowledgeRelation[]>;
  relationsOf(unitId: string): Promise<KnowledgeRelation[]>;
  prerequisitesOf(unitId: string): Promise<KnowledgeUnit[]>;
  saveRelation(relation: KnowledgeRelation): Promise<void>;
  saveRelations(relations: KnowledgeRelation[]): Promise<void>;

  listEmbeddings(targetType?: string): Promise<Embedding[]>;
  saveEmbedding(embedding: Embedding): Promise<void>;
  saveEmbeddings(embeddings: Embedding[]): Promise<void>;
  deleteEmbeddingsByTarget(targetId: string): Promise<void>;

  fullTextSearch(query: string, scope?: RetrievalScope, limit?: number): Promise<Chunk[]>;
}
```

---

## 8. 任务分解

| ID | 任务 | 依赖 | 预估 | 备注 |
|----|------|------|------|------|
| T1 | 新增域类型：Section / Chunk / Embedding（`src/domain/*.ts`） | — | S | 纯 TS 类型定义 |
| T2 | 扩展 StorageAdapter 接口（`src/storage/types.ts`） | T1 | S | 接口定义 |
| T3 | InMemoryStorage 实现新方法（`src/storage/memory.ts`） | T1 T2 | M | 简单 Map + 过滤 |
| T4 | localStorage 适配器扩展（`src/storage/local.ts`） | T1 T2 T3 | M | JSON 序列化 + 键管理 |
| T5 | SQLite DDL SQL + 迁移脚本（`src-tauri/src/db_schema.sql` + `db.rs`） | T1 | M | Rust 侧表结构 |
| T6 | Tauri SQLite 初始化与 CRUD 命令（`src-tauri/src/db.rs` + `lib.rs`） | T5 | L | 异步查询层 |
| T7 | Tauri 侧工厂函数与后端选择（`src/stores/useLoopStore.ts`） | T2 T4 T6 | S | `isTauri()` 条件分支 |
| T8 | 单测：StorageAdapter 新方法（`tests/storage-adapter.test.ts`） | T1 T3 | M | 内存后端注入 |
| T9 | 迁移脚本与启动时自动迁移（Python + Rust） | T5 T6 | M | Dev 验证 + 生产挂钩 |
| T10 | 文档补充：README 更新，表字段注释完善 | T5 | S | 文档 |

**执行顺序**：T1 → T2 → T3/T4（并行）→ T5 → T6 → T7 → T8 → T9 → T10。

**验收关卡**：
- ✅ `npm run typecheck` 0 error
- ✅ `npm run test:storage` 全绿（内存后端）
- ✅ Tauri dev build 成功，SQLite 表创建无误
- ✅ 手工验证：导入文档 → 章/section/chunk 正确落表 → fts_search 可用

---

## 9. 风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| localStorage 占位体积溢出（> 10MB） | 中 | P0 完成 SQLite 迁移；护栏检查；优先 N0 落地 Rust |
| Rust SQLite 查询性能不达标 | 低 | 索引完善；lazy loading chunks；P1 性能优化 |
| 向量库选型延后导致 Embedding 表悬空 | 低 | 表预留字段但不强依赖；P1 决策时补齐 |
| 浏览器预览 vs Tauri 行为不一致 | 中 | StorageAdapter 接口隐藏实现；单测用内存后端；集成测用两套环境 |
| TypeScript 与 Rust 类型不同步 | 中 | 共享 domain 类型，Rust 用 serde 反序列化；文档对齐约定 |

---

## 10. 验证与交付

### 10.1 验收条件

1. ✅ 五层表结构完整定案（Document/Chapter/Section/Chunk/KnowledgeUnit）；
2. ✅ StorageAdapter 接口覆盖所有新增 CRUD 与查询方法；
3. ✅ 内存 + localStorage + SQLite 三后端均实现；
4. ✅ SQLite DDL + 索引 + FTS5 定义完善；
5. ✅ Rust 侧 CRUD 命令与 TS 接口镜像；
6. ✅ typecheck 0 error + test 全绿；
7. ✅ 迁移路径清晰（手工验证 + 自动化脚本）。

### 10.2 测试清单

- 单元测：StorageAdapter 各方法（内存后端注入）
- 集成测：localStorage 序列化/反序列化完整性
- 端到端：Tauri dev 模式导入文档 → SQLite 表查验
- 性能测：1000 chunks FTS 查询 < 100ms

---

## 11. 后续演进

| 阶段 | 工作 | 时间 |
|------|------|------|
| **N1（P1）** | 向量库选型（SQLite vector vs LanceDB）+ Embedding 表补齐；Chunk 级检索引擎 | 2 周 |
| **N2（P1）** | Knowledge Graph 可视化 + 高级检索（图扩展、重排序） | 3 周 |
| **N3（P2）** | RAG Context Builder 完整实现；Evidence 链路闭合 | 2 周 |
| **N4（P2）** | localStorage 下线；Tauri SQLite 生产迁移工具上线 | 1 周 |

---

## 变更记录

| 日期 | 变更 | 作者 |
|------|------|------|
| 2026-09-10 | 初稿：五层存储模型 + SQLite DDL + StorageAdapter 扩展 + 迁移路径 | WorkBuddy |
