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

mod db;
mod llm;
mod vault;

use db::init_db;
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
            // SQLite 初始化失败不阻塞启动：UI 侧 isTauri() 守卫会回退到
            // localStorage 后端（db_status 可用于排障）。
            if let Err(err) = init_db(app) {
                eprintln!("sqlite init skipped: {err}");
            }
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
            vault::vault_set_secret,
            vault::vault_get_secret,
            vault::vault_delete_secret,
            // RAG 存储层（T6）
            db::commands::db_status,
            db::commands::db_list_sections,
            db::commands::db_get_section,
            db::commands::db_sections_by_range,
            db::commands::db_save_sections,
            db::commands::db_delete_section,
            db::commands::db_list_chunks,
            db::commands::db_list_chunks_by_document,
            db::commands::db_chunks_by_knowledge,
            db::commands::db_get_chunk,
            db::commands::db_save_chunks,
            db::commands::db_delete_chunk,
            db::commands::db_fts_search,
            db::commands::db_list_knowledge_units,
            db::commands::db_get_knowledge_unit,
            db::commands::db_save_knowledge_units,
            db::commands::db_delete_knowledge_unit,
            db::commands::db_list_relations,
            db::commands::db_prerequisites_of,
            db::commands::db_save_relations,
            db::commands::db_delete_relation,
            db::commands::db_list_embeddings,
            db::commands::db_get_embedding,
            db::commands::db_save_embeddings,
            db::commands::db_delete_embedding,
            db::commands::db_delete_embeddings_by_target,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the Personal Learning OS shell");
}
