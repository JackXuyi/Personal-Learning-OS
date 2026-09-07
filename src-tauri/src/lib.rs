/// Rust shell for the Personal Learning OS desktop app (Tauri v2).
///
/// Phase 0: the shell only reports app status. Native commands (file dialogs,
/// SQLite-backed storage, provider process spawning) land in later phases —
/// the JS layer already routes every I/O capability through adapters, so the
/// shell stays thin.
use serde_json::json;

/// Minimal health probe the webview can invoke via `invoke("app_status")`.
#[tauri::command]
fn app_status() -> serde_json::Value {
    json!({
        "status": "ok",
        "phase": "foundation-scaffold",
        "desktop": true,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![app_status])
        .run(tauri::generate_context!())
        .expect("error while running the Personal Learning OS shell");
}
