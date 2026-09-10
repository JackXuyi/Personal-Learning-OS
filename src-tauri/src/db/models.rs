//! db 数据模型 —— 与 `src/domain/{section,chunk,knowledge,embedding}.ts` 镜像。
//!
//! 分两类结构：
//! - `*Row`：sqlx `FromRow` 直接映射的列结构（多值字段为 JSON 文本）；
//! - `*Out`：命令返回值（多值字段已解析为 `Vec<String>`），前端拿到即可用。
//!
//! TS/Rust 两侧同改，勿单向漂移（skills/tauri-ipc §Payload）。

use serde::{Deserialize, Serialize};

// ========== Section ==========

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SectionInput {
    pub id: String,
    pub chapter_id: String,
    pub document_id: String,
    pub title: String,
    pub level: i64,
    pub idx: i64,
    pub content_ref_start: i64,
    pub content_ref_end: i64,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct SectionRow {
    pub id: String,
    pub chapter_id: String,
    pub document_id: String,
    pub title: String,
    pub level: i64,
    pub idx: i64,
    pub content_ref_start: i64,
    pub content_ref_end: i64,
    pub created_at: i64,
}

// ========== Chunk ==========

/// 写入用的 Chunk（knowledge_ids 走 chunk_knowledge 关联表，不落主表）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkInput {
    pub id: String,
    pub document_id: String,
    pub chapter_id: String,
    pub section_id: Option<String>,
    pub content: String,
    pub position: i64,
    pub token_count: Option<i64>,
    pub metadata_heading: Option<String>,
    pub metadata_page: Option<i64>,
    pub metadata_source_location: Option<String>,
    #[serde(default)]
    pub knowledge_ids: Vec<String>,
    pub created_at: i64,
}

/// 查询行：knowledge_ids 由 GROUP_CONCAT 聚合成逗号串，再拆成 Vec。
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct ChunkRow {
    pub id: String,
    pub document_id: String,
    pub chapter_id: String,
    pub section_id: Option<String>,
    pub content: String,
    pub position: i64,
    pub token_count: Option<i64>,
    pub metadata_heading: Option<String>,
    pub metadata_page: Option<i64>,
    pub metadata_source_location: Option<String>,
    pub knowledge_ids: Option<String>,
    pub created_at: i64,
}

/// 对外返回的 Chunk（与 src/domain/chunk.ts 的 Chunk 对齐）。
#[derive(Debug, Clone, Serialize)]
pub struct ChunkOut {
    pub id: String,
    pub document_id: String,
    pub chapter_id: String,
    pub section_id: Option<String>,
    pub content: String,
    pub position: i64,
    pub token_count: Option<i64>,
    pub metadata_heading: Option<String>,
    pub metadata_page: Option<i64>,
    pub metadata_source_location: Option<String>,
    pub knowledge_ids: Vec<String>,
    pub created_at: i64,
}

impl From<ChunkRow> for ChunkOut {
    fn from(row: ChunkRow) -> Self {
        let knowledge_ids = row
            .knowledge_ids
            .unwrap_or_default()
            .split(',')
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .collect();
        ChunkOut {
            id: row.id,
            document_id: row.document_id,
            chapter_id: row.chapter_id,
            section_id: row.section_id,
            content: row.content,
            position: row.position,
            token_count: row.token_count,
            metadata_heading: row.metadata_heading,
            metadata_page: row.metadata_page,
            metadata_source_location: row.metadata_source_location,
            knowledge_ids,
            created_at: row.created_at,
        }
    }
}

// ========== KnowledgeUnit ==========

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnowledgeUnitInput {
    pub id: String,
    pub title: String,
    pub kind: String,
    pub summary: Option<String>,
    pub source_document_id: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct KnowledgeUnitRow {
    pub id: String,
    pub title: String,
    pub kind: String,
    pub summary: Option<String>,
    pub source_document_id: Option<String>,
    pub tags: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct KnowledgeUnitOut {
    pub id: String,
    pub title: String,
    pub kind: String,
    pub summary: Option<String>,
    pub source_document_id: Option<String>,
    pub tags: Vec<String>,
    pub created_at: i64,
}

impl From<KnowledgeUnitRow> for KnowledgeUnitOut {
    fn from(row: KnowledgeUnitRow) -> Self {
        let tags = row
            .tags
            .and_then(|t| serde_json::from_str::<Vec<String>>(&t).ok())
            .unwrap_or_default();
        KnowledgeUnitOut {
            id: row.id,
            title: row.title,
            kind: row.kind,
            summary: row.summary,
            source_document_id: row.source_document_id,
            tags,
            created_at: row.created_at,
        }
    }
}

// ========== KnowledgeRelation ==========

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnowledgeRelationInput {
    pub id: String,
    pub from_id: String,
    pub to_id: String,
    pub rel_type: String,
    pub strength: Option<f64>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct KnowledgeRelationRow {
    pub id: String,
    pub from_id: String,
    pub to_id: String,
    pub rel_type: String,
    pub strength: Option<f64>,
    pub created_at: i64,
}

// ========== Embedding ==========

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmbeddingInput {
    pub id: String,
    pub target_type: String,
    pub target_id: String,
    pub model: String,
    pub vector_dim: i64,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct EmbeddingRow {
    pub id: String,
    pub target_type: String,
    pub target_id: String,
    pub model: String,
    pub vector_dim: i64,
    pub created_at: i64,
}
