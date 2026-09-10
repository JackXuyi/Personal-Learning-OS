-- PLOS RAG 存储层 DDL（SQLite / sqlx）
--
-- 范围说明：本脚本只建 RAG 五层中的「新增表」——sections / chunks /
-- chunk_knowledge / knowledge_units / knowledge_relations / embeddings。
-- documents 与 chapters 仍是 localStorage 侧的 source of truth（迁移期避免
-- 双写），待迁移工具稳定后由下一版 schema 接管。
--
-- 约定：
-- - 字段名 snake_case，与 Rust models.rs 的 FromRow 结构一一对应；
-- - created_at 由调用方传入 epoch ms，不用 SQL 函数作 DEFAULT（SQLite 要求
--   DEFAULT 为常量表达式，strftime 之类会报 not constant）；
-- - 多值字段（tags / knowledge_ids）分别以 JSON 文本、关联表存储；
-- - 时间统一 epoch ms（与 TS 侧 Date.now() 对齐），便于前后端直接比较。

-- ===== 小节（Chapter 下的逻辑分段）=====
-- 层级：Document → Chapter → Section → Chunk。Section 可选，用于三层结构
-- （如 7.1 / 7.2），检索结果可在此粒度返回。
CREATE TABLE IF NOT EXISTS sections (
  id                TEXT PRIMARY KEY,  -- ULID / nanoid，TS 侧生成
  chapter_id        TEXT NOT NULL,     -- 所属章（localStorage 侧 chapters.id）
  document_id       TEXT NOT NULL,     -- 冗余所属文档，便于按文档整批清理
  title             TEXT NOT NULL,     -- 小节标题
  level             INTEGER NOT NULL,  -- 标题级数 1-6（对应 H1-H6）
  idx               INTEGER NOT NULL,  -- 章内序号（从 0 起）；列名避开保留字 index
  content_ref_start INTEGER NOT NULL,  -- 正文切片起点（含，字符偏移）
  content_ref_end   INTEGER NOT NULL,  -- 正文切片终点（不含，字符偏移）
  created_at        INTEGER NOT NULL   -- epoch ms
);
CREATE INDEX IF NOT EXISTS idx_sections_chapter ON sections(chapter_id);
CREATE INDEX IF NOT EXISTS idx_sections_document ON sections(document_id);

-- ===== 块（向量化 / 全文检索基础单位）=====
-- 由语义切分引擎产出；content 建议 ≤ 512 tokens，必须保留完整来源上下文。
CREATE TABLE IF NOT EXISTS chunks (
  id                       TEXT PRIMARY KEY,  -- ULID / nanoid
  document_id              TEXT NOT NULL,     -- 来源文档
  chapter_id               TEXT NOT NULL,     -- 来源章
  section_id               TEXT,              -- 来源小节（可空：无小节结构时直挂章）
  content                  TEXT NOT NULL,     -- 块正文（检索与引用的最小单位）
  position                 INTEGER NOT NULL,  -- 文内序号（从 0 起，决定展示顺序）
  token_count              INTEGER,           -- token 数（可空：未估算时留空）
  metadata_heading         TEXT,              -- 块所属标题（ChunkMetadata.heading）
  metadata_page            INTEGER,           -- PDF 页码（ChunkMetadata.page）
  metadata_source_location TEXT,              -- 出处标号，如 "7.2"（ChunkMetadata.sourceLocation）
  created_at               INTEGER NOT NULL   -- epoch ms
);
CREATE INDEX IF NOT EXISTS idx_chunks_chapter ON chunks(chapter_id);
CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_chunks_section ON chunks(section_id);

-- 块 ↔ 知识单元多对多（chunks.knowledgeIds 的关系化落地）
CREATE TABLE IF NOT EXISTS chunk_knowledge (
  chunk_id     TEXT NOT NULL,  -- chunks.id
  knowledge_id TEXT NOT NULL,  -- knowledge_units.id
  PRIMARY KEY (chunk_id, knowledge_id)
);
CREATE INDEX IF NOT EXISTS idx_chunk_knowledge_kid ON chunk_knowledge(knowledge_id);

-- ===== 知识单元（概念 / 技能原子语义）=====
CREATE TABLE IF NOT EXISTS knowledge_units (
  id                 TEXT PRIMARY KEY,  -- ULID / nanoid
  title              TEXT NOT NULL,     -- 概念名
  kind               TEXT NOT NULL,     -- concept | skill | fact | procedure | principle
  summary            TEXT,              -- 通俗释义
  source_document_id TEXT,              -- 抽取来源文档（Evidence 链溯源）
  tags               TEXT,              -- JSON array 文本，如 ["NLP","深度学习"]
  created_at         INTEGER NOT NULL   -- epoch ms
);
CREATE INDEX IF NOT EXISTS idx_knowledge_document ON knowledge_units(source_document_id);

-- ===== 知识关系（知识图谱的边）=====
-- 语义：from_id 是 to_id 的 <rel_type>。例如 prerequisite 表示
-- 「必须先掌握 from_id，才学得会 to_id」。
CREATE TABLE IF NOT EXISTS knowledge_relations (
  id         TEXT PRIMARY KEY,  -- ULID / nanoid
  from_id    TEXT NOT NULL,     -- 边起点 knowledge_units.id
  to_id      TEXT NOT NULL,     -- 边终点 knowledge_units.id
  rel_type   TEXT NOT NULL,     -- prerequisite|related|parent|child|example|contrast|application|source
                                -- 列名避开 SQL 保留字 type
  strength   REAL,              -- 关系强度 [0,1]（可空；供推荐/掌握度引擎用）
  created_at INTEGER NOT NULL   -- epoch ms（领域类型无此字段，写入时补当前时刻）
);
CREATE INDEX IF NOT EXISTS idx_relations_from ON knowledge_relations(from_id);
CREATE INDEX IF NOT EXISTS idx_relations_to ON knowledge_relations(to_id);

-- ===== 向量化元数据 + 向量本体（v3 起）=====
-- 记录「谁被哪个模型向量化过」（支持多模型共存），并就地承载向量本体。
--
-- v3 变更：新增 vector 列（float32 little-endian 的 BLOB）。
-- 之所以不再「只记元数据」：向量检索落在应用内（不引 sqlite-vec / LanceDB 等扩展），
-- 且向量规模受个人学习资料体量约束（千级 chunk × 768 维 ≈ 3MB），全量载入 + 内存余弦
-- 即可满足。约束：vector 为 NULL 表示「元数据在、向量未生成」（老数据或生成失败）。
--
-- 新增列写在 CREATE 语句里（新库直接拿到）；存量库由 db/mod.rs::migrate 的 v2→v3
-- 步骤用 PRAGMA 探测后 ALTER 补齐——不能把 ALTER 放进本脚本，因为 apply_schema()
-- 每次启动都会执行，第二次必然报 duplicate column name。
CREATE TABLE IF NOT EXISTS embeddings (
  id          TEXT PRIMARY KEY,  -- ULID / nanoid
  target_type TEXT NOT NULL,     -- chunk | knowledge | chapter（EmbeddingTargetType）
  target_id   TEXT NOT NULL,     -- 目标实体 id
  model       TEXT NOT NULL,     -- 模型标识，如 "qwen-1.5b" | "openai-3-small"
  vector_dim  INTEGER NOT NULL,  -- 向量维度（查询前校验用）
  vector      BLOB,              -- 向量本体：float32 LE 拼接；NULL = 未生成（v3）
  created_at  INTEGER NOT NULL   -- epoch ms
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_embeddings_unique
  ON embeddings(target_type, target_id, model);
CREATE INDEX IF NOT EXISTS idx_embeddings_target ON embeddings(target_type, target_id);

-- ===== 全文检索（FTS5，trigram 分词器）=====
-- content 列建索引；id / chapter_id / document_id 仅作回表键（UNINDEXED）。
--
-- 分词器 = 'trigram'（SQLite ≥ 3.34，本机 3.43 满足）：按 3 字符滑动窗口建索引，
-- 中文子串天然可命中——MATCH '编码器' / MATCH 'tion' 都能检索到，彻底解决
-- unicode61 把连续中文整段当一个 token 的缺陷（详见 runbook 遗留问题 F1）。
--
-- 约束：trigram 要求查询词 ≥ 3 字符；应用层 db_fts_search 对 < 3 字符查询自动
-- 降级为回表 `chunks.content LIKE '%q%'`，保证中文 1–2 字短查询仍出结果；两者都
-- 未命中时由前端内存子串匹配兜底，功能不中断。
-- 存量库从 unicode61 切换到 trigram 的重建 + 重灌由 db/mod.rs::migrate 完成（v1→v2）。
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  content,
  id          UNINDEXED,
  chapter_id  UNINDEXED,
  document_id UNINDEXED,
  tokenize = 'trigram'
);

-- 同步策略：不用触发器，改由 Rust 命令显式维护（db_save_chunks /
-- db_delete_chunk）。原因：部分 SQLite 版本（含 macOS 自带 3.43 在 defensive
-- 配置下）禁止在触发器内写 FTS5 虚拟表，报 "unsafe use of virtual table"；
-- 显式同步跨版本行为一致，且逻辑集中在代码里可测。
-- 对应实现见 src-tauri/src/db/commands.rs。

-- ===== schema 版本 =====
-- 结构变更时 +1，并在 Rust 侧补对应的迁移步骤；当前版本 = 3。
-- v1 = 初版（embeddings 仅元数据）；v2 = chunks_fts 改 trigram；v3 = embeddings 加 vector。
CREATE TABLE IF NOT EXISTS _schema_version (
  version    INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL   -- epoch ms；初始占位的 0 表示「建表时刻未知」
);
INSERT OR IGNORE INTO _schema_version(version, applied_at) VALUES (1, 0);
