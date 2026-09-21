//! db 命令面 —— RAG 存储层的 CRUD 与全文检索。
//!
//! 命令命名 `db_*`，参数 snake_case（Tauri 自动把前端 camelCase 映射过来）。
//! 全部返回 `Result<T, String>`：内部错误转成简短中文提示，详细原因留在
//! Rust 侧的 eprintln。
//!
//! 分工：本模块承担 SourceDocument / Chapter（v5 下沉 · D12）、
//! Section / Chunk / KnowledgeUnit / KnowledgeRelation / 全文检索 / 健康探针；
//! **Embedding 命令已拆到 `embedding_commands.rs`** 并在下方 `pub use` 再导出，
//! 因此 `lib.rs` 的注册路径与前端 `invoke("db_*")` 调用点均保持不变。
//!
//! 实现风格：命令体一律是「取出 `State` → 调 `*_impl(&pool, …)`」两行。
//! 抽出 `*_impl` 的理由与 `clear_library` 当初相同 —— 命令签名带 `State`
//! 在单测里造不出来，而这几条恰好是**最需要单测**的（diff-delete / 空数组 /
//! 事务次序）。

use tauri::State;

use super::db_err;
use super::models::{
    from_json_array, json_col, json_col_required, ChapterInput, ChapterOut, ChapterRow, ChunkInput,
    ChunkOut, ChunkRow, DocumentInput, DocumentOut, DocumentRow, KnowledgeRelationInput,
    KnowledgeRelationRow, KnowledgeUnitInput, KnowledgeUnitOut, KnowledgeUnitRow, SectionInput,
    SectionRow,
};
use super::DbState;

// Embedding 命令再导出（保持 `db::commands::db_save_embeddings` 等旧路径可用）。
pub use super::embedding_commands::*;

// ========== SourceDocument（v5 下沉 · D12）==========

/// 全部资料。排序 `imported_at ASC, id ASC`：`Map` 无序，镜像重建必须有**确定性**
/// 顺序，否则「同一份库读两次顺序不同」会让依赖顺序的逻辑（如知识包 round-trip
/// 深比较）无谓地飘。同刻导入用 id 兜底 → 全序。
pub(crate) async fn list_documents_impl(pool: &sqlx::SqlitePool) -> Result<Vec<DocumentOut>, String> {
    let rows = sqlx::query_as::<_, DocumentRow>(
        "SELECT * FROM documents ORDER BY imported_at ASC, id ASC",
    )
    .fetch_all(pool)
    .await
    .map_err(|err| db_err("读取资料列表", err))?;
    Ok(rows.into_iter().map(DocumentOut::from).collect())
}

/// 全部章节（一次性载入镜像用）。排序 `document_id ASC, ord ASC` —— 组内已有序，
/// TS 侧 `groupChaptersByDocument` 只做分组、**不再排序**（排序口径只留一处）。
pub(crate) async fn list_chapters_all_impl(
    pool: &sqlx::SqlitePool,
) -> Result<Vec<ChapterOut>, String> {
    let rows = sqlx::query_as::<_, ChapterRow>(
        "SELECT * FROM chapters ORDER BY document_id ASC, ord ASC",
    )
    .fetch_all(pool)
    .await
    .map_err(|err| db_err("读取章节列表", err))?;
    Ok(rows.into_iter().map(ChapterOut::from).collect())
}

#[tauri::command]
pub async fn db_list_documents(state: State<'_, DbState>) -> Result<Vec<DocumentOut>, String> {
    list_documents_impl(&state.pool).await
}

#[tauri::command]
pub async fn db_list_chapters_all(state: State<'_, DbState>) -> Result<Vec<ChapterOut>, String> {
    list_chapters_all_impl(&state.pool).await
}

/// 批量 upsert 资料（单事务）。
pub(crate) async fn save_documents_impl(
    pool: &sqlx::SqlitePool,
    documents: &[DocumentInput],
) -> Result<(), String> {
    let mut tx = pool.begin().await.map_err(|err| db_err("开启事务", err))?;
    for d in documents {
        let goal_ids = json_col(&d.goal_ids)?;
        let analysis = json_col(&d.analysis)?;
        let overview = json_col(&d.overview)?;
        sqlx::query(
            "INSERT INTO documents
               (id, title, format, status, path, uri, source, imported_at,
                raw_size_bytes, text_preview, goal_ids, analysis, overview)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               title = excluded.title, format = excluded.format, status = excluded.status,
               path = excluded.path, uri = excluded.uri, source = excluded.source,
               imported_at = excluded.imported_at,
               raw_size_bytes = excluded.raw_size_bytes,
               text_preview = excluded.text_preview, goal_ids = excluded.goal_ids,
               analysis = excluded.analysis, overview = excluded.overview",
        )
        .bind(&d.id)
        .bind(&d.title)
        .bind(&d.format)
        .bind(&d.status)
        .bind(&d.path)
        .bind(&d.uri)
        .bind(&d.source)
        .bind(d.imported_at)
        .bind(d.raw_size_bytes)
        .bind(&d.text_preview)
        .bind(goal_ids)
        .bind(analysis)
        .bind(overview)
        .execute(&mut *tx)
        .await
        .map_err(|err| db_err("写入资料", err))?;
    }
    tx.commit().await.map_err(|err| db_err("提交事务", err))
}

#[tauri::command]
pub async fn db_save_documents(
    state: State<'_, DbState>,
    documents: Vec<DocumentInput>,
) -> Result<(), String> {
    save_documents_impl(&state.pool, &documents).await
}

/// 删除一份资料 —— 单事务内先删其章节、再删资料本体。
///
/// 先子后父只为日志可读（无外键约束，schema.sql 已说明）；但**必须同事务**：
/// 分开会留下「资料没了、章节还在」的孤儿行，而章节是按 `document_id` 载入
/// 镜像的 → 下次启动会凭空多出一批挂在不存在的资料下的章。
pub(crate) async fn delete_document_impl(
    pool: &sqlx::SqlitePool,
    id: &str,
) -> Result<(), String> {
    let mut tx = pool.begin().await.map_err(|err| db_err("开启事务", err))?;
    sqlx::query("DELETE FROM chapters WHERE document_id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(|err| db_err("删除资料的章节", err))?;
    sqlx::query("DELETE FROM documents WHERE id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(|err| db_err("删除资料", err))?;
    tx.commit().await.map_err(|err| db_err("提交事务", err))
}

#[tauri::command]
pub async fn db_delete_document(state: State<'_, DbState>, id: String) -> Result<(), String> {
    delete_document_impl(&state.pool, &id).await
}

// ========== Chapter（v5 下沉 · D12）==========

/// 写入某资料的章节集 —— 语义是 **整批替换**（upsert + diff-delete）。
///
/// ⚠️ 两个细节都是**会静默出错**的地方，改动前请先读这两条：
///
/// ① **空数组必须特判**：SQLite 的 `NOT IN ()` 是**语法错误**。不特判，
///    「删掉某资料的最后一章」会直接 500 —— 而这恰恰是章节编辑（F7-a）
///    的正常操作，不是边界。
/// ② **diff-delete 是必需的，不是优化**：`saveChapters` 的语义是「整批替换
///    该资料的章节集」（与内存侧 `rememberChapters` 严格同构）。只 upsert 会把
///    被删 / 被合并掉的章节**永远留在表里**，于是每次载入镜像都会把它们复活。
pub(crate) async fn save_chapters_impl(
    pool: &sqlx::SqlitePool,
    document_id: &str,
    chapters: &[ChapterInput],
) -> Result<(), String> {
    let mut tx = pool.begin().await.map_err(|err| db_err("开启事务", err))?;

    for c in chapters {
        let key_points = json_col_required(&c.key_points, "[]");
        let unit_ids = json_col_required(&c.unit_ids, "[]");
        let key_point_refs = json_col(&c.key_point_refs)?;
        sqlx::query(
            "INSERT INTO chapters
               (id, document_id, ord, title, content_ref_start, content_ref_end, status,
                created_at, key_points, key_point_refs, unit_ids)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               document_id = excluded.document_id, ord = excluded.ord,
               title = excluded.title,
               content_ref_start = excluded.content_ref_start,
               content_ref_end = excluded.content_ref_end, status = excluded.status,
               created_at = excluded.created_at, key_points = excluded.key_points,
               key_point_refs = excluded.key_point_refs, unit_ids = excluded.unit_ids",
        )
        .bind(&c.id)
        .bind(document_id)
        .bind(c.ord)
        .bind(&c.title)
        .bind(c.content_ref_start)
        .bind(c.content_ref_end)
        .bind(&c.status)
        .bind(c.created_at)
        .bind(key_points)
        .bind(key_point_refs)
        .bind(unit_ids)
        .execute(&mut *tx)
        .await
        .map_err(|err| db_err("写入章节", err))?;
    }

    if chapters.is_empty() {
        // ① 空数组特判（见函数注释）。
        sqlx::query("DELETE FROM chapters WHERE document_id = ?")
            .bind(document_id)
            .execute(&mut *tx)
            .await
            .map_err(|err| db_err("清空章节目录", err))?;
    } else {
        // ② diff-delete（见函数注释）。占位符逐条 bind，不拼字符串。
        let placeholders = vec!["?"; chapters.len()].join(",");
        let sql =
            format!("DELETE FROM chapters WHERE document_id = ? AND id NOT IN ({placeholders})");
        let mut q = sqlx::query(&sql).bind(document_id);
        for c in chapters {
            q = q.bind(&c.id);
        }
        q.execute(&mut *tx)
            .await
            .map_err(|err| db_err("清理陈旧章节", err))?;
    }

    tx.commit().await.map_err(|err| db_err("提交事务", err))
}

#[tauri::command]
pub async fn db_save_chapters(
    state: State<'_, DbState>,
    document_id: String,
    chapters: Vec<ChapterInput>,
) -> Result<(), String> {
    save_chapters_impl(&state.pool, &document_id, &chapters).await
}

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
               (id, title, kind, summary, source_document_id, tags, created_at,
                evidence_document_id, evidence_start, evidence_end, evidence_quote)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               title = excluded.title, kind = excluded.kind, summary = excluded.summary,
               source_document_id = excluded.source_document_id, tags = excluded.tags,
               created_at = excluded.created_at,
               evidence_document_id = excluded.evidence_document_id,
               evidence_start = excluded.evidence_start,
               evidence_end = excluded.evidence_end,
               evidence_quote = excluded.evidence_quote",
        )
        .bind(&u.id)
        .bind(&u.title)
        .bind(&u.kind)
        .bind(&u.summary)
        .bind(&u.source_document_id)
        .bind(tags)
        .bind(u.created_at)
        .bind(&u.evidence_document_id)
        .bind(u.evidence_start)
        .bind(u.evidence_end)
        .bind(&u.evidence_quote)
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
///
/// v5 起 `documents` / `chapters` 也在计数里 —— 设置页排障区据此确认
/// 「文档真的进去了」（下沉之后，这一条是「新后端在干活」的最直接证据）。
#[tauri::command]
pub async fn db_status(state: State<'_, DbState>) -> Result<serde_json::Value, String> {
    let documents = count_rows(&state.pool, "documents")
        .await
        .map_err(|err| db_err("统计 documents", err))?;
    let chapters = count_rows(&state.pool, "chapters")
        .await
        .map_err(|err| db_err("统计 chapters", err))?;
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
            "documents": documents,
            "chapters": chapters,
            "sections": sections,
            "chunks": chunks,
            "knowledgeUnits": units,
            "relations": relations,
            "embeddings": embeddings,
        },
    }))
}

// ========== 整库清空（replace 导入）==========

/// 清空**九表**的实现（抽出来便于单测：命令签名带 `State` 没法直接调）。
///
/// v5 起从七表扩到九表（新增 `chapters` → `documents`，**先子后父**只为日志可读，
/// 无外键约束）。⚠️ 这**不是**「顺手多清两张」，而是必需：分两条命令清会让
/// 「documents 清了、chunks 没清」的半清态成为可能 —— 而 v5 之后 documents 与
/// chunks 是**同一个用户资产**的两半（一份资料 + 它的块），清一半比不清更糟。
///
/// ⚠️ `chunks_fts` 是 FTS5 虚拟表：用 `DELETE` 而不是 `DROP`（DROP 会连表结构
/// 一起没，下次查询直接报 no such table）。
/// ⚠️ `chunk_knowledge` 无外键约束 → 必须显式清，否则残留指向已删 chunk 的关联行。
/// ⚠️ `_schema_version` **不清**：它是库自身的结构版本，不是用户数据。
pub(crate) async fn clear_library(pool: &sqlx::SqlitePool) -> Result<(), String> {
    let mut tx = pool.begin().await.map_err(|err| db_err("开启事务", err))?;
    for stmt in [
        "DELETE FROM chunks_fts",
        "DELETE FROM chunk_knowledge",
        "DELETE FROM chunks",
        "DELETE FROM sections",
        "DELETE FROM knowledge_relations",
        "DELETE FROM knowledge_units",
        "DELETE FROM embeddings",
        "DELETE FROM chapters",
        "DELETE FROM documents",
    ] {
        sqlx::query(stmt)
            .execute(&mut *tx)
            .await
            .map_err(|err| db_err("清空存储表", err))?;
    }
    tx.commit().await.map_err(|err| db_err("提交清空事务", err))
}

/// 清空**九表**（replace 导入用）。事务保证「要么全清、要么不动」。
///
/// 前端 `TauriStorage.clearAll()` 依赖它：**失败必须抛错**（不要静默回退），
/// 否则 localStorage 清了、SQLite 没清 → FTS 仍能检索到用户以为已删除的段落。
///
/// ⚠️ 旧名 `db_clear_rag` 已废弃（v5 改名，D15）—— 名字里的 `rag` 在文档 / 章节
/// 下沉后就不再准确了，且「清 RAG 7 表」的语义会让调用方以为文档不必清。
#[tauri::command]
pub async fn db_clear_library(state: State<'_, DbState>) -> Result<(), String> {
    clear_library(&state.pool).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_pool;
    use sqlx::SqlitePool;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_db_path(tag: &str) -> PathBuf {
        let ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        std::env::temp_dir().join(format!("plos-db-{tag}-{ms}.db"))
    }

    /// 建一个临时库并返回 (pool, path)；调用方负责 `close` + 删文件。
    async fn temp_pool(tag: &str) -> (SqlitePool, PathBuf) {
        let path = temp_db_path(tag);
        let pool = init_pool(&path).await.unwrap();
        (pool, path)
    }

    async fn cleanup(pool: SqlitePool, path: PathBuf) {
        pool.close().await;
        let _ = std::fs::remove_file(&path);
    }

    fn document_input(id: &str, title: &str) -> DocumentInput {
        DocumentInput {
            id: id.into(),
            title: title.into(),
            format: "pdf".into(),
            status: "ready".into(),
            path: Some("/tmp/book.pdf".into()),
            uri: None,
            source: Some("同事分享".into()),
            imported_at: 1_800_000_000_000,
            raw_size_bytes: Some(4096),
            text_preview: Some("第一章 检索增强生成\n向量召回…".into()),
            goal_ids: Some(vec!["g1".into()]),
            analysis: Some(serde_json::json!({ "chaptersAt": 7, "model": "qwen" })),
            overview: Some(serde_json::json!({ "gist": "一句话定位", "sourceChars": 18 })),
        }
    }

    fn chapter_input(id: &str, ord: i64, title: &str) -> ChapterInput {
        ChapterInput {
            id: id.into(),
            ord,
            title: title.into(),
            content_ref_start: 0,
            content_ref_end: 18,
            status: "not-started".into(),
            created_at: 1,
            key_points: vec!["要点一".into()],
            key_point_refs: Some(vec![crate::db::models::KeyPointRefDto {
                point: "要点一".into(),
                quote: "检索增强生成".into(),
                start: 0,
                end: 6,
            }]),
            unit_ids: vec![],
        }
    }

    /// TC-RUST-04：documents 往返 —— 三个 JSON 列 + 中文正文逐字段相等；
    /// 可空列缺省读回仍是 `None`（**不是** JSON `null` 字符串）。
    #[tokio::test]
    async fn documents_roundtrip_including_json_columns() {
        let (pool, path) = temp_pool("doc-roundtrip").await;

        save_documents_impl(&pool, &[document_input("d1", "检索增强生成")])
            .await
            .unwrap();
        let out = list_documents_impl(&pool).await.unwrap();
        assert_eq!(out.len(), 1);
        let d = &out[0];
        assert_eq!(d.title, "检索增强生成");
        assert_eq!(d.imported_at, 1_800_000_000_000);
        assert_eq!(d.raw_size_bytes, Some(4096));
        assert_eq!(
            d.text_preview.as_deref(),
            Some("第一章 检索增强生成\n向量召回…"),
            "中文正文必须原样往返（含换行）"
        );
        assert_eq!(d.goal_ids.as_deref(), Some(["g1".to_string()].as_slice()));
        assert_eq!(
            d.analysis.as_ref().and_then(|a| a.get("chaptersAt")).and_then(|v| v.as_i64()),
            Some(7)
        );
        assert_eq!(
            d.overview.as_ref().and_then(|o| o.get("gist")).and_then(|v| v.as_str()),
            Some("一句话定位")
        );

        // 全部可空列缺省 → 读回 None（不是 Some(Value::Null)）。
        let bare = DocumentInput {
            id: "d2".into(),
            title: "无正文".into(),
            format: "note".into(),
            status: "imported".into(),
            path: None,
            uri: None,
            source: None,
            imported_at: 2,
            raw_size_bytes: None,
            text_preview: None,
            goal_ids: None,
            analysis: None,
            overview: None,
        };
        save_documents_impl(&pool, &[bare]).await.unwrap();
        let out = list_documents_impl(&pool).await.unwrap();
        let d2 = out.iter().find(|d| d.id == "d2").unwrap();
        assert!(d2.text_preview.is_none(), "缺省正文必须是 None");
        assert!(d2.goal_ids.is_none(), "缺省 goal_ids 必须是 None（不是空数组）");
        assert!(d2.analysis.is_none(), "缺省 analysis 必须是 None（不是 JSON null 字符串）");

        // 顺序确定性：imported_at 升序（d2 的 imported_at = 2 排在前）。
        assert_eq!(out[0].id, "d2");

        // upsert 语义：同 id 再写一次是覆盖而不是翻倍。
        save_documents_impl(&pool, &[document_input("d1", "改了标题")])
            .await
            .unwrap();
        let out = list_documents_impl(&pool).await.unwrap();
        assert_eq!(out.len(), 2, "同 id 覆盖，不新增行");
        assert_eq!(out.iter().find(|d| d.id == "d1").unwrap().title, "改了标题");

        cleanup(pool, path).await;
    }

    /// TC-RUST-05：`db_save_chapters` 的 **diff-delete** —— 语义是「整批替换」，
    /// 只 upsert 会把被删 / 被合并掉的章节永远留在表里（下次载入镜像就复活）。
    #[tokio::test]
    async fn save_chapters_replaces_the_whole_set() {
        let (pool, path) = temp_pool("chapters-diff").await;

        save_chapters_impl(
            &pool,
            "d1",
            &[
                chapter_input("c1", 1, "第一章"),
                chapter_input("c2", 2, "第二章"),
                chapter_input("c3", 3, "第三章"),
            ],
        )
        .await
        .unwrap();
        assert_eq!(list_chapters_all_impl(&pool).await.unwrap().len(), 3);

        // 再写 2 章（c1 改名、c4 新增）→ c2 / c3 必须被删掉。
        save_chapters_impl(
            &pool,
            "d1",
            &[chapter_input("c1", 1, "第一章（改）"), chapter_input("c4", 4, "新章")],
        )
        .await
        .unwrap();
        let rows = list_chapters_all_impl(&pool).await.unwrap();
        assert_eq!(rows.len(), 2, "陈旧章节必须被 diff-delete 清掉：{rows:?}");
        assert!(rows.iter().all(|c| c.id != "c2" && c.id != "c3"), "c2/c3 未被删除");
        assert_eq!(rows.iter().find(|c| c.id == "c1").unwrap().title, "第一章（改）");

        // 另一份资料的章节**不受影响**（diff-delete 的 where 带 document_id）。
        save_chapters_impl(&pool, "d2", &[chapter_input("c9", 1, "别人的章")])
            .await
            .unwrap();
        save_chapters_impl(&pool, "d1", &[chapter_input("c1", 1, "第一章")])
            .await
            .unwrap();
        let rows = list_chapters_all_impl(&pool).await.unwrap();
        assert!(rows.iter().any(|c| c.id == "c9"), "d2 的章被误删（where 少带 document_id）");

        // JSON 列往返。
        let c1 = rows.iter().find(|c| c.id == "c1").unwrap();
        assert_eq!(c1.key_points, vec!["要点一".to_string()]);
        assert_eq!(c1.key_point_refs.as_ref().map(|r| r.len()), Some(1));
        assert_eq!(c1.ord, 1);

        cleanup(pool, path).await;
    }

    /// TC-RUST-06：空数组特判 —— SQLite 的 `NOT IN ()` 是**语法错误**，
    /// 不特判则「删掉某资料的最后一章」直接报错（而这只是常规操作）。
    #[tokio::test]
    async fn save_chapters_handles_empty_array_without_sql_syntax_error() {
        let (pool, path) = temp_pool("chapters-empty").await;

        save_chapters_impl(&pool, "d1", &[chapter_input("c1", 1, "独苗")])
            .await
            .unwrap();
        assert_eq!(list_chapters_all_impl(&pool).await.unwrap().len(), 1);

        // 传空数组 → 该资料章节清空，且**不报错**。
        let r = save_chapters_impl(&pool, "d1", &[]).await;
        assert!(r.is_ok(), "空数组必须特判，不能撞 NOT IN () 语法错误：{r:?}");
        assert_eq!(list_chapters_all_impl(&pool).await.unwrap().len(), 0);

        // 空库上再来一次（幂等）。
        assert!(save_chapters_impl(&pool, "d1", &[]).await.is_ok());

        cleanup(pool, path).await;
    }

    /// TC-RUST-07：每张表插一行（含 FTS 与关联表），清空后必须全空且
    /// `_schema_version` 仍在。v5：从七表扩到**九表**。
    #[tokio::test]
    async fn clear_library_empties_nine_tables_and_keeps_schema_version() {
        let (pool, path) = temp_pool("clear-nine").await;

        sqlx::query(
            "INSERT INTO documents (id, title, format, status, imported_at) \
             VALUES ('d1','t','pdf','ready',1)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO chapters (id, document_id, ord, title, content_ref_start, \
             content_ref_end, status, created_at, key_points, unit_ids) \
             VALUES ('c1','d1',1,'t',0,10,'not-started',1,'[]','[]')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO sections (id, chapter_id, document_id, title, level, idx, \
             content_ref_start, content_ref_end, created_at) VALUES ('s1','c1','d1','t',1,0,0,10,1)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO chunks (id, document_id, chapter_id, content, position, created_at) \
             VALUES ('k1','d1','c1','hello',0,1)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO chunks_fts (content, id, chapter_id, document_id) VALUES ('hello','k1','c1','d1')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO chunk_knowledge (chunk_id, knowledge_id) VALUES ('k1','u1')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO knowledge_units (id, title, kind, tags, created_at) \
             VALUES ('u1','t','concept','[]',1)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO knowledge_relations (id, from_id, to_id, rel_type, created_at) \
             VALUES ('r1','u1','u2','related',1)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO embeddings (id, target_type, target_id, model, vector_dim, created_at) \
             VALUES ('e1','chunk','k1','m',4,1)",
        )
        .execute(&pool)
        .await
        .unwrap();

        clear_library(&pool).await.unwrap();

        for table in [
            "documents",
            "chapters",
            "sections",
            "chunks",
            "chunks_fts",
            "chunk_knowledge",
            "knowledge_units",
            "knowledge_relations",
            "embeddings",
        ] {
            let n: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table}"))
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(n, 0, "{table} 未被清空");
        }

        // 结构版本是库自身状态，不属于用户数据 —— 清空后必须仍在。
        let versions: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM _schema_version")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert!(versions >= 1, "_schema_version 不该被清空");

        cleanup(pool, path).await;
    }

    /// 幂等：空库再清一次不报错（replace 导入可能撞上「本来就是空库」）。
    #[tokio::test]
    async fn clear_library_is_idempotent() {
        let (pool, path) = temp_pool("clear-idempotent").await;
        clear_library(&pool).await.unwrap();
        clear_library(&pool).await.unwrap();
        cleanup(pool, path).await;
    }

    /// TC-RUST-08：`migrate_v5` 幂等 —— 连续 `init_pool` 两次，版本号最大值为 5、
    /// `applied_at` **不被重写**（第二次走 `cur >= 5` 提前返回），两张新表存在。
    #[tokio::test]
    async fn migrate_v5_is_idempotent_and_keeps_applied_at() {
        let path = temp_db_path("migrate-v5");

        let pool = init_pool(&path).await.unwrap();
        let (v, at1): (i64, i64) =
            sqlx::query_as("SELECT version, applied_at FROM _schema_version ORDER BY version DESC LIMIT 1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(v, 5, "v5 迁移未落版本号");

        // 两张新表存在且为空（本步骤只建表，不搬数据 —— 搬迁源在宿主 localStorage）。
        for table in ["documents", "chapters"] {
            let n: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table}"))
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(n, 0, "{table} 应为空表");
        }
        pool.close().await;

        // 第二次启动：同一个库再跑一遍 init_pool（apply_schema + migrate）。
        let pool2 = init_pool(&path).await.unwrap();
        let rows: Vec<(i64, i64)> =
            sqlx::query_as("SELECT version, applied_at FROM _schema_version ORDER BY version ASC")
                .fetch_all(&pool2)
                .await
                .unwrap();
        assert_eq!(rows.len(), 5, "版本行不该因重复启动而增加：{rows:?}");
        let (v2, at2) = *rows.last().unwrap();
        assert_eq!(v2, 5);
        assert_eq!(at2, at1, "applied_at 被重写了（迁移未提前返回）");

        cleanup(pool2, path).await;
    }

    /// `db_delete_document` 在单事务内同时删资料与它的章节 —— 分开会留下
    /// 「资料没了、章节还在」的孤儿行，下次载入镜像时凭空多出一批章。
    #[tokio::test]
    async fn delete_document_also_removes_its_chapters() {
        let (pool, path) = temp_pool("delete-doc").await;

        save_documents_impl(&pool, &[document_input("d1", "A"), document_input("d2", "B")])
            .await
            .unwrap();
        save_chapters_impl(&pool, "d1", &[chapter_input("c1", 1, "一章")])
            .await
            .unwrap();
        save_chapters_impl(&pool, "d2", &[chapter_input("c2", 1, "别的章")])
            .await
            .unwrap();

        delete_document_impl(&pool, "d1").await.unwrap();

        let docs = list_documents_impl(&pool).await.unwrap();
        assert_eq!(docs.len(), 1);
        assert_eq!(docs[0].id, "d2");
        let chapters = list_chapters_all_impl(&pool).await.unwrap();
        assert_eq!(chapters.len(), 1, "d1 的章节未被级联删除：{chapters:?}");
        assert_eq!(chapters[0].id, "c2");

        // 幂等：删不存在的 id 不报错。
        assert!(delete_document_impl(&pool, "nope").await.is_ok());

        cleanup(pool, path).await;
    }
}
