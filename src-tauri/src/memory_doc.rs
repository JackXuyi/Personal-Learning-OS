//! 记忆文档文件通道 —— 写 / 读 / 定位 `<app_data>/memory/learner-memory.md`。
//! 方案：docs/learner-memory-design-2026-09.md §8.20（D12-A）。
//!
//! 为什么自建命令而不是引 `tauri-plugin-fs`：同 `backup.rs` 的 D1 ——
//! 本仓库 capabilities 只有 `core:default`，加插件要动 capabilities + 两个 manifest；
//! Tauri 2 下自定义命令默认可达，零新增 crate。
//!
//! ⚠️ 与 `backup.rs` 的**关键差别（本模块更强）**：这里**没有任何来自前端的路径 / 文件名**。
//! 目录名与文件名都是常量、后缀锁死 `.md` —— 于是「路径穿越」在本模块里
//! **不是「被校验拦住」而是「结构上不存在」**（对比 `backup.rs::safe_name` 的必要性）。
//! 落盘内容是纯文本正文，只影响用户自己的学习文档。
//!
//! 落盘策略：先写 `learner-memory.md.tmp` 再 `rename` —— 崩溃 / 磁盘满时不产生
//! **半截 `.md`**（用户会用外部编辑器打开它，半截文档会被当成真源读回去）。
//! 临时名以 `.tmp` 结尾，且 `read` 只认固定文件名 → 永远不会被读回来。

use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

/// 记忆文件后缀（锁死；正文是 markdown）。
const MEMORY_SUFFIX: &str = ".md";

/// 记忆目录名（位于 `app_data_dir` 下）。
const MEMORY_DIR_NAME: &str = "memory";

/// 固定文件名：**不接受前端传名** → 无路径穿越面（见模块头注释）。
const MEMORY_FILE_NAME: &str = "learner-memory.md";

/// 解析记忆目录并确保存在。
pub fn memory_dir_of(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法定位应用数据目录：{e}"))?
        .join(MEMORY_DIR_NAME);
    fs::create_dir_all(&dir).map_err(|e| format!("无法创建记忆目录 {}：{e}", dir.display()))?;
    Ok(dir)
}

/// 目标文件的绝对路径（不加后缀校验 —— 文件名是常量，见 `MEMORY_FILE_NAME`）。
pub fn memory_path_in(dir: &Path) -> PathBuf {
    dir.join(format!("{MEMORY_FILE_NAME}"))
}

/// 写入记忆文档（先临时文件再 rename，避免半截文件）。返回最终绝对路径。
pub fn save_in(dir: &Path, contents: &str) -> Result<PathBuf, String> {
    debug_assert!(MEMORY_FILE_NAME.ends_with(MEMORY_SUFFIX));
    let target = memory_path_in(dir);
    let tmp = dir.join(format!("{MEMORY_FILE_NAME}.tmp"));
    fs::write(&tmp, contents).map_err(|e| format!("写入记忆文件失败：{e}"))?;
    if let Err(err) = fs::rename(&tmp, &target) {
        // Windows 上 rename 不覆盖已存在文件 → 先删目标再重试一次。
        let _ = fs::remove_file(&target);
        fs::rename(&tmp, &target).map_err(|e| {
            let _ = fs::remove_file(&tmp);
            format!("落盘记忆文件失败（{err} → {e}）")
        })?;
    }
    Ok(target)
}

/// 读取记忆文档。**文件不存在 → `Ok("")`**（TC-UC11-02）。
///
/// 为什么不是 `Err`：首次使用 / 用户手动删掉了这个文件都是**正常状态**，
/// 返回 `Err` 会让 UI 只能走报错分支 —— 而正确行为是「App 内文档照常工作，
/// 磁盘镜像为空」。
pub fn read_in(dir: &Path) -> Result<String, String> {
    let path = memory_path_in(dir);
    match fs::read_to_string(&path) {
        Ok(text) => Ok(text),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(format!("读取记忆文件失败：{e}")),
    }
}

/// 文件是否存在（`reveal` 的前置检查：定位一个不存在的文件是无声失败）。
pub fn exists_in(dir: &Path) -> bool {
    memory_path_in(dir).is_file()
}

// ===== Tauri 命令 =====

/// 记忆目录绝对路径（不存在则创建）→ UI 展示 + 「在文件管理器中显示」。
#[tauri::command]
pub fn memory_doc_dir(app: AppHandle) -> Result<String, String> {
    Ok(memory_dir_of(&app)?.to_string_lossy().to_string())
}

/// 写入记忆文档，返回绝对路径。
#[tauri::command]
pub fn memory_doc_save(app: AppHandle, contents: String) -> Result<String, String> {
    let dir = memory_dir_of(&app)?;
    let path = save_in(&dir, &contents)?;
    Ok(path.to_string_lossy().to_string())
}

/// 读取记忆文档（不存在 → 空串，不报错）。
#[tauri::command]
pub fn memory_doc_read(app: AppHandle) -> Result<String, String> {
    read_in(&memory_dir_of(&app)?)
}

/// 在系统文件管理器中显示该文件（macOS `open -R`，与 `backup.rs::backup_reveal` 同范式）。
#[tauri::command]
pub fn memory_doc_reveal(app: AppHandle) -> Result<(), String> {
    let dir = memory_dir_of(&app)?;
    if !exists_in(&dir) {
        return Err("记忆文件还没有落盘过".to_string());
    }
    let target = memory_path_in(&dir);

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
        c.arg(&dir);
        c
    };

    cmd.spawn().map_err(|e| format!("打开记忆文件位置失败：{e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    /// 当前 epoch ms（仅供测试造隔离临时目录名）。
    fn now_ms() -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0)
    }

    /// 隔离的临时目录（仓库无 tempfile 依赖 → 手工建 + 手工清理）。
    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("plos-memory-{tag}-{}", now_ms()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn target_path_is_fixed_markdown_inside_dir() {
        // 文件名与后缀都是常量：没有任何前端输入能改变目标路径（穿越面结构上不存在）。
        let dir = Path::new("/tmp/whatever");
        let path = memory_path_in(dir);
        assert_eq!(path, dir.join("learner-memory.md"));
        assert!(path.to_string_lossy().ends_with(MEMORY_SUFFIX));
    }

    #[test]
    fn read_missing_file_returns_empty_ok() {
        // TC-UC11-02：文件不存在 → Ok("")，不是 Err。
        let dir = temp_dir("missing");
        assert_eq!(read_in(&dir).unwrap(), "");
        assert!(!exists_in(&dir));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn save_read_round_trip_without_tmp_leftover() {
        let dir = temp_dir("roundtrip");
        let doc = "# 学习者记忆\n\n- 你的记录显示：常在 22:00–01:00 学习。<!--m:cadence-window-->\n";

        let saved = save_in(&dir, doc).unwrap();
        assert_eq!(saved, memory_path_in(&dir));
        // 不留下临时文件（否则它会跟着用户一起被备份 / 同步）
        assert!(!dir.join(format!("{MEMORY_FILE_NAME}.tmp")).exists());
        assert!(exists_in(&dir));

        assert_eq!(read_in(&dir).unwrap(), doc);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn save_overwrites_existing_file() {
        // 覆盖写同一文件（rename 在 Windows 上的兼容分支也走这里）。
        let dir = temp_dir("overwrite");
        save_in(&dir, "first").unwrap();
        save_in(&dir, "second").unwrap();
        assert_eq!(read_in(&dir).unwrap(), "second");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn save_empty_doc_is_valid_state() {
        // 清空全部记忆 → 落盘空文档：读回来是空串，不是「文件不存在」。
        let dir = temp_dir("empty");
        save_in(&dir, "").unwrap();
        assert!(exists_in(&dir));
        assert_eq!(read_in(&dir).unwrap(), "");
        fs::remove_dir_all(&dir).unwrap();
    }
}
