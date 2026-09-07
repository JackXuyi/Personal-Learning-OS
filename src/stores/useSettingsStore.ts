import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createProvider, type AIProvider, type ProviderKind } from "../ai";
import { defaultModelOf, normalizeOpenAiBaseUrl } from "../ai/openai-compatible";

/**
 * Provider 设置 —— 「已保存配置」是唯一持久化的真相（localStorage，
 * key: plos:settings:v1）。表单编辑是草稿态，点「保存」才落库生效；
 * `buildActiveProvider` 始终基于已保存配置构造，保证各页读到的是一致的一份。
 *
 * 安全说明：API Key 以明文保存在本机 localStorage，仅供本应用调用本地端点；
 * 桌面端本地优先产品可接受，云端 Key 请勿用于高风险场景。
 */

/** 持久化的已保存配置快照（不含任何运行时瞬态）。 */
interface SavedSettings {
  kind: ProviderKind;
  baseUrl: string;
  model: string;
  apiKey: string;
  /** 该配置最后一次通过连接测试的时间戳（通过才记录）。 */
  providerReady: boolean;
  testedAt?: number;
  /** 最近一次通过测试的往返耗时（毫秒）。 */
  lastLatencyMs?: number;
  /** 最近一次保存时间。 */
  savedAt?: number;
}

interface SettingsState extends SavedSettings {
  /** 以草稿配置整体覆盖「已保存配置」。测试结果一并落库。 */
  save: (
    draft: Pick<SavedSettings, "kind" | "baseUrl" | "model" | "apiKey">,
    meta: { testedOk: boolean; latencyMs?: number },
  ) => void;
}

const DEFAULTS: SavedSettings = {
  kind: "ollama",
  baseUrl: normalizeOpenAiBaseUrl("ollama"),
  model: defaultModelOf("ollama"),
  apiKey: "",
  providerReady: false,
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULTS,

      save: (draft, meta) =>
        set({
          ...draft,
          // 通过测试才把「就绪」落库；改配置未测即保存会清掉就绪标记。
          providerReady: meta.testedOk,
          testedAt: meta.testedOk ? Date.now() : undefined,
          lastLatencyMs: meta.testedOk ? meta.latencyMs : undefined,
          savedAt: Date.now(),
        }),
    }),
    {
      name: "plos:settings:v1",
      // 只持久化数据字段（函数不参与序列化）。
      partialize: (s) => ({
        kind: s.kind,
        baseUrl: s.baseUrl,
        model: s.model,
        apiKey: s.apiKey,
        providerReady: s.providerReady,
        testedAt: s.testedAt,
        lastLatencyMs: s.lastLatencyMs,
        savedAt: s.savedAt,
      }),
    },
  ),
);

/** 根据「已保存配置」构建活跃的 Provider。 */
export function buildActiveProvider(): AIProvider {
  const { kind, baseUrl, model, apiKey } = useSettingsStore.getState();
  return createProvider({
    kind,
    baseUrl: baseUrl.trim() || undefined,
    model: model.trim() || undefined,
    apiKey: apiKey.trim() || undefined,
  });
}
