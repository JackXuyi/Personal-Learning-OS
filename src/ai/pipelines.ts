/**
 * AI 提示词流水线（N3/T12）—— 在 AIProvider.chat() 传输层之上的一组能力管道。
 *
 * 设计（docs/learning-system-v2-design-2026-09.md §5.6）：
 * 每条能力 = 纯函数提示词构建（可单测）+ 严格 JSON 解析/校验 + 执行器
 * （provider 就绪时调用 chat，失败抛 AiProviderError 由调用方降级）。
 * AIProvider 契约保持「只做传输」，业务能力全部沉淀在这里，避免在各 Provider
 * 实现里复制提示词逻辑。
 *
 * 三条管道：
 * 1. refineChaptersWithAi / refineSplitResult —— 章节切分 AI 精修
 *    （标题提炼 + keyPoints + 过碎章并入，T12a；消费点 ImportModal / 目录页）；
 * 2. generateQuizQuestionsWithAi / mergeAiQuizContent —— 出卷题面 AI 生成
 *    （按本地卷的题型配额逐题替换题面，校验失败回退本地，T12b；消费点 NewQuizPage）；
 * 3. gradeSubjectiveWithAi / parseSubjectiveGrades —— 主观题 AI 批改
 *    （0-1 得分 + 批语 + 定位要点，T12c；消费点 QuizGradingPage）。
 *
 * 诚实降级：任何管道失败（未配置 / 网络 / 解析）都向上抛错或返回空，绝不
 * 伪造内容（P0-3）；调用方统一回退到本地确定性实现。
 */
import type { Chapter, Paper, PaperQuestion } from "../domain";
import type { ChapterRefine } from "../engine/splitter-engine";
import { applyChapterRefine } from "../engine/splitter-engine";
import type { AIProvider, ChatMessage } from "./types";
import { AiProviderError } from "./types";

/* ------------------------------------------------------------------ */
/* 共享工具                                                            */
/* ------------------------------------------------------------------ */

/** 各管道输入尺寸上限（防止提示词超出小模型上下文）。 */
export const PIPELINE_LIMITS = {
  /** AI 精修的最大章数（再多直接跳过，启发式产出已可用）。 */
  refineMaxChapters: 24,
  /** AI 精修的最大文档字符数。 */
  refineMaxTextChars: 60_000,
  /** 出题提示词总字符上限（超出回退本地题库）。 */
  quizMaxPromptChars: 32_000,
  /** 正文摘录每章最大字符（出题上下文）。 */
  quizExcerptChars: 700,
  /** 主观批改单请求最大条数（超出分批）。 */
  gradeChunkSize: 8,
};

/** 温度：精修/出题偏稳定，批改最低（事实判定）。 */
const TEMPERATURE = { refine: 0.2, quiz: 0.3, grade: 0.1 };

/** 取章正文的摘录（去掉标题行与多余空白；maxChars 截断）。 */
function chapterExcerpt(text: string, start: number, end: number, maxChars: number): string {
  const raw = text
    .slice(start, end)
    .replace(/^#{1,6}\s+.*$/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  if (raw.length === 0) return "";
  return raw.length <= maxChars ? raw : `${raw.slice(0, maxChars)}…`;
}

/** 从模型输出中抽出首个 JSON（剥掉 ```json 围栏与前后说明文字）。 */
export function extractJson(content: string): unknown {
  const stripped = content
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim();
  // 取剥离后首个「{ 或 [」到末个「} 或 ]」。
  const open = stripped.search(/[\[{]/);
  const close = Math.max(stripped.lastIndexOf("}"), stripped.lastIndexOf("]"));
  if (open === -1 || close <= open) {
    throw new AiProviderError(
      "request-failed",
      `AI 返回内容中未找到 JSON：${stripped.slice(0, 120) || "(空)"}`,
    );
  }
  try {
    return JSON.parse(stripped.slice(open, close + 1)) as unknown;
  } catch {
    throw new AiProviderError(
      "request-failed",
      `AI 返回的 JSON 无法解析：${stripped.slice(open, Math.min(close + 1, open + 160))}…`,
    );
  }
}

/** 发起一次「期望返回 JSON」的 chat；未配置 / 失败都以带类型错误抛出。 */
export async function chatJson(
  provider: AIProvider,
  messages: ChatMessage[],
  temperature: number,
): Promise<unknown> {
  if (!provider.isConfigured()) {
    throw new AiProviderError(
      "not-configured",
      "AI 未就绪：请到「设置 → AI 模型中心」配置本地模型或 API。",
    );
  }
  const { content } = await provider.chat({ messages, temperature });
  if (!content) {
    throw new AiProviderError("request-failed", "AI 返回了空内容。");
  }
  return extractJson(content);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/* ------------------------------------------------------------------ */
/* 1) 章节切分 AI 精修（splitDocument AI 精修，T12a）                  */
/* ------------------------------------------------------------------ */

const REFINE_SYSTEM =
  "你是严谨的学习资料章节编辑。用户会给出按启发式切出的章节列表（每章附正文摘录）。" +
  "请对每一章给出精修建议，三项职责：\n" +
  "1) 标题 title：把占位/泛化标题（如「第 3 节」）或过于啰嗦的标题改成准确简洁的章标题（≤24 字）；已恰当的保持原样；\n" +
  "2) 学习要点 keyPoints：依据本章正文提炼 2–5 条陈述式要点，每条 ≤60 字、可判对错，绝不编造正文没有的内容；\n" +
  "3) 边界修正 mergeIntoPrevious：仅当该章明显过碎（不足以独立成章，如只有一两句过渡内容）时置 true，表示并入上一章；第一项必须为 false。\n" +
  "只输出一个 JSON 数组（不要 markdown 围栏、不要多余文字），元素格式：" +
  '{"index":0,"title":"章标题","keyPoints":["要点1","要点2"],"mergeIntoPrevious":false}。';

/** 纯函数：构建精修提示词（供单测与执行器复用）。 */
export function buildRefineMessages(
  chapters: readonly Chapter[],
  text: string,
): ChatMessage[] {
  const lines = chapters.map((c, i) => {
    const excerpt = chapterExcerpt(text, c.contentRef.start, c.contentRef.end, 700);
    return `[${i}] 标题「${c.title || "(空)"}」\n正文摘录：${excerpt || "(无正文)"}`;
  });
  return [
    { role: "system", content: REFINE_SYSTEM },
    { role: "user", content: `章节列表如下（共 ${chapters.length} 项，index 即数组下标）：\n\n${lines.join("\n\n")}` },
  ];
}

/** 纯函数：解析 AI 精修响应 → 规范化建议（交给 engine.applyChapterRefine 应用）。 */
export function parseChapterRefines(raw: unknown, chapterCount: number): ChapterRefine[] {
  if (!Array.isArray(raw)) {
    throw new AiProviderError("request-failed", "AI 精修响应不是数组。");
  }
  const out: ChapterRefine[] = [];
  for (const item of raw.slice(0, chapterCount * 2)) {
    if (!isRecord(item)) continue;
    const index = item.index;
    if (typeof index !== "number" || !Number.isInteger(index)) continue;
    const title = str(item.title);
    const kpRaw = item.keyPoints;
    const keyPoints = Array.isArray(kpRaw) ? kpRaw.filter((k): k is string => typeof k === "string") : undefined;
    out.push({
      index,
      ...(title ? { title } : {}),
      ...(keyPoints && keyPoints.length > 0 ? { keyPoints } : {}),
      ...(typeof item.mergeIntoPrevious === "boolean" ? { mergeIntoPrevious: item.mergeIntoPrevious } : {}),
    });
  }
  return out;
}

/** 章节精修：对启发式切分结果跑 AI 精修（尺寸超标静默跳过 → 返回原样）。 */
export async function refineChaptersWithAi(
  provider: AIProvider,
  chapters: readonly Chapter[],
  text: string,
): Promise<ChapterRefine[]> {
  if (chapters.length === 0) return [];
  if (chapters.length > PIPELINE_LIMITS.refineMaxChapters) return [];
  if (text.length > PIPELINE_LIMITS.refineMaxTextChars) return [];
  const raw = await chatJson(provider, buildRefineMessages(chapters, text), TEMPERATURE.refine);
  return parseChapterRefines(raw, chapters.length);
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
      excerpt: chapterExcerpt(text, c.contentRef.start, c.contentRef.end, PIPELINE_LIMITS.quizExcerptChars),
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
