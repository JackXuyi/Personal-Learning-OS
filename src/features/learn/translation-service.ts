/**
 * 翻译编排（translation-service）—— 长度门 → AI 就绪阻断门 → 调用 → 错误分类，
 * 以及**缓存读写**（v6 · D3 改判：译文落 SQLite）。
 * （docs/learn-ai-translation-design-2026-10.md §8.4 / §14.10）
 *
 * 三条边界：
 * 1. **不二次读库**：调用方已持有 `doc` / `chapter` 并算好 `body`，本层直接收
 *    正文。两次取数之间可能夹着一次导入 / 重切分 ⇒ 「两把尺子」。
 * 2. **错误只产分类**：`errorKind` 是机器值，文案由 UI 走 i18n
 *    （`features/` 里没有 React 外的消息访问器，且文案要随界面语言切换）。
 * 3. **写缓存失败不抛错**：译文已经给用户看到了，存不住只是「下次要重翻」——
 *    让它冒泡成翻译失败是把一个降级当成错误（`persistTranslation` 返回 boolean）。
 *
 * 本模块是纯 TS（无 React / 无 i18n）→ 可被 `node --experimental-strip-types` 直跑。
 */
import type { AiFailureKind } from "../../ai/failure-kind";
import { aiFailureKindOf } from "../../ai/failure-kind";
import { translateText } from "../../ai/translation";
import type { AIProvider } from "../../ai/types";
import { ANNOTATION_LIMITS, TRANSLATION_LIMITS, bodyFingerprint } from "../../domain";
import type { TranslationLang, TranslationRecord } from "../../domain";
import type { StorageAdapter } from "../../storage";
import { storage } from "../../stores/useLoopStore";
import { buildActiveProvider } from "../../stores/useSettingsStore";

/**
 * 失败原因分类。
 *
 * 前三个是翻译**特有**的门槛（`AiFailureKind` 不产生它们，也不该产生 ——
 * 那是「AI 调用失败」的分类，这三是「还没走到调用」的分类）。
 */
export type TranslationErrorKind = "no-body" | "too-long" | "no-ai" | AiFailureKind;

export type TranslationResult =
  | {
      status: "ok";
      text: string;
      target: TranslationLang;
      /** 实际块数（多块时 UI 用它算「N/K 段未翻译」）。 */
      blocks: number;
      /** 失败 / 空输出被跳过的块数；`> 0` 时 UI 必须如实标注。 */
      skippedBlocks: number;
      /**
       * 被取消（`signal` 中断）。此时 `text` 是**已完成部分** ——
       * 整库任务据此不写库（半章译文存进去，下次会被当成完整译文读出来）。
       */
      cancelled: boolean;
    }
  | { status: "error"; errorKind: TranslationErrorKind; target: TranslationLang };

export interface TranslateChapterBodyInput {
  /** 章正文（调用方已按 `contentRef` 切片）。 */
  body: string;
  target: TranslationLang;
  chapterTitle?: string;
  keyPoints?: readonly string[];
  /** 注入用（单测传 mock）。 */
  provider?: AIProvider;
  /** 块进度（`done` = 已完成块数，从 1 起）；UI 接到 `useAiTask` 的 report 上。 */
  onProgress?: (done: number, total: number) => void;
  /** 每块成功后的增量译文（`index` 从 0 起）；UI 用它逐段上屏。 */
  onBlockDone?: (index: number, text: string) => void;
  /** 取消信号（块间生效）。 */
  signal?: AbortSignal;
}

/**
 * 整章正文翻译。
 *
 * 门槛顺序**不可调换**：长度门 → 就绪门 → 调用。就绪门放在调用前是既有约定
 * （`restatement-service` 的 D6-B），保证「没配模型时零调用、零副作用」；
 * 长度门更靠前是因为它不需要读 provider —— 省一次构造。
 */
export async function translateChapterBody(
  input: TranslateChapterBodyInput,
): Promise<TranslationResult> {
  const body = input.body.trim();
  if (body.length === 0) {
    return { status: "error", errorKind: "no-body", target: input.target };
  }
  // 硬上限：超出**拒绝**，绝不静默截断（截断会让用户以为读的是全章译文）。
  if (body.length > TRANSLATION_LIMITS.bodyMaxChars) {
    return { status: "error", errorKind: "too-long", target: input.target };
  }

  const provider = input.provider ?? buildActiveProvider();
  if (!provider.isConfigured()) {
    return { status: "error", errorKind: "no-ai", target: input.target }; // 阻断门：零调用
  }

  const context = {
    ...(input.chapterTitle ? { title: input.chapterTitle } : {}),
    ...(input.keyPoints?.length ? { keyPoints: input.keyPoints } : {}),
  };

  try {
    const out = await translateText(provider, {
      text: body,
      target: input.target,
      ...(Object.keys(context).length > 0 ? { context } : {}),
      ...(input.onProgress ? { onBlock: input.onProgress } : {}),
      ...(input.onBlockDone ? { onBlockDone: input.onBlockDone } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    });
    return {
      status: "ok",
      text: out.text,
      target: input.target,
      blocks: out.blocks,
      skippedBlocks: out.skippedBlocks,
      cancelled: out.cancelled,
    };
  } catch (err) {
    return { status: "error", errorKind: aiFailureKindOf(err), target: input.target };
  }
}

export interface TranslateSnippetInput {
  /** 划选片段（用户选区，已 trim）。 */
  text: string;
  target: TranslationLang;
  provider?: AIProvider;
}

/**
 * 划选片段翻译（单次调用）。
 *
 * 长度上限**复用** `ANNOTATION_LIMITS.maxQuoteChars`：两者都是「用户选区」口径
 * （选区浮层本身就以这个值卡上限），再造一个 `snippetMaxChars` 就是第二把尺子。
 * ⚠️ 与 `evidence-anchor.ts::MAX_QUOTE_CHARS` 那个 2 000 的**不同**——那个管 AI
 * 摘录灌水，别混用。
 */
export async function translateSnippet(input: TranslateSnippetInput): Promise<TranslationResult> {
  const text = input.text.trim();
  if (text.length === 0) {
    return { status: "error", errorKind: "no-body", target: input.target };
  }
  if (text.length > ANNOTATION_LIMITS.maxQuoteChars) {
    return { status: "error", errorKind: "too-long", target: input.target };
  }

  const provider = input.provider ?? buildActiveProvider();
  if (!provider.isConfigured()) {
    return { status: "error", errorKind: "no-ai", target: input.target };
  }

  try {
    // 片段不加「章标题 / 要点」上下文：用户选中的就是完整语义单元，
    // 塞上下文反而让模型把没选中的内容也译出来。
    const out = await translateText(provider, { text, target: input.target });
    return {
      status: "ok",
      text: out.text,
      target: input.target,
      blocks: out.blocks,
      skippedBlocks: out.skippedBlocks,
      cancelled: out.cancelled,
    };
  } catch (err) {
    return { status: "error", errorKind: aiFailureKindOf(err), target: input.target };
  }
}

/* ------------------------------------------------------------------ */
/* 译文缓存（v6 · D3 改判：落 SQLite）                                  */
/* ------------------------------------------------------------------ */

export interface ReadCachedTranslationInput {
  documentId: string;
  chapterId: string;
  /** 已解析的目标语言（`auto` 必须先经 `resolveTranslationTarget`）。 */
  target: TranslationLang;
  /** **当前**正文（用来算指纹）。传进来而不是在内部读库：调用方刚算过同一份切片。 */
  body: string;
  storage?: StorageAdapter;
}

/**
 * 读缓存译文 —— **命中即含指纹校验**。
 *
 * 三种结果的含义：
 * - 返回记录 → 指纹一致，可直接渲染（0 等待）；
 * - 返回 `undefined` → 没有记录，**或**章节被编辑 / 重切分导致指纹不符；
 * - 抛错 → 存储不可用（调用方自己决定降级，本函数不吞异常 —— 吞了就分不清
 *   「没缓存」与「读不到」，前者该翻译、后者该提示）。
 *
 * ⚠️ 指纹不符时**不删行**：用户可能只是微调章节后又改回来，删了就得重翻几十分钟。
 * 重翻成功会覆盖同一行。
 */
export async function readCachedTranslation(
  input: ReadCachedTranslationInput,
): Promise<TranslationRecord | undefined> {
  const store = input.storage ?? storage;
  const rec = await store.getTranslation(input.documentId, input.chapterId, input.target);
  if (!rec) return undefined;
  return rec.bodyHash === bodyFingerprint(input.body) ? rec : undefined;
}

export interface PersistTranslationInput {
  documentId: string;
  chapterId: string;
  /** 生成译文所用的正文（写指纹用；调用方已持有）。 */
  body: string;
  /** `translateChapterBody` 的成功结果。 */
  result: Extract<TranslationResult, { status: "ok" }>;
  storage?: StorageAdapter;
}

/**
 * 写缓存译文。**永不抛错** —— 返回真正写入的记录，写失败返回 `undefined`。
 *
 * 为什么吞异常：译文此刻已经渲染给用户了，存不住只意味着「下次要重翻」。
 * 让它冒泡会把一个**降级**变成**翻译失败**（用户会看到一个成功的译文配一条错误）。
 * 调用方据返回值决定要不要点亮「已缓存 ✓」标记（索引 store 的 upsert 用它）。
 *
 * ⚠️ 跳过块（`skippedBlocks > 0`）**照存**：整章重翻的成本是几十分钟，而缺段
 * 已在记录里如实带 `skipped`，读回时 UI 会照旧标注「N 段未翻译」。
 * 想补齐就点阅读页的「重翻」（先删缓存再翻）。
 */
export async function persistTranslation(
  input: PersistTranslationInput,
): Promise<TranslationRecord | undefined> {
  const store = input.storage ?? storage;
  const record: TranslationRecord = {
    documentId: input.documentId,
    chapterId: input.chapterId,
    target: input.result.target,
    bodyHash: bodyFingerprint(input.body),
    text: input.result.text,
    blocks: input.result.blocks,
    skipped: input.result.skippedBlocks,
    sourceChars: input.body.length,
    createdAt: Date.now(),
  };
  try {
    await store.saveTranslation(record);
    return record;
  } catch (err) {
    console.warn("[translation] 译文写库失败，本次不缓存", err);
    return undefined;
  }
}
