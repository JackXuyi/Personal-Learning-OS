-- PLOS RAG 存储层 DDL（SQLite / sqlx）
--
-- 范围说明：本脚本只建 RAG 五层中的「新增表」——sections / chunks /
-- chunk_knowledge / knowledge_units / knowledge_relations / embeddings。
-- documents 与 chapters 仍是 localStorage 侧的 source of truth（迁移期避免
-- 双写），待 T9 迁移工具上线后由下一版 schema 接管。
--
-- 约定：
-- - 字段名 snake_case，与 Rust models.rs 的 FromRow 结构一一对应；
-- - created_at 由调用方传入 epoch ms，不用 SQL 函数作 DEFAULT（SQLite 要求
--   DEFAULT 为常量表达式，strftime 之类会报 not constant）；
-- - 多值字段（tags / knowledge_ids）分别以 JSON 文本、关联表存储。

-- ===== 小节（Chapter 下的逻辑分段）=====
CREATE TABLE IF NOT EXISTS sections (
  id                TEXT PRIMARY KEY,
  chapter_id        TEXT NOT NULL,
  document_id       TEXT NOT NULL,
  title             TEXT NOT NULL,
  level             INTEGER NOT NULL,
  idx               INTEGER NOT NULL,
  content_ref_start INTEGER NOT NULL,
  content_ref_end   INTEGER NOT NULL,
  created_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sections_chapter ON sections(chapter_id);
CREATE INDEX IF NOT EXISTS idx_sections_document ON sections(document_id);

-- ===== 块（向量化 / 全文检索基础单位）=====
CREATE TABLE IF NOT EXISTS chunks (
  id                       TEXT PRIMARY KEY,
  document_id              TEXT NOT NULL,
  chapter_id               TEXT NOT NULL,
  section_id               TEXT,
  content                  TEXT NOT NULL,
  position                 INTEGER NOT NULL,
  token_count              INTEGER,
  metadata_heading         TEXT,
  metadata_page            INTEGER,
  metadata_source_location TEXT,
  created_at               INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunks_chapter ON chunks(chapter_id);
CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_chunks_section ON chunks(section_id);

-- 块 ↔ 知识单元多对多
CREATE TABLE IF NOT EXISTS chunk_knowledge (
  chunk_id     TEXT NOT NULL,
  knowledge_id TEXT NOT NULL,
  PRIMARY KEY (chunk_id, knowledge_id)
);
CREATE INDEX IF NOT EXISTS idx_chunk_knowledge_kid ON chunk_knowledge(knowledge_id);

-- ===== 知识单元 =====
CREATE TABLE IF NOT EXISTS knowledge_units (
  id                 TEXT PRIMARY KEY,
  title              TEXT NOT NULL,
  kind               TEXT NOT NULL,
  summary            TEXT,
  source_document_id TEXT,
  tags               TEXT,          -- JSON array 文本
  created_at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_knowledge_document ON knowledge_units(source_document_id);

-- ===== 知识关系 =====
CREATE TABLE IF NOT EXISTS knowledge_relations (
  id         TEXT PRIMARY KEY,
  from_id    TEXT NOT NULL,
  to_id      TEXT NOT NULL,
  rel_type   TEXT NOT NULL,          -- 避开 SQL 保留字 type
  strength   REAL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_relations_from ON knowledge_relations(from_id);
CREATE INDEX IF NOT EXISTS idx_relations_to ON knowledge_relations(to_id);

-- ===== 向量化元数据（实际向量由 P1 的向量库承载）=====
CREATE TABLE IF NOT EXISTS embeddings (
  id         TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id  TEXT NOT NULL,
  model      TEXT NOT NULL,
  vector_dim INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_embeddings_unique
  ON embeddings(target_type, target_id, model);
CREATE INDEX IF NOT EXISTS idx_embeddings_target ON embeddings(target_type, target_id);

-- ===== 全文检索（FTS5）=====
-- content 列建索引；id / chapter_id / document_id 仅作回表键（UNINDEXED）。
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  content,
  id         UNINDEXED,
  chapter_id UNINDEXED,
  document_id UNINDEXED
);

-- 同步策略：不用触发器，改由 Rust 命令显式维护（db_save_chunks /
-- db_delete_chunk）。原因：部分 SQLite 版本（含 macOS 自带 3.43 在 defensive
-- 配置下）禁止在触发器内写 FTS5 虚拟表，报 "unsafe use of virtual table"；
-- 显式同步跨版本行为一致，且逻辑集中在代码里可测。
-- 对应实现见 src-tauri/src/db/commands.rs。

-- ===== schema 版本 =====
CREATE TABLE IF NOT EXISTS _schema_version (
  version    INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
INSERT OR IGNORE INTO _schema_version(version, applied_at) VALUES (1, 0);
