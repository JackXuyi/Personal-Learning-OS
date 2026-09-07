//! llama-helper —— Personal Learning OS 的本地 LLM 推理 sidecar。
//!
//! 主应用以子进程方式 spawn 本二进制,通过 **JSON over stdin/stdout**
//! (每行一条消息)通信,不占用端口、无鉴权问题。协议、模型常驻缓存与
//! GPU 层数计算逻辑参考 meetily(Zackriya-Solutions/meetily,MIT)移植,
//! 详见 docs/local-llm-loading-plan-2026-09.md。
//!
//! N0(本里程碑):协议骨架 + ping/pong 保活 + shutdown。
//! N1:`generate` 接入 llama-cpp-2 实现真正的本地推理。

use std::io::{self, BufRead, Write};

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Protocol messages(JSON over stdin/stdout,每行一条)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Request {
    /// 生成文本。采样参数全部可选——缺省由 helper 端给保守默认值。
    #[allow(dead_code)] // fields consumed once N1 implements Generate
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
    /// 健康检查(主应用周期性发送,判断进程是否存活)。
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

/// 解析失败时回给主应用的错误响应(保持进程存活,便于调用方区分
/// 协议错误与进程崩溃)。
fn error_response(message: &str) -> Response {
    Response::Error {
        message: message.to_string(),
    }
}

fn main() -> io::Result<()> {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut out = stdout.lock();

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(line) => line,
            Err(err) => {
                eprintln!("llama-helper: stdin read error: {err}");
                break;
            }
        };
        if line.trim().is_empty() {
            continue;
        }

        let request: Request = match serde_json::from_str(&line) {
            Ok(request) => request,
            Err(err) => {
                let message = format!("bad request: {err}");
                eprintln!("llama-helper: {message}");
                write_json(&mut out, &error_response(&message))?;
                continue;
            }
        };

        let response = match request {
            Request::Ping => Response::Pong,
            Request::Shutdown => Response::Goodbye,
            Request::Generate { .. } => Response::Response {
                text: String::new(),
                error: Some(
                    "generate is not implemented yet (N1 milestone wires llama-cpp-2)".to_string(),
                ),
            },
        };

        let is_goodbye = matches!(response, Response::Goodbye);
        write_json(&mut out, &response)?;
        if is_goodbye {
            break;
        }
    }
    Ok(())
}

/// 序列化并写出一行 JSON;stdout 关闭(调用方退出)时中断主循环。
fn write_json(out: &mut impl Write, response: &Response) -> io::Result<()> {
    let json = serde_json::to_string(response)
        .map_err(|err| io::Error::new(io::ErrorKind::Other, format!("serialize: {err}")))?;
    writeln!(out, "{json}")?;
    out.flush()
}

#[cfg(test)]
mod tests {
    use super::*;

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
        let json = r#"{"type":"generate","prompt":"hi"}"#;
        let request: Request = serde_json::from_str(json).expect("should parse");
        match request {
            Request::Generate { max_tokens, .. } => assert_eq!(max_tokens, None),
            _ => panic!("expected generate"),
        }
    }

    #[test]
    fn ping_parses_and_pong_serializes() {
        let request: Request = serde_json::from_str(r#"{"type":"ping"}"#).expect("ping");
        assert!(matches!(request, Request::Ping));
        let json = serde_json::to_string(&Response::Pong).unwrap();
        assert_eq!(json, r#"{"type":"pong"}"#);
    }

    #[test]
    fn shutdown_parses_and_goodbye_serializes() {
        let request: Request = serde_json::from_str(r#"{"type":"shutdown"}"#).expect("shutdown");
        assert!(matches!(request, Request::Shutdown));
        let json = serde_json::to_string(&Response::Goodbye).unwrap();
        assert_eq!(json, r#"{"type":"goodbye"}"#);
    }

    #[test]
    fn unknown_type_is_rejected() {
        let result: Result<Request, _> = serde_json::from_str(r#"{"type":"explode"}"#);
        assert!(result.is_err());
    }
}
