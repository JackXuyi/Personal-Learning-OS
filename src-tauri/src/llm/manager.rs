//! 模型生命周期管理:扫描磁盘状态、带进度下载(双镜像)、删除、取消。
//!
//! 参考 meetily 的 `model_manager.rs`(MIT),差异:不依赖数据库(学习系统
//! 无 DB),一切以磁盘 `scan_models` 为准;下载经进度回调上抛,由命令层
//! 转发为 Tauri 事件。

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;

use anyhow::{anyhow, Context, Result};
use futures_util::StreamExt;
use serde::Serialize;
use tokio::sync::RwLock;

use super::models::{get_available_models, get_model_by_name, get_models_directory, ModelDef};

/// 下载进度(字节/百分比/MB/s),经回调上抛到命令层转发事件。
#[derive(Debug, Clone, Copy, Serialize)]
pub struct DownloadProgress {
    pub percent: u8,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub mbps: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ModelStatus {
    /// 尚未下载。
    NotFound,
    /// 下载中。
    Downloading { percent: u8 },
    /// 已就绪。
    Ready,
    /// 文件损坏或大小不符,需重新下载。
    Corrupted,
}

#[derive(Debug, Clone, Serialize)]
pub struct ModelInfo {
    pub name: String,
    pub display_name: String,
    pub approx_bytes: u64,
    pub context_size: u32,
    pub status: ModelStatus,
    pub description: String,
}

pub type ProgressCallback = Box<dyn Fn(DownloadProgress) + Send + Sync>;

pub struct ModelManager {
    models_dir: PathBuf,
    /// 正在下载的模型名(防并发重复下载)。
    active: Arc<RwLock<HashSet<String>>>,
    /// 取消标记:当前要取消下载的模型名。
    cancel: Arc<RwLock<Option<String>>>,
}

impl ModelManager {
    /// 以 app_data_dir 为根创建管理器(目录不存在则创建)。
    pub fn new(app_data_dir: &Path) -> Result<Self> {
        let models_dir = get_models_directory(app_data_dir);
        std::fs::create_dir_all(&models_dir)
            .with_context(|| format!("create models dir {}", models_dir.display()))?;
        Ok(Self {
            models_dir,
            active: Arc::new(RwLock::new(HashSet::new())),
            cancel: Arc::new(RwLock::new(None)),
        })
    }

    /// 供独立工具/测试使用:以平台数据目录兜底。
    #[allow(dead_code)]
    pub fn new_with_default_dir() -> Result<Self> {
        let dir = dirs::data_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("personal-learning-os");
        Self::new(&dir)
    }

    #[allow(dead_code)]
    pub fn models_dir(&self) -> &Path {
        &self.models_dir
    }

    fn file_path(&self, model: &ModelDef) -> PathBuf {
        self.models_dir.join(&model.gguf_file)
    }

    fn part_path(&self, model: &ModelDef) -> PathBuf {
        self.models_dir.join(format!("{}.part", model.gguf_file))
    }

    /// 扫描清单中每个模型的磁盘状态。
    pub async fn scan_models(&self) -> Vec<ModelInfo> {
        let active = self.active.read().await;
        let mut out = Vec::new();
        for def in get_available_models() {
            let path = self.file_path(&def);
            let status = if active.contains(&def.name) {
                ModelStatus::Downloading { percent: 0 }
            } else if let Ok(meta) = std::fs::metadata(&path) {
                // 就绪判定:文件存在且不小于预期体积的 80%
                if meta.len() >= def.approx_bytes * 8 / 10 {
                    ModelStatus::Ready
                } else {
                    ModelStatus::Corrupted
                }
            } else {
                ModelStatus::NotFound
            };
            out.push(ModelInfo {
                name: def.name,
                display_name: def.display_name,
                approx_bytes: def.approx_bytes,
                context_size: def.context_size,
                status,
                description: def.description,
            });
        }
        out
    }

    /// 是否已就绪(命令层生成前校验)。
    pub async fn is_model_ready(&self, name: &str) -> bool {
        let Some(def) = get_model_by_name(name) else {
            return false;
        };
        std::fs::metadata(self.file_path(&def))
            .map(|m| m.len() >= def.approx_bytes * 8 / 10)
            .unwrap_or(false)
    }

    /// 模型 GGUF 的绝对路径(供 generate 请求携带给 helper)。
    pub fn path_of(&self, name: &str) -> Option<PathBuf> {
        let def = get_model_by_name(name)?;
        Some(self.file_path(&def))
    }

    /// 流式下载模型。`on_progress` 每块上报进度;双镜像 404/失败自动切换。
    /// 下载过程写入 `.part`,成功后原子改名;取消/失败均清理残片。
    pub async fn download(
        &self,
        model_name: &str,
        on_progress: ProgressCallback,
    ) -> Result<()> {
        let def = get_model_by_name(model_name)
            .ok_or_else(|| anyhow!("unknown model: {model_name}"))?;

        {
            let mut active = self.active.write().await;
            if !active.insert(def.name.clone()) {
                return Err(anyhow!("model is already being downloaded"));
            }
            let mut cancel = self.cancel.write().await;
            *cancel = None;
        }
        let _guard = ActiveGuard {
            active: self.active.clone(),
            name: def.name.clone(),
        };

        // 已存在且完整 → 跳过
        let target = self.file_path(&def);
        if let Ok(meta) = std::fs::metadata(&target) {
            if meta.len() >= def.approx_bytes * 8 / 10 {
                on_progress(DownloadProgress {
                    percent: 100,
                    downloaded_bytes: def.approx_bytes,
                    total_bytes: def.approx_bytes,
                    mbps: 0.0,
                });
                return Ok(());
            }
        }

        let part = self.part_path(&def);
        let _ = std::fs::remove_file(&part); // 清理上次中断残片

        let client = reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(30))
            .build()
            .context("build http client")?;

        let mut last_error: Option<String> = None;
        let mut downloaded: u64 = 0;
        let started = Instant::now();

        // 双镜像依次尝试;仅对"源不可用"(404/403/连接失败)切源
        for url in &def.mirrors {
            let resp = client.get(url).send().await;
            let resp = match resp {
                Ok(r) if r.status().is_success() => r,
                Ok(r) => {
                    last_error = Some(format!("{} -> HTTP {}", url, r.status()));
                    continue;
                }
                Err(e) => {
                    last_error = Some(format!("{} -> {e}", url));
                    continue;
                }
            };

            // 目标总大小(Content-Length 可能缺失,缺失则用 approx_bytes 兜底)
            let total = resp
                .content_length()
                .unwrap_or(def.approx_bytes);
            let total = total.max(1);

            let mut file = tokio::fs::File::create(&part).await.context("create .part")?;
            let mut stream = resp.bytes_stream();
            let mut last_report = Instant::now();

            while let Some(chunk) = stream.next().await {
                // 取消检查
                if self.cancel.read().await.as_deref() == Some(def.name.as_str()) {
                    drop(file);
                    let _ = std::fs::remove_file(&part);
                    let mut cancel = self.cancel.write().await;
                    *cancel = None;
                    return Err(anyhow!("download cancelled"));
                }
                let chunk = chunk.context("read download stream")?;
                downloaded += chunk.len() as u64;
                tokio::io::AsyncWriteExt::write_all(&mut file, &chunk)
                    .await
                    .context("write .part")?;

                if last_report.elapsed().as_millis() >= 200 {
                    let elapsed = started.elapsed().as_secs_f64().max(0.001);
                    on_progress(DownloadProgress {
                        percent: ((downloaded as f64 / total as f64) * 100.0) as u8,
                        downloaded_bytes: downloaded,
                        total_bytes: total,
                        mbps: downloaded as f64 / 1024.0 / 1024.0 / elapsed,
                    });
                    last_report = Instant::now();
                }
            }
            drop(file);

            // 完成完整性粗校验后改名
            if downloaded < def.approx_bytes * 8 / 10 {
                let _ = std::fs::remove_file(&part);
                return Err(anyhow!(
                    "downloaded size {}B is far below expected ~{}B (source may be truncated)",
                    downloaded,
                    def.approx_bytes
                ));
            }
            std::fs::rename(&part, &target).context("finalize download (rename .part)")?;
            on_progress(DownloadProgress {
                percent: 100,
                downloaded_bytes: downloaded,
                total_bytes: total,
                mbps: 0.0,
            });
            return Ok(());
        }

        Err(anyhow!(
            "all mirrors failed: {}",
            last_error.unwrap_or_else(|| "no mirror attempted".into())
        ))
    }

    /// 请求取消某模型的下载。
    pub async fn request_cancel(&self, model_name: &str) {
        let mut cancel = self.cancel.write().await;
        *cancel = Some(model_name.to_string());
    }

    /// 删除模型文件(含 .part 残片)。
    pub async fn delete(&self, model_name: &str) -> Result<()> {
        let def = get_model_by_name(model_name)
            .ok_or_else(|| anyhow!("unknown model: {model_name}"))?;
        let mut removed = false;
        for p in [self.file_path(&def), self.part_path(&def)] {
            if p.exists() {
                std::fs::remove_file(&p)
                    .with_context(|| format!("remove {}", p.display()))?;
                removed = true;
            }
        }
        if removed {
            Ok(())
        } else {
            Err(anyhow!("model file not found"))
        }
    }
}

/// Drop 时自动从 active 集合移除(避免并发下载锁泄漏)。
struct ActiveGuard {
    active: Arc<RwLock<HashSet<String>>>,
    name: String,
}

impl Drop for ActiveGuard {
    fn drop(&mut self) {
        let active = self.active.clone();
        let name = self.name.clone();
        tauri::async_runtime::spawn(async move {
            active.write().await.remove(&name);
        });
    }
}
