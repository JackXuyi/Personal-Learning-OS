//! llm 命令面:模型管理(list/download/cancel/delete)与生成(generate)。

use std::sync::Arc;

use serde::Deserialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, State};

use super::manager::{
    block_reason_if_unsupported, current_device, DownloadProgress, ModelInfo, ModelManager,
};
use super::models::{
    get_default_model, get_model_by_name, render_prompt, ChatMessage, ChatRole, ModelDef,
    SamplingParams,
};
use super::sidecar::Sidecar;

/// 下载进度事件名(前端经 `@tauri-apps/api/event` 监听)。
pub const DOWNLOAD_PROGRESS_EVENT: &str = "llm://download-progress";

/// 汇总的应用状态,由 `lib.rs` setup 创建并 `manage`。
pub struct LlmState {
    pub manager: Arc<ModelManager>,
    pub sidecar: Arc<Sidecar>,
}

/// 前端传来的消息(与 src/ai/types.ts 的 ChatMessage 对应)。
#[derive(Debug, Deserialize)]
pub struct JsonChatMessage {
    #[serde(rename = "role")]
    pub role: String,
    #[serde(rename = "content")]
    pub content: String,
}

#[derive(Debug, Deserialize)]
pub struct GenerateRequest {
    /// 模型名,如 "qwen3.5:4b"。
    #[serde(rename = "model")]
    pub model: String,
    #[serde(rename = "messages")]
    pub messages: Vec<JsonChatMessage>,
    #[serde(rename = "maxTokens")]
    pub max_tokens: Option<i32>,
    /// 覆盖模型预设温度(结构化/JSON 调用传 0.1~0.3;缺省用模型预设)。
    #[serde(rename = "temperature")]
    pub temperature: Option<f32>,
    /// 采样预设名:"tight" → `SamplingParams::tight_structured()`(近贪心,
    /// 供 JSON 结构化输出);未知/缺省回落模型自带预设。
    #[serde(rename = "samplingPreset")]
    pub sampling_preset: Option<String>,
}

/// 输出上限兜底。原 2048 会在概念抽取这类长 JSON(单章 6~14 条概念,一条
/// 150~250 token)中途截断,导致解析层拿到不闭合的 JSON —— 提至 4096。
const DEFAULT_MAX_TOKENS: i32 = 4096;

/// 纯函数:按请求解析出本次生成实际使用的采样参数(采样唯一真源)。
///
/// 优先级:① `sampling_preset == "tight"` → `tight_structured()`,否则模型
/// 自带预设;② 请求显式带 `temperature`(有限值)→ 覆盖基线温度,其余参数
/// (top_k / penalty 等)仍取基线。可脱离模型文件单测。
pub fn resolve_sampling(def: &ModelDef, request: &GenerateRequest) -> SamplingParams {
    let mut sampling = match request.sampling_preset.as_deref() {
        Some("tight") => SamplingParams::tight_structured(),
        _ => def.sampling.clone(),
    };
    if let Some(t) = request.temperature {
        // 与 helper 侧清洗口径一致:非有限值忽略,负温度按 0(贪心解码)。
        if t.is_finite() {
            sampling.temperature = t.max(0.0);
        }
    }
    sampling
}

#[tauri::command]
pub async fn llm_list_models(state: State<'_, LlmState>) -> Result<Vec<ModelInfo>, String> {
    Ok(state.manager.scan_models().await)
}

#[tauri::command]
pub async fn llm_download(
    app: AppHandle,
    state: State<'_, LlmState>,
    model: String,
) -> Result<(), String> {
    if get_model_by_name(&model).is_none() {
        return Err(format!("unknown model: {model}"));
    }
    // 设备匹配纵深防御(Q1):本机不支持的档位拒绝下载。
    if let Some(reason) = block_reason_if_unsupported(&model) {
        return Err(format!("model '{model}' is not supported on this device: {reason}"));
    }
    let manager = state.manager.clone();
    let app = app.clone();
    let model_name = model.clone();

    manager
        .download(
            &model,
            Box::new(move |p: DownloadProgress| {
                let _ = app.emit(
                    DOWNLOAD_PROGRESS_EVENT,
                    json!({ "model": model_name, "percent": p.percent, "downloadedBytes": p.downloaded_bytes, "totalBytes": p.total_bytes, "mbps": p.mbps }),
                );
            }),
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn llm_cancel_download(state: State<'_, LlmState>, model: String) -> Result<(), String> {
    state.manager.request_cancel(&model).await;
    Ok(())
}

#[tauri::command]
pub async fn llm_delete(state: State<'_, LlmState>, model: String) -> Result<(), String> {
    state.manager.delete(&model).await.map_err(|e| e.to_string())
}

/// 生成文本。模型未就绪 / helper 不可用 / 推理失败均返回人类可读错误。
#[tauri::command]
pub async fn llm_generate(
    state: State<'_, LlmState>,
    request: GenerateRequest,
) -> Result<String, String> {
    // 1. 模型存在、设备支持且已下载
    let def = get_model_by_name(&request.model)
        .ok_or_else(|| format!("unknown model: {}", request.model))?;
    if let Some(reason) = block_reason_if_unsupported(&request.model) {
        return Err(format!(
            "model '{}' is not supported on this device: {reason}",
            request.model
        ));
    }
    if !state.manager.is_model_ready(&request.model).await {
        return Err(format!(
            "model '{}' is not downloaded yet. Call llm_download first.",
            request.model
        ));
    }
    let model_path = state
        .manager
        .path_of(&request.model)
        .ok_or_else(|| "model path unavailable".to_string())?;
    let model_path_str = model_path.to_string_lossy().to_string();

    // 2. 消息 → 单条 prompt(模板/转义在 models.rs)
    let messages: Vec<ChatMessage> = request
        .messages
        .iter()
        .map(|m| ChatMessage {
            role: match m.role.as_str() {
                "system" => ChatRole::System,
                "user" => ChatRole::User,
                "assistant" => ChatRole::Assistant,
                _ => ChatRole::User, // 未知角色按 user 处理,避免丢内容
            },
            content: m.content.clone(),
        })
        .collect();
    if messages.is_empty() {
        return Err("messages must not be empty".to_string());
    }
    let prompt = render_prompt(&messages);

    // 3. 组装 generate 请求(采样按请求解析:preset/温度覆盖 → 模型预设)
    let sampling = resolve_sampling(&def, &request);
    let request_json = json!({
        "type": "generate",
        "prompt": prompt,
        "max_tokens": request.max_tokens.unwrap_or(DEFAULT_MAX_TOKENS),
        "context_size": def.context_size,
        "model_path": model_path_str,
        "temperature": sampling.temperature,
        "top_k": sampling.top_k,
        "top_p": sampling.top_p,
        "presence_penalty": sampling.presence_penalty,
        "frequency_penalty": sampling.frequency_penalty,
        "repeat_penalty": sampling.repeat_penalty,
        "penalty_last_n": sampling.penalty_last_n,
        "stop_tokens": &sampling.stop_tokens,
    })
    .to_string();

    // 4. helper 推理
    state.sidecar.generate(request_json).await.map_err(|e| e.to_string())
}

/// 供设置页展示默认模型名。
#[tauri::command]
pub async fn llm_default_model() -> String {
    get_default_model().name
}

/// 供设置页/诊断使用:当前 helper 是否健康 + 设备能力(返回错误则说明不可用)。
#[tauri::command]
pub async fn llm_status(state: State<'_, LlmState>) -> Result<serde_json::Value, String> {
    let ready = state.sidecar.ping().await;
    let def = get_default_model();
    let device = current_device();
    let device_json = serde_json::to_value(&device).map_err(|e| e.to_string())?;
    Ok(json!({
        "helper_ready": ready,
        "default_model": def.name,
        "helper_path": state.sidecar.helper_path().to_string_lossy(),
        "device": device_json,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 构造一个最小 GenerateRequest(仅填采样相关字段)。
    fn req(temperature: Option<f32>, preset: Option<&str>, max_tokens: Option<i32>) -> GenerateRequest {
        GenerateRequest {
            model: "qwen3.5:4b".into(),
            messages: vec![],
            max_tokens,
            temperature,
            sampling_preset: preset.map(|s| s.to_string()),
        }
    }

    #[test]
    fn default_uses_model_preset() {
        let def = get_default_model();
        let s = resolve_sampling(&def, &req(None, None, None));
        assert_eq!(s.temperature, def.sampling.temperature); // qwen35_summary = 0.5
        assert_eq!(s.presence_penalty, 0.3);
        assert_eq!(s.repeat_penalty, 1.05);
    }

    #[test]
    fn tight_preset_drops_penalties() {
        let def = get_default_model();
        let s = resolve_sampling(&def, &req(None, Some("tight"), None));
        assert_eq!(s.temperature, 0.1);
        assert_eq!(s.presence_penalty, 0.0);
        assert_eq!(s.frequency_penalty, 0.0);
        assert_eq!(s.repeat_penalty, 1.0);
        assert_eq!(s.penalty_last_n, 0);
    }

    #[test]
    fn explicit_temperature_overrides_preset() {
        let def = get_default_model();
        let s = resolve_sampling(&def, &req(Some(0.2), Some("tight"), None));
        assert!((s.temperature - 0.2).abs() < f32::EPSILON);
        // 其余采样参数仍取 tight 预设,不受温度覆盖影响。
        assert_eq!(s.presence_penalty, 0.0);
        assert_eq!(s.penalty_last_n, 0);
    }

    #[test]
    fn unknown_preset_and_non_finite_temperature_fall_back() {
        let def = get_default_model();
        // 未知预设 → 回落模型自带预设,不报错。
        let s = resolve_sampling(&def, &req(None, Some("nope"), None));
        assert_eq!(s.temperature, def.sampling.temperature);
        // 非有限温度(NaN)被忽略 → 仍为模型预设。
        let s = resolve_sampling(&def, &req(Some(f32::NAN), None, None));
        assert_eq!(s.temperature, def.sampling.temperature);
    }

    #[test]
    fn default_max_tokens_budget() {
        // 兜底值必须大于 2048:概念抽取的长 JSON 曾在 2048 被截断。
        assert!(DEFAULT_MAX_TOKENS > 2048);
        assert_eq!(DEFAULT_MAX_TOKENS, 4096);
    }
}
