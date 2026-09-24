/**
 * Provider 展示元数据 ——「AI 模型中心」预置供应商下拉的数据源。
 *
 * 分类心智(2026-09-07 UI 简化迭代):API Tab 只保留**预置供应商下拉**,
 * 以「千问等可在个人设备使用的开源模型」为主(决策 Q3):
 * 千问 / DeepSeek / OpenAI / 智谱 GLM / Kimi / 自定义兼容。
 * 「本地服务(自建端点)」与「规划中(适配器未实现)」入口已移除 —— 外部端点
 * 需求可经「自定义(OpenAI 兼容)」表达。
 */
import { defaultModelOf, normalizeOpenAiBaseUrl } from "./openai-compatible";
import type { ApiProviderKind } from "./active";

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
