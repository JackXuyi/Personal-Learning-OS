/**
 * AI 提示词流水线 —— 在 AIProvider.chat() 传输层之上的一组能力管道。
 *
 * 本文件已收敛为**薄聚合层**：自身只保留出题 / 批改两条管道与两个兼容执行器；
 * 其余能力按域拆到同目录模块，并在此 re-export 以保持既有 import 路径
 * （`tests/*`、`analyze-service`）零改动：
 *
 * | 能力 | 实现模块 |
 * |------|----------|
 * | 传输 / JSON 归一化 / 尺寸上限 | `pipeline-core.ts` |
 * | 通用文本分块与摘录 | `text-blocks.ts` |
 * | 章节精修（分批 + 全局下标重映射） | `refine-batch.ts` |
 * | 要点抽取（章内 map-reduce + 引用式归并） | `chapter-map-reduce.ts` |
 * | 概念抽取（同上 + 关系下标重建） | `concept-map-reduce.ts` |
 * | 出题题面生成 / 主观题批改 / 兼容执行器 | 本文件 |
 *
 * 拆分原因：本文件曾达 803 行，超出 `rules/code-structure-and-dependencies`
 * 的 700 行硬上限。
 *
 * 诚实降级：任何管道失败（未配置 / 网络 / 解析）都向上抛错或返回空，绝不
 * 伪造内容（P0-3）；调用方统一回退到本地确定性实现。
 */
import type {
  Chapter,
  KnowledgeRelation,
  KnowledgeUnit,
  Paper,
  PaperQuestion,
} from "../domain";
import { newId } from "../domain";
import type { ChapterRefine } from "../engine/splitter-engine";
import { applyChapterRefine } from "../engine/splitter-engine";
import type { AIProvider, ChatMessage } from "./types";
import { AiProviderError } from "./types";
import { excerptOf } from "./text-blocks";
import {
  PIPELINE_LIMITS,
  TEMPERATURE,
  chatJson,
  extractJson,
  isRecord,
  str,
} from "./pipeline-core";
import type { AiKeyPointDraft } from "./chapter-map-reduce";
import {
  buildKeyPointBlockMessages,
  buildKeyPointMessages,
  parseKeyPointBlockDrafts,
  parseKeyPointDrafts,
  planChapterBlocks,
} from "./chapter-map-reduce";
import type { AiConceptDraft, AiRelationDraft } from "./concept-map-reduce";
import {
  buildConceptBlockMessages,
  buildConceptMessages,
  materializeRelations,
  parseConceptDrafts,
  remapRelationDrafts,
} from "./concept-map-reduce";
import { refineChaptersBatched } from "./refine-batch";

/* ------------------------------------------------------------------ */
/* 0) 兼容 re-export（实现均已下沉到同目录模块）                        */
/* ------------------------------------------------------------------ */

/** 传输 / JSON 归一化 / 尺寸上限（实现见 `pipeline-core.ts`）。 */
export { PIPELINE_LIMITS, chatJson, extractJson, isRecord, str };

/** 通用分块与摘录（实现见 `text-blocks.ts`）。 */
export { excerptOf, planTextBlocks, adaptiveChunkChars } from "./text-blocks";
export type { TextBlock, PlanTextBlocksInput } from "./text-blocks";

/** 章节精修（实现见 `refine-batch.ts`）。 */
export {
  buildRefineMessages,
  parseChapterRefines,
  planRefineBatches,
  refineChaptersBatched,
} from "./refine-batch";
export type { RefineBatch } from "./refine-batch";

/** 要点抽取（实现见 `chapter-map-reduce.ts`）。 */
export {
  planChapterBlocks,
  buildKeyPointMessages,
  buildKeyPointBlockMessages,
  parseKeyPointDrafts,
  parseKeyPointBlockDrafts,
  parseKeyPointMerge,
  extractKeyPointsMapped,
} from "./chapter-map-reduce";
export type {
  AiKeyPointDraft,
  KeyPointCandidate,
  AnchorFn,
  MappedKeyPointResult,
} from "./chapter-map-reduce";

/** 概念抽取（实现见 `concept-map-reduce.ts`）。 */
export {
  buildConceptMessages,
  buildConceptBlockMessages,
  parseConceptDrafts,
  parseConceptRelations,
  parseConceptMerge,
  extractConceptsMapped,
} from "./concept-map-reduce";
export type {
  AiConceptDraft,
  AiRelationDraft,
  ConceptCandidate,
  MappedConceptResult,
} from "./concept-map-reduce";

/* ------------------------------------------------------------------ */
/* 1) 章节切分 AI 精修（splitDocument AI 精修，T12a）                  */
/* ------------------------------------------------------------------ */

/**
 * 章节精修：对启发式切分结果跑 AI 精修。
 *
 * 实现已改为**分批委派**（`refine-batch.ts`）：不再对整篇设「>6 万字 / >24 章
 * 静默跳过」的硬门槛，长资料同样能真正精修，且单批失败只丢该批。
 * 签名与「失败返回空数组」的降级语义保持不变（调用方零改动）。
 */
export async function refineChaptersWithAi(
  provider: AIProvider,
  chapters: readonly Chapter[],
  text: string,
): Promise<ChapterRefine[]> {
  if (chapters.length === 0) return [];
  try {
    const { refines } = await refineChaptersBatched(provider, chapters, text);
    return refines;
  } catch {
    // 与改造前一致的降级：不抛错，返回空建议（UI 侧已给出「无建议」提示）。
    return [];
  }
}

/** 供 UI 直接调用：provider 就绪则精修、失败/未就绪回退启发式结果（永不抛错）。 */
export async function refineSplitResult(
  provider: AIProvider,
  chapters: readonly Chapter[],
  text: string,
): Promise<{ chapters: Chapter[]; refined: boolean }> {
  if (!provider.isConfigured() || chapters.length === 0) {
    return { chapters: [...chapters], refined: false };
  }
  try {
    const refines = await refineChaptersWithAi(provider, chapters, text);
    const next = applyChapterRefine([...chapters], refines);
    const changed =
      next.length !== chapters.length ||
      next.some((c, i) => c.title !== chapters[i].title || c.keyPoints.join("\u0001") !== chapters[i].keyPoints.join("\u0001"));
    return { chapters: next, refined: changed };
  } catch {
    // 诚实降级：AI 精修失败不阻断导入，保留启发式章节。
    return { chapters: [...chapters], refined: false };
  }
}

/* ------------------------------------------------------------------ */
/* 2) 出卷题面 AI 生成（generateQuizQuestions，T12b）                  */
/* ------------------------------------------------------------------ */

const QUIZ_SYSTEM =
  "你是学习测评的出题老师。用户会给出若干章的正文摘录与一张卷的题型清单，请按清单逐题出题。\n" +
  "要求：\n" +
  "- 题面围绕对应章节内容，作答依据必须来自正文摘录，不引入摘录外的知识；\n" +
  "- choice：恰好 4 个选项，各 ≤40 字，干扰项与本章内容相关但错误，正确项唯一；\n" +
  "- judge：给出可明确判对/错的一句话论断；\n" +
  "- qa / application：给出开放式题干与评分参考 referenceAnswer（要点式，≤120 字）；\n" +
  "- 输出 JSON 数组、顺序与题目清单一致、长度一致（不要 markdown 围栏与多余文字）。" +
  '元素格式：{"type":"choice|judge|qa|application","prompt":"题干","options":["…","…","…","…"],"answer":2,"referenceAnswer":"评分参考(主观题必填，客观题可省略)"}，choice 的 answer 为正确项下标（0 起），judge 的 answer 为 true/false。';

/** 纯函数：构建出题提示词。profile = 本地 createPaper 产出的题（配额单源）。 */
export function buildQuizGenMessages(
  chapters: readonly Chapter[],
  text: string,
  profile: readonly PaperQuestion[],
): ChatMessage[] {
  // 章上下文（去重一次）：题号 → 标题 + keyPoints + 摘录。
  const ctxByChapter = new Map<string, { no: number; title: string; excerpt: string }>();
  for (const q of profile) {
    if (ctxByChapter.has(q.chapterId)) continue;
    const c = chapters.find((cc) => cc.id === q.chapterId);
    if (!c) continue;
    ctxByChapter.set(q.chapterId, {
      no: c.order,
      title: c.title || `第 ${c.order} 章`,
      excerpt: excerptOf(text, c.contentRef.start, c.contentRef.end, PIPELINE_LIMITS.quizExcerptChars),
    });
  }
  const ctxLines = [...ctxByChapter.values()].map(
    (ctx) => `[章 ${ctx.no}] ${ctx.title}\n${ctx.excerpt || "(无正文摘录)"}`,
  );

  const typeLabel: Record<PaperQuestion["type"], string> = {
    choice: "选择题",
    judge: "判断题",
    qa: "问答题",
    application: "应用题",
  };
  const qLines = profile.map((q, i) => {
    const ctx = ctxByChapter.get(q.chapterId);
    return `${i + 1}. 章「${ctx?.title ?? q.chapterId}」· ${typeLabel[q.type]}：针对本章内容出题。`;
  });

  return [
    { role: "system", content: QUIZ_SYSTEM },
    {
      role: "user",
      content:
        `章节正文摘录（作答依据）：\n${ctxLines.join("\n\n")}\n\n` +
        `题目清单（共 ${profile.length} 题，输出数组必须逐题对应）：\n${qLines.join("\n")}`,
    },
  ];
}

/** AI 出题的单题草稿（内容字段；id/认知层级/难度由本地卷保持）。 */
export interface AiQuizDraft {
  type: PaperQuestion["type"];
  prompt: string;
  options?: string[];
  answer?: string;
  referenceAnswer?: string;
}

function sanitizeDraft(raw: unknown, expected: PaperQuestion): AiQuizDraft | undefined {
  if (!isRecord(raw) || raw.type !== expected.type) return undefined;
  const prompt = str(raw.prompt)?.trim();
  if (!prompt || prompt.length > 600) return undefined;

  if (expected.type === "choice") {
    const options = Array.isArray(raw.options)
      ? raw.options
          .filter((o): o is string => typeof o === "string" && o.trim().length > 0)
          .map((o) => (o.length <= 40 ? o : `${o.slice(0, 40)}…`))
      : [];
    if (options.length < 2 || options.length > 6) return undefined;
    const idx = raw.answer;
    if (typeof idx !== "number" || !Number.isInteger(idx) || idx < 0 || idx >= options.length) {
      return undefined;
    }
    return { type: "choice", prompt, options, answer: String(idx) };
  }

  if (expected.type === "judge") {
    const a = raw.answer;
    const answer = a === true || a === "true" ? "true" : a === false || a === "false" ? "false" : undefined;
    if (!answer) return undefined;
    return { type: "judge", prompt, answer };
  }

  // qa / application：题干可用即接受，评分参考缺省沿用本地。
  const referenceAnswer = str(raw.referenceAnswer)?.trim();
  return {
    type: expected.type,
    prompt,
    referenceAnswer: referenceAnswer || expected.referenceAnswer,
  };
}

/**
 * 纯函数：把 AI 返回的草稿按本地卷逐题合并。
 * 逐题校验，任何不合规的一题自动回退本地题面（长度/题型永不漂移）。
 */
export function mergeAiQuizContent(
  profile: readonly PaperQuestion[],
  raw: unknown,
): PaperQuestion[] {
  if (!Array.isArray(raw)) {
    throw new AiProviderError("request-failed", "AI 出题响应不是数组。");
  }
  return profile.map((q, i) => {
    const draft = sanitizeDraft(raw[i], q);
    if (!draft) return q; // 缺题 / 不合规 → 本地题面兜底
    const next: PaperQuestion = { ...q, prompt: draft.prompt };
    if (draft.type === "choice") {
      next.options = draft.options;
      next.answer = draft.answer;
    } else if (draft.type === "judge") {
      next.answer = draft.answer;
      next.options = undefined;
    } else {
      next.referenceAnswer = draft.referenceAnswer;
      next.options = undefined;
      next.answer = undefined;
    }
    return next;
  });
}

/**
 * 出卷题面 AI 生成：题量/题型配额来自本地 createPaper 产物（单源），
 * 由 AI 逐题改写题面；整体失败或提示词超限 → 回退本地卷（原样返回）。
 */
export async function generateQuizQuestionsWithAi(input: {
  provider: AIProvider;
  paper: Paper;
  chapters: readonly Chapter[];
  /** 所属文档正文（chapter.contentRef 所在原文）。 */
  text: string;
}): Promise<PaperQuestion[]> {
  const { provider, paper, chapters, text } = input;
  const profile = paper.questions;
  if (profile.length === 0) return profile;
  const messages = buildQuizGenMessages(chapters, text, profile);
  const totalChars = messages.reduce((n, m) => n + m.content.length, 0);
  if (totalChars > PIPELINE_LIMITS.quizMaxPromptChars) return profile;
  const raw = await chatJson(provider, messages, TEMPERATURE.quiz);
  return mergeAiQuizContent(profile, raw);
}

/* ------------------------------------------------------------------ */
/* 3) 主观题 AI 批改（T12c）                                          */
/* ------------------------------------------------------------------ */

/** 批改输入：一道主观题 + 学生作答 + 章上下文（定位要点用）。 */
export interface SubjectiveGradeItem {
  questionId: string;
  /** 请求内短标签（q1..qN，避免让模型回显长 id）。 */
  label: string;
  chapterTitle: string;
  keyPoints: string[];
  prompt: string;
  referenceAnswer?: string;
  answerText: string;
}

/** 批改输出（结构对齐 engine.SubjectiveGradeFeed，attach 直接消费）。 */
export interface SubjectiveGradeResult {
  questionId: string;
  /** 0..1。 */
  score: number;
  feedback: string;
  point?: string;
}

const GRADE_SYSTEM =
  "你是严谨的学科批改老师。用户会给出一批主观题：每道含章节标题、章要点、题干、评分参考与学生作答。\n" +
  "请逐题评判：\n" +
  "- score：0–1 的掌握度得分（0.6 视为通过），依据作答是否准确、完整、切中要点，宁可严格不灌水；\n" +
  "- feedback：≤120 字中文批语，说清对在哪/错在哪/遗漏了什么/如何改进；\n" +
  "- point：作答命中或遗漏的章要点（尽量直接引用要点原文；没有可引用时为空字符串）。\n" +
  "只输出一个 JSON 数组（不要 markdown 围栏与多余文字），元素格式：" +
  '{"label":"q1","score":0.7,"feedback":"…","point":"…"}，label 必须与输入一致。';

/** 纯函数：构建批改提示词。 */
export function buildGradeMessages(items: readonly SubjectiveGradeItem[]): ChatMessage[] {
  const lines = items.map(
    (it) =>
      `[${it.label}] 章「${it.chapterTitle || "(未知章)"}」\n` +
      `章要点：${it.keyPoints.length > 0 ? it.keyPoints.map((k) => `· ${k}`).join(" ") : "(无)"}\n` +
      `题干：${it.prompt}\n` +
      `评分参考：${it.referenceAnswer ?? "(无)"}\n` +
      `学生作答：${it.answerText}`,
  );
  return [
    { role: "system", content: GRADE_SYSTEM },
    { role: "user", content: `待批改题目（共 ${items.length} 道）：\n\n${lines.join("\n\n")}` },
  ];
}

/** 纯函数：解析批改响应 → 按 label 回填 questionId 并规范化（0..1 夹取）。 */
export function parseSubjectiveGrades(
  raw: unknown,
  items: readonly SubjectiveGradeItem[],
): SubjectiveGradeResult[] {
  if (!Array.isArray(raw)) {
    throw new AiProviderError("request-failed", "AI 批改响应不是数组。");
  }
  const byLabel = new Map(items.map((it) => [it.label, it]));
  const out: SubjectiveGradeResult[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const target = byLabel.get(str(item.label) ?? "");
    if (!target) continue;
    const score = typeof item.score === "number" && Number.isFinite(item.score)
      ? Math.min(1, Math.max(0, item.score))
      : undefined;
    if (score === undefined) continue;
    const feedback = str(item.feedback)?.trim() ?? "（无批语）";
    const point = str(item.point)?.trim();
    out.push({
      questionId: target.questionId,
      score,
      feedback,
      ...(point ? { point } : {}),
    });
  }
  return out;
}

/** 主观题批改执行器：分批调用（gradeChunkSize/请求），聚合返回。 */
export async function gradeSubjectiveWithAi(
  provider: AIProvider,
  items: readonly SubjectiveGradeItem[],
): Promise<SubjectiveGradeResult[]> {
  if (items.length === 0) return [];
  const out: SubjectiveGradeResult[] = [];
  const chunk = PIPELINE_LIMITS.gradeChunkSize;
  for (let i = 0; i < items.length; i += chunk) {
    const group = items.slice(i, i + chunk);
    const raw = await chatJson(provider, buildGradeMessages(group), TEMPERATURE.grade);
    out.push(...parseSubjectiveGrades(raw, group));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 4) 章概念 AI 抽取 · 兼容执行器（章内分块 map + 代码级合并）          */
/* ------------------------------------------------------------------ */

/**
 * 章概念抽取（既有签名的**兼容执行器**）。
 *
 * 与改造前的差异：不再因单章 > 4 万字直接抛错 —— 内部改为章内分块 map +
 * 代码级合并去重，长章同样能出概念。
 *
 * 与 `extractConceptsMapped` 的差异：本函数**不接收锚定回调**，因此
 * `evidence.start/end` 恒为 -1（占位），由调用方用 `locateQuote` 回填或整体移除；
 * 也**不跑 AI 归并**（归并的引用式继承要求候选先锚定）。
 * 需要一步到位的调用方请直接用 `extractConceptsMapped`。
 */
export async function extractChapterConceptsWithAi(
  provider: AIProvider,
  input: { chapterTitle: string; text: string; documentId?: string },
): Promise<{ units: KnowledgeUnit[]; relations: KnowledgeRelation[] }> {
  const body = input.text.trim();
  if (body.length === 0) {
    throw new AiProviderError("request-failed", "章正文为空，无法提炼概念。");
  }
  const blocks = planChapterBlocks(body);
  const now = Date.now();

  /** map 中间态：概念草稿 + 已在「全局候选下标空间」的关系。 */
  const drafts: AiConceptDraft[] = [];
  const rawRelations: AiRelationDraft[] = [];

  if (blocks.length <= 1) {
    if (body.length > PIPELINE_LIMITS.conceptBlockMaxChars) {
      throw new AiProviderError(
        "request-failed",
        `单块仍过长（${body.length} 字，上限 ${PIPELINE_LIMITS.conceptBlockMaxChars}），分块算法异常，请排查。`,
      );
    }
    const raw = await chatJson(
      provider,
      buildConceptMessages({ chapterTitle: input.chapterTitle, text: body }),
      TEMPERATURE.concept,
    );
    const parsed = parseConceptDrafts(raw);
    drafts.push(...parsed.units);
    rawRelations.push(...parsed.relations);
  } else {
    for (let k = 0; k < blocks.length; k++) {
      try {
        const raw = await chatJson(
          provider,
          buildConceptBlockMessages({
            blockIndex: k,
            blockTotal: blocks.length,
            chapterTitle: input.chapterTitle,
            text: body.slice(blocks[k].start, blocks[k].end),
          }),
          TEMPERATURE.concept,
        );
        const parsed = parseConceptDrafts(raw);
        // 块内下标 → 全局候选下标（偏移 = 本块之前的候选总数）。
        const offset = drafts.length;
        for (const r of parsed.relations) {
          rawRelations.push({ from: r.from + offset, to: r.to + offset, type: r.type });
        }
        drafts.push(...parsed.units);
      } catch {
        // 单块失败跳过：其余块仍可用（与 mapped 版一致）。
      }
    }
    if (drafts.length === 0) {
      throw new AiProviderError("request-failed", "所有分块提炼均失败，未能得到任何概念。");
    }
  }

  // 代码级合并：按 title 去重（保首条），关系端点随后按下标映射搬家。
  const seen = new Map<string, number>();
  const indexMap: number[] = [];
  const unique: AiConceptDraft[] = [];
  drafts.forEach((d, i) => {
    const key = d.title.trim();
    const hit = seen.get(key);
    if (hit !== undefined) {
      indexMap[i] = hit;
      return;
    }
    seen.set(key, unique.length);
    indexMap[i] = unique.length;
    unique.push(d);
  });

  const relations = remapRelationDrafts(rawRelations, (i) => indexMap[i], unique.length);
  const units: KnowledgeUnit[] = unique.map((d) => ({
    id: newId("unit"),
    title: d.title,
    kind: d.kind,
    ...(d.summary ? { summary: d.summary } : {}),
    tags: d.tags,
    createdAt: now,
    // 未锚定占位（start/end = -1）；调用方负责用 locateQuote 定位或整体移除。
    ...(d.quote && input.documentId
      ? { evidence: { documentId: input.documentId, start: -1, end: -1, quote: d.quote } }
      : {}),
  }));
  return { units, relations: materializeRelations(relations, units.map((u) => u.id)) };
}

/* ------------------------------------------------------------------ */
/* 5) 章要点 AI 抽取 · 兼容执行器（章内分块 map + 代码级合并）          */
/* ------------------------------------------------------------------ */

/**
 * 章要点抽取（既有签名的**兼容执行器**）。
 *
 * 与改造前的差异：不再因单章 > 4 万字直接抛错 —— 内部改为章内分块 map +
 * 代码级合并去重，长章同样能出要点。
 *
 * 与 `extractKeyPointsMapped` 的差异：返回的草稿**不含偏移**（由调用方用
 * `locateQuote` 锚定），也**不跑 AI 归并**。需要一步到位的调用方请直接用
 * `extractKeyPointsMapped`（它注入 anchor 并做引用式归并）。
 */
export async function extractKeyPointsWithAi(
  provider: AIProvider,
  input: { chapterTitle: string; text: string },
): Promise<AiKeyPointDraft[]> {
  const body = input.text.trim();
  if (body.length === 0) {
    throw new AiProviderError("request-failed", "章正文为空，无法提炼要点。");
  }
  const blocks = planChapterBlocks(body);

  if (blocks.length <= 1) {
    if (body.length > PIPELINE_LIMITS.keyPointBlockMaxChars) {
      throw new AiProviderError(
        "request-failed",
        `单块仍过长（${body.length} 字，上限 ${PIPELINE_LIMITS.keyPointBlockMaxChars}），分块算法异常，请排查。`,
      );
    }
    const raw = await chatJson(
      provider,
      buildKeyPointMessages({ chapterTitle: input.chapterTitle, text: body }),
      TEMPERATURE.keyPoint,
    );
    return parseKeyPointDrafts(raw);
  }

  const out: AiKeyPointDraft[] = [];
  const seen = new Set<string>();
  for (let k = 0; k < blocks.length; k++) {
    try {
      const raw = await chatJson(
        provider,
        buildKeyPointBlockMessages({
          blockIndex: k,
          blockTotal: blocks.length,
          text: body.slice(blocks[k].start, blocks[k].end),
        }),
        TEMPERATURE.keyPoint,
      );
      for (const d of parseKeyPointBlockDrafts(raw)) {
        if (seen.has(d.point)) continue;
        seen.add(d.point);
        out.push(d);
        if (out.length >= PIPELINE_LIMITS.keyPointMergeMax) break;
      }
    } catch {
      // 单块失败跳过：其余块仍可用（与 mapped 版一致）。
    }
    if (out.length >= PIPELINE_LIMITS.keyPointMergeMax) break;
  }
  if (out.length === 0) {
    throw new AiProviderError("request-failed", "所有分块提炼均失败，未能得到任何要点。");
  }
  return out;
}
