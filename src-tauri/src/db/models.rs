//! db 数据模型 —— 与 `src/domain/{document,chapter,section,chunk,knowledge,embedding}.ts` 镜像。
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

// ========== JSON 列编解码（documents / chapters 六处共用）==========
//
// 抽出来的理由：本文件里「JSON 列」从一个（knowledge_units.tags）涨到七个，
// 每处各写一份 `serde_json::to_string(...).unwrap_or_else(...)` 就是同一规则
// 散在多处 —— 那正是本仓库反复踩过的「两把尺子」根因。
//
// 硬口径：**`None` 保持 SQL NULL，绝不写 `"null"` 字符串**。写成字符串后
// 读回是 `Some(Value::Null)`，与「字段缺省」再也分不开。

/// 编码可空 JSON 列：`None` → SQL NULL。
pub fn json_col<T: Serialize>(value: &Option<T>) -> Result<Option<String>, String> {
    match value {
        None => Ok(None),
        Some(v) => serde_json::to_string(v).map(Some).map_err(|e| e.to_string()),
    }
}

/// 解码可空 JSON 列：NULL / 坏值 → `None`（老数据或手改过的库不炸）。
pub fn from_json_col<T: serde::de::DeserializeOwned>(raw: Option<String>) -> Option<T> {
    raw.and_then(|s| serde_json::from_str::<T>(&s).ok())
}

/// 编码 NOT NULL JSON 列（`chapters.key_points` / `unit_ids`）：失败兜底为 `fallback`。
pub fn json_col_required<T: Serialize>(value: &T, fallback: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| fallback.to_string())
}

/// 解码 NOT NULL 的 JSON 数组列：坏值 → 空数组（显示为空，不中断读路径）。
pub fn from_json_array<T: serde::de::DeserializeOwned>(raw: &str) -> Vec<T> {
    serde_json::from_str::<Vec<T>>(raw).unwrap_or_default()
}

// ========== SourceDocument（v5 下沉 · D12）==========

/// 写入用的资料。
///
/// `analysis` / `overview` 用 `serde_json::Value` 而不拆列：两者是随领域演进的
/// 嵌套结构（`DocumentOverview` 已有 9 个字段），拆列会让每次字段增删都要动
/// schema；它们是「资料自带的附带信息」，SQL 侧不需要按内部字段查询。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentInput {
    pub id: String,
    pub title: String,
    pub format: String,
    pub status: String,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub uri: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
    pub imported_at: i64,
    #[serde(default)]
    pub raw_size_bytes: Option<i64>,
    /// 正文快照 —— **最大的一列**（社区知识包 100 MiB 量级的主体就在这）。
    #[serde(default)]
    pub text_preview: Option<String>,
    #[serde(default)]
    pub goal_ids: Option<Vec<String>>,
    #[serde(default)]
    pub analysis: Option<serde_json::Value>,
    #[serde(default)]
    pub overview: Option<serde_json::Value>,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct DocumentRow {
    pub id: String,
    pub title: String,
    pub format: String,
    pub status: String,
    pub path: Option<String>,
    pub uri: Option<String>,
    pub source: Option<String>,
    pub imported_at: i64,
    pub raw_size_bytes: Option<i64>,
    pub text_preview: Option<String>,
    pub goal_ids: Option<String>,
    pub analysis: Option<String>,
    pub overview: Option<String>,
}

/// 对外返回的资料。
///
/// `skip_serializing_if`：字段缺省时**整个键不出现**（而非 `"path": null`）。
/// 这与 TS 侧 `path?: string` 的语义严格对齐 —— 否则前端把 `null` 存进领域对象，
/// 下一次 round-trip 的深比较就会因 `null !== undefined` 失败。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentOut {
    pub id: String,
    pub title: String,
    pub format: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uri: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    pub imported_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_size_bytes: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_preview: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub goal_ids: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub analysis: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub overview: Option<serde_json::Value>,
}

impl From<DocumentRow> for DocumentOut {
    fn from(row: DocumentRow) -> Self {
        DocumentOut {
            id: row.id,
            title: row.title,
            format: row.format,
            status: row.status,
            path: row.path,
            uri: row.uri,
            source: row.source,
            imported_at: row.imported_at,
            raw_size_bytes: row.raw_size_bytes,
            text_preview: row.text_preview,
            goal_ids: from_json_col(row.goal_ids),
            analysis: from_json_col(row.analysis),
            overview: from_json_col(row.overview),
        }
    }
}

// ========== Chapter（v5 下沉 · D12）==========

/// 要点 ↔ 原文引用（`Chapter.keyPointRefs` 的元素；与 domain/chapter.ts 的
/// `KeyPointRef` 逐字段对齐）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyPointRefDto {
    pub point: String,
    pub quote: String,
    pub start: i64,
    pub end: i64,
}

/// 写入用的章节。
///
/// ⚠️ **刻意不含 `document_id`** —— 它由命令参数给出。行内再带一份就有
/// 「参数与行内不一致」的可能，而这类错只在运行时才暴露（写进别人的资料下）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterInput {
    pub id: String,
    /// 章序号 1..n（TS 侧 `Chapter.order`；SQL 列名 `ord` 避开保留字）。
    pub ord: i64,
    pub title: String,
    pub content_ref_start: i64,
    pub content_ref_end: i64,
    pub status: String,
    pub created_at: i64,
    #[serde(default)]
    pub key_points: Vec<String>,
    #[serde(default)]
    pub key_point_refs: Option<Vec<KeyPointRefDto>>,
    #[serde(default)]
    pub unit_ids: Vec<String>,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct ChapterRow {
    pub id: String,
    pub document_id: String,
    pub ord: i64,
    pub title: String,
    pub content_ref_start: i64,
    pub content_ref_end: i64,
    pub status: String,
    pub created_at: i64,
    pub key_points: String,
    pub key_point_refs: Option<String>,
    pub unit_ids: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterOut {
    pub id: String,
    pub document_id: String,
    pub ord: i64,
    pub title: String,
    pub content_ref_start: i64,
    pub content_ref_end: i64,
    pub status: String,
    pub created_at: i64,
    pub key_points: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key_point_refs: Option<Vec<KeyPointRefDto>>,
    pub unit_ids: Vec<String>,
}

impl From<ChapterRow> for ChapterOut {
    fn from(row: ChapterRow) -> Self {
        ChapterOut {
            id: row.id,
            document_id: row.document_id,
            ord: row.ord,
            title: row.title,
            content_ref_start: row.content_ref_start,
            content_ref_end: row.content_ref_end,
            status: row.status,
            created_at: row.created_at,
            key_points: from_json_array(&row.key_points),
            key_point_refs: from_json_col(row.key_point_refs),
            unit_ids: from_json_array(&row.unit_ids),
        }
    }
}

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

/// 概念原文出处（v4）：四列同空 = 无 evidence，不做部分存储。
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
    #[serde(default)]
    pub evidence_document_id: Option<String>,
    #[serde(default)]
    pub evidence_start: Option<i64>,
    #[serde(default)]
    pub evidence_end: Option<i64>,
    #[serde(default)]
    pub evidence_quote: Option<String>,
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
    pub evidence_document_id: Option<String>,
    pub evidence_start: Option<i64>,
    pub evidence_end: Option<i64>,
    pub evidence_quote: Option<String>,
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
    pub evidence_document_id: Option<String>,
    pub evidence_start: Option<i64>,
    pub evidence_end: Option<i64>,
    pub evidence_quote: Option<String>,
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
            evidence_document_id: row.evidence_document_id,
            evidence_start: row.evidence_start,
            evidence_end: row.evidence_end,
            evidence_quote: row.evidence_quote,
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
    fn knowledge_unit_input_accepts_camel_case_with_evidence() {
        // v4：evidence 拆平四列，字段名必须与 TS KnowledgeUnitDto 的 camelCase 对齐。
        let json = serde_json::json!({
            "id": "u1", "title": "向量检索", "kind": "concept", "summary": "用向量做语义召回",
            "sourceDocumentId": "d1", "tags": ["NLP"], "createdAt": 5,
            "evidenceDocumentId": "d1", "evidenceStart": 10, "evidenceEnd": 42,
            "evidenceQuote": "向量检索先编码再近邻搜索"
        });
        let u: KnowledgeUnitInput =
            serde_json::from_value(json).expect("camelCase KnowledgeUnitInput");
        assert_eq!(u.evidence_document_id.as_deref(), Some("d1"));
        assert_eq!(u.evidence_start, Some(10));
        assert_eq!(u.evidence_end, Some(42));
        assert_eq!(
            u.evidence_quote.as_deref(),
            Some("向量检索先编码再近邻搜索")
        );

        // 无 evidence 的概念（老数据）也必须能反序列化。
        let bare = serde_json::json!({
            "id": "u2", "title": "切分", "kind": "concept", "tags": [], "createdAt": 6
        });
        let u2: KnowledgeUnitInput =
            serde_json::from_value(bare).expect("evidence 可整体缺省");
        assert!(u2.evidence_document_id.is_none());
        assert!(u2.evidence_quote.is_none());
    }

    #[test]
    fn knowledge_unit_out_serializes_evidence_to_camel_case() {
        let out = KnowledgeUnitOut {
            id: "u1".into(),
            title: "向量检索".into(),
            kind: "concept".into(),
            summary: None,
            source_document_id: Some("d1".into()),
            tags: vec!["NLP".into()],
            created_at: 5,
            evidence_document_id: Some("d1".into()),
            evidence_start: Some(10),
            evidence_end: Some(42),
            evidence_quote: Some("q".into()),
        };
        let v = serde_json::to_value(&out).expect("serialize KnowledgeUnitOut");
        for key in [
            "evidenceDocumentId",
            "evidenceStart",
            "evidenceEnd",
            "evidenceQuote",
        ] {
            assert!(v.get(key).is_some(), "缺少 camelCase 字段 {key}：{v}");
        }
        assert!(v.get("evidence_start").is_none(), "不应出现 snake_case：{v}");
    }

    #[test]
    fn document_input_accepts_camel_case_and_optional_fields() {
        // v5：documents 下沉后，字段名必须与 TS DocumentDto 的 camelCase 对齐。
        let json = serde_json::json!({
            "id": "d1", "title": "检索增强生成", "format": "pdf", "status": "ready",
            "importedAt": 42, "rawSizeBytes": 1024, "textPreview": "正文…",
            "goalIds": ["g1"], "analysis": { "chaptersAt": 7 },
            "overview": { "gist": "一句话" }
        });
        let d: DocumentInput = serde_json::from_value(json).expect("camelCase DocumentInput");
        assert_eq!(d.imported_at, 42);
        assert_eq!(d.raw_size_bytes, Some(1024));
        assert_eq!(d.goal_ids.as_deref(), Some(["g1".to_string()].as_slice()));
        assert_eq!(d.analysis.as_ref().and_then(|a| a.get("chaptersAt")).and_then(|v| v.as_i64()), Some(7));

        // 全可选字段缺省（老数据 / 刚导入未解析）也必须能反序列化。
        let bare = serde_json::json!({
            "id": "d2", "title": "t", "format": "txt", "status": "imported", "importedAt": 1
        });
        let d2: DocumentInput = serde_json::from_value(bare).expect("可选字段可整体缺省");
        assert!(d2.text_preview.is_none());
        assert!(d2.goal_ids.is_none());
        assert!(d2.analysis.is_none());
    }

    #[test]
    fn document_out_omits_absent_fields_instead_of_nulling_them() {
        // ⚠️ 这条锁的是「TS 侧 `path?: string` 的语义」：缺省字段必须**整个键不出现**。
        // 若序列化成 `"path": null`，前端会把 null 存进领域对象，下一次 round-trip
        // 的深比较就会因 `null !== undefined` 失败（且 typecheck 查不出来）。
        let out = DocumentOut {
            id: "d1".into(),
            title: "t".into(),
            format: "pdf".into(),
            status: "ready".into(),
            path: None,
            uri: None,
            source: None,
            imported_at: 42,
            raw_size_bytes: None,
            text_preview: None,
            goal_ids: None,
            analysis: None,
            overview: None,
        };
        let v = serde_json::to_value(&out).expect("serialize DocumentOut");
        assert_eq!(v.get("importedAt").and_then(|x| x.as_i64()), Some(42), "camelCase 缺失：{v}");
        for key in ["path", "uri", "source", "rawSizeBytes", "textPreview", "goalIds", "analysis", "overview"] {
            assert!(v.get(key).is_none(), "缺省字段不该出现（更不该是 null）：{key} / {v}");
        }
        assert!(v.get("imported_at").is_none(), "不应出现 snake_case：{v}");
    }

    #[test]
    fn chapter_dto_uses_ord_and_parses_json_columns() {
        // TS 侧字段名是 `order`，SQL 列名是 `ord`（避开保留字）——
        // 映射点只有 toChapterDto / fromChapterDto 两处，DTO 这一层不出现 `order`。
        let json = serde_json::json!({
            "id": "c1", "ord": 2, "title": "Reranking",
            "contentRefStart": 0, "contentRefEnd": 120,
            "status": "not-started", "createdAt": 7,
            "keyPoints": ["a"], "unitIds": ["u1"],
            "keyPointRefs": [{ "point": "a", "quote": "原文", "start": 3, "end": 9 }]
        });
        let c: ChapterInput = serde_json::from_value(json).expect("camelCase ChapterInput");
        assert_eq!(c.ord, 2);
        assert_eq!(c.key_point_refs.as_ref().map(|r| r.len()), Some(1));

        let row = ChapterRow {
            id: "c1".into(),
            document_id: "d1".into(),
            ord: 2,
            title: "Reranking".into(),
            content_ref_start: 0,
            content_ref_end: 120,
            status: "not-started".into(),
            created_at: 7,
            key_points: "[\"a\"]".into(),
            key_point_refs: None,
            unit_ids: "[]".into(),
        };
        let out = ChapterOut::from(row);
        assert_eq!(out.key_points, vec!["a".to_string()]);
        assert!(out.key_point_refs.is_none());
        let v = serde_json::to_value(&out).expect("serialize ChapterOut");
        assert!(v.get("documentId").is_some(), "缺少 camelCase documentId：{v}");
        assert!(v.get("keyPoints").is_some());
        assert!(v.get("keyPointRefs").is_none(), "缺省字段不该出现：{v}");
        assert!(v.get("ord").is_some());
    }

    #[test]
    fn json_cols_keep_none_as_sql_null_and_survive_bad_input() {
        // None 必须编成 SQL NULL —— 绝不能变成字符串 "null"。
        assert_eq!(json_col::<Vec<String>>(&None).unwrap(), None);
        assert_eq!(json_col(&Some(vec!["a".to_string()])).unwrap(), Some("[\"a\"]".to_string()));
        // 解码侧：NULL / 坏值 / 类型不符一律回落，不抛错。
        assert_eq!(from_json_col::<Vec<String>>(None), None);
        assert_eq!(from_json_col::<Vec<String>>(Some("not json".into())), None);
        assert_eq!(from_json_array::<String>("not json"), Vec::<String>::new());
        assert_eq!(from_json_array::<String>("[]"), Vec::<String>::new());
        assert_eq!(json_col_required(&Vec::<String>::new(), "[]"), "[]");
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
