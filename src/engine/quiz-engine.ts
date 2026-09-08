/**
 * Quiz Engine（试卷引擎）—— 出卷（T2）+ 判分（T3）。
 *
 * 从「章集合 + 学习者状态」确定性生成试卷：
 *   - 配额：按卷型（单元/阶段/综合/补考）× 章数 × 难度带计算题型分布
 *   - 难度自适应：mastery < 0.4 → 记忆/理解档客观题为主；
 *                 > 0.7 → 增加应用/分析档主观题
 *   - 题面：客观题用本地确定性题库（keyPoints 驱动，无 AI 也可判分）；
 *           主观题无 Provider 时剔除（诚实降级，docs §6）
 *
 * 判分（T3）：gradePaper 客观题本地比对判分、主观题无 AI → pending
 * （P0-3 不伪造）；gradeAndApply 汇总卷面 → 调 learner-model.applyPaperResult
 * 平滑更新章掌握度（0.65×score + 0.35×prev）并写 nextReviewAt（P0-1）。
 */
import type { Chapter, LearnerState } from "../domain";
import type {
  CognitiveLevel,
  Paper,
  PaperAnswers,
  PaperMode,
  PaperQuestion,
  PaperResult,
  PaperScope,
  QuizType,
} from "../domain";
import { isSubjectiveType, newId, PAPER_MODE_LABEL, sortChaptersByOrder } from "../domain";
import { applyPaperResult } from "./learner-model";

/* ------------------------------------------------------------------ */
/* 难度带（Bloom / 配比的自适应输入）                                  */
/* ------------------------------------------------------------------ */

export type DifficultyBand = 1 | 2 | 3;

/** mastery <0.4 → band1（记忆/理解）；<0.7 → band2（标准）；否则 band3（应用/分析）。 */
export function bandOfMastery(mastery?: number): DifficultyBand {
  const m = mastery ?? 0;
  if (m < 0.4) return 1;
  if (m < 0.7) return 2;
  return 3;
}

/** 题型 → 认知层级（选择/判断 = remember/understand；问答 = understand/analyze；应用 = apply/evaluate）。 */
function cognitiveOf(type: QuizType, band: DifficultyBand): CognitiveLevel {
  switch (type) {
    case "choice":
      return band === 1 ? "remember" : band === 2 ? "understand" : "analyze";
    case "judge":
      return band === 1 ? "remember" : "understand";
    case "qa":
      return band === 2 ? "understand" : "analyze";
    case "application":
      return band === 2 ? "apply" : "evaluate";
  }
}

/** difficulty 1..5：choice/judge 偏中低，qa/application 偏高；band 越高越难；lift 用于补考卷降档。 */
function difficultyOf(type: QuizType, band: DifficultyBand, lift = 0): number {
  const base = type === "choice" || type === "judge" ? 1 : type === "qa" ? 3 : 4;
  return Math.min(5, Math.max(1, base + (band - 1) + lift));
}

/* ------------------------------------------------------------------ */
/* 本地确定性题库（keyPoints 驱动）                                   */
/* ------------------------------------------------------------------ */

function buildChoice(
  chapter: Chapter,
  keyPoint: string,
  distractors: string[],
  band: DifficultyBand,
  index: number,
  lift = 0,
): PaperQuestion {
  const options = [keyPoint, ...distractors];
  // 确定性轮转（以 index 为种子），避免正确项总在首位。
  const shift = index % options.length;
  const rotated = [...options.slice(shift), ...options.slice(0, shift)];
  return {
    id: newId("pq"),
    chapterId: chapter.id,
    type: "choice",
    cognitiveLevel: cognitiveOf("choice", band),
    prompt: `关于「${chapter.title}」，以下哪项是正确的要点陈述？`,
    options: rotated,
    answer: String(rotated.indexOf(keyPoint)),
    difficulty: difficultyOf("choice", band, lift),
  };
}

function buildJudge(
  chapter: Chapter,
  keyPoint: string,
  band: DifficultyBand,
  lift = 0,
): PaperQuestion {
  return {
    id: newId("pq"),
    chapterId: chapter.id,
    type: "judge",
    cognitiveLevel: cognitiveOf("judge", band),
    prompt: `判断：「${keyPoint}」这一说法是否成立？`,
    answer: "true",
    difficulty: difficultyOf("judge", band, lift),
  };
}

/** 主观题题面——引用一个要点或章标题；判分由 AI 完成（无 AI 不出卷内）。 */
function buildSubjective(
  chapter: Chapter,
  keyPoint: string | undefined,
  type: "qa" | "application",
  band: DifficultyBand,
): PaperQuestion {
  const subject = keyPoint ? `「${keyPoint}」` : `本章主题「${chapter.title}」`;
  return {
    id: newId("pq"),
    chapterId: chapter.id,
    type,
    cognitiveLevel: cognitiveOf(type, band),
    prompt:
      type === "qa"
        ? `请用自己的话解释${subject}，并给出一个具体例子。`
        : `请运用${subject}，设计一个实际应用场景并说明你的思路。`,
    referenceAnswer: keyPoint ?? chapter.title,
    difficulty: difficultyOf(type, band),
  };
}

/** choice 干扰项：同文档其他章 keyPoints（不同章互作干扰）；不足时用中性兜底句。 */
function collectDistractors(chapter: Chapter, allChapters: Chapter[]): string[] {
  const distractors: string[] = [];
  for (const other of allChapters) {
    if (other.id === chapter.id) continue;
    for (const kp of other.keyPoints) {
      distractors.push(kp);
      if (distractors.length >= 3) break;
    }
    if (distractors.length >= 3) break;
  }
  const FALLBACK = [
    "该要点与本章内容无关。",
    "该要点在本章中并未出现。",
    "该要点是其他章节的核心主张。",
  ];
  for (const f of FALLBACK) {
    if (distractors.length >= 3) break;
    distractors.push(f);
  }
  return distractors;
}

/* ------------------------------------------------------------------ */
/* 出卷主流程                                                          */
/* ------------------------------------------------------------------ */

export interface CreatePaperInput {
  scope: PaperScope;
  /** 范围内章节（按 order 排序；出卷只使用这些章）。 */
  chapters: Chapter[];
  /** 同文档全部章——供 choice 干扰项（除范围章外的其他章要点）。 */
  allChapters?: Chapter[];
  /** 学习者状态：按 chapterId 取 mastery 做难度自适应。 */
  learnerState?: LearnerState;
  /** 是否允许主观题（= 是否配置了 AI 判分）；false 时主观题剔除（诚实降级）。 */
  allowSubjective?: boolean;
  /** 测试注入时间戳。 */
  now?: number;
}

/**
 * 依据范围与学习者状态出一张卷。
 * 确定性规则：同输入 → 同题型/同题面结构（仅题目 id 与 createdAt 可变）。
 */
export function createPaper(input: CreatePaperInput): Paper {
  const {
    scope,
    chapters,
    allChapters = chapters,
    learnerState,
    allowSubjective = false,
    now = Date.now(),
  } = input;

  const ordered = [...chapters].sort((a, b) => a.order - b.order);
  const questions: PaperQuestion[] = [];
  const questionIndex: Record<string, number> = {};

  if (scope.mode === "final-test") {
    buildFinalTest(ordered, allChapters, learnerState, allowSubjective, questions, questionIndex);
  } else if (scope.mode === "unit-test") {
    // 单元测语义：只对单章出卷（防御多章误传，取第一章）。
    const chapter = ordered[0];
    if (chapter) {
      questions.push(...unitQuota(chapter, allChapters, learnerState, allowSubjective, questionIndex));
    }
  } else {
    ordered.forEach((chapter, ci) => {
      questions.push(
        ...(scope.mode === "retake"
          ? retakeQuota(chapter, allChapters, learnerState, questionIndex)
          : stageQuota(chapter, allChapters, learnerState, allowSubjective, questionIndex, ci)),
      );
    });
  }

  return assemble(scope, questions, now);
}

/** 全局题序计数器（choice 选项轮转种子，跨章连续避免扎堆）。 */
function nextIndex(questionIndex: Record<string, number>): number {
  questionIndex.n = (questionIndex.n ?? 0) + 1;
  return questionIndex.n;
}

/** 生成 N 道客观题（判断约占 1/3，每 3 题第 2 题为判断）。 */
function objectiveQuestions(
  chapter: Chapter,
  allChapters: Chapter[],
  learnerState: LearnerState | undefined,
  count: number,
  questionIndex: Record<string, number>,
  lift = 0,
): PaperQuestion[] {
  const out: PaperQuestion[] = [];
  const band = bandOfMastery(learnerState?.byUnit[chapter.id]?.mastery);
  const kps = chapter.keyPoints.length > 0 ? chapter.keyPoints : [chapter.title];
  for (let i = 0; i < count; i++) {
    const gi = nextIndex(questionIndex);
    const kp = kps[i % kps.length];
    if (i % 3 === 1) {
      out.push(buildJudge(chapter, kp, band, lift));
    } else {
      const distractors = collectDistractors(chapter, allChapters);
      out.push(buildChoice(chapter, kp, distractors, band, gi, lift));
    }
  }
  return out;
}

/** 单元测：单章 3 客观 +（band>1 且有 AI）2 主观：qa + application。 */
function unitQuota(
  chapter: Chapter,
  allChapters: Chapter[],
  learnerState: LearnerState | undefined,
  allowSubjective: boolean,
  questionIndex: Record<string, number>,
): PaperQuestion[] {
  const band = bandOfMastery(learnerState?.byUnit[chapter.id]?.mastery);
  const out = objectiveQuestions(chapter, allChapters, learnerState, 3, questionIndex);
  if (band > 1 && allowSubjective) {
    const kps = chapter.keyPoints.length > 0 ? chapter.keyPoints : undefined;
    out.push(buildSubjective(chapter, kps?.[0], "qa", band));
    out.push(buildSubjective(chapter, kps?.[1], "application", band));
  }
  return out;
}

/** 阶段测：每章 客观3 +（band>1 且有 AI）主观1（qa/application 按章序轮换）；band1 章 4 客观。 */
function stageQuota(
  chapter: Chapter,
  allChapters: Chapter[],
  learnerState: LearnerState | undefined,
  allowSubjective: boolean,
  questionIndex: Record<string, number>,
  ci: number,
): PaperQuestion[] {
  const band = bandOfMastery(learnerState?.byUnit[chapter.id]?.mastery);
  const out = objectiveQuestions(chapter, allChapters, learnerState, band === 1 ? 4 : 3, questionIndex);
  if (band > 1 && allowSubjective) {
    const kps = chapter.keyPoints.length > 0 ? chapter.keyPoints : undefined;
    const type: "qa" | "application" = ci % 2 === 0 ? "qa" : "application";
    out.push(buildSubjective(chapter, kps?.[0], type, band));
  }
  return out;
}

/** 补考卷：每章客观3，主观剔除，难度整体降一档（lift=-1）。 */
function retakeQuota(
  chapter: Chapter,
  allChapters: Chapter[],
  learnerState: LearnerState | undefined,
  questionIndex: Record<string, number>,
): PaperQuestion[] {
  return objectiveQuestions(chapter, allChapters, learnerState, 3, questionIndex, -1);
}

/** 综合测：总题量 clamp(3n, 15, 20)，客观 ~60% / 主观 ~40%（每章主观至多 2）。 */
function buildFinalTest(
  chapters: Chapter[],
  allChapters: Chapter[],
  learnerState: LearnerState | undefined,
  allowSubjective: boolean,
  questions: PaperQuestion[],
  questionIndex: Record<string, number>,
): void {
  const n = Math.max(1, chapters.length);
  const total = Math.min(20, Math.max(15, n * 3));
  const subjectiveTotal = allowSubjective ? Math.min(Math.round(total * 0.4), n * 2) : 0;
  const objectiveTotal = total - subjectiveTotal;

  // 客观题配额：base + 余数前 r 章各 +1。
  const objBase = Math.floor(objectiveTotal / n);
  const objRemainder = objectiveTotal - objBase * n;

  chapters.forEach((chapter, ci) => {
    const add = ci < objRemainder ? 1 : 0;
    objectiveQuestions(chapter, allChapters, learnerState, objBase + add, questionIndex)
      .forEach((q) => questions.push(q));
  });

  // 主观题：轮转分配（章 = s % n；qa/application 按主观全局序号交替）。
  for (let s = 0; s < subjectiveTotal; s++) {
    const chapter = chapters[s % n];
    const band = bandOfMastery(learnerState?.byUnit[chapter.id]?.mastery);
    const kps = chapter.keyPoints;
    const kp = kps.length > 0 ? kps[s % kps.length] : undefined;
    const type: "qa" | "application" = s % 2 === 0 ? "qa" : "application";
    questions.push(buildSubjective(chapter, kp, type, band));
  }
}

/** 组装 Paper（标题：卷型 + 范围）。 */
function assemble(scope: PaperScope, questions: PaperQuestion[], now: number): Paper {
  const modeLabel = PAPER_MODE_LABEL[scope.mode];
  const title = modeLabel;
  return {
    id: newId("paper"),
    scope,
    title,
    questions,
    status: "open",
    createdAt: now,
  };
}

/* ------------------------------------------------------------------ */
/* 补考卷聚合出卷（T10 · 仅错题章范围）                                */
/* ------------------------------------------------------------------ */

/**
 * 补考卷（docs §4 模式表：仅错题章 · 每章 3 客观 · 主观剔除 · 降一档难度）。
 *
 * 与 createPaper(mode="retake") 的关系：当错题章跨越多个文档时，choice 的
 * 干扰项必须取自「各章自己的文档」（同文档其他章要点），否则会把别的文档
 * 内容泄作选项（P1 语义）。因此这里按 documentId 分组后分别调 createPaper
 * （各组的 allChapters = 该文档全部章），再合并成一张 Paper。
 *
 * 纯函数；确定性规则与 createPaper 一致（同输入 → 同题型/同题面结构）。
 * 空章输入返回空卷（不抛错，与 createPaper 无章时行为一致，由 UI 守卫）。
 */
export function createRetakePaper(input: {
  /** 需要补考的章（错题章范围；内部按 order 升序）。 */
  chapters: Chapter[];
  /** docId → 该文档全部章（choice 干扰项源）；缺省时退化为用范围章自身。 */
  docChapters?: ReadonlyMap<string, readonly Chapter[]>;
  learnerState?: LearnerState;
  /** 测试注入时间戳。 */
  now?: number;
}): Paper {
  const { chapters, docChapters, learnerState, now = Date.now() } = input;
  const ordered = sortChaptersByOrder(chapters);

  // 按文档分组（保持 order 顺序）：每组 allChapters 取该文档全量章。
  const groups: Chapter[][] = [];
  const byDoc = new Map<string, Chapter[]>();
  for (const chapter of ordered) {
    let group = byDoc.get(chapter.documentId);
    if (!group) {
      group = [];
      byDoc.set(chapter.documentId, group);
      groups.push(group);
    }
    group.push(chapter);
  }

  const parts = groups.map((group) =>
    createPaper({
      scope: { chapterIds: group.map((c) => c.id), mode: "retake" },
      chapters: group,
      allChapters: [...(docChapters?.get(group[0].documentId) ?? group)],
      learnerState,
      allowSubjective: false,
      now,
    }),
  );

  return {
    id: newId("paper"),
    scope: { chapterIds: ordered.map((c) => c.id), mode: "retake" },
    title: PAPER_MODE_LABEL.retake,
    questions: parts.flatMap((p) => p.questions),
    status: "open",
    createdAt: now,
  };
}

/* ------------------------------------------------------------------ */
/* 导出：题型配比快照（供 UI 预览 / 文档核对）                        */
/* ------------------------------------------------------------------ */

export const QUIZ_QUOTA_PREVIEW: Record<PaperMode, string> = {
  "unit-test": "单章 5 题：选择2·判断1·问答1·应用1（低掌握仅客观3）",
  "stage-test": "每章 客观3 + 主观1（轮换；低掌握章 客观4）",
  "final-test": "总 clamp(3n,15,20) · 客观~60% / 主观~40%",
  retake: "每章 客观3 · 主观剔除 · 难度降一档",
};

/* ------------------------------------------------------------------ */
/* 判分（T3）—— 客观本地判 + 主观 pending（P0-3）                     */
/* ------------------------------------------------------------------ */

/** 逐题判分结果；correct 为 undefined = 主观题 pending（无 AI，不伪造判分）。 */
export interface GradedQuestion {
  questionId: string;
  chapterId: string;
  type: QuizType;
  correct?: boolean;
  difficulty: number;
}

/** 章节级判分；score 为难度加权卷面分（本章无客观题时为 undefined）。 */
export interface GradedChapter {
  score?: number;
  objectiveCount: number;
  objectiveCorrect: number;
}

/** gradePaper 的中间产物（不含掌握度回写）。 */
export interface GradedPaper {
  paperId: string;
  questions: GradedQuestion[];
  perChapter: Record<string, GradedChapter>;
  /** 全卷客观难度加权正确率 0..1（无可判客观题时为 0）。 */
  totalScore: number;
  wrongQuestions: PaperResult["wrongQuestions"];
  submittedAt: number;
}

/**
 * 客观题本地确定性判分；主观题 → pending（P0-3：无 AI 不伪造判分，不计入得分）。
 * 纯函数；缺失答案的客观题按未答判错。
 */
export function gradePaper(
  paper: Paper,
  answers: PaperAnswers,
  now = Date.now(),
): GradedPaper {
  // 逐题判分 + 按章聚合（难度加权；与报告展示的题数分开记录）。
  type ChAgg = { w: number; earned: number; count: number; correctCount: number };
  const aggByChapter = new Map<string, ChAgg>();
  const questions: GradedQuestion[] = [];
  const wrongQuestions: PaperResult["wrongQuestions"] = [];
  let totalW = 0;
  let earnedW = 0;

  for (const q of paper.questions) {
    if (isSubjectiveType(q.type)) {
      questions.push({
        questionId: q.id,
        chapterId: q.chapterId,
        type: q.type,
        difficulty: q.difficulty,
      });
      continue; // pending：不判对错、不参与任何得分
    }

    const your = (answers[q.id] ?? "").trim();
    const correct = your.length > 0 && your === q.answer;
    questions.push({
      questionId: q.id,
      chapterId: q.chapterId,
      type: q.type,
      correct,
      difficulty: q.difficulty,
    });

    const w = q.difficulty;
    totalW += w;
    if (correct) earnedW += w;

    const agg = aggByChapter.get(q.chapterId) ?? { w: 0, earned: 0, count: 0, correctCount: 0 };
    agg.w += w;
    if (correct) agg.earned += w;
    agg.count += 1;
    if (correct) agg.correctCount += 1;
    aggByChapter.set(q.chapterId, agg);

    if (!correct) {
      wrongQuestions.push({ questionId: q.id, yourAnswer: answers[q.id] ?? "" });
    }
  }

  const perChapter: Record<string, GradedChapter> = {};
  for (const [chapterId, agg] of aggByChapter) {
    perChapter[chapterId] = {
      score: agg.w > 0 ? agg.earned / agg.w : undefined,
      objectiveCount: agg.count,
      objectiveCorrect: agg.correctCount,
    };
  }

  return {
    paperId: paper.id,
    questions,
    perChapter,
    totalScore: totalW > 0 ? earnedW / totalW : 0,
    wrongQuestions,
    submittedAt: now,
  };
}

export interface GradeAndApplyInput {
  paper: Paper;
  answers: PaperAnswers;
  learnerState: LearnerState;
  /** 测试注入时间戳。 */
  now?: number;
}

/**
 * 判分 → 章掌握度平滑回写（V2 双证据原则的卷面路径）。
 *
 * 对每道有客观分的章调用 applyPaperResult：
 *   newMastery = 0.65 × score + 0.35 × prev（含历史防单次波动）
 * 并写 nextReviewAt（按分数档 7/3/1 天）。返回更新后的 learnerState 与
 * PaperResult（报告页消费：总分 / 逐章前后掌握度 / 错题）。
 */
export function gradeAndApply(input: GradeAndApplyInput): {
  result: PaperResult;
  learnerState: LearnerState;
  graded: GradedPaper;
} {
  const { paper, answers, learnerState, now = Date.now() } = input;
  const graded = gradePaper(paper, answers, now);

  let nextState = learnerState;
  const perChapter: PaperResult["perChapter"] = {};

  for (const [chapterId, ch] of Object.entries(graded.perChapter)) {
    if (ch.score === undefined) continue; // 全主观章（无客观证据）不回写
    const previousMastery = nextState.byUnit[chapterId]?.mastery ?? 0;
    nextState = applyPaperResult(
      nextState,
      chapterId,
      {
        score: ch.score,
        evidenceCorrect: ch.objectiveCorrect,
        evidenceTotal: ch.objectiveCount,
      },
      now,
    );
    perChapter[chapterId] = {
      score: ch.score,
      previousMastery,
      mastery: nextState.byUnit[chapterId].mastery,
    };
  }

  return {
    result: {
      paperId: paper.id,
      totalScore: graded.totalScore,
      perChapter,
      wrongQuestions: graded.wrongQuestions,
      createdAt: now,
    },
    learnerState: nextState,
    graded,
  };
}
