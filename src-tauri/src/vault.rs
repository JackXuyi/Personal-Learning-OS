//! vault 命令面 —— 把 API Key 等小秘密存入系统钥匙串（macOS Keychain）。
//!
//! 实现说明：直接 spawn `security` CLI（add/find/delete-generic-password），
//! 零第三方 crate 依赖，避免引入 keyring crate 的编译与网络成本；
//! 仅 macOS 支持，其它平台返回带类型错误（前端 isTauri 守卫已兜底，
//! 纯浏览器预览不触碰这些命令）。
//!
//! service 固定为 `plos`；account 由调用方给定（前端归一为 `api:<provider>`），
//! 一个供应商一条 Keychain 记录。secret 经 Command 参数传递（不经 shell，
//! 无注入面）；`-w` 后跟单参数值即可，空格/特殊字符安全。

use std::process::Command;

/// Keychain 条目分组（service）。前端 vault.ts 与此保持一致。
const SERVICE: &str = "plos";

const NOT_MACOS: &str = "keyring is only supported on macOS (Keychain)";

#[inline]
fn on_macos() -> bool {
    cfg!(target_os = "macos")
}

/// 写入或更新一条钥匙串记录（`-U` 更新已存在项）。secret 为空串 = 清理
/// （与前端 saveActive「清空 API Key」语义对齐，委托删除）。
#[tauri::command]
pub fn vault_set_secret(account: String, secret: String) -> Result<(), String> {
    if !on_macos() {
        return Err(NOT_MACOS.to_string());
    }
    if secret.is_empty() {
        return vault_delete_secret(account);
    }
    let out = Command::new("security")
        .args([
            "add-generic-password",
            "-U",
            "-s",
            SERVICE,
            "-a",
            &account,
            "-w",
            &secret,
        ])
        .output()
        .map_err(|e| format!("failed to run security CLI: {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// 读取钥匙串记录。无条目返回 Ok(None)（与「未配置 Key」同义，而非错误）。
#[tauri::command]
pub fn vault_get_secret(account: String) -> Result<Option<String>, String> {
    if !on_macos() {
        return Err(NOT_MACOS.to_string());
    }
    let out = Command::new("security")
        .args(["find-generic-password", "-s", SERVICE, "-a", &account, "-w"])
        .output()
        .map_err(|e| format!("failed to run security CLI: {e}"))?;
    if out.status.success() {
        // CLI 输出 = secret + 末尾换行；仅去掉尾部换行，保留 secret 内部空白。
        let secret = String::from_utf8_lossy(&out.stdout).trim_end().to_string();
        Ok(Some(secret))
    } else {
        let stderr = String::from_utf8_lossy(&out.stderr);
        if stderr.contains("errSecItemNotFound") {
            Ok(None)
        } else {
            Err(stderr.trim().to_string())
        }
    }
}

/// 删除钥匙串记录。无条目时幂等成功（与「从未配置」同义）。
#[tauri::command]
pub fn vault_delete_secret(account: String) -> Result<(), String> {
    if !on_macos() {
        return Err(NOT_MACOS.to_string());
    }
    let out = Command::new("security")
        .args(["delete-generic-password", "-s", SERVICE, "-a", &account])
        .output()
        .map_err(|e| format!("failed to run security CLI: {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&out.stderr);
        if stderr.contains("errSecItemNotFound") {
            Ok(())
        } else {
            Err(stderr.trim().to_string())
        }
    }
}
