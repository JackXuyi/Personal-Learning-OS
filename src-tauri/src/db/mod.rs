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
pub mod embedding_commands;
pub mod models;

/// 统一错误转换：日志留详情，前端拿短提示。
///
/// 放在模块根（而非某个子模块）以便 commands / embedding_commands 共用，
/// 同时避免两个子模块互相引用形成环。
pub(crate) fn db_err(context: &str, err: impl std::fmt::Display) -> String {
    eprintln!("db error [{context}]: {err}");
    format!("数据库操作失败：{context}")
}

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
    // 版本迁移（v1 → v2：chunks_fts 改 trigram；v2 → v3：embeddings 加 vector）。
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

/// 版本迁移入口（幂等）。按版本号顺序执行，每一步自行判断是否需要跑。
///
/// 注意：两步的版本判定互相独立，因此 v1 存量库会连跑 v2 与 v3 一次到位。
/// 新库在 `apply_schema` 阶段就已带全部列，两步都会走「无需变更」分支。
async fn migrate(pool: &SqlitePool) -> Result<(), Box<dyn std::error::Error>> {
    let mut conn = pool.acquire().await?;
    migrate_v2(&mut conn).await?;
    migrate_v3(&mut conn).await?;
    Ok(())
}

/// v1 → v2：chunks_fts 切换 trigram 分词器。
///
/// 背景：v1 用默认 unicode61 分词器，连续中文被当成一个 token，中文子串检索
/// 失效（runbook 遗留问题 F1）。trigram 按 3 字符窗口建索引，中文子串天然可用，
/// 但存量库已建的旧 FTS 表不会被 `CREATE IF NOT EXISTS` 覆盖，必须显式 DROP 后
/// 由 schema.sql 的新定义重建，并从 chunks 全量重灌（数据不丢，仅重建索引）。
async fn migrate_v2(
    conn: &mut sqlx::SqliteConnection,
) -> Result<(), Box<dyn std::error::Error>> {
    let cur: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(version), 0) FROM _schema_version")
        .fetch_one(&mut *conn)
        .await?;
    if cur >= 2 {
        return Ok(()); // 已是目标版本（或更高），跳过
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

/// v2 → v3：`embeddings` 增加 `vector BLOB`（向量本体）。
///
/// 幂等做法：先 `PRAGMA table_info(embeddings)` 探列——新库在 `apply_schema` 阶段
/// 已带该列（CREATE 语句里就有），此步直接写版本号；只有 v2 及更早的存量库才会真正
/// 执行 ALTER。不用「先 ALTER 再捕获 duplicate column 错误」，因为那样无法区分
/// 「列已存在」与「表不存在」两类失败。
async fn migrate_v3(
    conn: &mut sqlx::SqliteConnection,
) -> Result<(), Box<dyn std::error::Error>> {
    let cur: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(version), 0) FROM _schema_version")
        .fetch_one(&mut *conn)
        .await?;
    if cur >= 3 {
        return Ok(()); // 已是目标版本，跳过
    }
    if !has_column(conn, "embeddings", "vector").await? {
        sqlx::query("ALTER TABLE embeddings ADD COLUMN vector BLOB")
            .execute(&mut *conn)
            .await?;
    }
    sqlx::query("INSERT INTO _schema_version (version, applied_at) VALUES (3, ?)")
        .bind(now_ms())
        .execute(&mut *conn)
        .await?;
    Ok(())
}

/// 探测表是否已有某列。
///
/// 用 SQLite 的表值函数 `pragma_table_info(?)` 而不是裸 `PRAGMA table_info`：
/// 前者可当普通表查询（能 bind 参数、能 WHERE、返回单列），后者只能拿整行再按列名取值。
async fn has_column(
    conn: &mut sqlx::SqliteConnection,
    table: &str,
    column: &str,
) -> Result<bool, Box<dyn std::error::Error>> {
    let n: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM pragma_table_info(?) WHERE name = ?")
            .bind(table)
            .bind(column)
            .fetch_one(&mut *conn)
            .await?;
    Ok(n > 0)
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
