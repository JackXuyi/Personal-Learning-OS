//! llama-helper —— Personal Learning OS 的本地 LLM 推理 sidecar。
//!
//! 主应用以子进程方式 spawn 本二进制,通过 **JSON over stdin/stdout**
//! (每行一条消息)通信:不占用端口、无鉴权问题。空闲回收由主应用侧
//! 的 idle 循环发送 `shutdown` 完成;本进程内置超时作为兜底。
//!
//! 协议、模型常驻缓存(ModelState)、VRAM 检测与 GPU 层数计算、采样清洗
//! 均参考 meetily(Zackriya-Solutions/meetily,MIT)的 llama-helper 移植,
//! 详见 docs/local-llm-loading-plan-2026-09.md。
//!
//! 构建(Apple Silicon 启用 Metal,决策 Q4):
//! ```bash
//! cargo build -p llama-helper --release -F metal
//! ```

use std::io::{self, BufRead, Write};
use std::num::NonZeroU32;
use std::path::PathBuf;
use std::pin::pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result};
use encoding_rs;
use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{AddBos, LlamaModel};
use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Protocol(JSON over stdin/stdout,每行一条)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Request {
    /// 生成文本。采样参数全部可选——缺省由 helper 给保守默认值。
    Generate {
        prompt: String,
        #[serde(default)]
        max_tokens: Option<i32>,
        #[serde(default)]
        context_size: Option<u32>,
        #[serde(default)]
        model_path: Option<String>,
        #[serde(default)]
        temperature: Option<f32>,
        #[serde(default)]
        top_k: Option<i32>,
        #[serde(default)]
        top_p: Option<f32>,
        #[serde(default)]
        presence_penalty: Option<f32>,
        #[serde(default)]
        frequency_penalty: Option<f32>,
        #[serde(default)]
        repeat_penalty: Option<f32>,
        #[serde(default)]
        penalty_last_n: Option<i32>,
        #[serde(default)]
        stop_tokens: Option<Vec<String>>,
    },
    /// 健康检查(主应用周期性发送)。
    Ping,
    /// 优雅退出(空闲回收时由主应用发送)。
    Shutdown,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Response {
    /// 生成结果。`error` 为 Some 时表示本次生成失败,`text` 为空。
    Response { text: String, error: Option<String> },
    Pong,
    Goodbye,
    Error { message: String },
}

// ---------------------------------------------------------------------------
// 采样配置:清洗非法值,`temperature <= 0` 走贪心解码
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq)]
struct SamplingConfig {
    temperature: f32,
    top_k: i32,
    top_p: f32,
    presence_penalty: f32,
    frequency_penalty: f32,
    repeat_penalty: f32,
    penalty_last_n: i32,
}

impl SamplingConfig {
    fn from_request(
        temperature: Option<f32>,
        top_k: Option<i32>,
        top_p: Option<f32>,
        presence_penalty: Option<f32>,
        frequency_penalty: Option<f32>,
        repeat_penalty: Option<f32>,
        penalty_last_n: Option<i32>,
    ) -> Self {
        let temperature = temperature.unwrap_or(1.0);
        let temperature = if temperature.is_finite() {
            temperature.max(0.0)
        } else {
            0.0
        };
        let top_k = top_k.unwrap_or(64).max(1);
        let top_p = top_p.unwrap_or(0.95);
        let top_p = if top_p.is_finite() && top_p > 0.0 && top_p <= 1.0 {
            top_p
        } else {
            1.0
        };
        let presence_penalty = presence_penalty.unwrap_or(0.0);
        let presence_penalty = if presence_penalty.is_finite() {
            presence_penalty.max(0.0)
        } else {
            0.0
        };
        let frequency_penalty = frequency_penalty.unwrap_or(0.0);
        let frequency_penalty = if frequency_penalty.is_finite() {
            frequency_penalty.max(0.0)
        } else {
            0.0
        };
        let repeat_penalty = repeat_penalty.unwrap_or(1.0);
        let repeat_penalty = if repeat_penalty.is_finite() && repeat_penalty > 0.0 {
            repeat_penalty
        } else {
            1.0
        };
        let penalty_last_n = penalty_last_n.unwrap_or(0).max(0);

        Self {
            temperature,
            top_k,
            top_p,
            presence_penalty,
            frequency_penalty,
            repeat_penalty,
            penalty_last_n,
        }
    }

    fn uses_penalties(&self) -> bool {
        self.penalty_last_n > 0
            && (self.presence_penalty > 0.0
                || self.frequency_penalty > 0.0
                || (self.repeat_penalty - 1.0).abs() > f32::EPSILON)
    }
}

// ---------------------------------------------------------------------------
// VRAM 检测与 GPU 卸载层数估算
// ---------------------------------------------------------------------------

/// 估算可用显存(GB)。
fn detect_vram_gb() -> f32 {
    #[cfg(feature = "metal")]
    {
        if let Some(vram) = detect_metal_vram() {
            eprintln!("Metal VRAM detected: {:.2} GB", vram);
            return vram;
        }
    }
    #[cfg(feature = "cuda")]
    {
        if let Some(vram) = detect_cuda_vram() {
            eprintln!("CUDA VRAM detected: {:.2} GB", vram);
            return vram;
        }
    }
    // TODO: Vulkan VRAM detection
    eprintln!("VRAM detection not available, using conservative estimate");
    4.0 // 保守回退
}

#[cfg(feature = "metal")]
fn detect_metal_vram() -> Option<f32> {
    // Apple Silicon 统一内存:约 60% 系统内存可被 GPU 使用
    let output = std::process::Command::new("sysctl")
        .arg("hw.memsize")
        .output()
        .ok()?;
    let stdout = String::from_utf8(output.stdout).ok()?;
    let bytes = stdout.split(':').nth(1)?.trim().parse::<u64>().ok()?;
    Some(bytes as f32 / (1024.0 * 1024.0 * 1024.0) * 0.6)
}

#[cfg(feature = "cuda")]
fn detect_cuda_vram() -> Option<f32> {
    let output = std::process::Command::new("nvidia-smi")
        .args(["--query-gpu=memory.free", "--format=csv,noheader,nounits"])
        .output()
        .ok()?;
    let stdout = String::from_utf8(output.stdout).ok()?;
    stdout.trim().parse::<f32>().ok().map(|mb| mb / 1024.0)
}

/// 根据显存、模型文件大小、层数与上下文估算可卸载的 GPU 层数。
fn calculate_gpu_layers(model_path: &PathBuf, model_layers: u32, vram_gb: f32, context_size: u32) -> u32 {
    let file_size_gb = std::fs::metadata(model_path)
        .map(|m| m.len() as f32 / 1024.0 / 1024.0 / 1024.0)
        .unwrap_or(0.0);

    if file_size_gb == 0.0 {
        eprintln!("Could not determine model file size, using CPU only");
        return 0;
    }

    // KV cache 粗估:>2.5GB(7B 级,hidden 4096)约 256MB/1k ctx;
    // 更小的模型(1B 级,hidden 2048)约 128MB/1k ctx
    let kv_per_1k_gb = if file_size_gb > 2.5 { 0.25 } else { 0.12 };
    let total_kv_gb = (context_size as f32 / 1000.0) * kv_per_1k_gb;
    // 为系统/UI 预留 500MB
    let safe_vram = vram_gb - 0.5;

    eprintln!("VRAM Analysis: available={:.2}GB safe={:.2}GB weights={:.2}GB kv({}ctx)={:.2}GB",
        vram_gb, safe_vram, file_size_gb, context_size, total_kv_gb);

    if safe_vram <= 0.0 {
        eprintln!("No safe VRAM available, using CPU only");
        return 0;
    }

    let weight_per_layer = file_size_gb / model_layers as f32;
    let kv_per_layer = total_kv_gb / model_layers as f32;
    let total_per_layer = weight_per_layer + kv_per_layer;
    let safe_layers = (safe_vram / total_per_layer).floor() as u32;
    safe_layers.min(model_layers)
}

/// 默认 GPU 层数:按文件大小粗估层数后调用计算。
fn get_default_gpu_layers(model_path: &PathBuf, context_size: u32) -> u32 {
    let vram = detect_vram_gb();
    let file_size_gb = std::fs::metadata(model_path)
        .map(|m| m.len() as f32 / 1024.0 / 1024.0 / 1024.0)
        .unwrap_or(0.0);
    // 粗估:>2.5GB(7B 级)约 32-35 层;更小模型约 20-28 层
    let estimated_layers = if file_size_gb > 2.5 { 33 } else { 28 };
    calculate_gpu_layers(model_path, estimated_layers, vram, context_size)
}

// ---------------------------------------------------------------------------
// ModelState:模型常驻缓存(M3)——model_path/context 未变则不重载
// ---------------------------------------------------------------------------

struct ModelState {
    backend: LlamaBackend,
    model: Option<LlamaModel>,
    model_path: Option<PathBuf>,
    context_size: u32,
    last_activity: Arc<AtomicU64>,
}

impl ModelState {
    fn new() -> Result<Self> {
        let backend = LlamaBackend::init().context("Failed to init LlamaBackend")?;
        Ok(Self {
            backend,
            model: None,
            model_path: None,
            context_size: 2048,
            last_activity: Arc::new(AtomicU64::new(Self::current_timestamp())),
        })
    }

    fn current_timestamp() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
    }

    fn update_activity(&self) {
        self.last_activity
            .store(Self::current_timestamp(), Ordering::SeqCst);
    }

    fn seconds_since_activity(&self) -> u64 {
        Self::current_timestamp().saturating_sub(self.last_activity.load(Ordering::SeqCst))
    }

    /// 仅当模型路径或上下文长度变化时才重新加载(M3 常驻缓存)。
    fn load_model_if_needed(&mut self, model_path: PathBuf, context_size: u32) -> Result<()> {
        if let Some(ref loaded_path) = self.model_path {
            if loaded_path == &model_path && self.context_size == context_size {
                eprintln!("Model already loaded: {}", model_path.display());
                self.update_activity();
                return Ok(());
            }
        }

        eprintln!("Loading model: {}", model_path.display());
        let gpu_layers = get_default_gpu_layers(&model_path, context_size);
        let model_params = LlamaModelParams::default().with_n_gpu_layers(gpu_layers);
        let model_params = pin!(model_params);

        let model = LlamaModel::load_from_file(&self.backend, model_path.clone(), &model_params)
            .with_context(|| format!("unable to load model at {:?}", model_path))?;

        self.model = Some(model);
        self.model_path = Some(model_path);
        self.context_size = context_size;
        self.update_activity();
        eprintln!("Model loaded successfully ({} GPU layers)", gpu_layers);
        Ok(())
    }

    fn generate(
        &mut self,
        prompt: String,
        max_tokens: i32,
        sampling: SamplingConfig,
        stop_tokens: Vec<String>,
    ) -> Result<String> {
        let start_time = Instant::now();
        let model = self.model.as_ref().context("Model not loaded")?;

        // 保守线程数:max(1, 核数/2 + 2),避免占满 UI/宿主进程
        let threads: i32 = std::thread::available_parallelism()
            .map(|n| ((n.get() as i32 / 2) + 2).max(1))
            .unwrap_or(2);

        let ctx_params = LlamaContextParams::default()
            .with_n_ctx(Some(NonZeroU32::new(self.context_size).context("Invalid ctx size")?))
            .with_n_batch(self.context_size)
            .with_n_threads(threads)
            .with_n_threads_batch(threads);

        let mut ctx = model
            .new_context(&self.backend, ctx_params)
            .context("unable to create the llama_context")?;

        let tokens_list = model
            .str_to_token(&prompt, AddBos::Always)
            .context("failed to tokenize prompt")?;
        eprintln!("Tokenized prompt: {} tokens", tokens_list.len());

        // 上下文容量足够容纳长提示词
        let batch_size = self.context_size as usize;
        let mut batch = LlamaBatch::new(batch_size, 1);

        let last_index: i32 = (tokens_list.len() - 1) as i32;
        for (i, token) in (0_i32..).zip(tokens_list.into_iter()) {
            let is_last = i == last_index;
            batch
                .add(token, i, &[0], is_last)
                .context("Failed to add token to batch")?;
        }

        ctx.decode(&mut batch).context("llama_decode() failed")?;
        let prompt_time = start_time.elapsed();

        let n_prompt_tokens = batch.n_tokens();
        let mut n_cur = n_prompt_tokens;
        let mut decoder = encoding_rs::UTF_8.new_decoder();
        let mut output = String::new();

        eprintln!("Starting generation (max_tokens: {})", max_tokens);

        use llama_cpp_2::sampling::LlamaSampler;

        let seed = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u32;

        // 采样链:temperature<=0 走贪心;penalties 存在时附加在链首
        let sampler = if sampling.temperature <= 0.0 {
            if sampling.uses_penalties() {
                LlamaSampler::chain_simple([
                    LlamaSampler::penalties(
                        sampling.penalty_last_n,
                        sampling.repeat_penalty,
                        sampling.frequency_penalty,
                        sampling.presence_penalty,
                    ),
                    LlamaSampler::greedy(),
                ])
            } else {
                LlamaSampler::chain_simple([LlamaSampler::greedy()])
            }
        } else if sampling.uses_penalties() {
            LlamaSampler::chain_simple([
                LlamaSampler::penalties(
                    sampling.penalty_last_n,
                    sampling.repeat_penalty,
                    sampling.frequency_penalty,
                    sampling.presence_penalty,
                ),
                LlamaSampler::top_k(sampling.top_k),
                LlamaSampler::top_p(sampling.top_p, 1),
                LlamaSampler::temp(sampling.temperature),
                LlamaSampler::dist(seed),
            ])
        } else {
            LlamaSampler::chain_simple([
                LlamaSampler::top_k(sampling.top_k),
                LlamaSampler::top_p(sampling.top_p, 1),
                LlamaSampler::temp(sampling.temperature),
                LlamaSampler::dist(seed),
            ])
        };
        let mut sampler = pin!(sampler);

        loop {
            if (n_cur - n_prompt_tokens) >= max_tokens {
                eprintln!("Reached max_tokens limit");
                break;
            }

            let token = sampler.as_mut().sample(&ctx, batch.n_tokens() - 1);
            sampler.as_mut().accept(token);

            if model.is_eog_token(token) {
                eprintln!("End-of-generation token reached ({} chars)", output.len());
                break;
            }

            // token -> bytes;缓冲区不足时按提示扩容重试
            let output_bytes = match model.token_to_piece_bytes(token, 32, true, None) {
                Err(llama_cpp_2::TokenToStringError::InsufficientBufferSpace(size)) => {
                    let required_size: usize = size
                        .checked_neg()
                        .context("Invalid token piece buffer size")?
                        .try_into()
                        .context("Invalid token piece buffer size")?;
                    model.token_to_piece_bytes(token, required_size, true, None)
                }
                result => result,
            }
            .context("Failed to convert token to bytes")?;

            // 流式 UTF-8 解码(多字节字符跨 token 也能正确拼合)
            let mut token_text = String::with_capacity(32);
            let _ = decoder.decode_to_string(&output_bytes, &mut token_text, false);
            output.push_str(&token_text);

            // 模型/调用方自定义 stop token
            let mut should_stop = false;
            for stop_token in &stop_tokens {
                if output.contains(stop_token) {
                    output = output.replace(stop_token, "").trim_end().to_string();
                    should_stop = true;
                    break;
                }
            }
            if should_stop {
                break;
            }

            batch.clear();
            batch
                .add(token, n_cur, &[0], true)
                .context("Failed to add generated token to batch")?;
            n_cur += 1;
            ctx.decode(&mut batch).context("failed to eval")?;
        }

        let total_time = start_time.elapsed();
        let gen_time = total_time.saturating_sub(prompt_time);
        let output_tokens = (n_cur - n_prompt_tokens) as u64;
        let tokens_per_sec = if gen_time.as_secs_f64() > 0.0 {
            output_tokens as f64 / gen_time.as_secs_f64()
        } else {
            0.0
        };
        eprintln!(
            "Generation stats: prompt={} output={} prompt_time={:.2}s gen={:.2}s speed={:.2} tok/s",
            n_prompt_tokens,
            output_tokens,
            prompt_time.as_secs_f64(),
            gen_time.as_secs_f64(),
            tokens_per_sec
        );

        self.update_activity();
        Ok(output)
    }
}

// ---------------------------------------------------------------------------
// 主循环
// ---------------------------------------------------------------------------

fn send_response(response: &Response) -> Result<()> {
    let json = serde_json::to_string(response)?;
    println!("{json}");
    io::stdout().flush()?;
    Ok(())
}

fn main() -> Result<()> {
    // 空闲兜底超时(默认 5 分钟;真正的空闲回收由主应用侧发送 shutdown)
    let idle_timeout_secs = std::env::var("LLAMA_IDLE_TIMEOUT")
        .ok()
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(300);

    eprintln!("llama-helper starting (idle timeout: {}s)", idle_timeout_secs);

    let mut state = ModelState::new()?;

    let stdin = io::stdin();
    let mut stdin_lock = stdin.lock();
    let mut buffer = String::new();

    loop {
        if state.seconds_since_activity() > idle_timeout_secs {
            eprintln!("Idle timeout reached, shutting down");
            send_response(&Response::Goodbye)?;
            break;
        }

        buffer.clear();
        match stdin_lock.read_line(&mut buffer) {
            Ok(0) => {
                // EOF(stdin 关闭)
                eprintln!("EOF received, shutting down");
                break;
            }
            Ok(_) => {
                let line = buffer.trim();
                if line.is_empty() {
                    continue;
                }

                match serde_json::from_str::<Request>(line) {
                    Ok(Request::Generate {
                        prompt,
                        max_tokens,
                        context_size,
                        model_path,
                        temperature,
                        top_k,
                        top_p,
                        presence_penalty,
                        frequency_penalty,
                        repeat_penalty,
                        penalty_last_n,
                        stop_tokens,
                    }) => {
                        let max_tokens = max_tokens.unwrap_or(512);
                        let context_size = context_size.unwrap_or(2048);

                        let sampling = SamplingConfig::from_request(
                            temperature,
                            top_k,
                            top_p,
                            presence_penalty,
                            frequency_penalty,
                            repeat_penalty,
                            penalty_last_n,
                        );
                        let stop_tokens = stop_tokens.unwrap_or_default();

                        if let Some(path_str) = model_path {
                            let path = PathBuf::from(path_str);
                            if let Err(err) = state.load_model_if_needed(path, context_size) {
                                send_response(&Response::Response {
                                    text: String::new(),
                                    error: Some(format!("Failed to load model: {err}")),
                                })?;
                                continue;
                            }
                        }

                        match state.generate(prompt, max_tokens, sampling, stop_tokens) {
                            Ok(text) => {
                                send_response(&Response::Response { text, error: None })?;
                            }
                            Err(err) => {
                                send_response(&Response::Response {
                                    text: String::new(),
                                    error: Some(format!("Generation failed: {err}")),
                                })?;
                            }
                        }
                    }
                    Ok(Request::Ping) => {
                        state.update_activity();
                        send_response(&Response::Pong)?;
                    }
                    Ok(Request::Shutdown) => {
                        eprintln!("Shutdown requested");
                        send_response(&Response::Goodbye)?;
                        break;
                    }
                    Err(err) => {
                        eprintln!("Failed to parse request: {err}");
                        send_response(&Response::Error {
                            message: format!("Invalid request: {err}"),
                        })?;
                    }
                }
            }
            Err(err) => {
                eprintln!("Error reading stdin: {err}");
                break;
            }
        }
    }

    eprintln!("llama-helper exiting");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- 协议解析 ----

    #[test]
    fn generate_request_parses_snake_case_fields() {
        let json = r#"{"type":"generate","prompt":"你好","max_tokens":128,"context_size":4096,"model_path":"/tmp/q.gguf","temperature":0.5,"top_k":20,"top_p":0.8,"presence_penalty":0.3,"frequency_penalty":0.0,"repeat_penalty":1.05,"penalty_last_n":256,"stop_tokens":["<|im_end|>"]}"#;
        let request: Request = serde_json::from_str(json).expect("should parse");
        match request {
            Request::Generate {
                prompt,
                max_tokens,
                context_size,
                model_path,
                temperature,
                stop_tokens,
                ..
            } => {
                assert_eq!(prompt, "你好");
                assert_eq!(max_tokens, Some(128));
                assert_eq!(context_size, Some(4096));
                assert_eq!(model_path.as_deref(), Some("/tmp/q.gguf"));
                assert_eq!(temperature, Some(0.5));
                assert_eq!(stop_tokens, Some(vec!["<|im_end|>".to_string()]));
            }
            _ => panic!("expected generate"),
        }
    }

    #[test]
    fn generate_request_fields_default_to_none() {
        let request: Request =
            serde_json::from_str(r#"{"type":"generate","prompt":"hi"}"#).expect("should parse");
        match request {
            Request::Generate { max_tokens, .. } => assert_eq!(max_tokens, None),
            _ => panic!("expected generate"),
        }
    }

    #[test]
    fn ping_parses_and_pong_serializes() {
        let request: Request = serde_json::from_str(r#"{"type":"ping"}"#).expect("ping");
        assert!(matches!(request, Request::Ping));
        assert_eq!(serde_json::to_string(&Response::Pong).unwrap(), r#"{"type":"pong"}"#);
    }

    #[test]
    fn shutdown_parses_and_goodbye_serializes() {
        let request: Request = serde_json::from_str(r#"{"type":"shutdown"}"#).expect("shutdown");
        assert!(matches!(request, Request::Shutdown));
        assert_eq!(
            serde_json::to_string(&Response::Goodbye).unwrap(),
            r#"{"type":"goodbye"}"#
        );
    }

    #[test]
    fn unknown_type_is_rejected() {
        let result: Result<Request, _> = serde_json::from_str(r#"{"type":"explode"}"#);
        assert!(result.is_err());
    }

    // ---- 采样清洗(meetily 移植) ----

    #[test]
    fn sampling_defaults_to_sane_values_when_omitted() {
        let s = SamplingConfig::from_request(None, None, None, None, None, None, None);
        assert_eq!(s.temperature, 1.0);
        assert_eq!(s.top_k, 64);
        assert_eq!(s.top_p, 0.95);
        assert!(!s.uses_penalties());
    }

    #[test]
    fn sampling_sanitizes_non_finite_and_out_of_range() {
        let s = SamplingConfig::from_request(
            Some(f32::NAN),
            Some(0),
            Some(2.0),
            Some(-0.5),
            Some(f32::INFINITY),
            Some(0.0),
            Some(-1),
        );
        assert_eq!(s.temperature, 0.0);
        assert_eq!(s.top_k, 1);
        assert_eq!(s.top_p, 1.0);
        assert_eq!(s.presence_penalty, 0.0);
        assert_eq!(s.frequency_penalty, 0.0);
        assert_eq!(s.repeat_penalty, 1.0);
        assert_eq!(s.penalty_last_n, 0);
        assert!(!s.uses_penalties());
    }

    #[test]
    fn sampling_qwen_summary_preset_enables_penalties() {
        // 与主应用 ModelDef 的 qwen35 预设一致
        let s = SamplingConfig::from_request(
            Some(0.5),
            Some(20),
            Some(0.8),
            Some(0.3),
            Some(0.0),
            Some(1.05),
            Some(256),
        );
        assert_eq!(s.temperature, 0.5);
        assert_eq!(s.top_k, 20);
        assert_eq!(s.top_p, 0.8);
        assert!(s.uses_penalties());
    }
}
