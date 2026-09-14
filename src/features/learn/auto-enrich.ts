/**
 * 导入后 AI 整理的后台调度（auto-enrich）—— 本能力**唯一有 store 依赖**的一层。
 * （docs/import-ai-enrich-design-2026-09.md §4.3.6）
 *
 * 为什么与 `enrich-service.ts` 分成两个文件：`tests/*.test.ts` 走
 * `node --experimental-strip-types` 直跑，**不能把 zustand / React 拉进测试进程**。
 * 于是纯编排（`enrichDocumentNow` / `createSerialQueue` / `isReplaceableTitle`）
 * 留在 enrich-service 里可直测，store 接线（门控 / 装配 provider / 任务注册）
 * 集中在本文件，不进单测，靠 typecheck + 手工验收兜底。
 *
 * 静默语义（对齐 `index-service.autoIndexAfterImport`）：开关关 / 未配 AI /
 * 资料已被删 / AI 跑失败 → 不弹错、不改任何状态。导入本身的成功与 AI 整理无关，
 * 用户随时可在详情页「概览」Tab 手动重跑（幂等）。
 *
 * **本函数不调用 `notifyDocsChanged`** —— 那会把 import UI 组件层拉进服务模块。
 * 由调用方（ImportModal）在 promise settle 后自行通知。
 */
import { storage } from "../../stores/useLoopStore";
import { buildActiveProvider, useSettingsStore } from "../../stores/useSettingsStore";
import { runAiTask } from "../../stores/useAiTaskStore";
import { createSerialQueue, enrichDocumentNow } from "./enrich-service";

/** 模块级串行队列：批量导入 22 份会连发 22 次 AI 请求，并行只会互相抢算力。 */
const enqueue = createSerialQueue();

export interface AutoEnrichOptions {
  /** 是否允许 AI 覆盖标题（来自 `ImportUnit.titleSource`）。 */
  replaceTitle: boolean;
}

/**
 * 导入成功后的后台 AI 整理（决策 D1：后台异步，不阻塞导入结果卡）。
 *
 * 返回的 promise 在任务 settle 后 resolve（**不 reject**）——调用方可以直接
 * `.then(() => notifyDocsChanged())` 刷新列表，无需再写 catch。
 */
export function scheduleAutoEnrich(docId: string, opts: AutoEnrichOptions): Promise<void> {
  return enqueue(() => runAutoEnrich(docId, opts)).catch(() => undefined);
}

async function runAutoEnrich(docId: string, opts: AutoEnrichOptions): Promise<void> {
  // 门控 1：设置开关（缺省视为开，与 autoIndexOnImport 同口径）。
  if (useSettingsStore.getState().autoEnrichOnImport === false) return;
  // 门控 2：AI 已配置（buildActiveProvider 永不返回 null，用 isConfigured 判）。
  const provider = buildActiveProvider();
  if (!provider.isConfigured()) return;

  const doc = await storage.getDocument(docId);
  if (!doc) return; // 已被删除（覆盖式导入 / 手动删）
  const chapters = await storage.listChapters(docId);
  const model = useSettingsStore.getState().active?.model ?? undefined;

  // 复用详情页同一个任务 id：任务进行中该页按钮自动禁用（防重复算），
  // 失败终态也会在该页 90s 内可见（isTerminalFresh）。
  // 刻意不调用 setPhase：本层拿不到 i18n 文案，存「标记串」会被 UI 原样渲染。
  await runAiTask(`overview:${docId}`, async () => {
    await enrichDocumentNow(doc, chapters, {
      storage,
      provider,
      replaceTitle: opts.replaceTitle,
      ...(model ? { model } : {}),
    });
  });
}
