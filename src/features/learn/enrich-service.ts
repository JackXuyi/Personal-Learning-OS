/**
 * 导入后 AI 整理编排（enrich-service）——「资料标题 + 整篇概览」一次写库。
 * （docs/import-ai-enrich-design-2026-09.md §4.3）
 *
 * 与 `analyze-service.generateOverviewNow` 的关系是**并列**而非替代：
 * - `generateOverviewNow`：详情页手动触发，**只用 AI 概览**，从不改标题；
 * - `enrichDocumentNow`：导入后后台触发，**标题 + 概览**一次写入，受 `replaceTitle` 约束。
 *
 * 边界（对齐 analyze-service 的写法）：
 * - 纯编排：只依赖 domain / storage / ai，**不 import stores 与 React**
 *   （node `--experimental-strip-types` 单测可直跑）；
 * - 不做门控：开关与「AI 是否配置」由 auto-enrich.ts 判定，本层只认「已配置的 provider」；
 * - 一次写库：只有成功路径写 `saveDocument`，失败一律向上抛（旧 title/overview 保持不变）；
 * - 概览只依赖正文，**不要求已切分**（与 generateOverviewNow 同口径，无章时按段落分块）。
 *
 * ⚠️ 本文件会被 `tests/enrich-service.test.ts` 在 strip-types 下直跑 ——
 * 不得使用 TS 参数属性（`constructor(readonly x: T)`）与 `enum`。
 */
import type { Chapter, DocumentOverview, SourceDocument } from "../../domain";
import type { StorageAdapter } from "../../storage";
import type { AIProvider } from "../../ai";
import type { OverviewProgress } from "../../ai/overview-pipeline";
import { summarizeDocumentWithAi } from "../../ai/overview-pipeline";
import { aiLog } from "../../ai/log";
import type { ImportUnit } from "./import/types";

/**
 * 整理失败分类（UI 侧按此映射文案，服务层不产出中文）。
 * - `not-configured`：provider 未配置；
 * - `no-body`：资料没有正文；
 * - `failed`：预留给调用方对「AI 已跑但失败」的归类（当前路径直接透传
 *   `AiProviderError`，不吞不包装，故本层暂不产生该值）。
 */
export type EnrichErrorKind = "not-configured" | "no-body" | "failed";

export class EnrichError extends Error {
  readonly kind: EnrichErrorKind;
  constructor(kind: EnrichErrorKind, message: string) {
    super(message);
    this.name = "EnrichError";
    this.kind = kind;
  }
}

/**
 * 标题是否允许 AI 覆盖（`"derived"` 或缺省才可改）。
 *
 * 刻意**不做**「按标题文本猜」的启发式（如「像文件名就替换」）——判定依据必须
 * 显式，否则会出现「用户手填了 `notes.md` 结果被 AI 改名」这类不可预期行为。
 */
export function isReplaceableTitle(source: ImportUnit["titleSource"]): boolean {
  return (source ?? "derived") === "derived";
}

/**
 * 串行队列工厂：`enqueue(fn)` 会等前一个任务 settle 后再跑 `fn`；
 * 前一个任务失败**不阻断**后续（用 `then(task, task)` 而非 `then(task)`）。
 *
 * 为什么需要它：批量导入 22 份资料会连发 22 次后台 AI 请求，本地小模型
 * （qwen3.5:4b）串行跑得动、并行只会互相抢算力并把 UI 状态搅乱。
 * 纯函数、不依赖 store → 可单测。
 */
export function createSerialQueue(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task, task);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

export interface EnrichDocumentOptions {
  storage: StorageAdapter;
  provider: AIProvider;
  /** 是否允许用 AI 标题覆盖现有标题（= `isReplaceableTitle(unit.titleSource)`）。 */
  replaceTitle: boolean;
  /** 仅展示用（写入 `overview.model`），与既有 `generateOverviewNow` 同口径。 */
  model?: string;
  onProgress?: OverviewProgress;
  now?: number;
}

export interface EnrichResult {
  docId: string;
  /** 最终写入的标题（未替换时 = 原标题）。 */
  title: string;
  /** 标题是否真的被改了（供调用方决定提示文案与刷新范围）。 */
  titleChanged: boolean;
  overview: DocumentOverview;
  /** map 阶段失败跳过的块数（>0 时概览未覆盖全文，UI 可提示）。 */
  skipped: number;
}

/**
 * 执行序（**一次写库**，失败不写半成品）：
 * 1. `isConfigured` 为假 → `EnrichError("not-configured")`；
 * 2. 正文 trim 后为空 → `EnrichError("no-body")`；
 * 3. `summarizeDocumentWithAi` → `{ draft, title, mode, chunks, skipped }`
 *    （长度超限 / 解析不合规都由它抛错，本层不吞）；
 * 4. 组装 `DocumentOverview`（`title` 不进 draft，只作兄弟字段）；
 * 5. `nextTitle = replaceTitle && aiTitle ? aiTitle : doc.title`；
 * 6. `saveDocument` —— **唯一写点**；
 * 7. 返回结果（含 `titleChanged`）。
 */
export async function enrichDocumentNow(
  doc: SourceDocument,
  chapters: readonly Chapter[],
  opts: EnrichDocumentOptions,
): Promise<EnrichResult> {
  const { storage, provider, replaceTitle, model, onProgress, now = Date.now() } = opts;
  if (!provider.isConfigured()) {
    throw new EnrichError("not-configured", "AI 未配置。");
  }
  const text = doc.textPreview ?? "";
  if (text.trim().length === 0) {
    throw new EnrichError("no-body", "这份资料没有正文。");
  }

  const startedAt = Date.now();
  // 直接消费「抛错版」管道：AI 建议标题是附加产物，模型未返回时为 undefined，
  // 不影响概览照常产出（见 parseOverviewTitle 的宽松容错）。
  const { draft, title: aiTitle, mode, chunks, skipped } = await summarizeDocumentWithAi(provider, {
    title: doc.title,
    text,
    chapters,
    ...(onProgress ? { onProgress } : {}),
  });

  // ⚠️ `title` 绝不进 draft：DocumentOverview 类型上没有该字段，spread 会污染数据模型。
  const overview: DocumentOverview = {
    ...draft,
    generatedAt: now,
    sourceChars: text.length,
    mode,
    ...(mode === "map-reduce" ? { chunks } : {}),
    ...(model ? { model } : {}),
  };
  const nextTitle = replaceTitle && aiTitle ? aiTitle : doc.title;

  await storage.saveDocument({ ...doc, title: nextTitle, overview });
  aiLog("info", "enrich", "导入后整理完成", {
    doc: doc.id,
    mode,
    chunks,
    skipped,
    titleChanged: nextTitle !== doc.title,
    ms: Date.now() - startedAt,
  });
  return {
    docId: doc.id,
    title: nextTitle,
    titleChanged: nextTitle !== doc.title,
    overview,
    skipped,
  };
}
