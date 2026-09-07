/// Rust shell for the Personal Learning OS desktop app (Tauri v2).
///
/// Phase 0: the shell only reports app status. Native commands (file dialogs,
/// SQLite-backed storage, provider process spawning) land in later phases —
/// the JS layer already routes every I/O capability through adapters, so the
/// shell stays thin.
///
/// Phase 2 (local LLM): the `llm` module owns the built-in local model stack —
/// llama-helper sidecar spawning, model download/lifecycle and generation.
/// See docs/local-llm-loading-plan-2026-09.md.
use std::sync::Arc;
use std::time::Duration;

use serde_json::json;
use tauri::Manager;

mod llm;

use llm::commands::LlmState;
use llm::manager::ModelManager;
use llm::sidecar::Sidecar;

/// Minimal health probe the webview can invoke via `invoke("app_status")`.
#[tauri::command]
fn app_status() -> serde_json::Value {
    json!({
        "status": "ok",
        "phase": "foundation-scaffold",
        "desktop": true,
    })
}

/// 初始化本地 LLM 状态(model manager + helper sidecar + 空闲回收线程)。
fn init_llm(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let app_data_dir = app.path().app_data_dir()?;
    let resource_dir = app.path().resource_dir().ok();

    let manager = Arc::new(ModelManager::new(&app_data_dir)?);
    let helper_path = Sidecar::resolve_helper_binary(resource_dir.as_deref())?;
    let sidecar = Arc::new(Sidecar::new(helper_path));

    // 空闲回收:helper 无请求超过阈值则优雅退出(下次请求自动重启)。
    {
        let sidecar = sidecar.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(15)).await;
                if sidecar.is_idle().await {
                    sidecar.shutdown().await;
                }
            }
        });
    }

    app.manage(LlmState { manager, sidecar });
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if let Err(err) = init_llm(app) {
                // 本地模型栈初始化失败不阻塞启动:仅记录,UI 侧 llm_status
                // 会给出可读的 not-configured 提示。
                eprintln!("local LLM init skipped: {err}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_status,
            llm::commands::llm_list_models,
            llm::commands::llm_download,
            llm::commands::llm_cancel_download,
            llm::commands::llm_delete,
            llm::commands::llm_generate,
            llm::commands::llm_default_model,
            llm::commands::llm_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the Personal Learning OS shell");
}
