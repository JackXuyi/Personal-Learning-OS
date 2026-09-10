/**
 * useAiReady —— 响应式「AI 是否就绪」。
 *
 * 背景（docs/library-detail-page-design-2026-09.md §2 · B2 P0）：
 * 资料详情页原本用 `useMemo(() => buildActiveProvider()?.isConfigured(), [])`
 * 判定 AI，而那个 `buildActiveProvider` 是 `ai/active.ts` 里的 stub、恒返回
 * `null` —— 按钮永远禁用。更根本的问题是 `useMemo(…, [])` 只算一次：
 * 用户中途配好模型，按钮也不会亮。
 *
 * 本 hook 订阅 `useSettingsStore.providerReady`（设置层保存/测试通过后置 true），
 * 因此是**响应式**的：配好即亮、撤掉即暗。
 *
 * 依赖方向：hooks → stores（允许），不反向依赖 features。
 */
import { useSettingsStore } from "../stores/useSettingsStore";

/** 全局 AI 是否已就绪（已选模型且可用）。 */
export function useAiReady(): boolean {
  return useSettingsStore((s) => Boolean(s.providerReady));
}
