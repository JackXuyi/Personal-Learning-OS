//! llama-helper 子进程托管:解析二进制路径、spawn、JSON-over-stdio 通信、
//! 空闲回收。通信参考 meetily 的 `summary_engine/sidecar.rs`(MIT),改用
//! tokio 异步进程实现,并串行化单连接读写。

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, Context, Result};
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout};
use tokio::sync::Mutex;

/// 生成超时(单次最长等待;helper 端 15 分钟内通常远早完成)。
const GENERATION_TIMEOUT_SECS: u64 = 900;
/// 向量化超时(本地小模型,单次 16 条远早于生成完成)。
const EMBED_TIMEOUT_SECS: u64 = 300;
/// ping 健康检查超时。
const PING_TIMEOUT_SECS: u64 = 5;
/// 默认空闲回收阈值(与 helper 端兜底一致,可用 env 覆盖)。
pub const DEFAULT_IDLE_TIMEOUT_SECS: u64 = 300;

/// helper 返回的原始向量化结果(维度校验在主应用命令层做,见 commands.rs)。
#[derive(Debug, Clone)]
pub struct EmbedResponse {
    pub dim: usize,
    pub vectors: Vec<Vec<f32>>,
    pub truncated: usize,
}

struct IoState {
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    stdout: Option<BufReader<ChildStdout>>,
    /// 最近活动时间(unix 秒),用于空闲回收。
    last_activity: u64,
}

pub struct Sidecar {
    helper_path: PathBuf,
    io: Mutex<IoState>,
    idle_timeout_secs: u64,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

impl Sidecar {
    /// `helper_path` 由上层解析(见 [`resolve_helper_binary`])。
    pub fn new(helper_path: PathBuf) -> Self {
        let idle_timeout_secs = std::env::var("LLAMA_IDLE_TIMEOUT")
            .ok()
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(DEFAULT_IDLE_TIMEOUT_SECS);
        Self {
            helper_path,
            io: Mutex::new(IoState {
                child: None,
                stdin: None,
                stdout: None,
                last_activity: now_secs(),
            }),
            idle_timeout_secs,
        }
    }

    /// 解析 helper 二进制:
    /// 1. `LLAMA_HELPER_PATH` 环境覆盖;
    /// 2. 开发模式:与当前应用二进制同目录(均在 `target/debug`)的 `llama-helper`;
    /// 3. 生产模式:resource_dir/binaries/llama-helper(externalBin 约定)。
    pub fn resolve_helper_binary(
        resource_dir: Option<&Path>,
    ) -> Result<PathBuf> {
        if let Ok(env_path) = std::env::var("LLAMA_HELPER_PATH") {
            let p = PathBuf::from(env_path);
            if p.exists() {
                return Ok(p);
            }
            return Err(anyhow!("LLAMA_HELPER_PATH set but not found: {}", p.display()));
        }

        // 开发:app 与 helper 都编到同一个 target/<profile>
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                let candidate = dir.join("llama-helper");
                if candidate.exists() {
                    return Ok(candidate);
                }
            }
        }

        if let Some(res_dir) = resource_dir {
            let candidate = res_dir.join("binaries").join("llama-helper");
            if candidate.exists() {
                return Ok(candidate);
            }
        }

        Err(anyhow!(
            "llama-helper binary not found. Build it first: cargo build -p llama-helper (dev) \
             or place it under binaries/llama-helper-<target-triple> (production bundle)."
        ))
    }

    /// helper 二进制路径(诊断用)。
    pub fn helper_path(&self) -> &Path {
        &self.helper_path
    }

    fn touch(io: &mut IoState) {
        io.last_activity = now_secs();
    }

    /// 确保子进程存活(spawn 或重启)。
    async fn ensure_locked(io: &mut IoState, helper_path: &Path) -> Result<()> {
        if let Some(child) = io.child.as_mut() {
            match child.try_wait() {
                Ok(Some(_)) => {
                    // 进程已退出 → 重建
                    io.child = None;
                    io.stdin = None;
                    io.stdout = None;
                }
                Ok(None) => return Ok(()), // 存活
                Err(e) => {
                    return Err(anyhow!("helper try_wait failed: {e}"));
                }
            }
        }

        let mut child = tokio::process::Command::new(helper_path)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .with_context(|| format!("spawn llama-helper at {}", helper_path.display()))?;

        io.stdin = Some(child.stdin.take().context("take helper stdin")?);
        io.stdout = Some(BufReader::new(child.stdout.take().context("take helper stdout")?));
        io.child = Some(child);
        Ok(())
    }

    /// 写一行 JSON 请求 + 读一行 JSON 响应。**必须在串行临界区内调用**
    /// (helper 为同步单连接,并发读写会串包)。
    async fn request_raw(
        &self,
        io: &mut IoState,
        request_json: &str,
        timeout_secs: u64,
        timeout_hint: &str,
    ) -> Result<Value> {
        let stdin = io.stdin.as_mut().context("helper stdin missing")?;
        stdin
            .write_all(request_json.as_bytes())
            .await
            .context("write request")?;
        stdin.write_all(b"\n").await.context("write newline")?;
        stdin.flush().await.context("flush stdin")?;

        let stdout = io.stdout.as_mut().context("helper stdout missing")?;
        let mut line = String::new();
        tokio::time::timeout(
            Duration::from_secs(timeout_secs),
            stdout.read_line(&mut line),
        )
        .await
        .with_context(|| format!("{timeout_hint} timed out waiting for helper response"))?
        .context("read helper response")?;

        if line.is_empty() {
            return Err(anyhow!("llama-helper exited before responding"));
        }
        serde_json::from_str(line.trim()).context("parse helper response JSON")
    }

    /// 生成文本:串行临界区内写请求并读回完整响应(helper 为同步单连接)。
    pub async fn generate(&self, request_json: String) -> Result<String> {
        let mut io = self.io.lock().await;
        Self::ensure_locked(&mut io, &self.helper_path).await?;
        Self::touch(&mut io);

        let value = self
            .request_raw(&mut io, &request_json, GENERATION_TIMEOUT_SECS, "generation")
            .await?;
        Self::touch(&mut io);

        match value.get("type").and_then(|t| t.as_str()) {
            Some("response") => {
                if let Some(err) = value.get("error").and_then(|e| e.as_str()) {
                    if !err.is_empty() {
                        return Err(anyhow!("llama-helper: {err}"));
                    }
                }
                value
                    .get("text")
                    .and_then(|t| t.as_str())
                    .map(|s| s.to_string())
                    .ok_or_else(|| anyhow!("helper response missing text"))
            }
            Some("error") => Err(anyhow!(
                "llama-helper error: {}",
                value
                    .get("message")
                    .and_then(|m| m.as_str())
                    .unwrap_or("unknown")
            )),
            other => Err(anyhow!(
                "unexpected helper response type: {:?}",
                other.unwrap_or("")
            )),
        }
    }

    /// 向量化:与 generate 共用串行临界区,但走独立超时(本地小模型)。
    pub async fn embed(&self, request_json: String) -> Result<EmbedResponse> {
        let mut io = self.io.lock().await;
        Self::ensure_locked(&mut io, &self.helper_path).await?;
        Self::touch(&mut io);

        let value = self
            .request_raw(&mut io, &request_json, EMBED_TIMEOUT_SECS, "embedding")
            .await?;
        Self::touch(&mut io);

        match value.get("type").and_then(|t| t.as_str()) {
            Some("embeddings") => {
                if let Some(err) = value.get("error").and_then(|e| e.as_str()) {
                    if !err.is_empty() {
                        return Err(anyhow!("llama-helper: {err}"));
                    }
                }
                let dim = value.get("dim").and_then(|d| d.as_u64()).unwrap_or(0) as usize;
                let truncated =
                    value.get("truncated").and_then(|d| d.as_u64()).unwrap_or(0) as usize;
                let vectors = value
                    .get("vectors")
                    .and_then(|v| v.as_array())
                    .context("helper embeddings response missing vectors")?
                    .iter()
                    .map(|row| {
                        row.as_array()
                            .map(|cells| {
                                cells
                                    .iter()
                                    .map(|c| c.as_f64().unwrap_or(0.0) as f32)
                                    .collect::<Vec<f32>>()
                            })
                            .context("embedding row must be an array")
                    })
                    .collect::<Result<Vec<Vec<f32>>>>()?;
                Ok(EmbedResponse { dim, vectors, truncated })
            }
            Some("error") => Err(anyhow!(
                "llama-helper error: {}",
                value
                    .get("message")
                    .and_then(|m| m.as_str())
                    .unwrap_or("unknown")
            )),
            other => Err(anyhow!(
                "unexpected helper response type: {:?}",
                other.unwrap_or("")
            )),
        }
    }

    /// 健康检查。
    pub async fn ping(&self) -> bool {
        let mut io = self.io.lock().await;
        if Self::ensure_locked(&mut io, &self.helper_path).await.is_err() {
            return false;
        }
        Self::touch(&mut io);

        let write_ok = async {
            let stdin = io.stdin.as_mut()?;
            stdin.write_all(b"{\"type\":\"ping\"}\n").await.ok()?;
            stdin.flush().await.ok()
        }
        .await;
        if write_ok.is_none() {
            return false;
        }

        let line = tokio::time::timeout(
            Duration::from_secs(PING_TIMEOUT_SECS),
            async {
                let stdout = io.stdout.as_mut()?;
                let mut line = String::new();
                stdout.read_line(&mut line).await.ok()?;
                Some(line)
            },
        )
        .await;

        match line {
            Ok(Some(l)) if l.contains("\"pong\"") => {
                Self::touch(&mut io);
                true
            }
            _ => false,
        }
    }

    /// 是否已超过空闲阈值(由 idle reaper 调用)。
    pub async fn is_idle(&self) -> bool {
        let io = self.io.lock().await;
        if io.child.is_none() {
            return false; // 未启动无需回收
        }
        now_secs().saturating_sub(io.last_activity) > self.idle_timeout_secs
    }

    /// 空闲回收:发送 shutdown 并等待退出。
    pub async fn shutdown(&self) {
        let mut io = self.io.lock().await;
        if io.child.is_none() {
            return;
        }
        if let Some(stdin) = io.stdin.as_mut() {
            let _ = stdin.write_all(b"{\"type\":\"shutdown\"}\n").await;
            let _ = stdin.flush().await;
        }
        if let Some(child) = io.child.as_mut() {
            let _ = child.wait().await;
        }
        io.child = None;
        io.stdin = None;
        io.stdout = None;
    }
}
