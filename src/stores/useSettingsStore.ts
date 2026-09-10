import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PersistOptions } from "zustand/middleware";
import type { AIProvider, ProviderKind } from "../ai";
import { createProvider } from "../ai";
import { activeToProviderConfig, providerFromActive, type SavedActive } from "../ai/active";
import {
  hasKeyring,
  vaultDeleteSecret,
  vaultReadSecret,
  vaultSaveSecret,
} from "../ai/vault";

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
 * 安全说明(V2 T11):API Key 不再明文落 localStorage —— 桌面端写入/更新
 * 时经 `vaultSaveSecret` 存入 macOS Keychain,持久化 JSON 中 apiKey 剥离为
 * 空串(内存态保留真值供引擎同步使用);启动时 `restoreVaultApiKey()` 从
 * 钥匙串回填内存。纯浏览器预览(无钥匙串)回退旧明文策略,仅限本地预览。
 * 历史明文 Key 在首次启动恢复时自动迁入钥匙串并重写剥离后的持久化 JSON。
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
  /**
   * 向量化模型配置(D3-A:端点/Key 继承 active,模型名单独配置)。
   * null / undefined = 未配置 → provider 不挂载 `embed` 能力 → 检索降级纯 FTS。
   */
  embedding?: { model: string } | null;
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
  /** 设置 Embedding 模型名(空串 = 清除,恢复「无向量能力」)。 */
  setEmbeddingModel: (model: string) => void;
}

const DEFAULTS: SavedSettings = {
  active: null,
  providerReady: false,
  embedding: null,
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
      embedding: normalizeEmbedding(p.embedding),
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
      embedding: null, // 旧结构无向量化配置
      testedAt: flat.testedAt,
      lastLatencyMs: flat.lastLatencyMs,
      savedAt: flat.savedAt,
    };
  }
  return null;
}

/** 归一化持久化的 embedding 字段：只接受形如 `{ model: string }` 的非空模型名。 */
function normalizeEmbedding(raw: unknown): { model: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const model = (raw as { model?: unknown }).model;
  if (typeof model !== "string") return null;
  const trimmed = model.trim();
  return trimmed ? { model: trimmed } : null;
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
    (set, get) => ({
      ...DEFAULTS,

      saveActive: (active, meta) => {
        // Keychain 写穿:桌面端 api Key 存入钥匙串(空 Key = 清理);
        // 写失败不阻塞保存 —— 仅丢失「落盘 Key」能力,内存态照常可用。
        if (active.source === "api") {
          if (active.apiKey) {
            void vaultSaveSecret(active.provider, active.apiKey).catch((err) => {
              console.warn("vault save failed (fallback: memory-only key):", err);
            });
          } else {
            void vaultDeleteSecret(active.provider).catch(() => undefined);
          }
        }
        set({
          active,
          providerReady: meta.testedOk,
          testedAt: meta.testedOk ? Date.now() : undefined,
          lastLatencyMs: meta.testedOk ? meta.latencyMs : undefined,
          savedAt: Date.now(),
        });
      },

      clearActive: () => {
        const prev = get().active;
        if (prev?.source === "api") {
          void vaultDeleteSecret(prev.provider).catch(() => undefined);
        }
        set({
          active: null,
          providerReady: false,
          testedAt: undefined,
          lastLatencyMs: undefined,
          savedAt: Date.now(),
        });
      },

      setEmbeddingModel: (model) => {
        const trimmed = model.trim();
        set({ embedding: trimmed ? { model: trimmed } : null, savedAt: Date.now() });
      },
    }),
    {
      name: "plos:settings:v1", // key 沿用旧名以兼容历史数据;schema 版本 v2
      partialize: (s) => ({
        // 桌面端持久化剥离 API Key(明文已迁入钥匙串,磁盘不留凭据);
        // 纯浏览器预览无钥匙串,保留原明文以维持功能。
        active:
          s.active?.source === "api" && hasKeyring() && s.active.apiKey
            ? { ...s.active, apiKey: "" }
            : s.active,
        providerReady: s.providerReady,
        embedding: s.embedding ?? null,
        testedAt: s.testedAt,
        lastLatencyMs: s.lastLatencyMs,
        savedAt: s.savedAt,
      }),
      merge,
    },
  ),
);

/**
 * 启动时从钥匙串回填内存中的 API Key(V2 T11 keyring 持久化)。
 *
 * 桌面端场景:持久化 JSON 中 apiKey 已剥离为空串,rehydrate 后内存无 Key;
 * 此处异步读钥匙串回填,保证 buildActiveProvider() 构造出的 provider 带真值。
 * 历史明文迁移:rehydrate 后若内存仍有非空 Key(旧数据),先写钥匙串再触发
 * 一次 setState 让 persist 以剥离后的形状重写 JSON。
 * 任何失败静默降级(浏览器/无钥匙串/读失败 → 维持现状,不阻塞启动)。
 */
export async function restoreVaultApiKey(): Promise<void> {
  if (!hasKeyring()) return;
  try {
    const { active } = useSettingsStore.getState();
    if (active?.source !== "api") return;
    if (active.apiKey) {
      // 旧明文迁移:入库后触发 persist 剥离落盘。
      await vaultSaveSecret(active.provider, active.apiKey);
      useSettingsStore.setState((s) => ({ ...s }));
      return;
    }
    const secret = await vaultReadSecret(active.provider);
    if (secret) {
      useSettingsStore.setState((s) =>
        s.active?.source === "api" && s.active.provider === active.provider
          ? { ...s, active: { ...s.active, apiKey: secret } }
          : s,
      );
    }
  } catch (err) {
    console.warn("vault restore skipped:", err);
  }
}

/**
 * 根据「当前使用模型」构建活跃的 Provider(未选择时为离线兜底 provider)。
 *
 * 顺带注入向量化模型名(D3-A):端点/Key 复用 active,模型名来自 `embedding`。
 * 只有配置了 embedding 模型的 API provider 才会挂上 `embed` 能力,
 * builtin(本地模型)与未选择模型时能力不存在 → 检索层自然降级为纯 FTS。
 */
export function buildActiveProvider(): AIProvider {
  const { active, embedding } = useSettingsStore.getState();
  const cfg = activeToProviderConfig(active);
  // 未选择模型 → 复用 providerFromActive 的离线兜底（NoActiveProvider：无任何能力）
  if (!cfg) return providerFromActive(null);
  const model = embedding?.model?.trim();
  return createProvider(model ? { ...cfg, embeddingModel: model } : cfg);
}
