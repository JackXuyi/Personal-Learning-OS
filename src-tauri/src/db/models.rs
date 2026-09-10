//! db 数据模型 —— 与 `src/domain/{section,chunk,knowledge,embedding}.ts` 镜像。
//!
//! 分两类结构：
//! - `*Row`：sqlx `FromRow` 直接映射的列结构（多值字段为 JSON 文本）；
//! - `*Out`：命令返回值（多值字段已解析为 `Vec<String>`），前端拿到即可用。
//!
//! ## 序列化约定
//! 所有对外结构统一 `rename_all = "camelCase"`：
//! - **入参**：`#[tauri::command]` 只把*顶层*参数名转成 camelCase（宏默认
//!   `ArgumentCase::Camel`），**嵌套结构体的字段名不做转换**——所以 `*Input`
//!   必须自带 camelCase 重命名，否则前端得发 snake_case；
//! - **出参**：Rust 侧按字段名原样序列化，不加重命名前端收到的就是 snake_case。
//!
//! TS/Rust 两侧同改，勿单向漂移（skills/tauri-ipc §Payload）。

use serde::{Deserialize, Serialize};

// ========== Section ==========

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
pub struct KnowledgeRelationInput {
    pub id: String,
    pub from_id: String,
    pub to_id: String,
    pub rel_type: String,
    pub strength: Option<f64>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
pub struct EmbeddingInput {
    pub id: String,
    pub target_type: String,
    pub target_id: String,
    pub model: String,
    pub vector_dim: i64,
    /// 向量本体（v3）。None = 只写元数据（老调用点 / 生成失败留空）。
    #[serde(default)]
    pub vector: Option<Vec<f32>>,
    pub created_at: i64,
}

/// 查询行：**刻意不含 vector**。
///
/// `db_list_embeddings` 的语义是「元数据清单」（供判重与覆盖率统计），若把向量一起
/// `SELECT *` 出来，每次判重都要搬运 MB 级字节。取向量是 `db_list_embedding_vectors`
/// （`EmbeddingVectorOut`）的职责。
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingRow {
    pub id: String,
    pub target_type: String,
    pub target_id: String,
    pub model: String,
    pub vector_dim: i64,
    pub created_at: i64,
}

/// 检索用轻量视图（与 src/domain/embedding.ts 的 `EmbeddingVector` 对齐）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingVectorOut {
    pub target_id: String,
    pub model: String,
    /// 向量维度；以解码后的实际长度为准（BLOB 长度 ÷ 4）。
    pub dim: i64,
    pub vector: Vec<f32>,
}

/// 向量 → BLOB：float32 little-endian 逐元素拼接（4 字节 / 元素）。
///
/// 为什么手写而不引 `bytemuck`：本仓库 Rust 侧只有这一处二进制编解码，
/// 加一个依赖换取 10 行代码不划算；且 LE 显式写出，跨平台读写一致。
pub fn f32_to_blob(vector: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(vector.len() * 4);
    for v in vector {
        out.extend_from_slice(&v.to_le_bytes());
    }
    out
}

/// BLOB → 向量。长度不是 4 的倍数时，尾部残字节忽略（不 panic、不报错）。
pub fn blob_to_f32(blob: &[u8]) -> Vec<f32> {
    blob.chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect()
}

#[cfg(test)]
mod tests {
    //! IPC 命名契约守卫：前端 `src/storage/tauri.ts` 一律收发 camelCase。
    //! 入参侧尤其危险——`#[tauri::command]` 只转换*顶层*参数名，嵌套结构体
    //! 字段不做转换，一旦这里丢掉 rename_all，前端就会静默拿到 undefined。

    use super::*;

    #[test]
    fn section_input_accepts_camel_case() {
        let json = serde_json::json!({
            "id": "s1", "chapterId": "ch7", "documentId": "d1", "title": "Reranking",
            "level": 2, "idx": 1, "contentRefStart": 0, "contentRefEnd": 120, "createdAt": 42
        });
        let s: SectionInput = serde_json::from_value(json).expect("camelCase SectionInput");
        assert_eq!(s.chapter_id, "ch7");
        assert_eq!(s.content_ref_start, 0);
        assert_eq!(s.content_ref_end, 120);
    }

    #[test]
    fn chunk_input_accepts_camel_case() {
        let json = serde_json::json!({
            "id": "c1", "documentId": "d1", "chapterId": "ch7", "sectionId": "s2",
            "content": "Reranking improves ordering", "position": 3, "tokenCount": 7,
            "metadataHeading": "Reranking", "metadataPage": 128,
            "metadataSourceLocation": "7.2", "knowledgeIds": ["reranking"], "createdAt": 1
        });
        let c: ChunkInput = serde_json::from_value(json).expect("camelCase ChunkInput");
        assert_eq!(c.metadata_source_location.as_deref(), Some("7.2"));
        assert_eq!(c.knowledge_ids, vec!["reranking".to_string()]);
    }

    #[test]
    fn relation_input_accepts_camel_case() {
        let json = serde_json::json!({
            "id": "r1", "fromId": "u1", "toId": "u2",
            "relType": "prerequisite", "strength": 0.8, "createdAt": 1
        });
        let r: KnowledgeRelationInput =
            serde_json::from_value(json).expect("camelCase KnowledgeRelationInput");
        assert_eq!(r.rel_type, "prerequisite");
    }

    #[test]
    fn chunk_out_serializes_to_camel_case() {        let out = ChunkOut {
            id: "c1".into(),
            document_id: "d1".into(),
            chapter_id: "ch7".into(),
            section_id: Some("s2".into()),
            content: "x".into(),
            position: 1,
            token_count: Some(3),
            metadata_heading: Some("Reranking".into()),
            metadata_page: Some(128),
            metadata_source_location: None,
            knowledge_ids: vec!["reranking".into()],
            created_at: 1,
        };
        let v = serde_json::to_value(&out).expect("serialize ChunkOut");
        for key in [
            "documentId",
            "chapterId",
            "sectionId",
            "tokenCount",
            "metadataHeading",
            "metadataPage",
            "knowledgeIds",
            "createdAt",
        ] {
            assert!(v.get(key).is_some(), "缺少 camelCase 字段 {key}：{v}");
        }
        assert!(v.get("document_id").is_none(), "不应出现 snake_case：{v}");
    }

    #[test]
    fn embedding_input_accepts_camel_case_with_vector() {
        // 前端 saveEmbeddings 会带 vector（number[]）；缺省时也必须能反序列化（老调用点）。
        let json = serde_json::json!({
            "id": "e1", "targetType": "chunk", "targetId": "c1", "model": "text-embedding-v3",
            "vectorDim": 3, "vector": [1.0, 0.0, -0.5], "createdAt": 7
        });
        let e: EmbeddingInput = serde_json::from_value(json).expect("camelCase EmbeddingInput");
        assert_eq!(e.target_id, "c1");
        assert_eq!(e.vector.as_deref(), Some([1.0_f32, 0.0, -0.5].as_slice()));

        let no_vec = serde_json::json!({
            "id": "e2", "targetType": "chunk", "targetId": "c2", "model": "m",
            "vectorDim": 0, "createdAt": 7
        });
        let e2: EmbeddingInput =
            serde_json::from_value(no_vec).expect("vector 可缺省（serde default）");
        assert!(e2.vector.is_none());
    }

    #[test]
    fn embedding_vector_out_serializes_to_camel_case() {
        let out = EmbeddingVectorOut {
            target_id: "c1".into(),
            model: "text-embedding-v3".into(),
            dim: 2,
            vector: vec![0.25, -0.75],
        };
        let v = serde_json::to_value(&out).expect("serialize EmbeddingVectorOut");
        assert!(v.get("targetId").is_some(), "缺少 camelCase targetId：{v}");
        assert!(v.get("dim").is_some());
        assert!(v.get("target_id").is_none(), "不应出现 snake_case：{v}");
    }

    #[test]
    fn f32_blob_roundtrip_is_lossless_le() {
        let src = vec![0.0_f32, 1.0, -1.5, 3.0625, f32::MIN_POSITIVE];
        let blob = f32_to_blob(&src);
        assert_eq!(blob.len(), src.len() * 4, "每元素 4 字节");
        assert_eq!(blob_to_f32(&blob), src, "编解码必须无损");

        // 显式验证字节序：1.0f32 的 LE 字节是 00 00 80 3F。
        assert_eq!(&f32_to_blob(&[1.0])[..], &[0x00, 0x00, 0x80, 0x3F]);

        // 空向量 / 尾部残字节：不 panic，残字节被忽略。
        assert!(blob_to_f32(&[]).is_empty());
        assert_eq!(blob_to_f32(&[0x00, 0x00, 0x80]), Vec::<f32>::new());
    }
}
