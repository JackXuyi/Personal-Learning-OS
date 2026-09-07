//! 本地 LLM(内置推理):模型清单、生命周期管理与 llama-helper sidecar 托管。
//!
//! 设计详见 docs/local-llm-loading-plan-2026-09.md(N0–N4 里程碑)。

pub mod commands;
pub mod manager;
pub mod models;
pub mod sidecar;
