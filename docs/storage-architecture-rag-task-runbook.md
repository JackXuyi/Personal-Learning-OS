# RAG 存储系统实施 Runbook

| 字段 | 内容 |
|------|------|
| 方案文档 | `docs/storage-architecture-rag-2026-09.md` |
| 执行开始 | 2026-09-10 13:22 UTC+8 |
| 执行者 | WorkBuddy |
| 状态 | 🚧 进行中 |

---

## 任务清单（10 Tasks）

| ID | 任务 | 状态 | 开始时间 | 完成时间 | 备注 |
|----|------|------|----------|----------|------|
| T1 | 新增域类型：Section / Chunk / Embedding | ✅ 完成 | 2026-09-10 13:22 | 2026-09-10 13:27 | section.ts / chunk.ts / embedding.ts + index.ts 导出 |
| T2 | 扩展 StorageAdapter 接口 | 🚧 进行中 | 2026-09-10 13:28 | — | 接口定义 |
| T3 | InMemoryStorage 实现新方法 | ⏸️ 等待 T1 T2 | — | — | 简单 Map + 过滤 |
| T4 | localStorage 适配器扩展 | ⏸️ 等待 T1 T2 T3 | — | — | JSON 序列化 + 键管理 |
| T5 | SQLite DDL SQL + 迁移脚本 | ⏸️ 等待 T1 | — | — | Rust 侧表结构 |
| T6 | Tauri SQLite 初始化与 CRUD 命令 | ⏸️ 等待 T5 | — | — | 异步查询层 |
| T7 | Tauri 侧工厂函数与后端选择 | ⏸️ 等待 T2 T4 T6 | — | — | `isTauri()` 条件分支 |
| T8 | 单测：StorageAdapter 新方法 | ⏸️ 等待 T1 T3 | — | — | 内存后端注入 |
| T9 | 迁移脚本与启动时自动迁移 | ⏸️ 等待 T5 T6 | — | — | Dev 验证 + 生产挂钩 |
| T10 | 文档补充：README 更新，表字段注释 | ⏸️ 等待 T5 | — | — | 文档 |

---

## T1 · 新增域类型（Section / Chunk / Embedding）

### 目标
在 `src/domain/` 下新增三个域类型文件，定义完整字段与辅助函数。

### 涉及文件
- `src/domain/section.ts`（新建）
- `src/domain/chunk.ts`（新建）
- `src/domain/embedding.ts`（新建）
- `src/domain/index.ts`（修改，导出新类型）

### 实施步骤

#### 1.1 新建 `src/domain/section.ts`

```ts
/**
 * Section（小节）—— Chapter 下的逻辑分段（可选，支持三层结构）。
 * 例：Chapter 7 下可有 7.1、7.2、7.3 多个 Section。
 * 搜索时可在 Section 粒度返回结果。
 */
import type { ChapterRange } from "./chapter";

export interface Section {
  id: string;
  chapterId: string;
  documentId: string;
  title: string;
  /** 标题级数（1-6 对应 H1-H6）。 */
  level: number;
  /** 章内序号。 */
  index: number;
  /** 正文切片引用（字符区间）。 */
  contentRef: ChapterRange;
  createdAt: number;
}

/** 按 index 升序排序（与 Chapter 同样规则）。 */
export function sortSectionsByIndex(sections: Section[]): Section[] {
  return [...sections].sort((a, b) => a.index - b.index);
}
```

#### 1.2 新建 `src/domain/chunk.ts`

```ts
/**
 * Chunk（块）—— 向量化与全文检索的基础单位。
 * 由 semanticChunk 引擎产生（将 Section/Paragraph 分割为语义块）。
 */

export interface ChunkMetadata {
  heading?: string;
  page?: number;
  sourceLocation?: string;  // "7.2" 等
}

export interface Chunk {
  id: string;
  documentId: string;
  chapterId: string;
  sectionId?: string;
  /** 实际正文（≤ 512 tokens 建议）。 */
  content: string;
  /** 在整文中的序号。 */
  position: number;
  tokenCount?: number;
  /** 关联的 KnowledgeUnit IDs。 */
  knowledgeIds: string[];
  metadata?: ChunkMetadata;
  createdAt: number;
}

/** 按 position 升序排序。 */
export function sortChunksByPosition(chunks: Chunk[]): Chunk[] {
  return [...chunks].sort((a, b) => a.position - b.position);
}

/** 估算 token 数量（简单启发式：中文 ~1.5 字/token，英文 ~4 字符/token）。 */
export function estimateTokenCount(text: string): number {
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const otherChars = text.length - chineseChars;
  return Math.ceil(chineseChars / 1.5 + otherChars / 4);
}
```

#### 1.3 新建 `src/domain/embedding.ts`

```ts
/**
 * Embedding（向量化元数据）—— 记录向量化结果。
 * 具体向量库选型延后（P1），本表仅记录元数据。
 * 实际向量存储在向量库或单独的 BLOB 表中。
 */

export type EmbeddingTargetType = "chunk" | "knowledge" | "chapter";

export interface Embedding {
  id: string;
  targetType: EmbeddingTargetType;
  targetId: string;
  /** 模型标识（如 "qwen-1.5b" | "openai-3-small"）。 */
  model: string;
  /** 向量维度（便于查询检查）。 */
  vectorDim: number;
  createdAt: number;
}

/** 按目标类型 + ID 查找 Embedding。 */
export function embeddingKey(targetType: EmbeddingTargetType, targetId: string): string {
  return `${targetType}:${targetId}`;
}
```

#### 1.4 修改 `src/domain/index.ts`（导出新类型）

```ts
// 现状导出 …
export * from "./document";
export * from "./chapter";
export * from "./knowledge";
export * from "./assessment";
export * from "./learner";
export * from "./goal";
export * from "./plan";
export * from "./quiz";
export * from "./evidence";

// 新增导出
export * from "./section";
export * from "./chunk";
export * from "./embedding";
```

### 验证
```bash
npm run typecheck  # 预期 0 error
```

### 产出
- ✅ `src/domain/section.ts`（~30 行）
- ✅ `src/domain/chunk.ts`（~50 行）
- ✅ `src/domain/embedding.ts`（~30 行）
- ✅ `src/domain/index.ts` 导出新增类型

---

## T2 · 扩展 StorageAdapter 接口

### 目标
在 `src/storage/types.ts` 中为 StorageAdapter 新增 Section / Chunk / KnowledgeUnit / Embedding / 全文搜索方法签名。

### 涉及文件
- `src/storage/types.ts`（修改）

### 实施步骤

#### 2.1 新增类型导入

```ts
import type {
  Chapter,
  Chunk,        // 新增
  Embedding,    // 新增
  EvidenceEntry,
  KnowledgeGraph,
  KnowledgeRelation,  // 新增
  KnowledgeUnit,      // 新增
  LearnerState,
  LearningGoal,
  Paper,
  PaperAnswers,
  PaperResult,
  Section,      // 新增
  SourceDocument,
} from "../domain";
```

#### 2.2 新增 RetrievalScope 类型

```ts
/** RAG 检索范围限定（用于 fullTextSearch / vectorSearch 等）。 */
export interface RetrievalScope {
  documentId?: string;
  chapterId?: string;
  sectionId?: string;
  knowledgeId?: string;
  goalId?: string;
}
```

#### 2.3 扩展 StorageAdapter 接口

在现有方法后追加：

```ts
export interface StorageAdapter {
  readonly name: string;

  // ===== 现状 Section（保留）=====
  listDocuments(): Promise<SourceDocument[]>;
  getDocument(id: string): Promise<SourceDocument | undefined>;
  saveDocument(doc: SourceDocument): Promise<void>;
  deleteDocument(id: string): Promise<void>;

  listChapters(documentId: string): Promise<Chapter[]>;
  saveChapters(documentId: string, chapters: Chapter[]): Promise<void>;
  // … paper / learner / goal / evidence（现状保留）…

  // ===== Section 层（新增）=====
  listSections(chapterId: string): Promise<Section[]>;
  getSection(id: string): Promise<Section | undefined>;
  saveSection(section: Section): Promise<void>;
  saveSections(sections: Section[]): Promise<void>;
  deleteSection(id: string): Promise<void>;
  /** 按正文区间查询（用于从 Chapter 切片快速定位 Sections）。 */
  sectionsByRange(documentId: string, start: number, end: number): Promise<Section[]>;

  // ===== Chunk 层（新增）=====
  listChunks(chapterId: string): Promise<Chunk[]>;
  listChunksByDocument(documentId: string): Promise<Chunk[]>;
  getChunk(id: string): Promise<Chunk | undefined>;
  saveChunk(chunk: Chunk): Promise<void>;
  saveChunks(chunks: Chunk[]): Promise<void>;
  deleteChunk(id: string): Promise<void>;
  /** 按知识单元查询相关 Chunks。 */
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
   * @param scope 检索范围
   * @param limit 返回条数（默认 10）
   */
  fullTextSearch(query: string, scope?: RetrievalScope, limit?: number): Promise<Chunk[]>;
}
```

### 验证
```bash
npm run typecheck  # 预期 0 error（接口定义，无实现）
```

### 产出
- ✅ `src/storage/types.ts` 扩展完成（新增 ~60 行）

---

## T3 · InMemoryStorage 实现新方法

### 目标
在 `src/storage/memory.ts` 中为新增方法提供内存哈希表实现。

### 涉及文件
- `src/storage/memory.ts`（修改）

### 实施步骤

#### 3.1 新增内部数据结构

```ts
import type {
  Chapter,
  Chunk,          // 新增
  Embedding,      // 新增
  EvidenceEntry,
  KnowledgeGraph,
  KnowledgeRelation,  // 新增
  KnowledgeUnit,      // 新增
  LearnerState,
  LearningGoal,
  Paper,
  PaperAnswers,
  PaperResult,
  Section,        // 新增
  SourceDocument,
} from "../domain";
import type { RetrievalScope, StorageAdapter } from "./types";

export class InMemoryStorage implements StorageAdapter {
  readonly name = "memory";

  // 现状
  protected documents = new Map<string, SourceDocument>();
  protected chaptersByDocument = new Map<string, Chapter[]>();
  protected papers = new Map<string, Paper>();
  // … 其他现状 …

  // 新增
  protected sections = new Map<string, Section>();
  protected chunks = new Map<string, Chunk>();
  protected knowledgeUnits = new Map<string, KnowledgeUnit>();
  protected knowledgeRelations = new Map<string, KnowledgeRelation>();
  protected embeddings = new Map<string, Embedding>();

  // … 现状方法 …
}
```

#### 3.2 实现 Section 方法

```ts
async listSections(chapterId: string): Promise<Section[]> {
  return [...this.sections.values()].filter((s) => s.chapterId === chapterId);
}

async getSection(id: string): Promise<Section | undefined> {
  return this.sections.get(id);
}

async saveSection(section: Section): Promise<void> {
  this.sections.set(section.id, section);
}

async saveSections(sections: Section[]): Promise<void> {
  for (const s of sections) {
    this.sections.set(s.id, s);
  }
}

async deleteSection(id: string): Promise<void> {
  this.sections.delete(id);
}

async sectionsByRange(documentId: string, start: number, end: number): Promise<Section[]> {
  return [...this.sections.values()].filter(
    (s) =>
      s.documentId === documentId &&
      s.contentRef.start >= start &&
      s.contentRef.end <= end,
  );
}
```

#### 3.3 实现 Chunk 方法

```ts
async listChunks(chapterId: string): Promise<Chunk[]> {
  return [...this.chunks.values()].filter((c) => c.chapterId === chapterId);
}

async listChunksByDocument(documentId: string): Promise<Chunk[]> {
  return [...this.chunks.values()].filter((c) => c.documentId === documentId);
}

async getChunk(id: string): Promise<Chunk | undefined> {
  return this.chunks.get(id);
}

async saveChunk(chunk: Chunk): Promise<void> {
  this.chunks.set(chunk.id, chunk);
}

async saveChunks(chunks: Chunk[]): Promise<void> {
  for (const c of chunks) {
    this.chunks.set(c.id, c);
  }
}

async deleteChunk(id: string): Promise<void> {
  this.chunks.delete(id);
}

async chunksByKnowledge(knowledgeId: string): Promise<Chunk[]> {
  return [...this.chunks.values()].filter((c) => c.knowledgeIds.includes(knowledgeId));
}
```

#### 3.4 实现 KnowledgeUnit / Relation 方法

```ts
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
  for (const u of units) {
    this.knowledgeUnits.set(u.id, u);
  }
}

async deleteKnowledgeUnit(id: string): Promise<void> {
  this.knowledgeUnits.delete(id);
}

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
  for (const r of relations) {
    this.knowledgeRelations.set(r.id, r);
  }
}

async deleteRelation(id: string): Promise<void> {
  this.knowledgeRelations.delete(id);
}
```

#### 3.5 实现 Embedding 方法

```ts
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
  for (const e of embeddings) {
    this.embeddings.set(e.id, e);
  }
}

async deleteEmbedding(id: string): Promise<void> {
  this.embeddings.delete(id);
}

async deleteEmbeddingsByTarget(targetId: string): Promise<void> {
  const toDelete = [...this.embeddings.values()]
    .filter((e) => e.targetId === targetId)
    .map((e) => e.id);
  for (const id of toDelete) {
    this.embeddings.delete(id);
  }
}
```

#### 3.6 实现 Evidence 扩展

```ts
async listEvidenceBySubject(subjectId: string): Promise<EvidenceEntry[]> {
  return this.evidenceLog.filter((e) => e.subjectId === subjectId);
}
```

#### 3.7 实现全文搜索（简单启发式）

```ts
async fullTextSearch(query: string, scope?: RetrievalScope, limit = 10): Promise<Chunk[]> {
  // 内存后端：简单 includes 匹配（生产用 FTS5）
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
  
  const matched = candidates.filter((c) =>
    c.content.toLowerCase().includes(query.toLowerCase()),
  );
  
  return matched.slice(0, limit);
}
```

### 验证
```bash
npm run typecheck  # 预期 0 error
```

### 产出
- ✅ `src/storage/memory.ts` 扩展完成（新增 ~200 行）

---

## T4 · localStorage 适配器扩展

### 目标
在 `src/storage/local.ts` 中继承 InMemoryStorage，增加新 localStorage key，调用 persist()。

### 涉及文件
- `src/storage/local.ts`（修改）

### 实施步骤

#### 4.1 新增 localStorage key

```ts
const KEY_SECTIONS = "plos.sections";
const KEY_CHUNKS = "plos.chunks";
const KEY_KNOWLEDGE_UNITS = "plos.knowledge-units";
const KEY_KNOWLEDGE_RELATIONS = "plos.knowledge-relations";
const KEY_EMBEDDINGS = "plos.embeddings";
```

#### 4.2 构造函数加载

```ts
constructor() {
  super();
  // 现状加载 …
  
  // 新增加载
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
```

#### 4.3 persist() 保存

```ts
private persist() {
  // 现状保存 …
  
  // 新增保存
  localStorage.setItem(KEY_SECTIONS, JSON.stringify([...this.sections.values()]));
  localStorage.setItem(KEY_CHUNKS, JSON.stringify([...this.chunks.values()]));
  localStorage.setItem(KEY_KNOWLEDGE_UNITS, JSON.stringify([...this.knowledgeUnits.values()]));
  localStorage.setItem(KEY_KNOWLEDGE_RELATIONS, JSON.stringify([...this.knowledgeRelations.values()]));
  localStorage.setItem(KEY_EMBEDDINGS, JSON.stringify([...this.embeddings.values()]));
}
```

#### 4.4 override 所有写操作

```ts
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

// … 同理 Chunk / KnowledgeUnit / Relation / Embedding 的写操作 …
```

### 验证
```bash
npm run typecheck  # 预期 0 error
```

### 产出
- ✅ `src/storage/local.ts` 扩展完成（新增 ~100 行）

---

## T5–T10（后续任务）

由于篇幅，T5–T10 任务的详细步骤将在执行 T1–T4 后补充。

**优先级**：T1 → T2 → T3 → T4（前端 TS 层优先）→ T5 → T6（Rust 层）→ T7–T10（集成与测试）。

---

## 执行日志

| 时间 | 事件 | 备注 |
|------|------|------|
| 2026-09-10 13:22 | Runbook 创建 | 准备开工 T1 |
| 2026-09-10 13:23 | T1 开始 | 新增域类型 |

---

## 变更记录

| 日期 | 变更 | 作者 |
|------|------|------|
| 2026-09-10 | 初稿 Runbook（T1–T4 详细步骤 + T5–T10 占位） | WorkBuddy |
