//! logging —— 自研轻量文件日志（零依赖，docs/tauri-log-config-design-2026-09.md）。
//!
//! 设计约束：
//! - **零依赖**：不引 log/tracing 插件，时间戳用 civil-date 算法自算（UTC）；
//! - **绝不伤害主流程**：任何 IO 失败静默降级记入 `last_error`，绝不 panic；
//! - **配置真源在 Rust**：持久化 `<app_data>/logging/config.json`，前端只经命令读写；
//! - **按天文件即轮转**：`<dir>/plos-YYYY-MM-DD.log`，跨天首次写入顺带清理 >7 天旧文件；
//! - **双端同写**：Rust 内部日志走 `log_line`（终端 + 文件），前端 `[ai:*]` 日志经
//!   `log_write` 命令转发只进文件（终端侧已有 console）。
//!
//! 纯函数（解析/过滤/文件名/清理/行格式）与全局 IO 分离，可脱离 Tauri 单测。

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

/// 单条日志最大字节数（防御前端/异常调用灌爆磁盘）。
const MAX_MESSAGE_BYTES: usize = 8 * 1024;
/// 日志文件保留天数（按文件名日期，跨天首次写入时清理）。
const KEEP_DAYS: i64 = 7;

/* ------------------------------------------------------------------ */
/* 级别                                                                */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Debug = 0,
    Info = 1,
    Warn = 2,
    Error = 3,
}

impl LogLevel {
    pub fn as_str(self) -> &'static str {
        match self {
            LogLevel::Debug => "debug",
            LogLevel::Info => "info",
            LogLevel::Warn => "warn",
            LogLevel::Error => "error",
        }
    }

    pub fn parse(s: &str) -> Option<LogLevel> {
        match s {
            "debug" => Some(LogLevel::Debug),
            "info" => Some(LogLevel::Info),
            "warn" => Some(LogLevel::Warn),
            "error" => Some(LogLevel::Error),
            _ => None,
        }
    }
}

/* ------------------------------------------------------------------ */
/* 配置（与 src/lib/desktop-log.ts 的 LogConfigInput 对应，camelCase）  */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogConfig {
    pub enabled: bool,
    pub level: LogLevel,
    /// 自定义写入目录；None = 默认 `<app_data>/logs`。
    pub dir: Option<String>,
}

impl Default for LogConfig {
    fn default() -> Self {
        // 决策 D2：默认开 + info，开箱即有日志可排查。
        LogConfig {
            enabled: true,
            level: LogLevel::Info,
            dir: None,
        }
    }
}

/// `log_get_config` 返回视图：dir 为落地绝对路径（config.dir 或默认）。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogConfigView {
    pub enabled: bool,
    pub level: LogLevel,
    pub dir: String,
    /// 最近一次写文件失败的摘要（排查用；None = 一切正常）。
    pub last_error: Option<String>,
}

/* ------------------------------------------------------------------ */
/* 全局状态                                                            */
/* ------------------------------------------------------------------ */

struct Sink {
    enabled: bool,
    level: LogLevel,
    dir: PathBuf,
    /// 当前写入日（YYYY-MM-DD）；跨天换文件 + 清理。
    day: String,
}

struct LogState {
    config_path: PathBuf,
    /// 默认写入目录（`<app_data>/logs`）：`config.dir` 为空/空白时的唯一回退目标。
    ///
    /// **必须显式持有**——曾用 `sink.dir.parent()` 兜底，导致每次保存配置
    /// （改开关或级别）目录都上移一级：`<app_data>/logs` → `<app_data>` → …，
    /// 表现为「改配置时路径被改」。
    default_dir: PathBuf,
    sink: Sink,
    last_error: Option<String>,
}

static STATE: OnceLock<Mutex<LogState>> = OnceLock::new();

/// setup 时调用：加载配置并建 sink。失败不阻塞启动（用默认配置）。
pub fn init(app_data_dir: &Path) {
    let config_path = app_data_dir.join("logging").join("config.json");
    let default_dir = app_data_dir.join("logs");
    let (config, load_error) = load_config(&config_path);
    let dir = resolve_dir(&config.dir, &default_dir);
    let _ = STATE.set(Mutex::new(LogState {
        config_path,
        default_dir: default_dir.clone(),
        sink: Sink {
            enabled: config.enabled,
            level: config.level,
            dir,
            day: today_string(),
        },
        last_error: load_error,
    }));
}

fn state_or_noop() -> Option<&'static Mutex<LogState>> {
    // 未 init（如纯测试环境）时日志命令静默无效。
    STATE.get()
}

/// config.dir 优先（去首尾空白）；为空/解析失败回 `default_dir`。
fn resolve_dir(dir: &Option<String>, default_dir: &Path) -> PathBuf {
    match dir {
        Some(d) if !d.trim().is_empty() => PathBuf::from(d.trim()),
        _ => default_dir.to_path_buf(),
    }
}

/// 把一份配置应用到内存态（不做 IO），返回实际落地目录。
///
/// 目录解析永远相对 `state.default_dir`——**绝不能用当前 `sink.dir` 派生**，
/// 否则「改开关/级别」这类不含目录的保存会逐次移动目录（见 LogState 注释）。
/// 与 `log_set_config` 共用，便于脱离 Tauri 单测这条回归。
fn apply_config(state: &mut LogState, config: &LogConfig) -> PathBuf {
    let dir = resolve_dir(&config.dir, &state.default_dir);
    state.sink = Sink {
        enabled: config.enabled,
        level: config.level,
        dir: dir.clone(),
        day: today_string(),
    };
    state.last_error = None;
    dir
}

/// 落盘形态的配置：写入**解析后的规范路径**（去首尾空白），而不是入参原文，
/// 保证 config.json 与内存 sink 始终一致；解析结果等于默认目录时归一化为
/// `None`，避免把「默认」写死成绝对路径（app_data 变化后即失效）。
fn persisted_config(state: &LogState, config: &LogConfig, dir: &Path) -> LogConfig {
    LogConfig {
        enabled: config.enabled,
        level: config.level,
        dir: if dir == state.default_dir {
            None
        } else {
            Some(dir.to_string_lossy().to_string())
        },
    }
}

/// 读配置文件；缺失 → 默认；损坏 JSON → 默认并带错误摘要（TC-04）。
fn load_config(path: &Path) -> (LogConfig, Option<String>) {
    match fs::read_to_string(path) {
        Ok(raw) => match serde_json::from_str::<LogConfig>(&raw) {
            Ok(config) => (config, None),
            Err(e) => (LogConfig::default(), Some(format!("config.json 损坏，已回默认: {e}"))),
        },
        Err(_) => (LogConfig::default(), None), // 不存在属首次启动，不算错误
    }
}

/* ------------------------------------------------------------------ */
/* 时间（UTC，零依赖 civil-date 算法 —— Hinnant）                       */
/* ------------------------------------------------------------------ */

/// 天数 → (年, 月, 日)。
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// (年, 月, 日) → 天数（清理时与文件名日期比较用）。
fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = (y - era * 400) as u64;
    let mp = if m > 2 { m - 3 } else { m + 9 } as u64;
    let doy = (153 * mp + 2) / 5 + d as u64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe as i64 - 719_468
}

/// 当前 UTC 时刻 → (YYYY-MM-DD, 当日秒)。
fn now_utc_parts() -> (String, i64) {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let days = secs.div_euclid(86_400);
    let sod = secs.rem_euclid(86_400);
    let (y, m, d) = civil_from_days(days);
    (format!("{y:04}-{m:02}-{d:02}"), sod)
}

fn today_string() -> String {
    now_utc_parts().0
}

/// 一条日志的完整行：`<ISO 时间戳> [<scope>] <message>`。
fn format_line(sod: i64, scope: &str, message: &str) -> String {
    let (h, mi, s) = (sod / 3600, (sod % 3600) / 60, sod % 60);
    format!("{h:02}:{mi:02}:{s:02}Z [{scope}] {message}")
}

/* ------------------------------------------------------------------ */
/* 文件写入与清理（纯 IO，可 tmpdir 单测）                              */
/* ------------------------------------------------------------------ */

fn log_file_name(day: &str) -> String {
    format!("plos-{day}.log")
}

/// 文件名是否为本模块日志文件；是则返回其日期（YYYY-MM-DD）。
fn log_file_date(name: &str) -> Option<String> {
    let rest = name.strip_prefix("plos-")?.strip_suffix(".log")?;
    if rest.len() == 10 && rest.as_bytes()[4] == b'-' && rest.as_bytes()[7] == b'-' {
        Some(rest.to_string())
    } else {
        None
    }
}

/// 追加一行到当日文件；目录不存在则创建；失败由调用方静默降级。
fn append_line(dir: &Path, day: &str, line: &str) -> std::io::Result<()> {
    let path = dir.join(log_file_name(day));
    let mut file = fs::OpenOptions::new().append(true).create(true).open(&path)?;
    writeln!(file, "{line}")
}

/// 清理 KEEP_DAYS 天前的旧日志文件，返回删除数。文件名日期不可解析的一律不动。
fn cleanup_dir(dir: &Path, today: &str) -> usize {
    let Ok(entries) = fs::read_dir(dir) else {
        return 0;
    };
    let today_days = match parse_date_to_days(today) {
        Some(d) => d,
        None => return 0,
    };
    let mut removed = 0;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        let Some(date) = log_file_date(name) else { continue };
        let Some(days) = parse_date_to_days(&date) else { continue };
        if today_days - days > KEEP_DAYS {
            if fs::remove_file(entry.path()).is_ok() {
                removed += 1;
            }
        }
    }
    removed
}

fn parse_date_to_days(date: &str) -> Option<i64> {
    let mut it = date.split('-');
    let y: i64 = it.next()?.parse().ok()?;
    let m: u32 = it.next()?.parse().ok()?;
    let d: u32 = it.next()?.parse().ok()?;
    if it.next().is_some() || !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    Some(days_from_civil(y, m, d))
}

/// 取文本尾部 n 行（预览用）。
fn tail_lines(content: &str, n: usize) -> Vec<String> {
    if n == 0 {
        return Vec::new();
    }
    let lines: Vec<&str> = content.lines().collect();
    let start = lines.len().saturating_sub(n);
    lines[start..].iter().map(|s| s.to_string()).collect()
}

/* ------------------------------------------------------------------ */
/* 写入入口（内部 / 前端转发）                                          */
/* ------------------------------------------------------------------ */

/// Rust 内部入口：终端 eprintln + 文件追加（决策 D1 双端同写）。
pub fn log_line(level: LogLevel, scope: &str, message: &str) {
    eprintln!("[{scope}] {message}");
    write_to_file(level, scope, message);
}

/// 前端 `log_write` 转发入口：只进文件（终端侧前端已有 console）。
fn write_to_file(level: LogLevel, scope: &str, message: &str) {
    let Some(state) = state_or_noop() else { return };
    let Ok(mut state) = state.lock() else { return };
    let message = truncate_message(message);
    if !state.sink.enabled || level < state.sink.level {
        return;
    }
    let (day, sod) = now_utc_parts();
    if day != state.sink.day {
        state.sink.day = day.clone();
        cleanup_dir(&state.sink.dir, &day);
    }
    if let Err(e) = append_line(&state.sink.dir, &state.sink.day, &format_line(sod, scope, &message)) {
        state.last_error = Some(format!("写入日志失败: {e}")); // 静默降级，绝不 panic（G5）
    }
}

/// 单条 8KB 截断（R4 防线，Rust 侧再兜一次）。
fn truncate_message(message: &str) -> String {
    if message.len() <= MAX_MESSAGE_BYTES {
        return message.to_string();
    }
    let mut end = MAX_MESSAGE_BYTES;
    while end > 0 && !message.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…(截断)", &message[..end])
}

/* ------------------------------------------------------------------ */
/* Tauri 命令（全部 Result<T, String>，与 vault 契约一致）              */
/* ------------------------------------------------------------------ */

#[tauri::command]
pub fn log_get_config() -> Result<LogConfigView, String> {
    let Some(state) = state_or_noop() else {
        return Err("logging 未初始化（非桌面环境?）".to_string());
    };
    let state = state.lock().map_err(|e| e.to_string())?;
    Ok(LogConfigView {
        enabled: state.sink.enabled,
        level: state.sink.level,
        dir: state.sink.dir.to_string_lossy().to_string(),
        last_error: state.last_error.clone(),
    })
}

/// 更新配置：校验 + 持久化 + 原子替换 sink（即时生效）。dir 传 None/空 = 恢复默认。
#[tauri::command]
pub fn log_set_config(config: LogConfig) -> Result<String, String> {
    let Some(state) = state_or_noop() else {
        return Err("logging 未初始化（非桌面环境?）".to_string());
    };
    let mut state = state.lock().map_err(|e| e.to_string())?;
    // ★ 空 dir 回「默认目录」，不是「当前目录的父级」（防路径漂移）。
    let dir = resolve_dir(&config.dir, &state.default_dir);
    // 目录现在就建好：配置即生效，别等第一条日志才发现路径不可写。
    fs::create_dir_all(&dir).map_err(|e| format!("无法创建日志目录 {}: {e}", dir.display()))?;
    if let Some(parent) = state.config_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    // 落盘前归一化：等值于默认目录时不写绝对路径。
    let persisted = persisted_config(&state, &config, &dir);
    fs::write(
        &state.config_path,
        serde_json::to_string(&persisted).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("持久化日志配置失败: {e}"))?;
    apply_config(&mut state, &config);
    Ok(dir.to_string_lossy().to_string())
}

/// 用系统文件管理器打开日志目录（macOS open / Windows explorer / Linux xdg-open）。
#[tauri::command]
pub fn log_open_dir() -> Result<(), String> {
    let Some(state) = state_or_noop() else {
        return Err("logging 未初始化（非桌面环境?）".to_string());
    };
    let dir = state.lock().map_err(|e| e.to_string())?.sink.dir.clone();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    let program = "open";
    #[cfg(target_os = "windows")]
    let program = "explorer";
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let program = "xdg-open";
    std::process::Command::new(program)
        .arg(&dir)
        .spawn()
        .map_err(|e| format!("打开目录失败: {e}"))?;
    Ok(())
}

/// 读当日文件尾部 n 行（默认 200）。文件不存在 = 今日尚无日志，返回空。
#[tauri::command]
pub fn log_read_recent(max_lines: Option<usize>) -> Result<Vec<String>, String> {
    let n = max_lines.unwrap_or(200).min(2000);
    let Some(state) = state_or_noop() else {
        return Ok(Vec::new());
    };
    let state = state.lock().map_err(|e| e.to_string())?;
    let path = state.sink.dir.join(log_file_name(&today_string()));
    match fs::read_to_string(path) {
        Ok(content) => Ok(tail_lines(&content, n)),
        Err(_) => Ok(Vec::new()),
    }
}

/// 前端 `[ai:*]` 日志转发入口（决策 D1）。级别不合法按 info 处理。
#[tauri::command]
pub fn log_write(level: String, scope: String, message: String) -> Result<(), String> {
    let level = LogLevel::parse(&level).unwrap_or(LogLevel::Info);
    if scope.contains('\n') || scope.contains(']') {
        return Err("scope 只能是短标识".to_string());
    }
    write_to_file(level, &scope, &message);
    Ok(())
}

/* ------------------------------------------------------------------ */
/* 单测（tmpdir，不依赖 Tauri）                                         */
/* ------------------------------------------------------------------ */

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDir(PathBuf);
    impl TempDir {
        fn new(tag: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "plos-log-test-{}-{tag}",
                std::process::id()
            ));
            let _ = fs::remove_dir_all(&path);
            fs::create_dir_all(&path).unwrap();
            TempDir(path)
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn default_config_when_file_missing() {
        let tmp = TempDir::new("missing");
        let (config, err) = load_config(&tmp.0.join("config.json"));
        assert_eq!(config.enabled, true); // D2：默认开
        assert_eq!(config.level, LogLevel::Info);
        assert!(config.dir.is_none());
        assert!(err.is_none()); // 首次启动不算错误
    }

    #[test]
    fn corrupted_config_falls_back_with_error() {
        let tmp = TempDir::new("corrupt");
        let path = tmp.0.join("config.json");
        fs::write(&path, "{bad json").unwrap();
        let (config, err) = load_config(&path);
        assert_eq!(config, LogConfig::default());
        assert!(err.unwrap().contains("损坏"));
    }

    #[test]
    fn config_roundtrip_keeps_camel_case() {
        let config = LogConfig {
            enabled: false,
            level: LogLevel::Warn,
            dir: Some("/tmp/x".into()),
        };
        let raw = serde_json::to_string(&config).unwrap();
        // camelCase 契约（rules/rust.mdc：模型 serde camelCase）
        assert!(raw.contains("\"level\":\"warn\""));
        assert_eq!(serde_json::from_str::<LogConfig>(&raw).unwrap(), config);
    }

    /// 构造一个脱离 Tauri 的内存态：default_dir = <tmp>/logs，sink 已指向它。
    fn test_state(tmp: &TempDir) -> LogState {
        let default_dir = tmp.0.join("logs");
        fs::create_dir_all(&default_dir).unwrap();
        LogState {
            config_path: tmp.0.join("logging").join("config.json"),
            default_dir: default_dir.clone(),
            sink: Sink {
                enabled: true,
                level: LogLevel::Info,
                dir: default_dir,
                day: "2026-09-11".into(),
            },
            last_error: None,
        }
    }

    #[test]
    fn saving_without_dir_keeps_default_dir() {
        // 回归（用户报障「改日志配置时路径被修改」）：旧实现以 sink.dir.parent()
        // 兜底空 dir，每保存一次（开关/级别）目录就上移一级。
        let tmp = TempDir::new("no-dir-drift");
        let mut state = test_state(&tmp);
        let default = state.default_dir.clone();

        let dir = apply_config(
            &mut state,
            &LogConfig {
                enabled: false,
                level: LogLevel::Warn,
                dir: None,
            },
        );
        assert_eq!(dir, default);
        assert_ne!(dir, default.parent().unwrap().to_path_buf()); // 不是父级
        // 连续保存仍稳定（旧实现第二次会漂到祖父级）
        let again = apply_config(
            &mut state,
            &LogConfig {
                enabled: true,
                level: LogLevel::Debug,
                dir: None,
            },
        );
        assert_eq!(again, default);
        assert_eq!(state.sink.dir, default);
        assert_eq!(state.sink.level, LogLevel::Debug);
    }

    #[test]
    fn blank_and_custom_dirs_resolve_and_persist() {
        let tmp = TempDir::new("dir-normalize");
        let mut state = test_state(&tmp);
        let default = state.default_dir.clone();

        // 空白串 = 恢复默认（且首尾空白被裁掉）
        assert_eq!(resolve_dir(&Some("   ".into()), &default), default);

        let custom = tmp.0.join("custom-logs");
        let cfg = LogConfig {
            enabled: true,
            level: LogLevel::Info,
            dir: Some(format!("  {}  ", custom.display())),
        };
        let dir = apply_config(&mut state, &cfg);
        assert_eq!(dir, custom);
        // 自定义目录原样落盘
        assert_eq!(
            persisted_config(&state, &cfg, &dir).dir.as_deref(),
            Some(custom.to_string_lossy().as_ref())
        );
        // 解析结果等于默认目录 → 归一化为 None（不写死绝对路径）
        let cfg_default = LogConfig {
            enabled: true,
            level: LogLevel::Info,
            dir: None,
        };
        assert!(persisted_config(&state, &cfg_default, &default).dir.is_none());
    }

    #[test]
    fn level_filter_respects_threshold() {
        assert!(passes(LogLevel::Error, LogLevel::Info));
        assert!(passes(LogLevel::Info, LogLevel::Info));
        assert!(!passes(LogLevel::Debug, LogLevel::Info));
    }

    fn passes(event: LogLevel, threshold: LogLevel) -> bool {
        event >= threshold
    }

    #[test]
    fn file_name_and_date_parsing() {
        assert_eq!(log_file_name("2026-09-11"), "plos-2026-09-11.log");
        assert_eq!(
            log_file_date("plos-2026-09-11.log").as_deref(),
            Some("2026-09-11")
        );
        assert!(log_file_date("other.log").is_none());
        assert!(log_file_date("plos-notadate.log").is_none());
    }

    #[test]
    fn append_creates_daily_file_and_formats_line() {
        let tmp = TempDir::new("append");
        append_line(&tmp.0, "2026-09-11", &format_line(45296, "ai:builtin", "生成请求")).unwrap();
        let content = fs::read_to_string(tmp.0.join("plos-2026-09-11.log")).unwrap();
        assert_eq!(content, "12:34:56Z [ai:builtin] 生成请求\n");
        // 追加不覆盖
        append_line(&tmp.0, "2026-09-11", "second").unwrap();
        assert_eq!(fs::read_to_string(tmp.0.join("plos-2026-09-11.log")).unwrap().lines().count(), 2);
    }

    #[test]
    fn cleanup_removes_only_old_log_files() {
        let tmp = TempDir::new("cleanup");
        // 10 天前 / 3 天前 / 今天 / 非日志文件
        let (y, m, d) = civil_from_days(days_from_civil(2026, 9, 11) - 10);
        let old = format!("{y:04}-{m:02}-{d:02}");
        fs::write(tmp.0.join(log_file_name(&old)), "old").unwrap();
        fs::write(tmp.0.join("plos-2026-09-08.log"), "keep-3d").unwrap();
        fs::write(tmp.0.join("plos-2026-09-11.log"), "today").unwrap();
        fs::write(tmp.0.join("unrelated.txt"), "keep").unwrap();
        assert_eq!(cleanup_dir(&tmp.0, "2026-09-11"), 1);
        assert!(!tmp.0.join(log_file_name(&old)).exists());
        assert!(tmp.0.join("plos-2026-09-08.log").exists());
        assert!(tmp.0.join("unrelated.txt").exists());
    }

    #[test]
    fn tail_lines_returns_last_n() {
        let content = "a\nb\nc\nd";
        assert_eq!(tail_lines(content, 2), vec!["c", "d"]);
        assert!(tail_lines(content, 0).is_empty());
        assert_eq!(tail_lines(content, 99).len(), 4);
    }

    #[test]
    fn truncate_message_clamps_to_limit() {
        let big = "汉".repeat(10_000); // 30KB
        let cut = truncate_message(&big);
        assert!(cut.len() < MAX_MESSAGE_BYTES + 64);
        assert!(cut.ends_with("…(截断)"));
        assert_eq!(truncate_message("短消息"), "短消息");
    }

    #[test]
    fn civil_date_roundtrip_samples() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        // 锚点：1970-01-01 → 2026-01-01 = 56*365+14(闰) = 20454；+253(Jan..Aug+10) = 20707
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(days_from_civil(2026, 9, 11), 20_707);
        assert_eq!(parse_date_to_days("2026-09-11"), Some(20_707));
        assert_eq!(parse_date_to_days("2026-13-01"), None);
    }
}
