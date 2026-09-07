/**
 * Provider / 模型 展示元数据 ——「AI 模型中心」UI 与 Active Banner 共用。
 *
 * 分类心智(2026-09-07 UI 简化迭代):API Tab 只保留**预置供应商下拉**,
 * 以「千问等可在个人设备使用的开源模型」为主(决策 Q3):
 * 千问 / DeepSeek / OpenAI / 智谱 GLM / Kimi / 自定义兼容。
 * 「本地服务(自建端点)」与「规划中(适配器未实现)」入口已移除 —— 外部端点
 * 需求可经「自定义(OpenAI 兼容)」表达。历史存档的 provider(如旧版迁移来的
 * `ollama` 等)经 labelOfProvider 兜底展示,配置仍可编辑。
 */
import { defaultModelOf, normalizeOpenAiBaseUrl } from "./openai-compatible";
import type { ApiProviderKind } from "./active";
import type { ProviderKind } from "./types";

export interface ProviderPreset {
  provider: ApiProviderKind;
  label: string;
  /** 预置默认 Base URL;custom 为空由用户填。 */
  baseUrl: string;
  /** 预置建议模型名(可改)。 */
  model: string;
  /** 是否要求 API Key(自定义兼容可免)。 */
  keyRequired: boolean;
  note?: string;
}

/** 预置清单(下拉选项;顺序即下拉排列顺序,全部可直接选用)。 */
export const API_PROVIDER_PRESETS: ProviderPreset[] = [
  { provider: "qwen", label: "千问 Qwen", baseUrl: normalizeOpenAiBaseUrl("qwen"), model: defaultModelOf("qwen"), keyRequired: true, note: "阿里开源 · 默认示例" },
  { provider: "deepseek", label: "DeepSeek", baseUrl: normalizeOpenAiBaseUrl("deepseek"), model: defaultModelOf("deepseek"), keyRequired: true },
  { provider: "openai", label: "OpenAI", baseUrl: normalizeOpenAiBaseUrl("openai"), model: defaultModelOf("openai"), keyRequired: true },
  { provider: "glm", label: "智谱 GLM", baseUrl: normalizeOpenAiBaseUrl("glm"), model: defaultModelOf("glm"), keyRequired: true },
  { provider: "kimi", label: "Kimi(月之暗面)", baseUrl: normalizeOpenAiBaseUrl("kimi"), model: defaultModelOf("kimi"), keyRequired: true },
  { provider: "custom", label: "自定义(OpenAI 兼容)", baseUrl: "", model: "", keyRequired: false, note: "任意 OpenAI 兼容端点" },
];

export function presetOf(provider: ApiProviderKind): ProviderPreset | undefined {
  return API_PROVIDER_PRESETS.find((p) => p.provider === provider);
}

/** 已移除入口的历史厂商 label 兜底(旧存档展示用,不提供可点入口)。 */
const LEGACY_PROVIDER_LABELS: Partial<Record<ProviderKind, string>> = {
  ollama: "Ollama(本地服务,已下线)",
  "llama.cpp": "llama.cpp(本地服务,已下线)",
  lmstudio: "LM Studio(本地服务,已下线)",
  anthropic: "Anthropic(规划中)",
  gemini: "Gemini(规划中)",
};

export function labelOfProvider(provider: ProviderKind): string {
  if (provider === "builtin") return "内置本地模型";
  return (
    presetOf(provider)?.label ??
    LEGACY_PROVIDER_LABELS[provider] ??
    provider
  );
}

/** 本地模型展示名(与 Rust models.rs 的 display_name 对齐;未命中时回退原名)。 */
export const LOCAL_MODEL_LABELS: Record<string, string> = {
  "qwen3.5:4b": "Qwen 3.5 4B(默认档)",
  "qwen3.5:2b": "Qwen 3.5 2B(轻量档)",
  "qwen3.5:0.8b": "Qwen 3.5 0.8B(超轻量)",
  "qwen3.5:9b": "Qwen 3.5 9B(高质量档)",
};

export function labelOfLocalModel(name: string): string {
  return LOCAL_MODEL_LABELS[name] ?? name;
}
