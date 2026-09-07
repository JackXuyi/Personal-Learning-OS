/**
 * Provider / 模型 展示元数据 ——「AI 模型中心」UI 与 Active Banner 共用。
 *
 * 分类心智(决策 Q3,见 docs/ai-model-center-plan-2026-09.md §5.2):
 * - API 模型 = 云端/自建端点,预置以「千问等可在个人设备使用的开源模型」为主;
 * - Anthropic / Gemini 属「规划中」(registry DEFERRED,非 OpenAI 传输格式);
 * - Ollama / llama.cpp / LM Studio 属用户自跑的本机端点,归「本地服务」分组。
 */
import { defaultModelOf, normalizeOpenAiBaseUrl } from "./openai-compatible";
import type { ApiProviderKind } from "./active";
import type { ProviderKind } from "./types";

export type ProviderGroup = "open-source" | "custom" | "local-endpoint" | "planned";

export interface ProviderPreset {
  provider: ApiProviderKind;
  label: string;
  group: ProviderGroup;
  /** 预置默认 Base URL;custom 为空由用户填。 */
  baseUrl: string;
  /** 预置建议模型名(可改)。 */
  model: string;
  /** 是否要求 API Key(本地服务/自定义兼容可免)。 */
  keyRequired: boolean;
  /** false = 适配器未实现等,UI 灰显禁选。 */
  available: boolean;
  note?: string;
}

/** API 预置清单(顺序即首屏排列顺序)。 */
export const API_PROVIDER_PRESETS: ProviderPreset[] = [
  { provider: "qwen", label: "千问 Qwen", group: "open-source", baseUrl: normalizeOpenAiBaseUrl("qwen"), model: defaultModelOf("qwen"), keyRequired: true, available: true, note: "阿里开源 · 默认示例" },
  { provider: "deepseek", label: "DeepSeek", group: "open-source", baseUrl: normalizeOpenAiBaseUrl("deepseek"), model: defaultModelOf("deepseek"), keyRequired: true, available: true },
  { provider: "openai", label: "OpenAI", group: "open-source", baseUrl: normalizeOpenAiBaseUrl("openai"), model: defaultModelOf("openai"), keyRequired: true, available: true },
  { provider: "glm", label: "智谱 GLM", group: "open-source", baseUrl: normalizeOpenAiBaseUrl("glm"), model: defaultModelOf("glm"), keyRequired: true, available: true },
  { provider: "kimi", label: "Kimi(月之暗面)", group: "open-source", baseUrl: normalizeOpenAiBaseUrl("kimi"), model: defaultModelOf("kimi"), keyRequired: true, available: true },
  { provider: "custom", label: "自定义(OpenAI 兼容)", group: "custom", baseUrl: "", model: "", keyRequired: false, available: true, note: "任意 OpenAI 兼容端点" },
];

/** 规划中(传输适配器未实现):展示但禁选。 */
export const PLANNED_PROVIDERS: ProviderPreset[] = [
  { provider: "anthropic", label: "Anthropic", group: "planned", baseUrl: "", model: "", keyRequired: true, available: false, note: "非 OpenAI 协议,待适配器里程碑" },
  { provider: "gemini", label: "Gemini", group: "planned", baseUrl: "", model: "", keyRequired: true, available: false, note: "非 OpenAI 协议,待适配器里程碑" },
];

/** 本地服务分组(外部自跑端点,免 Key)。 */
export const LOCAL_ENDPOINT_PRESETS: ProviderPreset[] = [
  { provider: "ollama", label: "Ollama", group: "local-endpoint", baseUrl: normalizeOpenAiBaseUrl("ollama"), model: defaultModelOf("ollama"), keyRequired: false, available: true },
  { provider: "llama.cpp", label: "llama.cpp", group: "local-endpoint", baseUrl: normalizeOpenAiBaseUrl("llama.cpp"), model: defaultModelOf("llama.cpp"), keyRequired: false, available: true },
  { provider: "lmstudio", label: "LM Studio", group: "local-endpoint", baseUrl: normalizeOpenAiBaseUrl("lmstudio"), model: defaultModelOf("lmstudio"), keyRequired: false, available: true },
];

const ALL_PRESETS = [...API_PROVIDER_PRESETS, ...PLANNED_PROVIDERS, ...LOCAL_ENDPOINT_PRESETS];

export function presetOf(provider: ApiProviderKind): ProviderPreset | undefined {
  return ALL_PRESETS.find((p) => p.provider === provider);
}

export function labelOfProvider(provider: ProviderKind): string {
  if (provider === "builtin") return "内置本地模型";
  return presetOf(provider)?.label ?? provider;
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
