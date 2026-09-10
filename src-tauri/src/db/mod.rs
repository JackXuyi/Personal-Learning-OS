//! db 模块 —— Tauri 侧的 SQLite 存储后端（RAG 五层中的新增表）。
//!
//! 职责边界：
//! - 本模块只提供「桌面端可用的 SQLite 持久化」；浏览器预览继续走
//!   `src/storage/local.ts`（localStorage），由前端 `isTauri()` 守卫分流；
//! - documents / chapters 仍由 localStorage 持有（迁移期避免双写），
//!   本模块暂不建这两张表，详见 schema.sql 头部说明。
//!
//! 初始化：app_data_dir/plos.db，首次启动执行 schema.sql（幂等 DDL）。

pub mod commands;
pub mod models;

use std::fs;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::time::{SystemTime, UNIX_EPOCH};

use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
use tauri::{App, Manager};

/// 内嵌 DDL（编译期打包，运行时不依赖外部文件路径）。
const SCHEMA_SQL: &str = include_str!("./schema.sql");

/// 注入 Tauri 托管状态的连接池句柄。
pub struct DbState {
    pub pool: SqlitePool,
}

/// 解析数据库文件路径：`{app_data_dir}/plos.db`。
pub fn db_path(app: &App) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let dir = app.path().app_data_dir()?;
    fs::create_dir_all(&dir)?;
    Ok(dir.join("plos.db"))
}

/// 建池并执行幂等 DDL；失败时把错误冒泡给调用方（lib.rs 决定降级策略）。
pub async fn init_pool(path: &Path) -> Result<SqlitePool, Box<dyn std::error::Error>> {
    let url = format!("sqlite://{}", path.display());
    // create_if_missing：首次启动自动建库文件。
    let options = SqliteConnectOptions::from_str(&url)?.create_if_missing(true);

    let pool = SqlitePoolOptions::new()
        .max_connections(4)
        .connect_with(options)
        .await?;

    // 逐条执行 DDL。sqlx 的 execute 单次只接受一条语句，故按分号切分；
    // 用 raw_sql 亦可，但切分后单条失败能给出更明确的错误位置。
    apply_schema(&pool).await?;
    // 版本迁移（当前仅 v1 → v2：chunks_fts 改 trigram 分词器）。
    migrate(&pool).await?;

    Ok(pool)
}

/// 执行 schema.sql：先建连接跑一遍，忽略空片段与纯注释片段。
async fn apply_schema(pool: &SqlitePool) -> Result<(), Box<dyn std::error::Error>> {
    let mut conn = pool.acquire().await?;
    for stmt in split_statements(SCHEMA_SQL) {
        sqlx::query(&stmt).execute(&mut *conn).await?;
    }
    Ok(())
}

/// 版本迁移（幂等）。当前仅 v1 → v2：chunks_fts 切换 trigram 分词器。
///
/// 背景：v1 用默认 unicode61 分词器，连续中文被当成一个 token，中文子串检索
/// 失效（runbook 遗留问题 F1）。trigram 按 3 字符窗口建索引，中文子串天然可用，
/// 但存量库已建的旧 FTS 表不会被 `CREATE IF NOT EXISTS` 覆盖，必须显式 DROP 后
/// 由 schema.sql 的新定义重建，并从 chunks 全量重灌（数据不丢，仅重建索引）。
async fn migrate(pool: &SqlitePool) -> Result<(), Box<dyn std::error::Error>> {
    let mut conn = pool.acquire().await?;
    let cur: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(version), 0) FROM _schema_version")
        .fetch_one(&mut *conn)
        .await?;
    if cur >= 2 {
        return Ok(()); // 已是目标版本，跳过
    }
    // 删旧 FTS 表，让 schema.sql 的 CREATE IF NOT EXISTS 用 trigram 定义重建。
    sqlx::query("DROP TABLE IF EXISTS chunks_fts")
        .execute(&mut *conn)
        .await?;
    for stmt in split_statements(SCHEMA_SQL) {
        sqlx::query(&stmt).execute(&mut *conn).await?;
    }
    // 从 chunks 全量重灌 FTS 索引（数据不丢，仅重建索引）。
    sqlx::query(
        "INSERT INTO chunks_fts (content, id, chapter_id, document_id) \
         SELECT content, id, chapter_id, document_id FROM chunks",
    )
    .execute(&mut *conn)
    .await?;
    // 写版本 2（applied_at 用真实 epoch ms）。
    sqlx::query("INSERT INTO _schema_version (version, applied_at) VALUES (2, ?)")
        .bind(now_ms())
        .execute(&mut *conn)
        .await?;
    Ok(())
}

/// 当前 epoch ms（与 TS 侧 Date.now() 对齐，便于审计）。
fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// 按 `;` 切分 SQL 脚本，去掉空语句与整段注释（不处理字符串内分号——
/// 本仓库 schema 中不存在该情况）。
fn split_statements(sql: &str) -> Vec<String> {
    sql.split(';')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        // 去掉行注释后仍为空的片段（如纯注释块）。
        .filter(|s| s.lines().any(|l| !l.trim().is_empty() && !l.trim().starts_with("--")))
        .map(|s| s.to_string())
        .collect()
}

/// 在 app 上完成初始化并注入 DbState。
pub fn init_db(app: &App) -> Result<(), Box<dyn std::error::Error>> {
    let path = db_path(app)?;
    let pool = tauri::async_runtime::block_on(async { init_pool(&path).await })?;
    app.manage(DbState { pool });
    println!("sqlite ready at {}", path.display());
    Ok(())
}
