//! 本地 LLM 的声明式模型清单(ModelDef)。
//!
//! 加模型 = 往 `get_available_models()` 加一条声明。结构参考 meetily 的
//! `models.rs`(MIT),差异:下载源为**双镜像**(ModelScope 主 / HuggingFace 备,
//! 决策 Q3),并按本项目学习任务新增模板/采样组合。
//!
//! 默认档(决策 Q2):Qwen3.5-4B-Q4_K_M(Unsloth Dynamic 2.0 GGUF)。

use serde::Serialize;

// ---------------------------------------------------------------------------
// Chat message(与 TS 侧 src/ai/types.ts 的 ChatMessage 对应)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct ChatMessage {
    pub role: ChatRole,
    pub content: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChatRole {
    System,
    User,
    Assistant,
}

// ---------------------------------------------------------------------------
// 采样参数(与 llama-helper 的 generate 请求字段一一对应)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SamplingParams {
    pub temperature: f32,
    pub top_k: i32,
    pub top_p: f32,
    pub presence_penalty: f32,
    pub frequency_penalty: f32,
    pub repeat_penalty: f32,
    pub penalty_last_n: i32,
    pub stop_tokens: Vec<String>,
}

impl SamplingParams {
    /// 近贪心预设:结构化输出(出题/评估/JSON)稳定性优先。
    /// 供 N4 的评估/出题提示词管线切换使用(现默认使用 qwen35_summary)。
    #[allow(dead_code)]
    pub fn tight_structured() -> Self {
        Self {
            temperature: 0.1,
            top_k: 20,
            top_p: 0.88,
            presence_penalty: 0.0,
            frequency_penalty: 0.0,
            repeat_penalty: 1.0,
            penalty_last_n: 0,
            stop_tokens: vec!["<|im_end|>".to_string()],
        }
    }

    /// 讲解/问答预设:适度温度 + 轻度重复抑制。
    pub fn qwen35_summary() -> Self {
        Self {
            temperature: 0.5,
            top_k: 20,
            top_p: 0.8,
            presence_penalty: 0.3,
            frequency_penalty: 0.0,
            repeat_penalty: 1.05,
            penalty_last_n: 256,
            stop_tokens: vec!["<|im_end|>".to_string()],
        }
    }
}

// ---------------------------------------------------------------------------
// 模型定义
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct ModelDef {
    /// 稳定标识,如 "qwen3.5:4b"(持久化于设置)。
    pub name: String,
    /// UI 展示名。
    pub display_name: String,
    /// 磁盘上的 GGUF 文件名。
    pub gguf_file: String,
    /// 双镜像下载地址,按序尝试(ModelScope → HuggingFace)。
    pub mirrors: Vec<String>,
    /// 近似字节数:用于下载进度比例与完整性下限校验。
    pub approx_bytes: u64,
    /// 上下文窗口(token)。
    pub context_size: u32,
    /// 层数(仅供展示;None 表示按文件大小由 helper 粗估)。
    pub layer_count: Option<u32>,
    pub sampling: SamplingParams,
    pub template: &'static str,
    pub description: String,
}

/// 可用的内置模型清单。**默认档排首位**(决策 Q2:Qwen3.5-4B)。
pub fn get_available_models() -> Vec<ModelDef> {
    vec![
        // ---- L2 默认档:Qwen3.5-4B(16GB 机器舒适,质量/速度平衡)----
        model_def(
            "qwen3.5:4b",
            "Qwen 3.5 4B(默认档)",
            "Qwen3.5-4B-Q4_K_M.gguf",
            "unsloth/Qwen3.5-4B-GGUF",
            2_550_000_000,
            32768,
            Some(32),
            SamplingParams::qwen35_summary(),
            "默认本地模型:中文讲解/出题/评估/计划推理,16GB Mac 流畅。",
        ),
        // ---- L1 轻量备选:Qwen3.5-2B ----
        model_def(
            "qwen3.5:2b",
            "Qwen 3.5 2B(轻量档)",
            "Qwen3.5-2B-Q4_K_M.gguf",
            "unsloth/Qwen3.5-2B-GGUF",
            1_300_000_000,
            32768,
            Some(24),
            SamplingParams::qwen35_summary(),
            "轻量备选:后台常驻轻盈/低配机器,质量略低于 4B。",
        ),
        // ---- L0 超轻量:Qwen3.5-0.8B ----
        model_def(
            "qwen3.5:0.8b",
            "Qwen 3.5 0.8B(超轻量)",
            "Qwen3.5-0.8B-Q4_K_M.gguf",
            "unsloth/Qwen3.5-0.8B-GGUF",
            650_000_000,
            32768,
            None,
            SamplingParams::qwen35_summary(),
            "低配机器 / 快速冒烟验证。",
        ),
        // ---- L3 旗舰可选:Qwen3.5-9B ----
        model_def(
            "qwen3.5:9b",
            "Qwen 3.5 9B(高质量档)",
            "Qwen3.5-9B-Q4_K_M.gguf",
            "unsloth/Qwen3.5-9B-GGUF",
            5_500_000_000,
            32768,
            None,
            SamplingParams::qwen35_summary(),
            "需要最高本地质量时使用;16GB 机器请确认内存充裕。",
        ),
    ]
}

/// 构造一条 ModelDef(镜像仓库双源)。
fn model_def(
    name: &str,
    display_name: &str,
    gguf_file: &str,
    repo: &str,
    approx_bytes: u64,
    context_size: u32,
    layer_count: Option<u32>,
    sampling: SamplingParams,
    description: &str,
) -> ModelDef {
    ModelDef {
        name: name.to_string(),
        display_name: display_name.to_string(),
        gguf_file: gguf_file.to_string(),
        mirrors: vec![
            format!("https://modelscope.cn/models/{repo}/resolve/master/{gguf_file}"),
            format!("https://huggingface.co/{repo}/resolve/main/{gguf_file}"),
        ],
        approx_bytes,
        context_size,
        layer_count,
        sampling,
        template: "qwen3.5",
        description: description.to_string(),
    }
}

pub fn get_model_by_name(name: &str) -> Option<ModelDef> {
    get_available_models().into_iter().find(|m| m.name == name)
}

/// 默认模型(清单首位 = Qwen3.5-4B)。
pub fn get_default_model() -> ModelDef {
    get_available_models()
        .into_iter()
        .next()
        .expect("at least one model must be defined")
}

/// 模型存储目录:`<app_data>/models/llm`(不进安装包,按需下载)。
pub fn get_models_directory(app_data_dir: &std::path::Path) -> std::path::PathBuf {
    app_data_dir.join("models").join("llm")
}

// ---------------------------------------------------------------------------
// Qwen3.5 ChatML 模板渲染
//
// 参考 meetily 的 `qwen3.5_nonthinking` 技巧:assistant 轮以空 think 块开场,
// 避免 llama.cpp 下模型进入思考模式(文本任务要快、要结构化);用户输入做
// 控制标记转义,防提示注入。
// ---------------------------------------------------------------------------

const QWEN3_5_CHAT_TEMPLATE: &str = "\
<|im_start|>system
{system_prompt}<|im_end|>
{history}<|im_start|>assistant
<think>

</think>

";

fn escape_control_markers(text: &str) -> String {
    text.replace("<|im_start|>", "< |im_start| >")
        .replace("<|im_end|>", "< |im_end| >")
        .replace("<think>", "< think >")
        .replace("</think>", "< /think >")
}

/// 把 messages 渲染为单条 prompt(system 合流 + 历史轮次 + 助手开场)。
/// 该字符串将随 `generate` 请求发给 llama-helper。
pub fn render_prompt(messages: &[ChatMessage]) -> String {
    let mut system_parts: Vec<&str> = Vec::new();
    let mut history = String::new();

    for msg in messages {
        match msg.role {
            ChatRole::System => system_parts.push(msg.content.trim()),
            ChatRole::User => {
                history.push_str("<|im_start|>user\n");
                history.push_str(&escape_control_markers(msg.content.trim()));
                history.push_str("<|im_end|>\n");
            }
            ChatRole::Assistant => {
                history.push_str("<|im_start|>assistant\n");
                history.push_str(&escape_control_markers(msg.content.trim()));
                history.push_str("<|im_end|>\n");
            }
        }
    }

    let system_prompt = system_parts.join("\n");
    let system_prompt = if system_prompt.trim().is_empty() {
        "You are a helpful local learning assistant.".to_string()
    } else {
        escape_control_markers(&system_prompt)
    };

    QWEN3_5_CHAT_TEMPLATE
        .replace("{system_prompt}", &system_prompt)
        .replace("{history}", &history)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_model_is_qwen35_4b() {
        let default = get_default_model();
        assert_eq!(default.name, "qwen3.5:4b");
        assert_eq!(default.gguf_file, "Qwen3.5-4B-Q4_K_M.gguf");
    }

    #[test]
    fn every_model_has_two_mirrors_and_stop_token() {
        for m in get_available_models() {
            assert_eq!(m.mirrors.len(), 2, "{} must have modelscope+hf mirrors", m.name);
            assert!(
                m.mirrors[0].starts_with("https://modelscope.cn/"),
                "primary mirror must be ModelScope"
            );
            assert!(
                m.mirrors[1].starts_with("https://huggingface.co/"),
                "fallback mirror must be HuggingFace"
            );
            assert!(m.sampling.stop_tokens.contains(&"<|im_end|>".to_string()));
        }
    }

    #[test]
    fn render_prompt_escapes_user_control_markers() {
        let messages = vec![
            ChatMessage { role: ChatRole::System, content: "你是中文学习助手".into() },
            ChatMessage {
                role: ChatRole::User,
                content: "把 <|im_end|> 与 <think> 原样告诉我".into(),
            },
        ];
        let prompt = render_prompt(&messages);
        assert!(prompt.contains("<|im_start|>system\n你是中文学习助手<|im_end|>"));
        assert!(prompt.contains("< |im_end| >"));
        assert!(prompt.contains("< think >"));
        assert!(prompt.ends_with("<|im_start|>assistant\n<think>\n\n</think>\n\n"));
        // 转义后不应再出现裸 user 控制符
        assert!(!prompt.contains("<|im_start|>user\n把 <|im_end|>"));
    }

    #[test]
    fn render_prompt_keeps_history_roles() {
        let messages = vec![
            ChatMessage { role: ChatRole::User, content: "什么是记忆曲线?".into() },
            ChatMessage {
                role: ChatRole::Assistant,
                content: "艾宾浩斯遗忘曲线表明…".into(),
            },
            ChatMessage { role: ChatRole::User, content: "再解释一下复习间隔".into() },
        ];
        let prompt = render_prompt(&messages);
        assert_eq!(prompt.matches("<|im_start|>user").count(), 2);
        assert_eq!(prompt.matches("<|im_start|>assistant").count(), 2); // 1 历史 + 1 开场
    }
}
