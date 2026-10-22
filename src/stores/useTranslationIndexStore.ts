/**
 * 译文索引缓存（zustand，**不持久化**）——
 * docs/learn-ai-translation-design-2026-10.md §14.10。
 *
 * 真源是存储层（桌面 = SQLite / 浏览器 = 内存）。本 store 只是把「哪些章已翻」
 * 放进内存，让两处不再反复读库：
 * - 阅读页：译钮三态（未翻 / 已翻 ✓ / 翻译中）；
 * - 设置页：整库进度（已翻 N / M 章）。
 *
 * 为什么不 persist：索引是**存储层的派生视图**，落盘就成了第二份真源 ——
 * 清库 / 删资料 / 重翻之后它必然对不上（而且它以 Map 存，序列化还得再转换一次）。
 *
 * ⚠️ `get()` 命中也**不代表能直接用**：索引行里的 `bodyHash` 只说明「曾经翻过」，
 * 章节可能已被编辑。真正的可用性判定在 `readCachedTranslation`（比对当前正文指纹）。
 */
import { create } from "zustand";
import { translationKeyOf } from "../domain";
import type { TranslationIndexRow, TranslationLang } from "../domain";
import { storage } from "./useLoopStore";

interface TranslationIndexState {
  /** key = `translationKeyOf(docId, chapterId, target)`。 */
  rows: Map<string, TranslationIndexRow>;
  /** 是否已成功从存储层载入过（false 时 UI 不该断言「未翻译」）。 */
  loaded: boolean;
  /** 全量重载（设置页打开 / 整库任务结束后调用）。失败时保持原状，不抛。 */
  refresh: () => Promise<void>;
  /** 单行 upsert（每章翻译完成后立即调用：进度条与按钮立刻变）。 */
  upsert: (row: TranslationIndexRow) => void;
  /** 删单行（「重翻」先删缓存）。 */
  remove: (documentId: string, chapterId: string, target: TranslationLang) => void;
  /** 清空（「清空译文」/ 清库后）。 */
  clear: () => void;
  get: (
    documentId: string,
    chapterId: string,
    target: TranslationLang,
  ) => TranslationIndexRow | undefined;
}

export const useTranslationIndexStore = create<TranslationIndexState>((set, get) => ({
  rows: new Map(),
  loaded: false,

  refresh: async () => {
    try {
      const list = await storage.listTranslationIndex();
      set({ rows: new Map(list.map((r) => [translationKeyOf(r.documentId, r.chapterId, r.target), r])), loaded: true });
    } catch (err) {
      // 读索引失败不该让页面崩：保持旧值（最坏是按钮显示过期的 ✓，
      // 点下去 readCachedTranslation 仍有指纹兜底）。
      console.warn("[translation] 读取译文索引失败", err);
    }
  },

  upsert: (row) =>
    set((s) => {
      const rows = new Map(s.rows);
      rows.set(translationKeyOf(row.documentId, row.chapterId, row.target), row);
      return { rows, loaded: true };
    }),

  remove: (documentId, chapterId, target) =>
    set((s) => {
      const key = translationKeyOf(documentId, chapterId, target);
      if (!s.rows.has(key)) return s; // 无变化不触发订阅（避免无谓重渲染）
      const rows = new Map(s.rows);
      rows.delete(key);
      return { rows };
    }),

  clear: () => set({ rows: new Map(), loaded: true }),

  get: (documentId, chapterId, target) =>
    get().rows.get(translationKeyOf(documentId, chapterId, target)),
}));
