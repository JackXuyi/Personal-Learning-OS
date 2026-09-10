//! db 命令面 —— RAG 存储层的 CRUD 与全文检索。
//!
//! 命令命名 `db_*`，参数 snake_case（Tauri 自动把前端 camelCase 映射过来）。
//! 全部返回 `Result<T, String>`：内部错误转成简短中文提示，详细原因留在
//! Rust 侧的 eprintln。
//!
//! 分工：本模块承担 Section / Chunk / KnowledgeUnit / KnowledgeRelation / 全文检索 /
//! 健康探针；**Embedding 命令已拆到 `embedding_commands.rs`** 并在下方 `pub use` 再导出，
//! 因此 `lib.rs` 的注册路径与前端 `invoke("db_*")` 调用点均保持不变。

use tauri::State;

use super::db_err;
use super::models::{
    ChunkInput, ChunkOut, ChunkRow, KnowledgeRelationInput, KnowledgeRelationRow,
    KnowledgeUnitInput, KnowledgeUnitOut, KnowledgeUnitRow, SectionInput, SectionRow,
};
use super::DbState;

// Embedding 命令再导出（保持 `db::commands::db_save_embeddings` 等旧路径可用）。
pub use super::embedding_commands::*;

// ========== Section ==========

#[tauri::command]
pub async fn db_list_sections(
    state: State<'_, DbState>,
    chapter_id: String,
) -> Result<Vec<SectionRow>, String> {
    sqlx::query_as::<_, SectionRow>(
        "SELECT * FROM sections WHERE chapter_id = ? ORDER BY idx ASC",
    )
    .bind(chapter_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|err| db_err("读取小节列表", err))
}

/// 批量写入（同 id 覆盖）。前端 saveSections 走这里，减少 IPC 往返。
#[tauri::command]
pub async fn db_save_sections(
    state: State<'_, DbState>,
    sections: Vec<SectionInput>,
) -> Result<(), String> {
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|err| db_err("开启事务", err))?;

    for s in sections {
        sqlx::query(
            "INSERT INTO sections
               (id, chapter_id, document_id, title, level, idx, content_ref_start, content_ref_end, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               chapter_id = excluded.chapter_id, document_id = excluded.document_id,
               title = excluded.title, level = excluded.level, idx = excluded.idx,
               content_ref_start = excluded.content_ref_start,
               content_ref_end = excluded.content_ref_end,
               created_at = excluded.created_at",
        )
        .bind(&s.id)
        .bind(&s.chapter_id)
        .bind(&s.document_id)
        .bind(&s.title)
        .bind(s.level)
        .bind(s.idx)
        .bind(s.content_ref_start)
        .bind(s.content_ref_end)
        .bind(s.created_at)
        .execute(&mut *tx)
        .await
        .map_err(|err| db_err("写入小节", err))?;
    }

    tx.commit().await.map_err(|err| db_err("提交事务", err))
}

#[tauri::command]
pub async fn db_delete_section(state: State<'_, DbState>, id: String) -> Result<(), String> {
    sqlx::query("DELETE FROM sections WHERE id = ?")
        .bind(id)
        .execute(&state.pool)
        .await
        .map_err(|err| db_err("删除小节", err))?;
    Ok(())
}

/// 单条读取（StorageAdapter.getSection；不存在返回 None）。
#[tauri::command]
pub async fn db_get_section(
    state: State<'_, DbState>,
    id: String,
) -> Result<Option<SectionRow>, String> {
    sqlx::query_as::<_, SectionRow>("SELECT * FROM sections WHERE id = ?")
        .bind(id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|err| db_err("读取小节", err))
}

/// 与 [start, end) 有交叠的小节（区间半开：起点含、终点不含）。
/// 用于从 Chapter 的正文切片快速定位其下 Sections。
#[tauri::command]
pub async fn db_sections_by_range(
    state: State<'_, DbState>,
    document_id: String,
    start: i64,
    end: i64,
) -> Result<Vec<SectionRow>, String> {
    sqlx::query_as::<_, SectionRow>(
        "SELECT * FROM sections
          WHERE document_id = ? AND content_ref_start < ? AND content_ref_end > ?
          ORDER BY idx ASC",
    )
    .bind(document_id)
    .bind(end)
    .bind(start)
    .fetch_all(&state.pool)
    .await
    .map_err(|err| db_err("按区间读取小节", err))
}

// ========== Chunk ==========

/// 通用 Chunk 查询：LEFT JOIN chunk_knowledge 后用 GROUP_CONCAT 聚合关联概念，
/// 避免 N+1。
const CHUNK_SELECT: &str = "SELECT c.id, c.document_id, c.chapter_id, c.section_id,
       c.content, c.position, c.token_count, c.metadata_heading, c.metadata_page,
       c.metadata_source_location, c.created_at,
       GROUP_CONCAT(ck.knowledge_id) AS knowledge_ids
     FROM chunks c
     LEFT JOIN chunk_knowledge ck ON ck.chunk_id = c.id";

#[tauri::command]
pub async fn db_list_chunks(
    state: State<'_, DbState>,
    chapter_id: String,
) -> Result<Vec<ChunkOut>, String> {
    let sql = format!("{CHUNK_SELECT} WHERE c.chapter_id = ? GROUP BY c.id ORDER BY c.position ASC");
    let rows = sqlx::query_as::<_, ChunkRow>(&sql)
        .bind(chapter_id)
        .fetch_all(&state.pool)
        .await
        .map_err(|err| db_err("读取块列表", err))?;
    Ok(rows.into_iter().map(ChunkOut::from).collect())
}

#[tauri::command]
pub async fn db_list_chunks_by_document(
    state: State<'_, DbState>,
    document_id: String,
) -> Result<Vec<ChunkOut>, String> {
    let sql =
        format!("{CHUNK_SELECT} WHERE c.document_id = ? GROUP BY c.id ORDER BY c.position ASC");
    let rows = sqlx::query_as::<_, ChunkRow>(&sql)
        .bind(document_id)
        .fetch_all(&state.pool)
        .await
        .map_err(|err| db_err("按资料读取块", err))?;
    Ok(rows.into_iter().map(ChunkOut::from).collect())
}

#[tauri::command]
pub async fn db_chunks_by_knowledge(
    state: State<'_, DbState>,
    knowledge_id: String,
) -> Result<Vec<ChunkOut>, String> {
    let sql = format!(
        "{CHUNK_SELECT}
         WHERE c.id IN (SELECT chunk_id FROM chunk_knowledge WHERE knowledge_id = ?)
         GROUP BY c.id ORDER BY c.position ASC"
    );
    let rows = sqlx::query_as::<_, ChunkRow>(&sql)
        .bind(knowledge_id)
        .fetch_all(&state.pool)
        .await
        .map_err(|err| db_err("按概念读取块", err))?;
    Ok(rows.into_iter().map(ChunkOut::from).collect())
}

/// 批量写入 Chunk + 关联概念（单事务）。
#[tauri::command]
pub async fn db_save_chunks(
    state: State<'_, DbState>,
    chunks: Vec<ChunkInput>,
) -> Result<(), String> {
    let mut tx = state.pool.begin().await.map_err(|err| db_err("开启事务", err))?;

    for c in chunks {
        sqlx::query(
            "INSERT INTO chunks
               (id, document_id, chapter_id, section_id, content, position, token_count,
                metadata_heading, metadata_page, metadata_source_location, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               section_id = excluded.section_id, content = excluded.content,
               position = excluded.position, token_count = excluded.token_count,
               metadata_heading = excluded.metadata_heading,
               metadata_page = excluded.metadata_page,
               metadata_source_location = excluded.metadata_source_location,
               created_at = excluded.created_at",
        )
        .bind(&c.id)
        .bind(&c.document_id)
        .bind(&c.chapter_id)
        .bind(&c.section_id)
        .bind(&c.content)
        .bind(c.position)
        .bind(c.token_count)
        .bind(&c.metadata_heading)
        .bind(c.metadata_page)
        .bind(&c.metadata_source_location)
        .bind(c.created_at)
        .execute(&mut *tx)
        .await
        .map_err(|err| db_err("写入块", err))?;

        // 关联关系整组重建：删旧再插新（概念抽取重跑时语义正确）。
        sqlx::query("DELETE FROM chunk_knowledge WHERE chunk_id = ?")
            .bind(&c.id)
            .execute(&mut *tx)
            .await
            .map_err(|err| db_err("清理块关联", err))?;

        for kid in c.knowledge_ids {
            sqlx::query("INSERT OR IGNORE INTO chunk_knowledge (chunk_id, knowledge_id) VALUES (?, ?)")
                .bind(&c.id)
                .bind(kid)
                .execute(&mut *tx)
                .await
                .map_err(|err| db_err("写入块关联", err))?;
        }

        // FTS 索引同步（不用触发器，见 schema.sql 说明）：先删旧行再插新行，
        // 保证 content 更新后索引不残留旧词项。
        sqlx::query("DELETE FROM chunks_fts WHERE id = ?")
            .bind(&c.id)
            .execute(&mut *tx)
            .await
            .map_err(|err| db_err("清理全文索引", err))?;
        sqlx::query(
            "INSERT INTO chunks_fts (content, id, chapter_id, document_id) VALUES (?, ?, ?, ?)",
        )
        .bind(&c.content)
        .bind(&c.id)
        .bind(&c.chapter_id)
        .bind(&c.document_id)
        .execute(&mut *tx)
        .await
        .map_err(|err| db_err("写入全文索引", err))?;
    }

    tx.commit().await.map_err(|err| db_err("提交事务", err))
}

#[tauri::command]
pub async fn db_delete_chunk(state: State<'_, DbState>, id: String) -> Result<(), String> {
    // chunk_knowledge 与 chunks_fts 需显式清理（无外键级联，见 schema.sql）。
    sqlx::query("DELETE FROM chunk_knowledge WHERE chunk_id = ?")
        .bind(&id)
        .execute(&state.pool)
        .await
        .map_err(|err| db_err("删除块关联", err))?;
    sqlx::query("DELETE FROM chunks_fts WHERE id = ?")
        .bind(&id)
        .execute(&state.pool)
        .await
        .map_err(|err| db_err("删除全文索引", err))?;
    sqlx::query("DELETE FROM chunks WHERE id = ?")
        .bind(&id)
        .execute(&state.pool)
        .await
        .map_err(|err| db_err("删除块", err))?;
    Ok(())
}

/// 按文档删除全部 Chunk（重切分 / 删除资料时用）。单事务清理三张表。
///
/// 顺序与 `db_delete_chunk` 一致（关联表 → FTS 索引 → 主表）：无外键级联，
/// 三处都必须显式清，否则会留下指不到 chunk 的孤儿关联与 FTS 残留行。
///
/// 注意：**不清理 embeddings** —— 向量按 target_id 记录，调用方需在删 chunk 之前
/// 先取出旧 chunk id 并逐个 `db_delete_embeddings_by_target`（否则清理失去依据）。
#[tauri::command]
pub async fn db_delete_chunks_by_document(
    state: State<'_, DbState>,
    document_id: String,
) -> Result<(), String> {
    let mut tx = state.pool.begin().await.map_err(|err| db_err("开启事务", err))?;

    sqlx::query(
        "DELETE FROM chunk_knowledge WHERE chunk_id IN \
         (SELECT id FROM chunks WHERE document_id = ?)",
    )
    .bind(&document_id)
    .execute(&mut *tx)
    .await
    .map_err(|err| db_err("删除块关联", err))?;

    sqlx::query(
        "DELETE FROM chunks_fts WHERE id IN (SELECT id FROM chunks WHERE document_id = ?)",
    )
    .bind(&document_id)
    .execute(&mut *tx)
    .await
    .map_err(|err| db_err("删除全文索引", err))?;

    sqlx::query("DELETE FROM chunks WHERE document_id = ?")
        .bind(&document_id)
        .execute(&mut *tx)
        .await
        .map_err(|err| db_err("删除块", err))?;

    tx.commit().await.map_err(|err| db_err("提交事务", err))
}

/// 单条读取（StorageAdapter.getChunk；不存在返回 None）。
#[tauri::command]
pub async fn db_get_chunk(
    state: State<'_, DbState>,
    id: String,
) -> Result<Option<ChunkOut>, String> {
    let sql = format!("{CHUNK_SELECT} WHERE c.id = ? GROUP BY c.id");
    let row = sqlx::query_as::<_, ChunkRow>(&sql)
        .bind(id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|err| db_err("读取块", err))?;
    Ok(row.map(ChunkOut::from))
}

/// FTS5 全文检索：命中 chunks_fts 后回表取完整 Chunk。
/// 未命中或 FTS 不可用时返回空数组（前端可降级到 localStorage 子串匹配）。
///
/// 查询路由（chunks_fts 用 trigram 分词器，约束查询 ≥ 3 字符）：
/// - 查询词 trim 后 ≥ 3 字符 → `f.content MATCH ?`（trigram 子串命中，中英文通用）；
/// - < 3 字符（含中文 1–2 字）→ 降级回表 `c.content LIKE '%q%'`，保证短查询仍出结果；
/// - 空查询 → 直接返回空，避免误匹配全库。
#[tauri::command]
pub async fn db_fts_search(
    state: State<'_, DbState>,
    query: String,
    document_id: Option<String>,
    chapter_id: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<ChunkOut>, String> {
    let limit = limit.unwrap_or(10).max(1);
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    // trigram 要求查询词 ≥ 3 字符；不足时走回表 LIKE（过滤列用 c，因 FTS 表对
    // 短查询无命中，且 document_id / chapter_id 在 chunks 表同样存在）。
    let use_like = trimmed.chars().count() < 3;
    let filter_col = if use_like { "c" } else { "f" };

    let mut sql = format!(
        "{CHUNK_SELECT}
         JOIN chunks_fts f ON f.id = c.id
         WHERE {}",
        if use_like {
            "c.content LIKE '%' || ? || '%'"
        } else {
            "f.content MATCH ?"
        }
    );
    if document_id.is_some() {
        sql.push_str(&format!(" AND {filter_col}.document_id = ?"));
    }
    if chapter_id.is_some() {
        sql.push_str(&format!(" AND {filter_col}.chapter_id = ?"));
    }
    sql.push_str(" GROUP BY c.id ORDER BY c.position ASC LIMIT ?");

    let mut q = sqlx::query_as::<_, ChunkRow>(&sql).bind(trimmed);
    if let Some(d) = document_id {
        q = q.bind(d);
    }
    if let Some(c) = chapter_id {
        q = q.bind(c);
    }
    q = q.bind(limit);

    let rows = q
        .fetch_all(&state.pool)
        .await
        .map_err(|err| db_err("全文检索", err))?;
    Ok(rows.into_iter().map(ChunkOut::from).collect())
}

// ========== KnowledgeUnit ==========

#[tauri::command]
pub async fn db_list_knowledge_units(
    state: State<'_, DbState>,
    document_id: Option<String>,
) -> Result<Vec<KnowledgeUnitOut>, String> {
    let rows = match document_id {
        Some(doc) => {
            sqlx::query_as::<_, KnowledgeUnitRow>(
                "SELECT * FROM knowledge_units WHERE source_document_id = ? ORDER BY created_at ASC",
            )
            .bind(doc)
            .fetch_all(&state.pool)
            .await
        }
        None => {
            sqlx::query_as::<_, KnowledgeUnitRow>(
                "SELECT * FROM knowledge_units ORDER BY created_at ASC",
            )
            .fetch_all(&state.pool)
            .await
        }
    }
    .map_err(|err| db_err("读取知识单元", err))?;
    Ok(rows.into_iter().map(KnowledgeUnitOut::from).collect())
}

#[tauri::command]
pub async fn db_save_knowledge_units(
    state: State<'_, DbState>,
    units: Vec<KnowledgeUnitInput>,
) -> Result<(), String> {
    let mut tx = state.pool.begin().await.map_err(|err| db_err("开启事务", err))?;

    for u in units {
        let tags = serde_json::to_string(&u.tags).unwrap_or_else(|_| "[]".to_string());
        sqlx::query(
            "INSERT INTO knowledge_units
               (id, title, kind, summary, source_document_id, tags, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               title = excluded.title, kind = excluded.kind, summary = excluded.summary,
               source_document_id = excluded.source_document_id, tags = excluded.tags,
               created_at = excluded.created_at",
        )
        .bind(&u.id)
        .bind(&u.title)
        .bind(&u.kind)
        .bind(&u.summary)
        .bind(&u.source_document_id)
        .bind(tags)
        .bind(u.created_at)
        .execute(&mut *tx)
        .await
        .map_err(|err| db_err("写入知识单元", err))?;
    }

    tx.commit().await.map_err(|err| db_err("提交事务", err))
}

#[tauri::command]
pub async fn db_delete_knowledge_unit(
    state: State<'_, DbState>,
    id: String,
) -> Result<(), String> {
    sqlx::query("DELETE FROM knowledge_units WHERE id = ?")
        .bind(id)
        .execute(&state.pool)
        .await
        .map_err(|err| db_err("删除知识单元", err))?;
    Ok(())
}

/// 单条读取（StorageAdapter.getKnowledgeUnit；不存在返回 None）。
#[tauri::command]
pub async fn db_get_knowledge_unit(
    state: State<'_, DbState>,
    id: String,
) -> Result<Option<KnowledgeUnitOut>, String> {
    let row = sqlx::query_as::<_, KnowledgeUnitRow>(
        "SELECT * FROM knowledge_units WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|err| db_err("读取知识单元", err))?;
    Ok(row.map(KnowledgeUnitOut::from))
}

// ========== KnowledgeRelation ==========

#[tauri::command]
pub async fn db_list_relations(
    state: State<'_, DbState>,
    unit_id: Option<String>,
) -> Result<Vec<KnowledgeRelationRow>, String> {
    let rows = match unit_id {
        Some(uid) => {
            sqlx::query_as::<_, KnowledgeRelationRow>(
                "SELECT * FROM knowledge_relations WHERE from_id = ? OR to_id = ? ORDER BY created_at ASC",
            )
            .bind(&uid)
            .bind(&uid)
            .fetch_all(&state.pool)
            .await
        }
        None => {
            sqlx::query_as::<_, KnowledgeRelationRow>(
                "SELECT * FROM knowledge_relations ORDER BY created_at ASC",
            )
            .fetch_all(&state.pool)
            .await
        }
    }
    .map_err(|err| db_err("读取知识关系", err))?;
    Ok(rows)
}

/// 目标单元的前置概念（rel_type = prerequisite 且指向该单元）。
#[tauri::command]
pub async fn db_prerequisites_of(
    state: State<'_, DbState>,
    unit_id: String,
) -> Result<Vec<KnowledgeUnitOut>, String> {
    let rows = sqlx::query_as::<_, KnowledgeUnitRow>(
        "SELECT u.* FROM knowledge_units u
           JOIN knowledge_relations r ON r.from_id = u.id
          WHERE r.to_id = ? AND r.rel_type = 'prerequisite'
          ORDER BY u.created_at ASC",
    )
    .bind(unit_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|err| db_err("读取前置概念", err))?;
    Ok(rows.into_iter().map(KnowledgeUnitOut::from).collect())
}

#[tauri::command]
pub async fn db_save_relations(
    state: State<'_, DbState>,
    relations: Vec<KnowledgeRelationInput>,
) -> Result<(), String> {
    let mut tx = state.pool.begin().await.map_err(|err| db_err("开启事务", err))?;

    for r in relations {
        sqlx::query(
            "INSERT INTO knowledge_relations (id, from_id, to_id, rel_type, strength, created_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               from_id = excluded.from_id, to_id = excluded.to_id,
               rel_type = excluded.rel_type, strength = excluded.strength,
               created_at = excluded.created_at",
        )
        .bind(&r.id)
        .bind(&r.from_id)
        .bind(&r.to_id)
        .bind(&r.rel_type)
        .bind(r.strength)
        .bind(r.created_at)
        .execute(&mut *tx)
        .await
        .map_err(|err| db_err("写入知识关系", err))?;
    }

    tx.commit().await.map_err(|err| db_err("提交事务", err))
}

#[tauri::command]
pub async fn db_delete_relation(state: State<'_, DbState>, id: String) -> Result<(), String> {
    sqlx::query("DELETE FROM knowledge_relations WHERE id = ?")
        .bind(id)
        .execute(&state.pool)
        .await
        .map_err(|err| db_err("删除知识关系", err))?;
    Ok(())
}

// ========== 健康探针 ==========

/// 统计某表行数（db_status 用；表名来自本模块常量，无外部输入）。
async fn count_rows(pool: &sqlx::SqlitePool, table: &str) -> Result<i64, sqlx::Error> {
    let sql = format!("SELECT COUNT(*) FROM {table}");
    sqlx::query_scalar::<_, i64>(&sql).fetch_one(pool).await
}

/// 供前端/排障确认 SQLite 是否就绪及各表行数。
#[tauri::command]
pub async fn db_status(state: State<'_, DbState>) -> Result<serde_json::Value, String> {
    let sections = count_rows(&state.pool, "sections")
        .await
        .map_err(|err| db_err("统计 sections", err))?;
    let chunks = count_rows(&state.pool, "chunks")
        .await
        .map_err(|err| db_err("统计 chunks", err))?;
    let units = count_rows(&state.pool, "knowledge_units")
        .await
        .map_err(|err| db_err("统计 knowledge_units", err))?;
    let relations = count_rows(&state.pool, "knowledge_relations")
        .await
        .map_err(|err| db_err("统计 knowledge_relations", err))?;
    let embeddings = count_rows(&state.pool, "embeddings")
        .await
        .map_err(|err| db_err("统计 embeddings", err))?;

    Ok(serde_json::json!({
        "ready": true,
        "counts": {
            "sections": sections,
            "chunks": chunks,
            "knowledgeUnits": units,
            "relations": relations,
            "embeddings": embeddings,
        },
    }))
}
