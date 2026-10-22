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

mod backup;
mod db;
mod llm;
mod logging;
mod memory_doc;
mod net;
mod ocr;
mod tray;
mod vault;

use db::init_db;
use llm::commands::LlmState;
use llm::manager::ModelManager;
use llm::models::ModelKind;
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
///
/// 两个进程:聊天模型一个、向量模型一个。共用同一个 helper 二进制,但进程
/// 隔离 —— 否则 `load_model_if_needed` 会因模型路径交替而反复重载 2.5GB 与
/// 639MB 的两个模型(D4)。
fn init_llm(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let app_data_dir = app.path().app_data_dir()?;
    let resource_dir = app.path().resource_dir().ok();

    let manager = Arc::new(ModelManager::new(&app_data_dir, ModelKind::Llm)?);
    let embed_manager = Arc::new(ModelManager::new(&app_data_dir, ModelKind::Embedding)?);
    let helper_path = Sidecar::resolve_helper_binary(resource_dir.as_deref())?;
    let sidecar = Arc::new(Sidecar::new(helper_path.clone()));
    let embed_sidecar = Arc::new(Sidecar::new(helper_path));

    // 空闲回收:两个进程都要回收,否则向量进程会常驻到自身超时。
    for sidecar in [sidecar.clone(), embed_sidecar.clone()] {
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(15)).await;
                if sidecar.is_idle().await {
                    sidecar.shutdown().await;
                }
            }
        });
    }

    app.manage(LlmState {
        manager,
        sidecar,
        embed_manager,
        embed_sidecar,
    });
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // 日志最先初始化：后续 init_db/init_llm 的失败也进文件（TC-01）。
            match app.path().app_data_dir() {
                Ok(dir) => logging::init(&dir),
                Err(err) => eprintln!("logging init skipped: {err}"),
            }
            // SQLite 初始化失败不阻塞启动：UI 侧 isTauri() 守卫会回退到
            // localStorage 后端（db_status 可用于排障）。
            if let Err(err) = init_db(app) {
                logging::log_line(
                    logging::LogLevel::Warn,
                    "app",
                    &format!("sqlite init skipped: {err}"),
                );
            }
            if let Err(err) = init_llm(app) {
                // 本地模型栈初始化失败不阻塞启动:仅记录,UI 侧 llm_status
                // 会给出可读的 not-configured 提示。
                logging::log_line(
                    logging::LogLevel::Warn,
                    "app",
                    &format!("local LLM init skipped: {err}"),
                );
            }
            // 菜单栏常驻图标（tray.rs）：失败不阻塞启动，仅记录。
            let tray_ok = match tray::init(app.handle()) {
                Ok(()) => true,
                Err(err) => {
                    logging::log_line(
                        logging::LogLevel::Warn,
                        "app",
                        &format!("tray init skipped: {err}"),
                    );
                    false
                }
            };
            // 纯菜单栏应用：Dock 不再显示图标，菜单栏图标是唯一入口。
            // ⚠️ 仅在托盘可用时才切 —— 否则红点一收走窗口就再也唤不回来
            // （见 tray.rs::is_available 的注释）。
            #[cfg(target_os = "macos")]
            if tray_ok {
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            }
            Ok(())
        })
        // 窗口左上角红色关闭按钮 → 收进菜单栏而非退出（2026-10-19 用户确认：
        // 「改成最小化到顶部的菜单栏，而不是退出当前客户端」，并确认 Dock 不留图标）。
        // 真正退出走托盘菜单「退出」；⚠️ Accessory 策略下应用菜单不显示，⌘Q 已失效。
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                // 托盘不可用时回退最小化：Dock 图标点击仍能唤回，
                // 而 hide() 后 macOS 不会自动恢复窗口 = 应用变成僵尸进程。
                if tray::is_available() {
                    let _ = window.hide();
                } else {
                    let _ = window.minimize();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            app_status,
            llm::commands::llm_list_models,
            llm::commands::llm_download,
            llm::commands::llm_cancel_download,
            llm::commands::llm_delete,
            llm::commands::llm_generate,
            llm::commands::llm_status,
            // 本地向量化（docs/embedding-default-config-design-2026-09.md）
            llm::commands::embed_list_models,
            llm::commands::embed_download,
            llm::commands::embed_cancel_download,
            llm::commands::embed_delete,
            llm::commands::embed_texts,
            // 文件日志（docs/tauri-log-config-design-2026-09.md）
            logging::log_get_config,
            logging::log_set_config,
            logging::log_open_dir,
            logging::log_read_recent,
            logging::log_write,
            vault::vault_set_secret,
            vault::vault_get_secret,
            vault::vault_delete_secret,
            // 备份文件通道（docs/data-portability-export-import-design-2026-09.md §8.2）
            backup::backup_dir,
            backup::backup_save,
            backup::backup_list,
            backup::backup_read,
            backup::backup_reveal,
            // 记忆文档文件通道（docs/learner-memory-design-2026-09.md §8.20 / D12-A）
            memory_doc::memory_doc_dir,
            memory_doc::memory_doc_save,
            memory_doc::memory_doc_read,
            memory_doc::memory_doc_reveal,
            // UC-11：外部改动探测（读 mtime，不碰 read 的既有契约）
            memory_doc::memory_doc_mtime,
            // RAG 存储层（T6）
            db::commands::db_status,
            // 资料 / 章节（v5 下沉 · D12）
            db::commands::db_list_documents,
            db::commands::db_list_chapters_all,
            db::commands::db_save_documents,
            db::commands::db_save_chapters,
            db::commands::db_delete_document,
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
            db::commands::db_delete_chunks_by_document,
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
            db::commands::db_list_embedding_vectors,
            db::commands::db_delete_embedding,
            db::commands::db_delete_embeddings_by_target,
            // 章译文（v6 · D3 改判：译文持久化 + 整库翻译）
            // ⚠️ 注册遗漏 = 运行时 Command not found（前端 trySqlite 会降级成
            // 「不缓存」，症状是「译文总是重新翻」——比报错难发现）。
            db::commands::db_translation_index,
            db::commands::db_get_translation,
            db::commands::db_save_translation,
            db::commands::db_delete_translation,
            db::commands::db_delete_translations_by_document,
            // 整库清空（replace 导入；⚠️ 注册遗漏 = 运行时 Command not found）
            // v5 起由 db_clear_rag 改名为 db_clear_library（v6 起清 **10** 表，
            // 含 documents / chapters / translations）—— 与前端 `tauri.ts::clearAll`
            // 的调用点同一批改，否则中间态就是运行时 Command not found。
            db::commands::db_clear_library,
            // 网页抓取（docs/url-import-design-2026-10.md §8.1）
            // ⚠️ 本仓库唯一一条**用户任意 URL** 的出网命令：webview 的 fetch 受
            // CORS 约束，任意站点读不到响应体 ⇒ 只能由 Rust 发请求。
            net::fetch_url,
            // 扫描件 OCR（docs/pdf-ocr-design-2026-10.md §5）
            // 图片字节 base64 → macOS Vision 文字识别。无 PDF 知识、无文件 IO、
            // 无网络；页循环与上限在 TS（`import/pdf-ocr.ts`）。
            ocr::ocr_image,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the Personal Learning OS shell");
}
