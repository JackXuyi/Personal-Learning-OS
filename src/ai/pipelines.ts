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
import type {
  Chapter,
  KnowledgeRelation,
  KnowledgeUnit,
  Paper,
  PaperQuestion,
  RelationType,
} from "../domain";
import { newId } from "../domain";
import type { ChapterRefine } from "../engine/splitter-engine";
import { applyChapterRefine } from "../engine/splitter-engine";
import type { AIProvider, ChatMessage } from "./types";
import { AiProviderError } from "./types";
import { repairTruncatedJson } from "./json-repair";
import { aiLog } from "./log";

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
  /** 概念抽取的章正文最大字符数（超出拒绝——图谱应聚焦单章）。 */
  conceptMaxTextChars: 40_000,
  /** 要点抽取的章正文最大字符数（与概念抽取同口径）。 */
  keyPointMaxTextChars: 40_000,
  /** 单条要点 / 原文摘录的字符上限（防 AI 灌水）。 */
  keyPointMaxChars: 60,
  keyPointQuoteMaxChars: 200,
};

/** 温度：精修/出题偏稳定，批改最低（事实判定）。 */
const TEMPERATURE = { refine: 0.2, quiz: 0.3, grade: 0.1, concept: 0.2, keyPoint: 0.2 };

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
  if (open === -1) {
    aiLog("error", "parse", "AI 返回内容中未找到 JSON", {
      head: stripped.slice(0, 120) || "(空)",
    });
    throw new AiProviderError(
      "request-failed",
      `AI 返回内容中未找到 JSON：${stripped.slice(0, 120) || "(空)"}`,
    );
  }
  // close <= open：从 open 起没有任何闭合符 —— 截断发生在第一个元素中间，
  // 同样交给截断修复（回退容器边界）处理，而不是直接判死。
  const slice = stripped.slice(open, close > open ? close + 1 : undefined);
  try {
    return JSON.parse(slice) as unknown;
  } catch {
    // 输出被 max_tokens 截断是本地小模型的常见失败模式：JSON 停在半途、
    // 花括号不闭合。先尝试抢救「完整前缀」（只保留完整元素，不伪造半条），
    // 不可修复再走统一抛错。
    const repaired = repairTruncatedJson(slice);
    if (repaired !== undefined) {
      aiLog("warn", "parse", "截断 JSON 已抢救（只保留完整元素）", {
        rawChars: slice.length,
        repairedChars: repaired.length,
      });
      try {
        return JSON.parse(repaired) as unknown;
      } catch {
        // 理论不可达（repair 内部已验证过），落到统一抛错
      }
    }
    aiLog("error", "parse", "JSON 解析失败（可能是输出被长度截断）", {
      head: stripped.slice(open, Math.min(open + 120, stripped.length)),
    });
    throw new AiProviderError(
      "request-failed",
      `AI 返回的 JSON 无法解析（可能是输出被长度截断）：${stripped.slice(open, Math.min(close + 1, open + 160))}…`,
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
  // 关键修复：temperature 此前对 builtin 档被静默丢弃（builtin.chat 只组
  // model+messages）；jsonMode 声明结构化意图 → builtin 映射为近贪心采样预设。
  const startedAt = Date.now();
  const { content } = await provider.chat({ messages, temperature, jsonMode: true });
  if (!content) {
    aiLog("error", "chatJson", "AI 返回了空内容", { provider: provider.kind });
    throw new AiProviderError("request-failed", "AI 返回了空内容。");
  }
  aiLog("info", "chatJson", "调用完成", {
    provider: provider.kind,
    temperature,
    outChars: content.length,
    ms: Date.now() - startedAt,
  });
  return extractJson(content);
}

/** 供同目录管道模块（overview-pipeline）复用 —— 不复制第二份归一化工具。 */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 同上。 */
export function str(v: unknown): string | undefined {
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

/* ------------------------------------------------------------------ */
/* 4) 章概念 AI 抽取（概念层回归 N5/T14）                              */
/* ------------------------------------------------------------------ */

/** AI 认可的概念类型（与 domain.KnowledgeKind 白名单一致；缺省 concept）。 */
const CONCEPT_KINDS = new Set([
  "concept",
  "skill",
  "fact",
  "procedure",
  "principle",
]);

/** 画边的关系类型（图谱可视层只画这四类；其余类型留给概念侧栏文本）。 */
const CONCEPT_REL_TYPES: ReadonlySet<RelationType> = new Set([
  "prerequisite",
  "related",
  "parent",
  "child",
]);

const CONCEPT_SYSTEM =
  "你是严谨的学习资料概念分析师。用户会给出一章正文，请把这一章拆成有学习价值的" +
  "知识概念（KnowledgeUnit），并指出概念间关系。\n" +
  "要求：\n" +
  "- 概念粒度适中：一章 6–14 个，宁缺毋滥——只收录正文真正讲到、值得单独记忆/复习的原子概念，不编造正文外的内容；\n" +
  "- kind：concept 概念 / skill 技能 / fact 事实 / procedure 流程 / principle 原理（拿不准用 concept）；\n" +
  "- summary：≤120 字的一句话总结，让复习时能快速回忆；tags：0–3 个 ≤12 字的归类标签；\n" +
  "- quote：该概念在本章正文中的**原文摘录**（≤200 字，逐字照抄，不得改写/概括/拼接）；" +
  "正文里确实找不到明确出处时给空字符串（宁缺毋滥，不要为了填满而编）；\n" +
  "- relations：概念之间的关键关系，只用 prerequisite（前置依赖）/ related（相关）/ parent-child（上下位）；\n" +
  "  关系两端用 units 数组下标（从 0 起）引用，仅画有信息量的边（6–14 个概念建议 ≤16 条），无强关联可不给。\n" +
  "只输出一个 JSON 对象（不要 markdown 围栏与多余文字），格式：" +
  '{"units":[{"title":"向量化","kind":"concept","summary":"…","tags":["嵌入"],"quote":"向量化是把文本映射为向量的过程"}],"relations":[{"from":0,"to":1,"type":"prerequisite"}]}。';

/** 纯函数：构建章概念抽取提示词。 */
export function buildConceptMessages(input: {
  chapterTitle: string;
  text: string;
}): ChatMessage[] {
  return [
    { role: "system", content: CONCEPT_SYSTEM },
    {
      role: "user",
      content: `章「${input.chapterTitle || "(未命名章)"}」正文如下（${input.text.length} 字）：\n\n${input.text}`,
    },
  ];
}

/** 单概念草稿（title/kind/summary/tags 内容字段；id/来源由执行器分配）。 */
export interface AiConceptDraft {
  title: string;
  kind: KnowledgeUnit["kind"];
  summary?: string;
  tags: string[];
  /**
   * 原文摘录（可选）——AI 指出该概念出自正文哪一段。
   * 由执行器透传为 `KnowledgeUnit.evidence.quote`，**偏移一律由
   * analyze-service 用 `locateQuote` 回填**（不信 AI 的偏移量）。
   */
  quote?: string;
}

/** 单关系草稿：from/to 为 units 数组下标（0 起）。 */
export interface AiRelationDraft {
  from: number;
  to: number;
  type: RelationType;
}

function isRelType(v: unknown): v is RelationType {
  return typeof v === "string" && CONCEPT_REL_TYPES.has(v as RelationType);
}

/** 纯函数：解析 AI 概念响应 → 规范化草稿（越界下标 / 非法类型丢弃）。 */
export function parseConceptDrafts(raw: unknown): {
  units: AiConceptDraft[];
  relations: AiRelationDraft[];
} {
  if (!isRecord(raw)) {
    throw new AiProviderError("request-failed", "AI 概念抽取响应不是对象。");
  }
  const rawUnits = Array.isArray(raw.units) ? raw.units : [];
  const units: AiConceptDraft[] = [];
  for (const item of rawUnits) {
    if (!isRecord(item)) continue;
    const title = str(item.title)?.trim();
    if (!title || title.length > 40) continue;
    const kind = typeof item.kind === "string" && CONCEPT_KINDS.has(item.kind)
      ? (item.kind as KnowledgeUnit["kind"])
      : "concept";
    const summary = str(item.summary)?.trim();
    const tags = Array.isArray(item.tags)
      ? item.tags.filter((t): t is string => typeof t === "string")
          .map((t) => t.trim().slice(0, 12))
          .filter((t) => t.length > 0)
          .slice(0, 3)
      : [];
    const quote = str(item.quote)?.trim().slice(0, PIPELINE_LIMITS.keyPointQuoteMaxChars);
    units.push({
      title,
      kind,
      ...(summary && summary.length <= 120 ? { summary } : summary ? { summary: `${summary.slice(0, 120)}…` } : {}),
      tags,
      // 缺失 quote 是允许的（evidence 整体可选），不报错。
      ...(quote ? { quote } : {}),
    });
  }
  if (units.length === 0) {
    throw new AiProviderError("request-failed", "AI 概念抽取未返回任何合规概念。");
  }
  const rawRels = Array.isArray(raw.relations) ? raw.relations : [];
  const relations: AiRelationDraft[] = [];
  for (const item of rawRels) {
    if (!isRecord(item)) continue;
    const from = item.from;
    const to = item.to;
    if (
      typeof from !== "number" || !Number.isInteger(from) ||
      typeof to !== "number" || !Number.isInteger(to) ||
      from === to || from < 0 || to < 0 || from >= units.length || to >= units.length
    ) continue;
    if (!isRelType(item.type)) continue;
    relations.push({ from, to, type: item.type });
  }
  // 去重（同向同型只留一条）。
  const seen = new Set<string>();
  const deduped = relations.filter((r) => {
    const k = `${r.from}\u0001${r.to}\u0001${r.type}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { units, relations: deduped };
}

/** 章概念抽取执行器：AI 从章正文抽概念与关系（未配置/失败抛类型化错误）。 */
export async function extractChapterConceptsWithAi(
  provider: AIProvider,
  input: {
    /** 章标题（提示词上下文）。 */
    chapterTitle: string;
    /** 章正文（纯净文本；超长抛错，图谱应聚焦单章）。 */
    text: string;
    /**
     * 所属资料 id；传入且草稿带 quote 时，产出的 unit 会带 `evidence`。
     * 注意：`evidence.start/end` 在此处恒为 -1（**未锚定**），偏移量由
     * analyze-service 用 `locateQuote` 回填；锚定失败时该字段会被整体移除。
     */
    documentId?: string;
  },
): Promise<{ units: KnowledgeUnit[]; relations: KnowledgeRelation[] }> {
  const text = input.text.trim();
  if (text.length === 0) {
    throw new AiProviderError("request-failed", "章正文为空，无法提炼概念。");
  }
  if (text.length > PIPELINE_LIMITS.conceptMaxTextChars) {
    throw new AiProviderError(
      "request-failed",
      `本章正文过长（${text.length} 字，上限 ${PIPELINE_LIMITS.conceptMaxTextChars}），无法整章提炼——请先精简资料或拆分章节。`,
    );
  }
  const raw = await chatJson(
    provider,
    buildConceptMessages({ chapterTitle: input.chapterTitle, text }),
    TEMPERATURE.concept,
  );
  const { units, relations } = parseConceptDrafts(raw);
  const now = Date.now();
  const created: KnowledgeUnit[] = units.map((u) => ({
    id: newId("unit"),
    title: u.title,
    kind: u.kind,
    ...(u.summary ? { summary: u.summary } : {}),
    tags: u.tags,
    createdAt: now,
    // 未锚定占位（start/end = -1）；analyze-service 负责定位或移除。
    ...(u.quote && input.documentId
      ? { evidence: { documentId: input.documentId, start: -1, end: -1, quote: u.quote } }
      : {}),
  }));
  const unitIds = created.map((u) => u.id);
  const createdRels: KnowledgeRelation[] = relations.map((r) => ({
    id: newId("rel"),
    fromId: unitIds[r.from],
    toId: unitIds[r.to],
    type: r.type,
  }));
  return { units: created, relations: createdRels };
}

/* ------------------------------------------------------------------ */
/* 5) 章要点 AI 抽取 + 原文摘录（资料详情页 · 关键知识点 Tab）          */
/* ------------------------------------------------------------------ */

/**
 * 要点抽取与「概念抽取」的关键差异：**每条要点都必须附原文摘录**。
 * 用户的核心诉求是「知识点能对应到原文」，所以提示词把 quote 列为必填项，
 * 并明确要求逐字照抄——便于 `locateQuote` 精确命中（档 1 就能解决绝大多数）。
 */
const KEYPOINT_SYSTEM =
  "你是严谨的学习资料要点提炼助手。用户会给出一章正文，请提炼这一章的学习要点。\n" +
  "要求：\n" +
  "- 2–5 条陈述式要点，每条 ≤60 字、可判对错，只讲正文真正讲到的内容，绝不编造；\n" +
  "- 每条要点必须附 `quote`：该要点在本章正文中对应的**原文摘录**（≤200 字）。\n" +
  "  必须逐字照抄正文中的连续片段，不得改写、概括、拼接不相邻的句子；\n" +
  "- 找不到确切原文出处的要点请不要输出（宁缺毋滥），不要为了凑数给空 quote；\n" +
  "- 要点之间不要重复，也不要与章标题重复。\n" +
  "只输出一个 JSON 对象（不要 markdown 围栏与多余文字），格式：" +
  '{"points":[{"point":"要点","quote":"原文摘录"}]}。';

/** 纯函数：构建要点抽取提示词。 */
export function buildKeyPointMessages(input: {
  chapterTitle: string;
  text: string;
}): ChatMessage[] {
  return [
    { role: "system", content: KEYPOINT_SYSTEM },
    {
      role: "user",
      content: `章「${input.chapterTitle || "(未命名章)"}」正文如下（${input.text.length} 字）：\n\n${input.text}`,
    },
  ];
}

/**
 * 单条要点草稿。
 *
 * 注意：**这里没有 start/end**。偏移量不由 AI 给——AI 报的字符偏移在换行 /
 * 全角 / 截断场景下经常漂移，交给它等于把「可溯源」这条承诺架空。
 * 偏移一律由 `locateQuote` 在原文里算出来（见 features/learn/evidence-anchor.ts）。
 */
export interface AiKeyPointDraft {
  point: string;
  quote: string;
}

/**
 * 纯函数：解析 AI 要点响应 → 规范化草稿（裁剪 / 过滤 / 去重）。
 *
 * - `point` 裁剪到 60 字，`quote` 裁剪到 200 字；
 * - 空 point 丢弃；空 quote 丢弃（无原文出处的要点不入库，诚实降级）；
 * - 按 point 去重；最多留 5 条；
 * - 全部不合规 → 抛 `request-failed`（由调用方决定是否提示重试）。
 */
export function parseKeyPointDrafts(raw: unknown): AiKeyPointDraft[] {
  if (!isRecord(raw)) {
    throw new AiProviderError("request-failed", "AI 要点抽取响应不是对象。");
  }
  const rawPoints = Array.isArray(raw.points) ? raw.points : [];
  const out: AiKeyPointDraft[] = [];
  const seen = new Set<string>();

  for (const item of rawPoints) {
    if (!isRecord(item)) continue;
    const point = str(item.point)?.trim();
    if (!point) continue;
    const quote = str(item.quote)?.trim();
    // 无原文摘录 → 该条不可溯源，直接丢弃（E3 诚实降级）。
    if (!quote) continue;
    const p = point.slice(0, PIPELINE_LIMITS.keyPointMaxChars);
    if (seen.has(p)) continue;
    seen.add(p);
    out.push({ point: p, quote: quote.slice(0, PIPELINE_LIMITS.keyPointQuoteMaxChars) });
    if (out.length >= 5) break;
  }

  if (out.length === 0) {
    throw new AiProviderError("request-failed", "AI 要点抽取未返回任何带原文出处的要点。");
  }
  return out;
}

/**
 * 章要点抽取执行器：AI 从章正文提炼要点 + 原文摘录（未配置/失败抛类型化错误）。
 *
 * 返回的草稿**不含偏移**——调用方（analyze-service）负责用 `locateQuote`
 * 把 quote 锚定成 `Chapter.keyPointRefs` 的绝对区间。
 */
export async function extractKeyPointsWithAi(
  provider: AIProvider,
  input: {
    /** 章标题（提示词上下文）。 */
    chapterTitle: string;
    /** 章正文（纯净文本；超长抛错）。 */
    text: string;
  },
): Promise<AiKeyPointDraft[]> {
  const text = input.text.trim();
  if (text.length === 0) {
    throw new AiProviderError("request-failed", "章正文为空，无法提炼要点。");
  }
  if (text.length > PIPELINE_LIMITS.keyPointMaxTextChars) {
    throw new AiProviderError(
      "request-failed",
      `本章正文过长（${text.length} 字，上限 ${PIPELINE_LIMITS.keyPointMaxTextChars}），无法整章提炼——请先精简资料或拆分章节。`,
    );
  }
  const raw = await chatJson(
    provider,
    buildKeyPointMessages({ chapterTitle: input.chapterTitle, text }),
    TEMPERATURE.keyPoint,
  );
  return parseKeyPointDrafts(raw);
}
