import { create } from "zustand";
import { createProvider, type AIProvider, type ProviderKind } from "../ai";
import { defaultModelOf, normalizeOpenAiBaseUrl } from "../ai/openai-compatible";

interface SettingsState {
  kind: ProviderKind;
  baseUrl: string;
  model: string;
  apiKey: string;
  setKind: (kind: ProviderKind) => void;
  setBaseUrl: (value: string) => void;
  setModel: (value: string) => void;
  setApiKey: (value: string) => void;
}

/** Provider config lives in the UI store; the built provider is re-created on save. */
export const useSettingsStore = create<SettingsState>((set) => ({
  kind: "ollama",
  baseUrl: normalizeOpenAiBaseUrl("ollama"),
  model: defaultModelOf("ollama"),
  apiKey: "",
  setKind: (kind) =>
    set({
      kind,
      baseUrl: normalizeOpenAiBaseUrl(kind),
      model: defaultModelOf(kind),
    }),
  setBaseUrl: (baseUrl) => set({ baseUrl }),
  setModel: (model) => set({ model }),
  setApiKey: (apiKey) => set({ apiKey }),
}));

/** 根据当前设置构建活跃的 Provider（在保存后调用）。 */
export function buildActiveProvider(): AIProvider {
  const { kind, baseUrl, model, apiKey } = useSettingsStore.getState();
  return createProvider({
    kind,
    baseUrl: baseUrl.trim() || undefined,
    model: model.trim() || undefined,
    apiKey: apiKey.trim() || undefined,
  });
}
