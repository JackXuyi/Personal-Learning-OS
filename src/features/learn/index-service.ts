/**
 * 向量索引编排服务（index-service）—— 与 split-service 对称的 AI 侧编排。
 *
 * 硬契约(docs/rag-wiring-design-2026-09.md §4.1):
 * - **本模块绝不 import `engine/chunk-engine`**:切分归代码(确定性),
 *   向量化归 AI(可重跑),两者边界不得互相渗透;
 * - **向量化恒定走本地 Embedder**(`ai/embedding.ts`),不经过 `AIProvider`
 *   (决策 D1/D5:聊天可能用云端 API,向量化仍走本机);
 * - 幂等:embedding id 取 `embeddingKey(targetType, targetId, model)`,
 *   同一 (target, model) 重复执行只覆盖不新增;
 * - 分批容错:单批失败**折半重试一次**,仍失败计入 `failed` 并继续下一批,
 *   不整轮中断——这样「重建索引」可以部分成功,失败的下一轮「仅补齐缺失」即可续算。
 *
 * 本模块同时是**索引状态机的外壳**:编排 `useIndexStore`(stores 层)的状态流转,
 * 供设置页与导入弹窗调用。store 自身只存状态、不反向依赖 features(分层约束)。
 */
import type { Chunk, Embedding, EmbeddingTargetType } from "../../domain";
import { embeddingKey } from "../../domain";
import { isTauri } from "@tauri-apps/api/core";
import type { StorageAdapter } from "../../storage";
import {
  createEmbedder,
  EMBED_BATCH_SIZE,
  isEmbeddingModelReady,
  refreshEmbeddingStatus,
  type Embedder,
} from "../../ai/embedding";
import { storage } from "../../stores/useLoopStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useIndexStore } from "../../stores/useIndexStore";

export interface IndexProgress {
  /** 待处理总数（仅缺失模式 = 缺失条数）。 */
  total: number;
  /** 已成功写入的条数。 */
  done: number;
  /** 失败的条数（可重试：下次「仅补齐缺失」会带上）。 */
  failed: number;
}

export interface IndexRunOptions {
  storage: StorageAdapter;
  /**
   * 注入的向量化器(单测用)。不传则按 `model` 构造本地 Embedder
   * —— 浏览器预览下构造不出来 → 抛错(让调用方看到原因,不静默降级)。
   */
  embedder?: Embedder;
  /** 向量化模型名(写入 `Embedding.model`,同时决定判重口径)。 */
  model: string;
  /** 目标类型(当前只支持 "chunk")。 */
  targetType?: EmbeddingTargetType;
  /** 批量大小(默认 16;本地 16 × 1024 维 ≈ 200–300 KB/次 IPC)。 */
  batchSize?: number;
  /** true = 只补缺失向量;false = 全量重建(默认 false)。 */
  onlyMissing?: boolean;
  onProgress?: (p: IndexProgress) => void;
  signal?: AbortSignal;
}

/**
 * 为全部(或缺失的)chunk 生成向量并写回。
 *
 * @throws 前置能力不足时抛错(未配模型 / 本地模型不可用)——
 *         这是**配置问题**,不是运行期抖动,必须让用户看见而不是静默降级。
 */
export async function buildIndex(opts: IndexRunOptions): Promise<IndexProgress> {
  const targetType: EmbeddingTargetType = opts.targetType ?? "chunk";
  const model = opts.model.trim();
  const batchSize = Math.max(1, opts.batchSize ?? EMBED_BATCH_SIZE);

  if (!model) {
    throw new Error(
      "未启用本地向量模型,请在「设置 → AI 模型中心 → 向量索引」下载并启用。",
    );
  }
  const embedder = opts.embedder ?? createEmbedder(model);
  if (!embedder) {
    throw new Error(
      "本地向量模型不可用(需桌面端且模型已下载),请在「设置 → AI 模型中心 → 向量索引」检查。",
    );
  }
  const embed = embedder.embed.bind(embedder);

  const targets = await collectTargets(opts.storage, targetType);
  const existing = await opts.storage.listEmbeddings(targetType);
  const have = new Set(
    existing.filter((e) => e.model === model).map((e) => e.targetId),
  );
  const pending = opts.onlyMissing ? targets.filter((t) => !have.has(t.id)) : targets;

  const progress: IndexProgress = { total: pending.length, done: 0, failed: 0 };
  opts.onProgress?.({ ...progress });

  for (let i = 0; i < pending.length; i += batchSize) {
    if (opts.signal?.aborted) break;
    const batch = pending.slice(i, i + batchSize);
    try {
      const vectors = await embedWithFallback(embed, batch.map((b) => b.text));
      if (vectors.length !== batch.length) {
        throw new Error(`向量条数不匹配：请求 ${batch.length}，返回 ${vectors.length}`);
      }
      const dim = vectors[0]?.length ?? 0;
      if (dim === 0 || vectors.some((v) => v.length !== dim)) {
        throw new Error(`向量维度不一致（首条 ${dim}）`);
      }
      const embeddings: Embedding[] = batch.map((b, j) => ({
        id: embeddingKey(targetType, b.id, model),
        targetType,
        targetId: b.id,
        model,
        vectorDim: dim,
        vector: vectors[j],
        createdAt: Date.now(),
      }));
      await opts.storage.saveEmbeddings(embeddings);
      progress.done += batch.length;
    } catch {
      // 单批失败不中断整轮：失败的条目保持「无向量」，下次可续算。
      progress.failed += batch.length;
    }
    opts.onProgress?.({ ...progress });
  }

  return progress;
}

/** 覆盖率统计（供设置页 / 资料卡展示）。 */
export interface IndexCoverage {
  /** 该类型下可被向量化的目标总数。 */
  total: number;
  /** 当前模型已向量化的条数。 */
  indexed: number;
}

/** 统计覆盖率（只看当前配置的模型，换模型后覆盖率自然归零）。 */
export async function embeddingCoverage(
  model: string,
  opts: { storage?: StorageAdapter; targetType?: EmbeddingTargetType } = {},
): Promise<IndexCoverage> {
  const store = opts.storage ?? storage;
  const targetType: EmbeddingTargetType = opts.targetType ?? "chunk";
  const m = model.trim();
  if (!m) return { total: 0, indexed: 0 };

  const targets = await collectTargets(store, targetType);
  const existing = await store.listEmbeddings(targetType);
  const indexed = new Set(
    existing.filter((e) => e.model === m).map((e) => e.targetId),
  );
  return {
    total: targets.length,
    indexed: targets.filter((t) => indexed.has(t.id)).length,
  };
}

/** 当前配置的本地向量模型名(未配置返回空串)。 */
export function activeEmbeddingModel(): string {
  return useSettingsStore.getState().embedding?.model?.trim() ?? "";
}

/**
 * 带一次「折半重试」的向量化。
 *
 * 本地推理偶发失败(进程重启 / 上下文分配失败)时,整批 16 条直接判死代价太大;
 * 折半成两批各试一次,能救回单条异常导致的整批失败。仍失败则抛回,
 * 由上层计入 `failed`(TC-EDGE-02/03)。
 */
async function embedWithFallback(
  embed: (texts: readonly string[]) => Promise<number[][]>,
  texts: readonly string[],
): Promise<number[][]> {
  try {
    return await embed(texts);
  } catch (err) {
    if (texts.length < 2) throw err;
    const mid = Math.ceil(texts.length / 2);
    const [head, tail] = await Promise.all([
      embed(texts.slice(0, mid)),
      embed(texts.slice(mid)),
    ]);
    return [...head, ...tail];
  }
}

/**
 * 设置页「重建索引 / 仅补齐缺失」入口。
 *
 * 状态机（写入 `useIndexStore`）：
 * `running=true` → 逐批 `progress` → 结束 `running=false` + 刷新覆盖率；
 * 前置能力不足 → `error` 落库并**抛回**给 UI（设置页需要展示原因）。
 */
export async function rebuildIndex(opts: { onlyMissing?: boolean } = {}): Promise<IndexProgress> {
  const store = useIndexStore.getState();
  if (store.running) throw new Error("索引任务正在进行中,请等待完成。");

  const model = activeEmbeddingModel();

  useIndexStore.getState().begin();
  try {
    const out = await buildIndex({
      storage,
      model,
      onlyMissing: opts.onlyMissing ?? false,
      onProgress: (p) => useIndexStore.getState().setProgress(p),
    });
    await useIndexStore.getState().refreshCoverage();
    // 全部失败必须可见:此前单批失败是静默计数,用户只看得到「0% 覆盖率」。
    if (out.done === 0 && out.failed > 0) {
      useIndexStore.getState().fail(`全部 ${out.failed} 块向量化失败,可再点「仅补齐缺失」重试。`);
    } else {
      useIndexStore.getState().finish();
    }
    return out;
  } catch (err) {
    useIndexStore.getState().fail(err instanceof Error ? err.message : String(err));
    throw err;
  }
}

/** 「未自动入队」的原因(undefined = 可以入队)。 */
export type IndexOffReason = "preview" | "disabled" | "no-model";

/**
 * 当前是否具备「自动向量化」能力。
 *
 * 四个条件缺一不可:① 桌面端;② 开关未关;③ 配了本地模型名;④ 该模型
 * 文件已就绪(状态缓存,见 `ai/embedding.ts`)。UI(导入结果卡 / 设置页)与
 * `autoIndexAfterImport` 共用同一判定,避免两处口径漂移导致
 * 「卡片说已入队、实际没跑」。
 *
 * 注:④ 依赖异步拉取的状态缓存;调用方需先 `await refreshEmbeddingStatus()`,
 * 否则按「未就绪」处理(宁可不入队也不谎报)。
 */
export function isAutoIndexCapable(): boolean {
  return autoIndexBlockedReason() === undefined;
}

/** 未自动入队的原因(同步,供 UI 直接映射到文案)。 */
export function autoIndexBlockedReason(): IndexOffReason | undefined {
  if (!isTauri()) return "preview";
  if (useSettingsStore.getState().autoIndexOnImport === false) return "disabled";
  const model = activeEmbeddingModel();
  if (!model) return "no-model";
  if (!isEmbeddingModelReady(model)) return "no-model";
  return createEmbedder(model) === undefined ? "preview" : undefined;
}

/**
 * 导入完成后的后台入队（D2-A：切分后自动入队，不阻塞导入完成态）。
 *
 * 与设置页手动重建的区别:**完全静默**——能力不足(未配模型 / 未下载 /
 * 开关关闭 / 浏览器预览)时直接跳过,不弹错、不改状态,因为导入本身的成功
 * 与向量化无关。即使失败,用户仍可用「重建索引」补上(幂等)。
 *
 * 调用方（除导入外）：替换 / 追加正文、详情页与列表页的手动重切分——
 * 这些路径的 `rebuildChunks` 会清掉旧向量，必须补一次重算（G1）。
 */
export async function autoIndexAfterImport(): Promise<void> {
  // 先刷新模型状态缓存(IPC),否则能力判定会按「未就绪」误判;
  // 不 await 到 rebuild 完成:后台串行执行,让导入结果卡立即返回。
  await refreshEmbeddingStatus();
  if (!isAutoIndexCapable()) return;
  await rebuildIndex({ onlyMissing: true }).catch(() => undefined);
}

// ---------------------------------------------------------------- 内部工具

interface EmbedTarget {
  id: string;
  text: string;
}

/** 收集待向量化的文本（当前只有 chunk 级）。空正文目标直接跳过。 */
async function collectTargets(
  store: StorageAdapter,
  targetType: EmbeddingTargetType,
): Promise<EmbedTarget[]> {
  if (targetType !== "chunk") {
    // 概念层（knowledge）尚未接线，显式空集合而不是抛错——保持调用方逻辑简单。
    return [];
  }
  const docs = await store.listDocuments();
  const out: EmbedTarget[] = [];
  for (const doc of docs) {
    const chunks: Chunk[] = await store.listChunksByDocument(doc.id);
    for (const c of chunks) {
      if (c.content.trim().length === 0) continue;
      out.push({ id: c.id, text: c.content });
    }
  }
  return out;
}
