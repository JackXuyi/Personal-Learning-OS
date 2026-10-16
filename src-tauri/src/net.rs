//! 网页抓取（F8 范围 5）—— 本仓库唯一一条**用户任意 URL** 的出网命令。
//! 方案：docs/url-import-design-2026-10.md §8.1（D1-A / D4-A / D9-A）。
//!
//! 为什么必须落在 Rust：webview 的 `fetch` 受同源 / CORS 约束，只有主动发
//! `Access-Control-Allow-Origin` 的站点（如 api.github.com）才读得到响应体
//! ⇒ 任意站点在桌面端与浏览器预览下都抓不到。GitHub 导入能用 `fetch` 是对方
//! **主动放行**，不是通用能力。
//!
//! ⚠️ 与 `llm/manager.rs` 的模型下载不同：那条是**固定**地址，这条是用户给的
//! 任意地址 ⇒ 故有 scheme 白名单与「零凭据」两条约束：
//! - scheme 只接受 `http` / `https`（显式拒绝 `file:` / `data:` / `javascript:`）；
//! - `reqwest::Client` 不启用 `cookies` feature ⇒ 不带 Cookie、不复用会话。
//!
//! 编码**不在此处判定**：reqwest 未启用 `charset` feature，`text()` 对无 charset
//! 头的 GBK 页会静默乱码 ⇒ 原样回字节，由 TS 侧 `import/decode.ts` 嗅探并把
//! 实际采用的编码名回传给结果卡（D4）。
//!
//! 错误一律是**机器令牌**（D9-A）：`Result<T, String>` 守住 `rules/rust.mdc` 的
//! 字面约定，同时满足导入层纪律「Rust 绝不携带用户可见文案」—— 令牌 → 文案的
//! 映射在 TS 侧 `import/web-error.ts`，两边由各自的单测锁契约。

use std::time::Duration;

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use futures_util::StreamExt;

/// 传输护栏（防内存暴涨，**不是**产品体量线；产品线是 TS 的 `LIMITS.webMaxChars`）。
const MAX_FETCH_BYTES: usize = 5 * 1024 * 1024;
/// 单次请求超时（含连接与整个响应体读取）。
const TIMEOUT_SECS: u64 = 20;
/// 重定向跳数上限（超出 → `too-many-redirects`）。
const MAX_REDIRECTS: usize = 5;
/// 多数站点缺 UA 直接 403 ⇒ 给一个可识别的固定标识。
const USER_AGENT: &str = "PersonalLearningOS/0.1 (+local-first reader)";

/// 抓取结果（`rename_all = "camelCase"` ⇒ TS 侧驼峰；两边同改）。
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchedPage {
    /// 跟随重定向后的最终地址（TS 侧写入 `SourceDocument.source`，查重按它归一）。
    final_url: String,
    /// HTTP 状态码（仅 2xx 才会走到这里）。
    status: u16,
    /// 原始 `Content-Type`（可能含 charset；TS 侧解析，此处不解读）。
    content_type: Option<String>,
    /// 原始响应字节的 base64（**不解码**，见模块头注释）。
    bytes_base64: String,
    /// base64 解码前的字节数（结果卡 / 排障用）。
    byte_len: usize,
}

/// scheme 提取：`"https://x"` → `Some("https")`；无 `://` 或非法 section → `None`。
/// 大小写不敏感（`HTTP://` 亦认）；只做结构判定，不校验 host。
fn url_scheme(raw: &str) -> Option<String> {
    let idx = raw.find("://")?;
    let scheme = &raw[..idx];
    if scheme.is_empty()
        || !scheme
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'))
    {
        return None;
    }
    Some(scheme.to_ascii_lowercase())
}

/// scheme 白名单（`file:` / `data:` / `javascript:` 一律拒）。
/// 抽成纯函数以便 `cargo test --lib` 覆盖（不联网）。
fn scheme_allowed(raw: &str) -> bool {
    matches!(url_scheme(raw).as_deref(), Some("http") | Some("https"))
}

/// 机器令牌（**绝不含用户文案**）：`("http-error", Some("404"))` → `"http-error:404"`。
/// 抽成纯函数以便与 TS 侧解析端各自的单测锁契约。
fn token(kind: &str, detail: Option<&str>) -> String {
    match detail {
        Some(d) => format!("{kind}:{d}"),
        None => kind.to_string(),
    }
}

/// 抓取一个网页，回原始字节（base64）+ 终址 + Content-Type。
#[tauri::command]
pub async fn fetch_url(url: String) -> Result<FetchedPage, String> {
    if !scheme_allowed(&url) {
        return Err(token("invalid-url", None));
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(TIMEOUT_SECS))
        .redirect(reqwest::redirect::Policy::limited(MAX_REDIRECTS))
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| token("build-client", Some(&e.to_string())))?;

    let res = client
        .get(&url)
        .header(
            reqwest::header::ACCEPT,
            "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
        )
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                token("timeout", None)
            } else if e.is_redirect() {
                token("too-many-redirects", None)
            } else {
                token("network", Some(&e.to_string()))
            }
        })?;

    let status = res.status();
    if !status.is_success() {
        return Err(token("http-error", Some(&status.as_u16().to_string())));
    }

    // ⚠️ `bytes_stream()` 会消费 `res` ⇒ 终址与头部必须先取出来。
    let final_url = res.url().to_string();
    let content_type = res
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    // 流式累积 + 卡上限：超限立即中断连接，不把大响应读完（护栏在传输层生效）。
    let mut buf: Vec<u8> = Vec::new();
    let mut stream = res.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| token("network", Some(&e.to_string())))?;
        if buf.len() + chunk.len() > MAX_FETCH_BYTES {
            return Err(token("too-large", Some(&MAX_FETCH_BYTES.to_string())));
        }
        buf.extend_from_slice(&chunk);
    }

    let byte_len = buf.len();
    Ok(FetchedPage {
        final_url,
        status: status.as_u16(),
        content_type,
        bytes_base64: STANDARD.encode(&buf),
        byte_len,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 只测纯函数（**不联网**）：scheme 白名单 + 令牌格式契约。
    mod scheme {
        use super::*;

        #[test]
        fn accepts_http_and_https_case_insensitively() {
            assert!(scheme_allowed("https://example.com/article"));
            assert!(scheme_allowed("http://example.com"));
            assert!(scheme_allowed("HTTPS://Example.COM/a"));
            assert_eq!(url_scheme("HTTP://x").as_deref(), Some("http"));
        }

        #[test]
        fn rejects_non_web_schemes() {
            // 显式拒绝：本地文件 / 内联数据 / 脚本伪协议。
            assert!(!scheme_allowed("file:///etc/passwd"));
            assert!(!scheme_allowed("data:text/html,<h1>x</h1>"));
            assert!(!scheme_allowed("javascript:alert(1)"));
            // 无 `://` 的裸 scheme 也拒（parseWebUrl 后才会有，此处兜底）。
            assert!(!scheme_allowed("javascript://alert(1)"));
            assert!(!scheme_allowed("ftp://example.com"));
        }

        #[test]
        fn rejects_missing_or_malformed_scheme() {
            assert!(!scheme_allowed(""));
            assert!(!scheme_allowed("example.com/post"));
            assert!(!scheme_allowed("://no-scheme"));
            assert!(!scheme_allowed("ht tp://x"));
        }
    }

    mod tokens {
        use super::*;

        #[test]
        fn formats_kind_with_detail() {
            assert_eq!(token("http-error", Some("404")), "http-error:404");
            assert_eq!(token("too-large", Some("5242880")), "too-large:5242880");
        }

        #[test]
        fn formats_bare_kind_without_detail() {
            assert_eq!(token("network", None), "network");
            assert_eq!(token("timeout", None), "timeout");
            assert_eq!(token("too-many-redirects", None), "too-many-redirects");
            assert_eq!(token("invalid-url", None), "invalid-url");
        }
    }
}
