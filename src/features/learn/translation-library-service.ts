/**
 * 整库翻译（translation-library-service）—— 遍历资料 × 章节，逐章翻译并写库
 * （docs/learn-ai-translation-design-2026-10.md §14.7）。
 *
 * 三条核心设计：
 *
 * 1. **译文表本身就是进度**。不建队列表、不持久化任务状态 ——
 *    「哪些章还没翻」= `listTranslationIndex()` 与 `listDocuments() × listChapters()`
 *    的差集。因此断点续翻天然成立：应用重启后点「继续」会跳过所有已翻章。
 * 2. **每章完成即写库**。不攒到最后统一写 —— 那样中途崩溃 / 关窗口就白烧几小时 GPU。
 * 3. **失败不中断、不重试**。单章失败只计数（与单章口径一致：全失败才判失败），
 *    整库继续下一章。整库跑几小时，一次网络抖动就整体中止是不可接受的。
 *
 * ⚠️ 取消的真实边界：`AbortSignal` 只能在**块与块之间**生效 —— builtin 的
 * `llm_generate` 没有 cancel 命令，Rust 侧会跑完当前推理。所以点「暂停」后最多
 * 还要等当前这一块（700 字约 25 秒）。UI 文案必须如实说明，不能让用户以为立刻停。
 *
 * 本模块是纯 TS（无 React / 无 i18n）→ 可被 `node --experimental-strip-types` 直跑。
 */
import { translationConcurrencyOf, translateText } from "../../ai/translation";
import type { AIProvider } from "../../ai/types";
import {
  TRANSLATION_LIMITS,
  bodyFingerprint,
  translationKeyOf,
} from "../../domain";
import type { Chapter, TranslationLang, TranslationIndexRow } from "../../domain";
import type { StorageAdapter } from "../../storage";
import { storage } from "../../stores/useLoopStore";
import { buildActiveProvider } from "../../stores/useSettingsStore";
import { useTranslationIndexStore } from "../../stores/useTranslationIndexStore";
import { persistTranslation } from "./translation-service";

export interface LibraryProgress {
  /** 已处理章数（含「已有缓存跳过」与失败章 —— 进度条的分子）。 */
  doneChapters: number;
  /** 可翻译章总数（有正文且未超单章上限）。 */
  totalChapters: number;
  doneChars: number;
  totalChars: number;
  /** 当前正在翻的资料标题（长任务里给用户「它在干活」的锚点）。 */
  currentTitle?: string;
}

export interface LibraryJobInput {
  target: TranslationLang;
  /** 只翻这些资料（缺省 = 全部）。空数组等价于「什么都不翻」。 */
  documentIds?: readonly string[];
  signal?: AbortSignal;
  onProgress?: (p: LibraryProgress) => void;
  /** 每章完成即回调（UI 可立刻点亮该章的「已翻译」标记）。 */
  onChapterDone?: (documentId: string, chapterId: string) => void;
  /** 注入用（单测传 mock / 复用已构造的 provider）。 */
  provider?: AIProvider;
  storage?: StorageAdapter;
}

export interface LibraryJobResult {
  /** 新翻并写库成功的章数。 */
  translated: number;
  /** 索引里已有且指纹一致的章数（零调用）。 */
  skippedExisting: number;
  /** 失败 / 空正文 / 超单章上限的章数。 */
  failed: number;
  /** 被 signal 中断（当前块跑完后退出）。 */
  cancelled: boolean;
}

/** 待翻任务（只存引用，不存正文 —— 整库 150 万字全驻留没必要）。 */
interface ChapterTask {
  documentId: string;
  documentTitle: string;
  chapter: Chapter;
}

/**
 * 整库翻译。
 *
 * 门槛：未配置 AI → 抛 `translation:no-ai`（**机器令牌**，文案由 UI 映射 ——
 * 服务层不得产出面向用户的中文串，见项目「服务层错误串」红线）。
 */
export async function translateLibrary(input: LibraryJobInput): Promise<LibraryJobResult> {
  const store = input.storage ?? storage;
  const provider = input.provider ?? buildActiveProvider();
  if (!provider.isConfigured()) throw new Error("translation:no-ai");

  const docs = await store.listDocuments();
  const scope = input.documentIds ? new Set(input.documentIds) : undefined;
  const indexKey = new Map<string, TranslationIndexRow>();
  for (const row of await store.listTranslationIndex()) {
    indexKey.set(translationKeyOf(row.documentId, row.chapterId, row.target), row);
  }

  // ---- 第一遍：算总量、剔除已缓存（**不发起任何调用**）----
  const tasks: ChapterTask[] = [];
  let totalChapters = 0;
  let totalChars = 0;
  let skippedExisting = 0;
  /** 已缓存章的字数（进度里的「已完成字数」必须从它起算）。 */
  let skippedChars = 0;
  let failed = 0;

  for (const doc of docs) {
    if (scope && !scope.has(doc.id)) continue;
    const text = doc.textPreview ?? "";
    if (text.length === 0) continue;
    const chapters = await store.listChapters(doc.id);
    for (const chapter of chapters) {
      const body = text.slice(chapter.contentRef.start, chapter.contentRef.end);
      // 空正文 / 超单章上限：计入 failed 并**继续**（不中断整库）。
      if (body.trim().length === 0 || body.length > TRANSLATION_LIMITS.bodyMaxChars) {
        failed += 1;
        continue;
      }
      totalChapters += 1;
      totalChars += body.length;
      const cached = indexKey.get(
        translationKeyOf(doc.id, chapter.id, input.target),
      );
      if (cached && cached.bodyHash === bodyFingerprint(body)) {
        skippedExisting += 1;
        skippedChars += body.length;
        continue;
      }
      tasks.push({ documentId: doc.id, documentTitle: doc.title, chapter });
    }
  }

  // ---- 第二遍：按并发度消费任务队列 ----
  const result: LibraryJobResult = {
    translated: 0,
    skippedExisting,
    failed,
    cancelled: false,
  };
  /**
   * ⚠️ 起始值**只含已缓存**，不含第一遍的 `failed` 章 ——
   * 那些章（空正文 / 超单章上限）不在 `totalChapters` 分母里，把它们算进
   * 分子会让进度条一开始就跳到 30% 然后倒着算。它们单独由 `result.failed` 汇报。
   */
  let doneChapters = skippedExisting;
  let doneChars = skippedChars;

  const report = (currentTitle?: string) => {
    input.onProgress?.({
      doneChapters,
      totalChapters,
      doneChars,
      totalChars,
      ...(currentTitle ? { currentTitle } : {}),
    });
  };
  report();

  // 写库串行：并发 worker 各自 await 写入会变成并发 IPC（SQLite 单库写入排队，
  // 还可能与「章节保存」抢锁）。用一个 promise 链把写操作串起来。
  let writeChain: Promise<unknown> = Promise.resolve();
  const serializeWrite = <T,>(fn: () => Promise<T>): Promise<T> => {
    const next = writeChain.then(fn, fn);
    writeChain = next.catch(() => undefined);
    return next;
  };

  let cursor = 0;
  const concurrency = Math.max(1, translationConcurrencyOf(provider.kind));

  const worker = async (): Promise<void> => {
    for (;;) {
      if (input.signal?.aborted) return;
      const task = tasks[cursor];
      cursor += 1;
      if (!task) return;

      const body =
        (await store.getDocument(task.documentId))?.textPreview?.slice(
          task.chapter.contentRef.start,
          task.chapter.contentRef.end,
        ) ?? "";
      if (body.trim().length === 0) {
        // 第一遍之后资料被删 / 被重切分：如实计失败，不硬翻空串。
        result.failed += 1;
        doneChapters += 1;
        report(task.documentTitle);
        continue;
      }

      try {
        const out = await translateText(provider, {
          text: body,
          target: input.target,
          context: {
            ...(task.chapter.title ? { title: task.chapter.title } : {}),
            ...(task.chapter.keyPoints.length > 0
              ? { keyPoints: task.chapter.keyPoints.slice(0, 5) }
              : {}),
          },
          ...(input.signal ? { signal: input.signal } : {}),
        });
        if (out.cancelled) {
          // 半章译文不写库（下次会被当成完整译文读出来）。
          result.cancelled = true;
          return;
        }
        const saved = await serializeWrite(() =>
          persistTranslation({
            documentId: task.documentId,
            chapterId: task.chapter.id,
            body,
            result: {
              status: "ok",
              text: out.text,
              target: input.target,
              blocks: out.blocks,
              skippedBlocks: out.skippedBlocks,
              cancelled: false,
            },
            storage: store,
          }),
        );
        if (saved) {
          result.translated += 1;
          // 索引立即更新：整库跑几十分钟，UI 的「已翻 N 章」要跟着走，
          // 不能等任务结束才全量刷新。
          useTranslationIndexStore.getState().upsert(saved);
          input.onChapterDone?.(task.documentId, task.chapter.id);
        } else {
          // 存不住（配额 / SQLite 不可用）：这章的活白干了 ⇒ 计入失败，
          // 不要报「已翻 N 章」却查不到（下次还得重翻）。
          result.failed += 1;
        }
      } catch {
        result.failed += 1;
      }
      doneChapters += 1;
      doneChars += body.length;
      report(task.documentTitle);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  /**
   * 取消判定**只看用户有没有喊停**，不看队列还剩多少。
   *
   * 别写成 `signal.aborted && cursor < tasks.length`：`cursor` 在**取任务时**就自增，
   * 所以在最后一章按下暂停时 `cursor === tasks.length`，而那章其实被丢弃了 ——
   * 那样会报「这次翻好了 N 章」而不是「已暂停」，用户以为跑完了。
   */
  if (input.signal?.aborted) result.cancelled = true;
  report();
  return result;
}
