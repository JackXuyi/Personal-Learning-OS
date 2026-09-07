/**
 * Provider 连接测试 —— 设置页「测试连接」的工具函数。
 *
 * 对当前表单值（未保存也可测）发起一次最小 chat 请求（ping, max_tokens=1），
 * 带 3s 超时；失败时把底层异常翻译成「原因 + 怎么办」两句式文案，
 * 绝不把原始异常栈抛给用户。
 */
import { createProvider } from "./registry";
import type { ProviderConfig, ProviderKind } from "./types";
import { AiProviderError } from "./types";

export interface ConnectionOk {
  ok: true;
  latencyMs: number;
}
export interface ConnectionFailed {
  ok: false;
  /** 一句「原因」。 */
  reason: string;
  /** 一句「怎么办」。 */
  hint: string;
}
export type ConnectionTestResult = ConnectionOk | ConnectionFailed;

/** 测试超时（毫秒）。 */
export const CONNECTION_TIMEOUT_MS = 3_000;

const LOCAL_KINDS: ReadonlySet<ProviderKind> = new Set([
  "ollama",
  "llama.cpp",
  "lmstudio",
]);

function isLocal(kind: ProviderKind): boolean {
  return LOCAL_KINDS.has(kind);
}

/** 本地服务默认端口（用于超时时的排障提示）。 */
const LOCAL_PORT_HINT: Record<ProviderKind, string> = {
  builtin: "",
  ollama: "Ollama 默认 11434",
  "llama.cpp": "llama.cpp 默认 8080",
  lmstudio: "LM Studio 默认 1234",
  openai: "",
  anthropic: "",
  gemini: "",
  deepseek: "",
  custom: "",
};

/** 发起一次连接测试。 */
export async function testConnection(
  config: ProviderConfig,
): Promise<ConnectionTestResult> {
  const provider = createProvider(config);
  const started = performance.now();
  try {
    await Promise.race([
      provider.chat({
        messages: [{ role: "user", content: "ping" }],
        temperature: 0,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new AiProviderError(
                "request-failed",
                `connection timed out after ${CONNECTION_TIMEOUT_MS}ms`,
              ),
            ),
          CONNECTION_TIMEOUT_MS,
        ),
      ),
    ]);
  } catch (err) {
    return { ok: false, ...translateError(err, config) };
  }
  const latencyMs = Math.max(1, Math.round(performance.now() - started));
  return { ok: true, latencyMs };
}

/** 把底层异常翻译为「原因 + 怎么办」。 */
export function translateError(
  err: unknown,
  config: ProviderConfig,
): { reason: string; hint: string } {
  const local = isLocal(config.kind);
  const base = config.baseUrl?.trim() || "(未填)";

  if (err instanceof TypeError) {
    // fetch 网络层失败（连接被拒 / 无法解析主机等）。
    return {
      reason: `无法访问 ${base}`,
      hint: local
        ? "确认服务已启动：Ollama 运行 `ollama serve`；llama.cpp 运行 server；LM Studio 打开 Local Server。本地地址应为 http:// 而非 https。"
        : "检查地址拼写、网络是否可达；自建网关请确认已在允许列表。",
    };
  }

  if (err instanceof AiProviderError) {
    if (err.code === "not-configured") {
      return {
        reason: "配置不完整",
        hint: local
          ? "本地服务需填 Base URL。"
          : "云端服务还需填 API Key（见下方「API Key」输入框）。",
      };
    }
    if (err.code === "not-implemented") {
      return {
        reason: "该厂商的传输适配器尚未实装",
        hint: "Anthropic / Gemini 暂不支持直连，可先选 Ollama、DeepSeek 或自定义（OpenAI 兼容）。",
      };
    }
    // request-failed
    const message = err.message;
    const timeoutHit = /timed out after/.test(message);
    if (timeoutHit) {
      return {
        reason: `连接超时（${CONNECTION_TIMEOUT_MS / 1000} 秒未响应）`,
        hint: local
          ? `确认服务正在监听：${LOCAL_PORT_HINT[config.kind] ?? base}。模型首次加载可能较慢，可稍后重试。`
          : "检查网络延迟或防火墙；可稍后重试。",
      };
    }
    const status = /HTTP (\d{3})/.exec(message);
    if (status) {
      const code = Number(status[1]);
      if (code === 401 || code === 403) {
        return {
          reason: `鉴权失败（HTTP ${code}）`,
          hint: "检查 API Key 是否正确、是否有该模型/接口的权限。",
        };
      }
      if (code === 404) {
        return {
          reason: "接口或模型不可用（HTTP 404）",
          hint: local
            ? `核对 Base URL 是否含 /v1 路径、模型名是否已下载（ollama 用 \`ollama list\` 查看）。`
            : "核对 Base URL 与模型名是否拼写正确。",
        };
      }
      if (code === 429) {
        return { reason: "请求被限流（HTTP 429）", hint: "稍等片刻再试一次。" };
      }
      if (code >= 500) {
        return {
          reason: `服务端错误（HTTP ${code}）`,
          hint: local ? "查看服务端日志定位问题。" : "服务方临时故障，稍后重试。",
        };
      }
    }
    return { reason: "服务返回错误", hint: message.slice(0, 200) };
  }

  return { reason: "未知错误", hint: err instanceof Error ? err.message : String(err) };
}
