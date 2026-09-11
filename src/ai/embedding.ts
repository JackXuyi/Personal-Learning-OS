/**
 * 本地向量化唯一入口(Embedder)。
 *
 * 设计要点(见 docs/embedding-default-config-design-2026-09.md):
 * - **D1 云端已移除**:向量化只走本机 llama-helper,不发起任何 HTTP 请求。
 *   因此它**不能**挂在 `AIProvider` 上——provider 随「当前使用模型」变化
 *   (可能是云端 API),而向量化恒定走本地。二者彻底解耦(D5)。
 * - **D6 批量 16**:16 × 1024 float ≈ 200–300 KB/次 IPC,单次请求不超时。
 * - **维度以 Rust 侧为准**:本文件里的 `dim` 只是清单值(供 UI 展示),
 *   真正的硬校验在 `commands::embed_texts`(与清单不符直接拒绝入库)。
 *
 * 分层约束:本模块属 `src/ai`,**不 import stores**;模型名由调用方
 * (features 层,如 index-service)从 `useSettingsStore` 读取后传入。
 */
import { isTauri } from "@tauri-apps/api/core";
import { embedListModels, embedTexts } from "./builtin";

/** 默认本地向量模型(与 Rust `get_default_embedding_model()` 一致)。 */
export const DEFAULT_EMBEDDING_MODEL = "qwen3-embed:0.6b";

/** 本地分批大小:16 条 × 1024 维 ≈ 16k 个 float,单次 IPC 约 200–300 KB。 */
export const EMBED_BATCH_SIZE = 16;

/**
 * 本地向量模型白名单(与 Rust `get_embedding_models()` 对齐)。
 * 设置迁移时用它判断旧值是否为云端残留(如 `text-embedding-v3`)→ 重置默认。
 */
export const LOCAL_EMBEDDING_MODELS: ReadonlySet<string> = new Set([
  DEFAULT_EMBEDDING_MODEL,
]);

/**
 * 清单声明的向量维度(仅用于 UI 展示与前置估算)。
 * 真值由 helper 返回并在 Rust 侧硬校验;未知模型回 0(表示「未知」)。
 */
const DECLARED_DIMS: Readonly<Record<string, number>> = {
  "qwen3-embed:0.6b": 1024,
};

export interface Embedder {
  /** 模型名(写入 `Embedding.model`,决定判重口径)。 */
  readonly model: string;
  /** 清单声明维度;未知模型为 0。 */
  readonly dim: number;
  /** 与入参等长、顺序一致的向量数组。 */
  embed(texts: readonly string[]): Promise<number[][]>;
}

/**
 * 构造本地 Embedder。
 *
 * @returns 不可用时返回 `undefined`(纯浏览器预览 / 模型名为空),
 *          调用方据此降级而不是抛错。
 */
export function createEmbedder(model: string): Embedder | undefined {
  const name = model.trim();
  if (!name) return undefined;
  // 本地推理进程只在 Tauri 桌面端存在;浏览器预览下向量化不可达。
  if (!isTauri()) return undefined;

  return {
    model: name,
    dim: DECLARED_DIMS[name] ?? 0,
    async embed(texts: readonly string[]): Promise<number[][]> {
      if (texts.length === 0) return [];
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
        const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
        const res = await embedTexts(name, batch as string[]);
        if (res.vectors.length !== batch.length) {
          throw new Error(
            `向量条数不匹配:请求 ${batch.length},返回 ${res.vectors.length}`,
          );
        }
        out.push(...res.vectors);
      }
      return out;
    },
  };
}

/** 本地向量化是否可用(桌面端 + 已配置模型名)。 */
export function isLocalEmbeddingAvailable(model: string): boolean {
  return createEmbedder(model) !== undefined;
}

// ---------------------------------------------------------------------------
// 模型就绪状态缓存
//
// 「模型是否已下载」只能经 IPC 问 Rust(读磁盘)。但能力判定
// (`isAutoIndexCapable`)在渲染期是同步的、又被 6 处入队路径复用,
// 因此在这里缓存一份清单:由设置页/导入弹窗挂载时刷新一次,
// 之后同步可读。缓存未加载时一律按「未就绪」处理——宁可显示
// 「未下载」也不谎报「已入队」(B2 教训:静默失效比报错更糟)。
// ---------------------------------------------------------------------------

/** 与 Rust `ModelStatus` 对齐。 */
export type EmbeddingModelStatus =
  | "not_found"
  | "downloading"
  | "ready"
  | "corrupted";

interface CachedModel {
  name: string;
  status: EmbeddingModelStatus;
}

let cache: CachedModel[] | null = null;

/** 拉取(并缓存)向量模型清单状态。非桌面端返回空数组。 */
export async function refreshEmbeddingStatus(): Promise<CachedModel[]> {
  if (!isTauri()) {
    cache = [];
    return cache;
  }
  try {
    const list = await embedListModels();
    cache = list.map((m) => ({ name: m.name, status: m.status }));
  } catch {
    // 读取失败不影响主流程:保持「未知」(旧缓存或 null)。
    cache = cache ?? null;
  }
  return cache ?? [];
}

/** 该模型是否已下载就绪(缓存未加载 → false)。 */
export function isEmbeddingModelReady(model: string): boolean {
  const name = model.trim();
  if (!name || !cache) return false;
  return cache.some((m) => m.name === name && m.status === "ready");
}

/** 供测试/诊断:清空状态缓存。 */
export function resetEmbeddingStatusCache(): void {
  cache = null;
}
