//! 扫描件 PDF 的 OCR（F8 范围 2）—— 用 macOS 系统 Vision 框架做**图片 → 文字**。
//! 方案：docs/pdf-ocr-design-2026-10.md §5（D1-A / D2-A）。
//!
//! 职责刻意只有一件事：一段图片字节 → 若干文本行。**没有 PDF 知识、没有文件
//! IO、没有网络**。页循环、页数上限、进度回调节奏全在 TS 侧 `import/pdf-ocr.ts`
//! —— 那里能用假渲染器/假识别器把编排逻辑全部单测覆盖；本模块只保留「调系统
//! 框架」这一件在单测里无法伪造的事（与 `net.rs` 同构）。
//!
//! 为什么是 Vision 而不是 tesseract：免模型、免下载、离线，`zh-Hans` 由系统
//! 直接提供 ⇒ 打包体积零增长。代价是仅 macOS（本仓桌面端只有 macOS）。
//!
//! ⚠️ **能力必须运行时探测**：`tauri.conf.json` 没有 `minimumSystemVersion`
//! （tauri 2 默认 10.15），而 `zh-Hans` 的文字识别自 macOS 11 起才支持。
//! 编译期假定「一定有中文」会让 10.15 用户拿到乱码而不是明确报错，故：
//! ① 类不存在 → `unsupported-os`；② `supportedRecognitionLanguages` 里挑不出
//! 任何目标语言 → `unsupported-language`（不把 Vision 的原始错误抛给上层）。
//!
//! 错误一律是**机器令牌**（`rules/rust.mdc` 的 `Result<T, String>` 字面约定）：
//! 令牌 → 用户文案的映射在 TS 侧 `import/desktop-ocr.ts` + i18n，两侧各自的
//! 单测锁契约。本文件**绝不出现用户可见文案**。

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;

/// 目标识别语言（顺序即优先级）。中英混排是本仓用户的常态（GMP / 培训资料）。
const LANGS: [&str; 2] = ["zh-Hans", "en-US"];

/// 识别结果（`rename_all = "camelCase"` ⇒ TS 侧驼峰；两边同改）。
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrText {
    /// 文本行（`\n` 连接）；行内不做任何规整 —— 折行修复是 TS 侧 `promotePdfHeadings`
    /// 与切分器的职责，这里提前处理只会让两处规则打架。
    text: String,
    /// 非空行数（结果卡排障用）。
    line_count: usize,
}

/// 机器令牌（**绝不含用户文案**）。
fn token(kind: &str) -> String {
    kind.to_string()
}

/// 该行是否有实质内容（纯空白不算）。
fn is_text_line(line: &str) -> bool {
    !line.trim().is_empty()
}

/// 文本行 → 正文：去首尾空白、丢空行、`\n` 连接。
/// 抽成纯函数以便 `cargo test --lib` 覆盖（不依赖图片与系统框架）。
fn join_candidates(lines: &[String]) -> String {
    lines
        .iter()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

/// 识别一张图片里的文字。
///
/// 走 `spawn_blocking`：Vision 是**同步阻塞**调用（单页 0.5–1s），直接在 async
/// 上下文里跑会占住 tokio 的 worker 线程，串行处理 50 页时其它命令全被堵住。
#[tauri::command]
pub async fn ocr_image(bytes_base64: String) -> Result<OcrText, String> {
    tauri::async_runtime::spawn_blocking(move || recognize_blocking(&bytes_base64))
        .await
        .map_err(|_| token("vision-failed"))?
}

#[cfg(target_os = "macos")]
fn recognize_blocking(bytes_base64: &str) -> Result<OcrText, String> {
    use objc2::runtime::{AnyClass, AnyObject};
    use objc2::AnyThread;
    use objc2_foundation::{NSArray, NSData, NSDictionary, NSString};
    use objc2_vision::{
        VNImageOption, VNImageRequestHandler, VNRecognizeTextRequest, VNRequest,
        VNRequestTextRecognitionLevel,
    };

    let bytes = STANDARD
        .decode(bytes_base64)
        .map_err(|_| token("bad-base64"))?;
    if bytes.is_empty() {
        return Err(token("empty-image"));
    }

    // ① 能力探测：类不存在（macOS 10.15 之前的系统）⇒ 明确 unsupported-os。
    if AnyClass::get(c"VNRecognizeTextRequest").is_none() {
        return Err(token("unsupported-os"));
    }

    let request = VNRecognizeTextRequest::new();

    // ② 语言探测：先问系统支持哪些，再挑出交集。
    //    ⚠️ 不能直接把 ["zh-Hans"] 设进去 —— 不支持时 Vision 不报错，
    //    只是识别质量塌成垃圾字符，那是最坏的一种失败（用户以为文件坏了）。
    let supported = unsafe { request.supportedRecognitionLanguagesAndReturnError() }
        .map_err(|_| token("unsupported-language"))?;
    let mut langs: Vec<objc2::rc::Retained<NSString>> = Vec::new();
    for name in supported.iter() {
        let as_str = name.to_string();
        if LANGS.contains(&as_str.as_str()) {
            langs.push(name);
        }
    }
    if langs.is_empty() {
        return Err(token("unsupported-language"));
    }
    request.setRecognitionLanguages(&NSArray::from_retained_slice(&langs));
    // Accurate 而非 Fast：扫描件多是正文书页，精度优先；页数与总时长由 TS 侧
    // 的 `ocrMaxPages`（50）兜住，不靠降精度换速度。
    request.setRecognitionLevel(VNRequestTextRecognitionLevel::Accurate);
    request.setUsesLanguageCorrection(true);

    // ③ 执行。
    let data = NSData::with_bytes(&bytes);
    let options: objc2::rc::Retained<NSDictionary<VNImageOption, AnyObject>> = NSDictionary::new();
    let handler = VNImageRequestHandler::initWithData_options(
        VNImageRequestHandler::alloc(),
        &data,
        &options,
    );
    // 子类 → 父类由 Deref 链完成，不需要额外转换。
    let as_request: &VNRequest = &request;
    let requests = NSArray::from_slice(&[as_request]);
    handler
        .performRequests_error(&requests)
        .map_err(|_| token("vision-failed"))?;

    // ④ 收集结果：每条 observation 只要置信度最高的那个候选。
    let results = request.results().ok_or_else(|| token("no-text"))?;
    let mut lines: Vec<String> = Vec::new();
    for observation in results.iter() {
        let candidates = observation.topCandidates(1);
        if let Some(first) = candidates.firstObject() {
            lines.push(first.string().to_string());
        }
    }

    let text = join_candidates(&lines);
    if text.is_empty() {
        return Err(token("no-text"));
    }
    Ok(OcrText {
        line_count: lines.iter().filter(|line| is_text_line(line)).count(),
        text,
    })
}

/// 非 macOS：Vision 不存在。令牌与 macOS 侧一致，TS 侧只需一套映射。
#[cfg(not(target_os = "macos"))]
fn recognize_blocking(_bytes_base64: &str) -> Result<OcrText, String> {
    Err(token("unsupported-os"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 只测纯函数（**不依赖图片、不调用系统框架**）：令牌契约 + 行拼接规则。
    mod tokens {
        use super::*;

        #[test]
        fn tokens_are_bare_machine_kinds() {
            // 令牌里不允许出现空白或冒号 —— 它们会被 TS 侧按 `kind` 精确匹配。
            for kind in [
                "bad-base64",
                "empty-image",
                "unsupported-os",
                "unsupported-language",
                "vision-failed",
                "no-text",
            ] {
                assert_eq!(token(kind), kind);
                assert!(!token(kind).contains(char::is_whitespace));
            }
        }
    }

    mod lines {
        use super::*;

        #[test]
        fn drops_blank_lines_and_trims_edges() {
            let lines = vec![
                "  第一章 总则  ".to_string(),
                "".to_string(),
                "   ".to_string(),
                "1. 目的".to_string(),
            ];
            assert_eq!(join_candidates(&lines), "第一章 总则\n1. 目的");
        }

        #[test]
        fn keeps_inner_spacing_untouched() {
            // 行内空格是版面信息，不做压缩 —— 压缩会毁掉表格行的对齐。
            let lines = vec!["姓名    年龄".to_string()];
            assert_eq!(join_candidates(&lines), "姓名    年龄");
        }

        #[test]
        fn empty_input_yields_empty_string() {
            assert_eq!(join_candidates(&[]), "");
            assert!(!is_text_line("  \t "));
            assert!(is_text_line("a"));
        }
    }
}
