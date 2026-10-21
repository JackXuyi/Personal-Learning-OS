/**
 * 客观题即时提示的编排层（explain-service · Feature A）。
 *
 * 设计（docs/ai-immediate-explain-design-2026-10.md §8.7）：
 * - **零写入**：不落解释、不改 paper / draft / result / learner / evidence。
 *   与 `chapter-qa-service` 的零写入承诺同一口径 —— 解释是答题会话内的临时物。
 * - **零伪造**：AI 未就绪时**不检索、不生成任何文本**；锚不上的 quote 一律丢弃。
 * - **不让 AI 知道答案**：见 `ai/explain-question.ts` 文件头（决策 D3）。
 *
 * 为什么返回既有 `ChapterAnswer` 而不是新类型：它与章内问答形态完全同构
 * （正文 + 可锚定引用 + 六态），可共用同一套渲染件（`reader/qa-shared.tsx`）。
 * 另起一套状态机 = 同一份分支在两处维护，将来改一处漏一处。
 *
 * 依赖方向：`features/**` 可 import `ai/**` 与 `storage`；反向不可。
 */
import type {
  Chapter,
  ChapterAnswer,
  Paper,
  PaperQuestion,
  QaCitation,
  SourceDocument,
} from "../../domain";
import { isSubjectiveType } from "../../domain";
import type { StorageAdapter } from "../../storage";
import type { AIProvider } from "../../ai/types";
import type { Embedder } from "../../ai/embedding";
import { createEmbedder } from "../../ai/embedding";
import { aiFailureKindOf } from "../../ai/failure-kind";
import { explainQuestion } from "../../ai/explain-question";
import { retrieveChapterContext } from "../../ai/retrieval/chapter-context";
import { storage } from "../../stores/useLoopStore";
import { buildActiveProvider } from "../../stores/useSettingsStore";
import { activeEmbeddingModel } from "../../services/learn/index-service";
import { anchorQuotes } from "../learn/chapter-qa-service";

export interface ExplainQuestionRequest {
  /** 整份试卷：所属资料与章由本模块解析，UI 不做第二次遍历。 */
  paper: Paper;
  /** 目标题 id；本模块按此题取出题面 / 选项 / 归属章。 */
  questionId: string;
  /** 依赖注入（单测传 mock）。 */
  storage?: StorageAdapter;
  provider?: AIProvider;
  embedder?: Embedder;
}

/**
 * 客观题要点提示。
 *
 * 返回 `ChapterAnswer`（status: answered | unanchored | not-found | empty |
 * no-ai | error）。UI 侧按 status 分支渲染，不做隐式兜底。
 */
export async function objectiveQuestionHint(
  req: ExplainQuestionRequest,
): Promise<ChapterAnswer> {
  const store = req.storage ?? storage;
  const q = req.paper.questions.find((x) => x.id === req.questionId);

  // ⓪ 题不存在 / 主观题 → 早退（不检索、不调用、不伪造）
  //    主观题的「卡住」是不知道怎么组织语言，不是不知道答案，且它的 AI 批语
  //    已在判卷页完善（决策 D4）。UI 侧同样按题型判断，双保险。
  if (!q || isSubjectiveType(q.type)) {
    return { question: "", at: Date.now(), citations: [], scopeUsed: "chapter", status: "error" };
  }
  const base = {
    question: q.prompt,
    at: Date.now(),
    citations: [] as QaCitation[],
    scopeUsed: "chapter" as const,
  };

  // ① AI 未就绪 → 早退（不检索、不调用、不伪造）
  const provider = req.provider ?? buildActiveProvider();
  if (!provider.isConfigured()) return { ...base, status: "no-ai" };

  try {
    // ② 定位本题所属资料与章（资料已删则为 undefined —— 绝不显示裸 id）
    const located = await locatePaperSource(store, q.chapterId);
    if (!located) return { ...base, status: "empty" };
    if (!located.doc.textPreview) return { ...base, status: "empty" };

    // ③ 检索：本章命中不足会自动扩展到同资料其他章（既有决策 D1 行为）
    const embedder = req.embedder ?? createEmbedder(activeEmbeddingModel());
    const ctx = await retrieveChapterContext({
      storage: store,
      embedder,
      chapterId: q.chapterId,
      documentId: located.doc.id,
      query: `${q.prompt} ${(q.options ?? []).join(" ")}`.trim(),
    });
    if (ctx.candidates === 0) return { ...base, status: "empty" };
    if (ctx.blocks.length === 0) {
      return { ...base, status: "not-found", scopeUsed: ctx.scopeUsed };
    }

    // ④ 调模型（只拿 quotes，偏移本地反查）
    //    ⚠️ options 原序、无正确项标记（D3）—— 见 ai/explain-question.ts
    const draft = await explainQuestion(provider, {
      question: q.prompt,
      options: q.options,
      chapterTitle: located.chapter?.title ?? "",
      documentTitle: located.doc.title,
      blocks: ctx.blocks,
      depth: "hint",
    });
    if (!draft.found) return { ...base, status: "not-found", scopeUsed: ctx.scopeUsed };

    // ⑤ 锚定：复用既有 anchorQuotes（locateQuote 唯一真源），不自造匹配算法
    const chapters = await store.listChapters(located.doc.id);
    const citations = anchorQuotes(
      draft.quotes,
      located.doc.textPreview,
      chapters,
      q.chapterId,
    );

    return {
      ...base,
      scopeUsed: ctx.scopeUsed,
      answer: draft.explanation,
      citations,
      status: citations.length > 0 ? "answered" : "unanchored",
    };
  } catch (err) {
    return { ...base, status: "error", errorKind: aiFailureKindOf(err) };
  }
}

/**
 * 题目归属章 → 所属资料 + 该章（模块内部函数，不新建文件）。
 *
 * 为什么不复用 `QuizAnswerPage` 里的 `contextLabel()`：那里返回的是**展示文案**
 * （「《RAG 指南》· 第 1–3 章」），拿不到 `doc.id` / `textPreview`，且它已稳定，
 * 不该为了本需求改动。
 *
 * 为什么**不接 `paper`**：方案 §8.7 伪代码里带了 `paper` 参数，但函数体只用
 * `chapterId` —— 章 id 已能唯一定位（`Chapter.id` 全局唯一），多带一个用不到的
 * 参数只会让人误以为「范围来自试卷」。实现偏差已记入 runbook。
 */
export async function locatePaperSource(
  store: StorageAdapter,
  chapterId: string,
): Promise<{ doc: SourceDocument; chapter: Chapter | undefined } | undefined> {
  for (const doc of await store.listDocuments()) {
    const chapters = await store.listChapters(doc.id);
    const chapter = chapters.find((c) => c.id === chapterId);
    if (chapter) return { doc, chapter };
  }
  return undefined; // 资料已删 / 已无此章 → 调用方渲染「无依据」态
}

/** 暴露给 UI 的题型守卫（与 service 侧同一判据，避免两处各写一遍）。 */
export function canExplain(q: PaperQuestion): boolean {
  return !isSubjectiveType(q.type);
}
