/**
 * Quiz Engine（试卷引擎）—— 出卷（T2）+ 判分（T3）。
 *
 * 从「章集合 + 学习者状态」确定性生成试卷：
 *   - 配额：**内容驱动** —— 逐章按 keyPoints 定量（每个要点 2 题：选择 + 判断，
 *           clamp(4,12)；无要点章保底 3），综合测按总量 clamp(3n,15,20) 分摊
 *           （见 §每章题量配额；UI 预览走同一份 chapterQuota）；
 *   - 难度自适应：mastery < 0.4 → 记忆/理解档客观题为主；
 *                 > 0.7 → 增加应用/分析档主观题
 *   - 题面：客观题用本地确定性题库（keyPoints 驱动，无 AI 也可判分）；
 *           主观题无 Provider 时剔除（诚实降级，docs §6）
 *
 * 判分（T3）：gradePaper 客观题本地比对判分、主观题无 AI → pending
 * （P0-3 不伪造）；gradeAndApply 汇总卷面 → 调 learner-model.applyPaperResult
 * 平滑更新章掌握度（0.65×score + 0.35×prev）并写 nextReviewAt（P0-1）。
 */
import type { Chapter, LearnerProfile, LearnerState } from "../domain";
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
import { isSubjectiveType, newId, PAPER_MODE_LABEL } from "../domain";
import { applyPaperResult } from "./learner-model";
import { bandForChapter } from "./profile-band";

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
/* 每章题量配额（内容驱动）                                            */
/* ------------------------------------------------------------------ */

/** 每个要点出 2 题：选择（识别）+ 判断（验证）各一。 */
export const QUESTIONS_PER_KEYPOINT = 2;
/** 每章客观题下限：短章（1–2 个要点）也要有基本题量。 */
export const OBJECTIVE_QUOTA_MIN = 4;
/** 每章客观题上限：合并章要点可能偏多，防止单章卷面失控。 */
export const OBJECTIVE_QUOTA_MAX = 12;
/** 无要点章（只有标题可出题）的保底题量 —— 与内容驱动前的单章 3 题一致。 */
export const OBJECTIVE_QUOTA_FALLBACK = 3;

/**
 * 单章客观题配额：按**章节内容**定量 —— 每个要点 2 题，收敛到 [4, 12]。
 *
 * 改动前的固定配额（单元测 3 / 阶段测 3–4 / 补考 3）会让「5 个要点的章只考 3 个」，
 * 与「考一卷 = 检验本章掌握度」的语义不符；改为逐要点覆盖后，题量随内容长度伸缩。
 * 要点超出上限（2×要点数 > 12）时按要点均分，覆盖优先于「每要点两题」。
 */
export function objectiveQuotaFor(chapter: Chapter): number {
  const n = chapter.keyPoints.length;
  if (n === 0) return OBJECTIVE_QUOTA_FALLBACK;
  return Math.min(OBJECTIVE_QUOTA_MAX, Math.max(OBJECTIVE_QUOTA_MIN, n * QUESTIONS_PER_KEYPOINT));
}

/** 卷型 → 单章配额（客观题数 / 主观题上限 / 难度升降档）。 */
export interface ChapterQuota {
  objective: number;
  /** 该卷型每章最多出几道主观题（实际是否出还需 band>1 且有 AI 判分）。 */
  subjective: 0 | 1 | 2;
  /** 补考卷整体降一档。 */
  lift: number;
}

/**
 * 单章配额表（**出卷与 UI 预览共用的唯一来源**）。
 * 综合测不逐章配额定，见 buildFinalTest（总量 clamp(3n,15,20) 后再分摊）。
 */
export function chapterQuota(mode: PaperMode, chapter: Chapter): ChapterQuota {
  switch (mode) {
    case "unit-test":
      return { objective: objectiveQuotaFor(chapter), subjective: 2, lift: 0 };
    case "stage-test":
      return { objective: objectiveQuotaFor(chapter), subjective: 1, lift: 0 };
    case "retake":
      return { objective: objectiveQuotaFor(chapter), subjective: 0, lift: -1 };
    case "final-test":
      return { objective: 0, subjective: 0, lift: 0 };
  }
}

/** 预计题量（UI 模式卡预览）—— 与 createPaper 走**同一份** chapterQuota，不做第二套算法。 */
export interface PlannedQuota {
  objective: number;
  subjective: number;
  total: number;
}

/**
 * 按范围与卷型算出「预计题量」。主观题只在有 AI 判分（allowSubjective）
 * 且该章 band > 1 时出 —— 与 unitQuota / stageQuota 的判据逐条对齐。
 */
export function plannedQuota(input: {
  mode: PaperMode;
  chapters: Chapter[];
  allowSubjective?: boolean;
  learnerState?: LearnerState;
  profile?: LearnerProfile;
}): PlannedQuota {
  const ordered = [...input.chapters].sort((a, b) => a.order - b.order);
  if (ordered.length === 0) return { objective: 0, subjective: 0, total: 0 };

  if (input.mode === "final-test") {
    const n = ordered.length;
    const total = Math.min(20, Math.max(15, n * 3));
    const subjective = input.allowSubjective ? Math.min(Math.round(total * 0.4), n * 2) : 0;
    return { objective: total - subjective, subjective, total };
  }

  let objective = 0;
  let subjective = 0;
  for (const chapter of ordered) {
    const quota = chapterQuota(input.mode, chapter);
    objective += quota.objective;
    const band = bandForChapter(input.learnerState?.byUnit[chapter.id], input.profile);
    if (quota.subjective > 0 && input.allowSubjective && band > 1) subjective += quota.subjective;
  }
  return { objective, subjective, total: objective + subjective };
}

/* ------------------------------------------------------------------ */
/* 本地确定性题库（keyPoints 驱动）                                   */
/* ------------------------------------------------------------------ */

/** 选择题干扰项数（与 AI 出题提示词的「恰好 4 个选项」对齐）。 */
const CHOICE_DISTRACTORS = 3;

/** 题量槽位：每个要点均分 count 题（余数给前 r 个要点），按要点成组展开。 */
function quotaSlots(kpCount: number, count: number): { kp: number; occurrence: number }[] {
  const n = Math.max(1, kpCount);
  const base = Math.floor(count / n);
  const remainder = count - base * n;
  const slots: { kp: number; occurrence: number }[] = [];
  for (let j = 0; j < n; j += 1) {
    const per = base + (j < remainder ? 1 : 0);
    for (let k = 0; k < per; k += 1) slots.push({ kp: j, occurrence: k });
  }
  return slots;
}

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

/**
 * 判断题：谓词固定为「是本章的要点之一」，真伪都可在本章范围内判定。
 * - 真陈述 = 本章要点（answer true）；
 * - 伪陈述 = **其他章的要点**（answer false）—— 改动前所有判断题答案恒为 true，
 *   题量放大后会退化成「一律答真」，故按奇偶交替出真假题（见 objectiveQuestions）。
 */
function buildJudge(
  chapter: Chapter,
  statement: string,
  isTrue: boolean,
  band: DifficultyBand,
  lift = 0,
): PaperQuestion {
  return {
    id: newId("pq"),
    chapterId: chapter.id,
    type: "judge",
    cognitiveLevel: cognitiveOf("judge", band),
    prompt: `判断：「${statement}」是本章的要点之一。`,
    answer: isTrue ? "true" : "false",
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

/** 干扰项不足时的中性兜底句。 */
const FALLBACK_DISTRACTORS = [
  "该要点与本章内容无关。",
  "该要点在本章中并未出现。",
  "该要点是其他章节的核心主张。",
];

/**
 * choice 干扰项池：同文档**其他章**的 keyPoints（去重、排除本章自己的要点）。
 *
 * 改动前每次出题都在池里截前 3 条 → 同章多道选择题的选项列表一模一样；
 * 现在返回**整个池**，由 pickDistractors 按题号轮转取窗口。
 * 池不足 3 条时才用中性兜底句补齐（兜底句是最后手段，不抢占真实干扰项）。
 */
function distractorPool(chapter: Chapter, allChapters: Chapter[]): string[] {
  const own = new Set(chapter.keyPoints);
  const pool: string[] = [];
  for (const other of allChapters) {
    if (other.id === chapter.id) continue;
    for (const kp of other.keyPoints) {
      if (!kp || own.has(kp) || pool.includes(kp)) continue;
      pool.push(kp);
    }
  }
  for (const f of FALLBACK_DISTRACTORS) {
    if (pool.length >= CHOICE_DISTRACTORS) break;
    if (!pool.includes(f)) pool.push(f);
  }
  return pool;
}

/** 按题号从池中轮转取 3 条（池长 ≥3 时同题内必然互不相同）。 */
function pickDistractors(pool: string[], seed: number): string[] {
  if (pool.length === 0) return [];
  const start = (seed * CHOICE_DISTRACTORS) % pool.length;
  const out: string[] = [];
  for (let k = 0; k < Math.min(CHOICE_DISTRACTORS, pool.length); k += 1) {
    out.push(pool[(start + k) % pool.length]);
  }
  return out;
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
  /**
   * F1 学习者画像：**仅在章节无掌握度证据时**作难度先验
   * （`bandForChapter`）。缺省 = 现状（无证据 → band 1）。
   */
  profile?: LearnerProfile;
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
    profile,
    allowSubjective = false,
    now = Date.now(),
  } = input;

  const ordered = [...chapters].sort((a, b) => a.order - b.order);
  const questions: PaperQuestion[] = [];
  const questionIndex: Record<string, number> = {};

  if (scope.mode === "final-test") {
    buildFinalTest(ordered, allChapters, learnerState, allowSubjective, questions, questionIndex, profile);
  } else if (scope.mode === "unit-test") {
    // 单元测语义：只对单章出卷（防御多章误传，取第一章）。
    const chapter = ordered[0];
    if (chapter) {
      questions.push(...unitQuota(chapter, allChapters, learnerState, allowSubjective, questionIndex, profile));
    }
  } else {
    ordered.forEach((chapter, ci) => {
      questions.push(
        ...(scope.mode === "retake"
          ? retakeQuota(chapter, allChapters, learnerState, questionIndex, profile)
          : stageQuota(chapter, allChapters, learnerState, allowSubjective, questionIndex, ci, profile)),
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

/**
 * 生成 N 道客观题（逐要点覆盖 + 题型交替 + 真假交替）。
 *
 * - **覆盖优先**：每个要点均分题量（余数给前几个要点），同一要点先选后判；
 * - **判断真假交替**：第 1、3、5… 道判断题是真陈述，第 2、4、6… 道用其他章的
 *   要点作伪陈述（answer false）—— 全真判断题在题量放大后会失去区分度；
 * - **干扰项按题轮转**：池长 ≥3 时同章多道选择题的选项组合各不相同。
 */
function objectiveQuestions(
  chapter: Chapter,
  allChapters: Chapter[],
  learnerState: LearnerState | undefined,
  count: number,
  questionIndex: Record<string, number>,
  lift = 0,
  profile?: LearnerProfile,
): PaperQuestion[] {
  const out: PaperQuestion[] = [];
  if (count <= 0) return out;
  const band = bandForChapter(learnerState?.byUnit[chapter.id], profile);
  const kps = chapter.keyPoints.length > 0 ? chapter.keyPoints : [chapter.title];
  const pool = distractorPool(chapter, allChapters);
  let judgeNo = 0;
  for (const { kp: kpi, occurrence } of quotaSlots(kps.length, count)) {
    const gi = nextIndex(questionIndex);
    const kp = kps[kpi];
    if (occurrence % 2 === 1) {
      const isTrue = judgeNo % 2 === 0;
      judgeNo += 1;
      const statement = isTrue ? kp : (pool[gi % pool.length] ?? kp);
      out.push(buildJudge(chapter, statement, isTrue, band, lift));
    } else {
      out.push(buildChoice(chapter, kp, pickDistractors(pool, gi), band, gi, lift));
    }
  }
  return out;
}

/** 单元测：单章按内容定量（每要点 2 题）+（band>1 且有 AI）2 主观：qa + application。 */
function unitQuota(
  chapter: Chapter,
  allChapters: Chapter[],
  learnerState: LearnerState | undefined,
  allowSubjective: boolean,
  questionIndex: Record<string, number>,
  profile?: LearnerProfile,
): PaperQuestion[] {
  const quota = chapterQuota("unit-test", chapter);
  const band = bandForChapter(learnerState?.byUnit[chapter.id], profile);
  const out = objectiveQuestions(
    chapter,
    allChapters,
    learnerState,
    quota.objective,
    questionIndex,
    quota.lift,
    profile,
  );
  if (band > 1 && allowSubjective) {
    const kps = chapter.keyPoints.length > 0 ? chapter.keyPoints : undefined;
    out.push(buildSubjective(chapter, kps?.[0], "qa", band));
    out.push(buildSubjective(chapter, kps?.[1], "application", band));
  }
  return out;
}

/** 阶段测：每章按内容定量 +（band>1 且有 AI）主观 1（qa/application 按章序轮换）。 */
function stageQuota(
  chapter: Chapter,
  allChapters: Chapter[],
  learnerState: LearnerState | undefined,
  allowSubjective: boolean,
  questionIndex: Record<string, number>,
  ci: number,
  profile?: LearnerProfile,
): PaperQuestion[] {
  const quota = chapterQuota("stage-test", chapter);
  const band = bandForChapter(learnerState?.byUnit[chapter.id], profile);
  const out = objectiveQuestions(
    chapter,
    allChapters,
    learnerState,
    quota.objective,
    questionIndex,
    quota.lift,
    profile,
  );
  if (band > 1 && allowSubjective) {
    const kps = chapter.keyPoints.length > 0 ? chapter.keyPoints : undefined;
    const type: "qa" | "application" = ci % 2 === 0 ? "qa" : "application";
    out.push(buildSubjective(chapter, kps?.[0], type, band));
  }
  return out;
}

/** 补考卷：每章按内容定量，主观剔除，难度整体降一档（lift = -1）。 */
function retakeQuota(
  chapter: Chapter,
  allChapters: Chapter[],
  learnerState: LearnerState | undefined,
  questionIndex: Record<string, number>,
  profile?: LearnerProfile,
): PaperQuestion[] {
  const quota = chapterQuota("retake", chapter);
  return objectiveQuestions(
    chapter,
    allChapters,
    learnerState,
    quota.objective,
    questionIndex,
    quota.lift,
    profile,
  );
}

/** 综合测：总题量 clamp(3n, 15, 20)，客观 ~60% / 主观 ~40%（每章主观至多 2）。 */
function buildFinalTest(
  chapters: Chapter[],
  allChapters: Chapter[],
  learnerState: LearnerState | undefined,
  allowSubjective: boolean,
  questions: PaperQuestion[],
  questionIndex: Record<string, number>,
  profile?: LearnerProfile,
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
    objectiveQuestions(chapter, allChapters, learnerState, objBase + add, questionIndex, 0, profile)
      .forEach((q) => questions.push(q));
  });

  // 主观题：轮转分配（章 = s % n；qa/application 按主观全局序号交替）。
  for (let s = 0; s < subjectiveTotal; s++) {
    const chapter = chapters[s % n];
    const band = bandForChapter(learnerState?.byUnit[chapter.id], profile);
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

/* 卷型候选（NEW_PAPER_MODES / availablePaperModes / canCreatePaperMode）
   与跨文档聚合出卷（createPaperGroupedByDoc / createRetakePaper /
   createGoalPaper）已拆到 `./paper-scope.ts`（G5 行数护栏），由 engine/index.ts
   统一 re-export，调用方不变。 */

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
  /** 客观题证据快照（难度权重与得分；AI 主观分并入口径重算用，见 PaperResult.objective）。 */
  objective?: { weight: number; earned: number };
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
    objective: { weight: totalW, earned: earnedW },
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
      objective: graded.objective,
      perChapter,
      wrongQuestions: graded.wrongQuestions,
      createdAt: now,
    },
    learnerState: nextState,
    graded,
  };
}

/* ------------------------------------------------------------------ */
/* 主观题 AI 批语回填（N3/T12）—— 判卷流消费                          */
/* ------------------------------------------------------------------ */

/** 主观题达到该分即视为通过（与及格线语义对齐；报告/芯片用同一阈值）。 */
export const SUBJECTIVE_PASS = 0.6;

/** AI 对一道主观题的判分结果（提示词管线产出，供 attach 回填）。 */
export interface SubjectiveGradeFeed {
  questionId: string;
  /** 0..1。 */
  score: number;
  /** 批语（≤120 字）。 */
  feedback: string;
  /** 定位到的章节要点（可为空）。 */
  point?: string;
}

/**
 * 把 AI 主观判分合并进 PaperResult（N3 双证据 · T12 attachSubjectiveGrades 的升级）。
 *
 * 证据线设计（写入 docs §5.6 的 N3 打磨口径）：
 *  - 掌握度回写（gradeAndApply 已写入的 perChapter.mastery 与 learnerState）只吃
 *    客观确定性证据 —— 本函数不触碰 perChapter / 不回写 learnerState，保证平滑
 *    回写可复算、不受模型/重试波动影响；
 *  - AI 主观分只进「卷面展示口径 totalScore」：当卷内所有「已作答」主观题均拿到
 *    AI 分（missing 为空）时并入；未作答主观题按确定性 0 分参与并入（与客观题
 *    未答判错对称，无需 AI 也不伪造）。存在缺 AI 分的已作答题（部分失败）→
 *    totalScore 保持基线口径，待报告页重试补齐后再次并入。
 *
 * 副作用（错题回顾）：主观 < pass 的 AI 批改题与未作答（0 分）题追加进
 * wrongQuestions（附 aiFeedback / point）；已通过的主观题不入错题。
 * 同时写入主观作答快照 subjectiveAnswers 与每题得分 subjectiveScores
 * （报告页据此展示批改状态并提供「重试 AI 批改」，N3b）。
 *
 * 幂等：wrongQuestions 已含的 questionId 不重复追加；重复并入只覆盖 totalScore
 * 与 scores（无重复副作用）。纯函数，由调用方持久化。
 */
export function mergeSubjectiveGrades(input: {
  result: PaperResult;
  paper: Paper;
  answers: PaperAnswers;
  aiGrades: readonly SubjectiveGradeFeed[];
  pass?: number;
}): PaperResult {
  const { result, paper, answers, aiGrades, pass = SUBJECTIVE_PASS } = input;
  const subjects = paper.questions.filter((q) => isSubjectiveType(q.type));
  if (subjects.length === 0) return result;

  const aiById = new Map(aiGrades.map((g) => [g.questionId, g]));
  const scores: Record<string, number> = {};
  const subjectiveAnswers: Record<string, string> = {};
  const missing: string[] = []; // 已作答但缺 AI 分（pending，可重试补齐）

  for (const s of subjects) {
    const answerText = (answers[s.id] ?? "").trim();
    if (!answerText) {
      // 未作答：确定性 0 分（进分母惩罚，与客观题未答判错一致；无需 AI）。
      scores[s.id] = 0;
      continue;
    }
    subjectiveAnswers[s.id] = answerText;
    const ai = aiById.get(s.id);
    if (ai && Number.isFinite(ai.score)) {
      scores[s.id] = Math.min(1, Math.max(0, ai.score));
    } else {
      missing.push(s.id); // 保持 pending，报告页可重试
    }
  }

  // —— 卷面并入（仅当所有已作答主观题都有 AI 分）——
  // 客观部分优先取 result.objective 快照（gradeAndApply 写入；merge 幂等——对已
  // 并入的 result 再次调用也精确）；旧数据（无快照）由 paper 客观题难度与基线
  // 总分反推——旧 result 尚未并入、totalScore 为纯客观口径，反推成立，并回填
  // 快照保证后续幂等。
  let totalScore = result.totalScore;
  let objWeight = 0;
  let objEarnedW = 0;
  if (missing.length === 0) {
    const subWeight = subjects.reduce((n, s) => n + s.difficulty, 0);
    const subW = subjects.reduce((n, s) => n + (scores[s.id] ?? 0) * s.difficulty, 0);
    if (result.objective) {
      objWeight = result.objective.weight;
      objEarnedW = result.objective.earned;
    } else {
      objWeight = paper.questions.reduce(
        (n, q) => n + (isSubjectiveType(q.type) ? 0 : q.difficulty),
        0,
      );
      objEarnedW = result.totalScore * objWeight;
    }
    const denom = objWeight + subWeight;
    if (denom > 0) {
      totalScore = Math.min(1, Math.max(0, (objEarnedW + subW) / denom));
    }
  }

  // —— 错题回顾（AI 分 < pass 与未作答 0 分；幂等去重）——
  const wrong = [...result.wrongQuestions];
  const existing = new Set(wrong.map((w) => w.questionId));
  for (const [qid, sc] of Object.entries(scores)) {
    if (sc >= pass || existing.has(qid)) continue;
    const q = paper.questions.find((qq) => qq.id === qid);
    if (!q || !isSubjectiveType(q.type)) continue;
    existing.add(qid);
    const ai = aiById.get(qid);
    const feedback = (ai?.feedback ?? "").trim();
    const point = (ai?.point ?? "").trim();
    wrong.push({
      questionId: qid,
      yourAnswer: (answers[qid] ?? "").trim() || "（未作答）",
      ...(feedback.length > 0 ? { aiFeedback: feedback } : {}),
      ...(point.length > 0 ? { point } : {}),
    });
  }

  const answersSnapshot = Object.keys(subjectiveAnswers).length > 0 ? subjectiveAnswers : undefined;
  const scoresSnapshot = Object.keys(scores).length > 0 ? scores : undefined;
  // 回填客观证据快照（缺失且本次完成并入）：让任何经本函数并入过的 result 都带
  // 快照，后续重试 / 重复并入不再依赖反推（幂等）。
  const objectiveSnapshot =
    missing.length === 0 && !result.objective ? { weight: objWeight, earned: objEarnedW } : undefined;
  const unchanged =
    totalScore === result.totalScore &&
    wrong.length === result.wrongQuestions.length &&
    answersSnapshot === undefined &&
    scoresSnapshot === undefined &&
    objectiveSnapshot === undefined;
  if (unchanged) return result;

  return {
    ...result,
    totalScore,
    wrongQuestions: wrong,
    ...(objectiveSnapshot ? { objective: objectiveSnapshot } : {}),
    ...(answersSnapshot ? { subjectiveAnswers: answersSnapshot } : {}),
    ...(scoresSnapshot ? { subjectiveScores: scoresSnapshot } : {}),
  };
}
