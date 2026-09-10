//! Embedding 命令面 —— 向量化元数据与向量本体的 CRUD。
//!
//! 从 `commands.rs` 拆出（该文件已触及 700 行硬限），职责单一：只处理
//! `embeddings` 表。命令名与路径保持不变（`commands.rs` 用 `pub use` 再导出），
//! 故 `lib.rs` 的注册项与前端 `invoke("db_*")` 调用点都无需改动。
//!
//! 读写分工（见 src/domain/embedding.ts 注释）：
//! - `db_list_embeddings` = 元数据清单（判重 / 覆盖率），**不含向量**；
//! - `db_list_embedding_vectors` = 向量本体（检索用），BLOB → Vec<f32>。

use tauri::State;

use super::db_err;
use super::models::{blob_to_f32, f32_to_blob, EmbeddingInput, EmbeddingRow, EmbeddingVectorOut};
use super::DbState;

#[tauri::command]
pub async fn db_list_embeddings(
    state: State<'_, DbState>,
    target_type: Option<String>,
) -> Result<Vec<EmbeddingRow>, String> {
    let rows = match target_type {
        Some(t) => {
            sqlx::query_as::<_, EmbeddingRow>(
                "SELECT * FROM embeddings WHERE target_type = ? ORDER BY created_at ASC",
            )
            .bind(t)
            .fetch_all(&state.pool)
            .await
        }
        None => {
            sqlx::query_as::<_, EmbeddingRow>("SELECT * FROM embeddings ORDER BY created_at ASC")
                .fetch_all(&state.pool)
                .await
        }
    }
    .map_err(|err| db_err("读取向量元数据", err))?;
    Ok(rows)
}

#[tauri::command]
pub async fn db_save_embeddings(
    state: State<'_, DbState>,
    embeddings: Vec<EmbeddingInput>,
) -> Result<(), String> {
    let mut tx = state.pool.begin().await.map_err(|err| db_err("开启事务", err))?;

    for em in embeddings {
        // vector 为 None → 明确写 NULL（覆盖场景下清掉旧向量，避免「元数据已更新、
        // 向量还是上一版」的错配）。
        let blob = em.vector.as_deref().map(f32_to_blob);
        sqlx::query(
            "INSERT INTO embeddings
               (id, target_type, target_id, model, vector_dim, vector, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               vector_dim = excluded.vector_dim,
               vector = excluded.vector,
               created_at = excluded.created_at",
        )
        .bind(&em.id)
        .bind(&em.target_type)
        .bind(&em.target_id)
        .bind(&em.model)
        .bind(em.vector_dim)
        .bind(blob)
        .bind(em.created_at)
        .execute(&mut *tx)
        .await
        .map_err(|err| db_err("写入向量元数据", err))?;
    }

    tx.commit().await.map_err(|err| db_err("提交事务", err))
}

/// 取回向量本体（检索用）。
///
/// - `target_ids` 传值时按目标过滤（减少 IPC 传输量）；不传 = 该 target_type 全量；
/// - `vector IS NULL` 的行直接跳过（元数据在、向量未生成）；
/// - 动态 `IN` 只拼占位符，值一律走 bind（不拼字符串，避免注入）。
#[tauri::command]
pub async fn db_list_embedding_vectors(
    state: State<'_, DbState>,
    target_type: String,
    target_ids: Option<Vec<String>>,
) -> Result<Vec<EmbeddingVectorOut>, String> {
    let mut sql = String::from(
        "SELECT target_id, model, vector FROM embeddings \
         WHERE target_type = ? AND vector IS NOT NULL",
    );
    let ids: Vec<String> = target_ids.unwrap_or_default();
    if !ids.is_empty() {
        let placeholders = vec!["?"; ids.len()].join(",");
        sql.push_str(&format!(" AND target_id IN ({placeholders})"));
    }

    let mut q = sqlx::query(&sql).bind(&target_type);
    for id in &ids {
        q = q.bind(id);
    }

    let rows = q
        .fetch_all(&state.pool)
        .await
        .map_err(|err| db_err("读取向量", err))?;

    // 逐行手工解码：sqlx 的 FromRow 无法直接把 BLOB 映射成 Vec<f32>。
    use sqlx::Row;
    let out = rows
        .iter()
        .map(|row| {
            let blob: Option<Vec<u8>> = row.try_get("vector").unwrap_or(None);
            let vector = blob.as_deref().map(blob_to_f32).unwrap_or_default();
            EmbeddingVectorOut {
                target_id: row.try_get("target_id").unwrap_or_default(),
                model: row.try_get("model").unwrap_or_default(),
                dim: vector.len() as i64,
                vector,
            }
        })
        // 空向量（BLOB 长度 < 4）视为无效，直接剔除，避免污染余弦计算。
        .filter(|v| !v.vector.is_empty())
        .collect();

    Ok(out)
}

/// 按目标 id 删除向量（不区分 target_type）。
/// 重切分 / 删除资料前调用方须先取出旧 chunk id 再调用本命令（见 StorageAdapter 契约）。
#[tauri::command]
pub async fn db_delete_embeddings_by_target(
    state: State<'_, DbState>,
    target_id: String,
) -> Result<(), String> {
    sqlx::query("DELETE FROM embeddings WHERE target_id = ?")
        .bind(target_id)
        .execute(&state.pool)
        .await
        .map_err(|err| db_err("删除向量元数据", err))?;
    Ok(())
}

/// 单条读取（StorageAdapter.getEmbedding；不存在返回 None）。
#[tauri::command]
pub async fn db_get_embedding(
    state: State<'_, DbState>,
    id: String,
) -> Result<Option<EmbeddingRow>, String> {
    sqlx::query_as::<_, EmbeddingRow>("SELECT * FROM embeddings WHERE id = ?")
        .bind(id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|err| db_err("读取向量元数据", err))
}

#[tauri::command]
pub async fn db_delete_embedding(state: State<'_, DbState>, id: String) -> Result<(), String> {
    sqlx::query("DELETE FROM embeddings WHERE id = ?")
        .bind(id)
        .execute(&state.pool)
        .await
        .map_err(|err| db_err("删除向量元数据", err))?;
    Ok(())
}
