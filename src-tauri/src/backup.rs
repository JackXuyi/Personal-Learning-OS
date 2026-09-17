//! 备份文件通道 —— 写 / 列 / 读 / 定位 `<app_data>/backups/*.plosbak.json`。
//!
//! 为什么自建命令而不是引 `tauri-plugin-dialog` / `tauri-plugin-fs`（决策 D1）：
//! ① 本仓库 capabilities 只有 `core:default`，加插件要动 capabilities + 两个 manifest；
//! ② 备份天然该集中在固定目录（才有「最近备份」列表与自动预备份），
//!    「任意路径另存为」收益不抵成本；
//! ③ Tauri 2 下自定义命令默认可达，零新增 crate。
//!
//! ⚠️ 安全关键：`name` 来自前端，**不可信**。不校验就是一条任意文件写入原语
//! （可写到 `../` 下的任意位置）。校验见 `safe_name`。
//!
//! 落盘策略：先写 `{name}.tmp` 再 `rename` —— 崩溃 / 磁盘满时不产生**半截
//! `.plosbak.json`**（用户会以为那是一份可用备份）。临时名以 `.tmp` 结尾，
//! 天然不会出现在 `backup_list` 里。

use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;
use tauri::{AppHandle, Manager};

/// 备份文件后缀（双重后缀：`.json` 保证任意编辑器 / 终端可直接查看）。
const BACKUP_SUFFIX: &str = ".plosbak.json";

/// 备份目录名（位于 `app_data_dir` 下）。
const BACKUP_DIR_NAME: &str = "backups";

/// `backup_list` 的元素（前端 `BackupEntry` 的镜像，camelCase）。
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BackupEntry {
    pub name: String,
    pub path: String,
    pub bytes: u64,
    /// 修改时间 epoch ms。
    pub modified_at: i64,
}

/// 文件名白名单校验：只允许 `[A-Za-z0-9._-]`，必须以 `.plosbak.json` 结尾，
/// 且不含 `..`。三个条件缺一不可（`..` 已能被字符集判定拦住，但显式再判一次，
/// 防将来有人放宽字符集时静默打开路径穿越）。
///
/// 用于**读路径**（`backup_read`）与列表过滤：目录里应当只有备份。
pub fn safe_name(name: &str) -> Result<(), String> {
    safe_chars(name)?;
    if !name.ends_with(BACKUP_SUFFIX) {
        return Err(format!("非法备份文件名：{name}"));
    }
    Ok(())
}

/// 单章 Markdown 导出用的后缀（F4 范围 D6-A 的第 2 条 P0）。
const MARKDOWN_SUFFIX: &str = ".md";

/// 写路径的白名单：备份后缀 **或** `.md`。
///
/// 为什么允许 `.md`：单章 Markdown 导出与备份共用同一条「落盘到固定目录」通道
/// （零新增 crate / 零 capabilities 改动）；安全边界是**字符集 + 固定目录 +
/// 无路径分隔符**，后缀只是防呆，不该拦住一个正当的导出格式。
/// 读路径与列表仍只认 `.plosbak.json` → `.md` 不会混进「最近备份」。
pub fn safe_save_name(name: &str) -> Result<(), String> {
    safe_chars(name)?;
    if !name.ends_with(BACKUP_SUFFIX) && !name.ends_with(MARKDOWN_SUFFIX) {
        return Err(format!("非法导出文件名：{name}"));
    }
    Ok(())
}

/// 字符集与穿越检查（两条写 / 读路径共用）。
fn safe_chars(name: &str) -> Result<(), String> {
    let chars_ok = name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
    if !chars_ok || name.contains("..") || name.is_empty() {
        return Err(format!("非法文件名：{name}"));
    }
    Ok(())
}

/// 解析备份目录并确保存在。
pub fn backup_dir_of(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法定位应用数据目录：{e}"))?
        .join(BACKUP_DIR_NAME);
    fs::create_dir_all(&dir).map_err(|e| format!("无法创建备份目录 {}：{e}", dir.display()))?;
    Ok(dir)
}

/// 写入备份（先临时文件再 rename，避免半截文件）。返回最终绝对路径。
pub fn save_in(dir: &Path, name: &str, contents: &str) -> Result<PathBuf, String> {
    safe_save_name(name)?;
    let target = dir.join(name);
    let tmp = dir.join(format!("{name}.tmp"));
    fs::write(&tmp, contents).map_err(|e| format!("写入备份失败：{e}"))?;
    if let Err(err) = fs::rename(&tmp, &target) {
        // Windows 上 rename 不覆盖已存在文件 → 先删目标再重试一次。
        let _ = fs::remove_file(&target);
        fs::rename(&tmp, &target).map_err(|e| {
            let _ = fs::remove_file(&tmp);
            format!("落盘备份失败（{err} → {e}）")
        })?;
    }
    Ok(target)
}

/// 列举备份（只认 `.plosbak.json`），按修改时间倒序。
pub fn list_in(dir: &Path) -> Result<Vec<BackupEntry>, String> {
    let entries = fs::read_dir(dir).map_err(|e| format!("读取备份目录失败：{e}"))?;
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if !name.ends_with(BACKUP_SUFFIX) {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() {
            continue;
        }
        let modified_at = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        out.push(BackupEntry {
            name: name.to_string(),
            path: path.to_string_lossy().to_string(),
            bytes: meta.len(),
            modified_at,
        });
    }
    out.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    Ok(out)
}

/// 按名读取备份内容。
pub fn read_in(dir: &Path, name: &str) -> Result<String, String> {
    safe_name(name)?;
    fs::read_to_string(dir.join(name)).map_err(|e| format!("读取备份失败：{e}"))
}

/// 校验路径确实落在备份目录内（`backup_reveal` 的入参来自前端）。
fn ensure_inside(dir: &Path, path: &Path) -> Result<(), String> {
    let base = dir
        .canonicalize()
        .map_err(|e| format!("备份目录不可用：{e}"))?;
    let target = path
        .canonicalize()
        .map_err(|e| format!("备份文件不存在：{e}"))?;
    if !target.starts_with(&base) {
        return Err("只能定位备份目录内的文件".to_string());
    }
    Ok(())
}

// ===== Tauri 命令 =====

/// 备份目录绝对路径（不存在则创建）→ UI 展示 + 「打开目录」。
#[tauri::command]
pub fn backup_dir(app: AppHandle) -> Result<String, String> {
    Ok(backup_dir_of(&app)?.to_string_lossy().to_string())
}

/// 写入备份，返回绝对路径。
#[tauri::command]
pub fn backup_save(app: AppHandle, name: String, contents: String) -> Result<String, String> {
    let dir = backup_dir_of(&app)?;
    let path = save_in(&dir, &name, &contents)?;
    Ok(path.to_string_lossy().to_string())
}

/// 列举备份（时间倒序）→ 「最近备份」列表。
#[tauri::command]
pub fn backup_list(app: AppHandle) -> Result<Vec<BackupEntry>, String> {
    list_in(&backup_dir_of(&app)?)
}

/// 按名读取备份内容（从「最近备份」列表恢复用）。
#[tauri::command]
pub fn backup_read(app: AppHandle, name: String) -> Result<String, String> {
    let dir = backup_dir_of(&app)?;
    read_in(&dir, &name)
}

/// 在系统文件管理器中显示该文件（macOS `open -R`，与 `logging.rs::log_open_dir` 同范式）。
#[tauri::command]
pub fn backup_reveal(app: AppHandle, path: String) -> Result<(), String> {
    let dir = backup_dir_of(&app)?;
    let target = PathBuf::from(&path);
    ensure_inside(&dir, &target)?;

    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = std::process::Command::new("open");
        c.arg("-R").arg(&target);
        c
    };
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = std::process::Command::new("explorer");
        c.arg(format!("/select,{}", target.display()));
        c
    };
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let mut cmd = {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(target.parent().unwrap_or(&dir));
        c
    };

    cmd.spawn().map_err(|e| format!("打开备份位置失败：{e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::SystemTime;

    /// 当前 epoch ms（仅供测试造隔离临时目录名）。
    fn now_ms() -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0)
    }

    /// 隔离的临时目录（仓库无 tempfile 依赖 → 手工建 + 手工清理）。
    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("plos-backup-{tag}-{}", now_ms()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn safe_name_rejects_traversal_and_wrong_suffix() {
        // 路径穿越（相对路径）
        assert!(safe_name("../evil.plosbak.json").is_err());
        // 路径穿越（子目录）
        assert!(safe_name("a/b.plosbak.json").is_err());
        // 反斜杠（Windows 穿越）
        assert!(safe_name("a\\b.plosbak.json").is_err());
        // 后缀不符（例如误选了一份普通 JSON）
        assert!(safe_name("x.json").is_err());
        assert!(safe_name("plos-backup-1.plosbak").is_err());
        assert!(safe_name("").is_err());
        // 合法名
        assert!(safe_name("plos-backup-20260917-143200.plosbak.json").is_ok());
        assert!(safe_name("pre-import-20260917-144000.plosbak.json").is_ok());
    }

    #[test]
    fn save_name_allows_markdown_but_read_name_does_not() {
        // 写路径接受 `用户可见目录内` 的 .md（单章 Markdown 导出）
        assert!(safe_save_name("plos-chapter-20260917-143200.md").is_ok());
        assert!(safe_save_name("plos-backup-20260917-143200.plosbak.json").is_ok());
        // 读路径仍只认备份后缀（.md 不该从「最近备份」被读回来）
        assert!(safe_name("plos-chapter-20260917-143200.md").is_err());
        // 其它后缀两条路径都拒
        assert!(safe_save_name("x.txt").is_err());
        assert!(safe_save_name("x").is_err());
        // 穿越在 .md 上同样被拒
        assert!(safe_save_name("../evil.md").is_err());
        assert!(safe_save_name("a/b.md").is_err());
        assert!(safe_save_name("...md").is_err());
    }

    #[test]
    fn save_list_read_round_trip() {
        let dir = temp_dir("roundtrip");
        let name = "plos-backup-20260917-143200.plosbak.json";
        let contents = r#"{"kind":"plos.backup","exportVersion":1}"#;

        let saved = save_in(&dir, name, contents).unwrap();
        assert_eq!(saved, dir.join(name));
        // 不留下临时文件
        assert!(!dir.join(format!("{name}.tmp")).exists());

        let listed = list_in(&dir).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, name);
        assert_eq!(listed[0].bytes, contents.len() as u64);

        assert_eq!(read_in(&dir, name).unwrap(), contents);

        // 非法名在读路径上同样被拒（不光是写路径）
        assert!(read_in(&dir, "../evil.plosbak.json").is_err());

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn list_ignores_unrelated_and_partial_files() {
        let dir = temp_dir("list-filter");
        fs::write(dir.join("note.txt"), "x").unwrap();
        fs::write(dir.join("x.json"), "x").unwrap();
        // 半截文件（临时名）不该出现在「最近备份」里
        fs::write(dir.join("y.plosbak.json.tmp"), "x").unwrap();
        fs::write(dir.join("ok.plosbak.json"), "{}").unwrap();

        let listed = list_in(&dir).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, "ok.plosbak.json");

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn save_overwrites_existing_name() {
        let dir = temp_dir("overwrite");
        let name = "same.plosbak.json";
        save_in(&dir, name, "first").unwrap();
        save_in(&dir, name, "second").unwrap();
        assert_eq!(read_in(&dir, name).unwrap(), "second");
        assert_eq!(list_in(&dir).unwrap().len(), 1);
        fs::remove_dir_all(&dir).unwrap();
    }
}
