import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PersistOptions } from "zustand/middleware";
import type { AIProvider, ProviderKind } from "../ai";
import { providerFromActive, type SavedActive } from "../ai/active";

/**
 * AI 模型设置 —— 「当前使用模型」的唯一持久化真相(决策 Q2)。
 *
 * 结构: `active: {source:"local", model} | {source:"api", …} | null`
 * - localStorage key 沿用 `plos:settings:v1`(名称不变以兼容旧数据),
 *   内部 schema 为 v2;旧扁平结构(kind/baseUrl/model/apiKey)在 rehydrate
 *   时经自定义 merge 自动迁移为 active 复合结构。
 * - `providerReady`:local=激活模型已就绪;api=保存时连接测试通过。
 * - 引擎侧一律 `buildActiveProvider()` 取「当前使用模型」构造 provider,
 *   保证各页读到一致的一份。
 *
 * 安全说明:API Key 以明文保存在本机 localStorage,仅供本应用调用对应端点;
 * 桌面端本地优先产品可接受,云端 Key 请勿用于高风险场景。
 */

/** v1 扁平结构的旧持久化形状(用于迁移识别)。 */
interface LegacyFlatSettings {
  kind?: ProviderKind;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  providerReady?: boolean;
  testedAt?: number;
  lastLatencyMs?: number;
  savedAt?: number;
}

/** v2 持久化的数据字段。 */
export interface SavedSettings {
  active: SavedActive;
  /** 当前激活模型是否已就绪(本地=文件在;API=通过连接测试)。 */
  providerReady: boolean;
  /** 该配置最后一次通过连接测试的时间戳(通过才记录)。 */
  testedAt?: number;
  /** 最近一次通过测试的往返耗时(毫秒)。 */
  lastLatencyMs?: number;
  /** 最近一次保存时间。 */
  savedAt?: number;
}

interface SettingsState extends SavedSettings {
  /** 以新的「当前使用模型」整体覆盖已保存配置。 */
  saveActive: (
    active: NonNullable<SavedActive>,
    meta: { testedOk: boolean; latencyMs?: number },
  ) => void;
  /** 回到「未选择模型」(删除当前本地模型等场景)。 */
  clearActive: () => void;
}

const DEFAULTS: SavedSettings = {
  active: null,
  providerReady: false,
};

function legacyToActive(p: LegacyFlatSettings): NonNullable<SavedActive> {
  if (p.kind === "builtin") {
    return { source: "local", model: p.model || "qwen3.5:4b" };
  }
  return {
    source: "api",
    provider: p.kind || "custom",
    baseUrl: p.baseUrl ?? "",
    model: p.model ?? "",
    apiKey: p.apiKey ?? "",
  };
}

/** 持久化形状归一化:识别旧扁平结构并迁移为 v2,返回 null 表示「无需/无法迁移」。 */
function normalizePersisted(persisted: unknown): SavedSettings | null {
  if (!persisted || typeof persisted !== "object") return null;
  const p = persisted as Record<string, unknown>;
  if ("active" in p) {
    return {
      active: p.active as SavedActive,
      providerReady: Boolean(p.providerReady),
      testedAt: typeof p.testedAt === "number" ? p.testedAt : undefined,
      lastLatencyMs:
        typeof p.lastLatencyMs === "number" ? p.lastLatencyMs : undefined,
      savedAt: typeof p.savedAt === "number" ? p.savedAt : undefined,
    };
  }
  if ("kind" in p) {
    const flat = p as unknown as LegacyFlatSettings;
    return {
      active: legacyToActive(flat),
      providerReady: Boolean(flat.providerReady),
      testedAt: flat.testedAt,
      lastLatencyMs: flat.lastLatencyMs,
      savedAt: flat.savedAt,
    };
  }
  return null;
}

// 自定义 merge:无论存储里是 v2 形状、旧扁平结构还是空数据,都归一到 v2。
// (zustand 的 version/migrate 只对带 version 字段的数据生效;本项目旧数据
// 无 version,因此以 merge 作为唯一迁移入口,确保旧配置升级后行为一致。)
const merge: PersistOptions<SettingsState, SavedSettings>["merge"] = (
  persisted,
  current,
) => {
  const normalized = normalizePersisted(persisted);
  if (!normalized) return { ...current, ...DEFAULTS };
  return { ...current, ...normalized };
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULTS,

      saveActive: (active, meta) =>
        set({
          active,
          providerReady: meta.testedOk,
          testedAt: meta.testedOk ? Date.now() : undefined,
          lastLatencyMs: meta.testedOk ? meta.latencyMs : undefined,
          savedAt: Date.now(),
        }),

      clearActive: () =>
        set({
          active: null,
          providerReady: false,
          testedAt: undefined,
          lastLatencyMs: undefined,
          savedAt: Date.now(),
        }),
    }),
    {
      name: "plos:settings:v1", // key 沿用旧名以兼容历史数据;schema 版本 v2
      partialize: (s) => ({
        active: s.active,
        providerReady: s.providerReady,
        testedAt: s.testedAt,
        lastLatencyMs: s.lastLatencyMs,
        savedAt: s.savedAt,
      }),
      merge,
    },
  ),
);

/** 根据「当前使用模型」构建活跃的 Provider(未选择时为离线兜底 provider)。 */
export function buildActiveProvider(): AIProvider {
  const { active } = useSettingsStore.getState();
  return providerFromActive(active);
}
