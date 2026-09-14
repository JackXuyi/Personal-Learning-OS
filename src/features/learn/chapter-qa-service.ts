/**
 * 章内提问编排（chapter-qa-service）—— 读章/资料 → 检索 → 无 AI 早退 → chat →
 * **锚定 + 归属判定** → 组装 `ChapterAnswer`。
 *
 * 设计（docs/learn-chapter-qa-design-2026-09.md §8.5）：
 * - 本模块是**唯一** import `features/learn/evidence-anchor.ts` 的问答模块：
 *   锚定（`locateQuote`）必须落在 features 层，因为 `ai/` 不得反向依赖
 *   `features/`（分层红线）。`ai/chapter-qa.ts` 只产出 `quotes: string[]`。
 * - **零写入承诺**：本功能不写任何存储 —— 不落问答记录（决策 D2）、不写
 *   evidence、不改掌握度、不改 chunk / chapter / document。
 * - **零伪造引用**：锚不上的 quote 一律丢弃；`found=true` 但零引用锚定时返回
 *   `unanchored`（展示答案 + 显式警示，绝不假装有据）。
 *
 * 约束：错误只产出**分类**（`ChapterQaErrorKind`），文案由 UI 走 i18n 映射
 * （见 `domain/qa.ts` 的说明）。
 */
import type {
  Chapter,
  ChapterAnswer,
  ChapterQaErrorKind,
  QaCitation,
} from "../../domain";
import type { StorageAdapter } from "../../storage";
import type { AIProvider } from "../../ai/types";
import { AiProviderError } from "../../ai/types";
import type { Embedder } from "../../ai/embedding";
import { createEmbedder } from "../../ai/embedding";
import { PIPELINE_LIMITS } from "../../ai/pipeline-core";
import { answerChapterQuestion } from "../../ai/chapter-qa";
import { retrieveChapterContext } from "../../ai/retrieval/chapter-context";
import { storage } from "../../stores/useLoopStore";
import { buildActiveProvider } from "../../stores/useSettingsStore";
import { locateQuote } from "./evidence-anchor";
import { activeEmbeddingModel } from "./index-service";

/** 问题长度上限（UI 与 service 共用同一常量，避免两处口径漂移）。 */
export const MAX_QUESTION_CHARS = 200;

/** 引用条数上限（与 `ai/chapter-qa` 的 quotes 上限同源，避免两处各写一个 5）。 */
export const MAX_CITATIONS = PIPELINE_LIMITS.chapterQaMaxQuotes;

export interface AskChapterInput {
  documentId: string;
  chapterId: string;
  question: string;
  /** 注入用（单测传 mock）。 */
  storage?: StorageAdapter;
  provider?: AIProvider;
  embedder?: Embedder;
}

export async function askChapter(input: AskChapterInput): Promise<ChapterAnswer> {
  const store = input.storage ?? storage;
  const question = input.question.trim();
  const now = Date.now();
  const base = {
    question,
    at: now,
    citations: [] as QaCitation[],
    scopeUsed: "chapter" as const,
  };

  // ⓪ 问题非法：不检索、不调用（UI 已在提交前拦截，service 侧同样拒绝）
  if (question.length === 0 || question.length > MAX_QUESTION_CHARS) {
    return { ...base, status: "error", errorKind: "invalid-question" };
  }

  // ① AI 未就绪 → 早退（不检索、不调用、不伪造）
  const provider = input.provider ?? buildActiveProvider();
  if (!provider.isConfigured()) return { ...base, status: "no-ai" };

  try {
    // ② 取资料与章（锚定基准正文 + 归属章判定依据）
    const doc = await store.getDocument(input.documentId);
    const chapters = await store.listChapters(input.documentId);
    const chapter = chapters.find((c) => c.id === input.chapterId);
    if (!doc || !chapter) return { ...base, status: "error", errorKind: "generic" };
    if (!doc.textPreview) return { ...base, status: "empty" };

    // ③ 检索（向量器不可用则自动仅 FTS）
    const embedder = input.embedder ?? createEmbedder(activeEmbeddingModel());
    const ctx = await retrieveChapterContext({
      storage: store,
      embedder,
      chapterId: input.chapterId,
      documentId: input.documentId,
      query: question,
    });
    if (ctx.candidates === 0) return { ...base, status: "empty" };
    if (ctx.blocks.length === 0) {
      return { ...base, status: "not-found", scopeUsed: ctx.scopeUsed };
    }

    // ④ 调模型（只拿 quotes，偏移一律本地反查）；F1 画像注入背景块（未填写 = undefined）
    const profile = await store.getProfile();
    const draft = await answerChapterQuestion(provider, {
      chapterTitle: chapter.title,
      documentTitle: doc.title,
      question,
      blocks: ctx.blocks,
      learner: profile,
    });
    if (!draft.found) return { ...base, status: "not-found", scopeUsed: ctx.scopeUsed };

    // ⑤ 锚定：每条 quote 必须在文档正文里逐字（或折叠空白后）找到，否则丢弃
    const citations = anchorQuotes(draft.quotes, doc.textPreview, chapters, input.chapterId);

    return {
      ...base,
      scopeUsed: ctx.scopeUsed,
      answer: draft.answer,
      citations,
      status: citations.length > 0 ? "answered" : "unanchored",
    };
  } catch (err) {
    return { ...base, status: "error", errorKind: classifyQaError(err) };
  }
}

/**
 * 引用锚定 + 归属判定（纯函数，可直跑单测）。
 *
 * 三条不变式：
 *   1. 锚不上的 quote **一律丢弃**（零伪造引用，绝不显示模型自造引文）；
 *   2. 命中的区间必须落在某章 `contentRef` 内，否则丢弃（页眉 / 章间过渡段
 *      不算依据，跨章边界的区间同样不归属任何单章）；
 *   3. 输出 `start/end` 为 `doc.textPreview` 绝对偏移，前端自行减去章起点。
 *
 * 锚定唯一入口是 `evidence-anchor.locateQuote`（档 1 精确 / 档 2 折叠空白），
 * 本函数不自造第二套匹配算法。
 */
export function anchorQuotes(
  quotes: readonly string[],
  docText: string,
  chapters: readonly Chapter[],
  currentChapterId: string,
): QaCitation[] {
  const out: QaCitation[] = [];
  const seen = new Set<string>();
  for (const raw of quotes) {
    const quote = raw.trim();
    if (!quote || seen.has(quote)) continue;
    seen.add(quote);
    const hit = locateQuote(docText, quote); // 档1精确 / 档2折叠
    if (!hit) continue; // 不变式 1
    const owner = chapters.find(
      (c) => hit.start >= c.contentRef.start && hit.end <= c.contentRef.end,
    );
    if (!owner) continue; // 不变式 2
    out.push({
      quote,
      start: hit.start,
      end: hit.end,
      chapterId: owner.id,
      chapterTitle: owner.title,
      chapterOrder: owner.order,
      inThisChapter: owner.id === currentChapterId,
    });
    if (out.length >= MAX_CITATIONS) break;
  }
  return out;
}

/**
 * 异常 → 稳定的原因分类（不把异常栈丢给用户；文案由 UI 走 i18n）。
 *
 * - `not-configured` → 未配置 / 密钥失效；
 * - `request-failed` → 主要是模型输出不可解析（`chatJson` / `extractJson`），
 *   这是本地小模型最常见的失败模式（UC-06），故归入 `parse`；
 * - 其它（storage / 检索链路）→ `fetch`。
 */
function classifyQaError(err: unknown): ChapterQaErrorKind {
  if (err instanceof AiProviderError) {
    if (err.code === "not-configured") return "not-configured";
    if (err.code === "request-failed") return "parse";
    return "generic";
  }
  return "fetch";
}
