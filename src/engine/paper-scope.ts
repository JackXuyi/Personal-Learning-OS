/**
 * Paper Scope（出卷范围与聚合出卷）—— 从 `quiz-engine.ts` 拆出的**范围层**。
 *
 * 拆出原因（docs/goal-capability-assessment-design-2026-09.md §8.5 G5 护栏）：
 * `quiz-engine.ts` 已逼近 700 行上限，而 F6 目标卷需要新增「跨文档分组出卷」。
 * 这里承载两件事：
 *   ① 卷型候选（向导 / 详情页「一键出卷」共用的单一真源）；
 *   ② 跨文档聚合出卷（补考卷与目标级客观卷共用）。
 *
 * 本文件**不做题型配额与题面构造**（那是 `quiz-engine.ts` 的职责），只负责
 * 「把范围章分组、分别交给 `createPaper`、再合并成一张卷」。
 * `engine/index.ts` 统一 re-export → 调用方零改动（唯一例外见 T3 runbook 偏差说明）。
 */
import type { Chapter, LearnerProfile, LearnerState, Paper, PaperMode } from "../domain";
import { newId, PAPER_MODE_LABEL, sortChaptersByOrder } from "../domain";
import { createPaper } from "./quiz-engine";

/* ------------------------------------------------------------------ */
/* 卷型候选（向导与详情页「一键出卷」共用的单一真源）                  */
/* ------------------------------------------------------------------ */

/** 新建卷可选的三种卷型（补考卷由报告页触发，不在其列）。 */
export const NEW_PAPER_MODES = ["unit-test", "stage-test", "final-test"] as const;

/** 卷型 → 所需最小章数。 */
export const PAPER_MODE_MIN_CHAPTERS: Record<Exclude<PaperMode, "retake">, number> = {
  "unit-test": 1,
  "stage-test": 2,
  "final-test": 3,
};

/**
 * 给定「已选章数 / 总章数」，返回可出的卷型（纯函数）。
 *
 * 规则原在 /quiz/new 向导内部，资料详情页「一键出卷」需要同源校验
 * （否则推荐出的 retake / 不合法 final-test 会绕过向导校验直接落库），
 * 故下沉到引擎层，两边共用一份规则。
 */
export function availablePaperModes(args: {
  /** 已选章数。 */
  selected: number;
  /** 该资料的总章数。 */
  total: number;
}): Exclude<PaperMode, "retake">[] {
  const { selected: n, total } = args;
  const ok = (mm: Exclude<PaperMode, "retake">): boolean => {
    if (n === 0) return false;
    switch (mm) {
      case "unit-test":
        return n === 1;
      case "stage-test":
        // ≥2 章；全本（2 章以下小资料）也允许，避免无模式可选。
        return n >= 2 && (n < total || total <= 2);
      case "final-test":
        return n === total && total >= PAPER_MODE_MIN_CHAPTERS["final-test"];
    }
  };
  return NEW_PAPER_MODES.filter(ok);
}

/**
 * 判断某卷型当前是否可出（纯函数，GUI 禁用态与落库前校验共用）。
 */
export function canCreatePaperMode(
  mode: PaperMode,
  args: { selected: number; total: number },
): boolean {
  if (mode === "retake") return false; // 补考卷只能由报告页触发
  return availablePaperModes(args).includes(mode);
}

/* ------------------------------------------------------------------ */
/* 跨文档聚合出卷                                                      */
/* ------------------------------------------------------------------ */

/**
 * 跨文档分组出卷（从 `createRetakePaper` 上移，补考卷与目标卷共用）。
 *
 * 为什么必须分组：`allChapters` 决定 choice 干扰项来源 —— 单一数组会把 A
 * 文档的要点泄作 B 文档的选项（createRetakePaper 头注释已记录该 P1 语义坑）。
 *
 * 与 `createPaperAndSave`（features/quiz/paper-flow.ts）的关系：本函数**不做**
 * 卷型—章数校验，供「范围天然不满足向导规则」的入口直接使用（目标级客观卷
 * 的范围通常是全库子集，过 `canCreatePaperMode("final-test")` 必 `invalid-mode`）。
 *
 * 纯函数；确定性规则与 createPaper 一致（同输入 → 同题型/同题面结构）。
 * 空章输入返回空卷（不抛错，与 createPaper 无章时行为一致，由 UI 守卫）。
 */
export function createPaperGroupedByDoc(input: {
  /** 范围章（内部按 order 升序）。 */
  chapters: Chapter[];
  /** docId → 该文档全部章（choice 干扰项源）；缺省时退化为用本组章自身。 */
  docChapters?: ReadonlyMap<string, readonly Chapter[]>;
  mode: PaperMode;
  learnerState?: LearnerState;
  /** F1 画像：各组章同样走「有证据看实测 / 无证据看先验」（缺省 = 现状）。 */
  profile?: LearnerProfile;
  /** 是否允许主观题（= 是否配置了 AI 判分）；false 时主观题剔除（诚实降级）。 */
  allowSubjective?: boolean;
  /** 测试注入时间戳。 */
  now?: number;
}): Paper {
  const {
    chapters,
    docChapters,
    mode,
    learnerState,
    profile,
    allowSubjective = false,
    now = Date.now(),
  } = input;
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
      scope: { chapterIds: group.map((c) => c.id), mode },
      chapters: group,
      allChapters: [...(docChapters?.get(group[0].documentId) ?? group)],
      learnerState,
      profile,
      allowSubjective,
      now,
    }),
  );

  return {
    id: newId("paper"),
    scope: { chapterIds: ordered.map((c) => c.id), mode },
    title: PAPER_MODE_LABEL[mode],
    questions: parts.flatMap((p) => p.questions),
    status: "open",
    createdAt: now,
  };
}

/**
 * 补考卷（docs §4 模式表：仅错题章 · 每章 3 客观 · 主观剔除 · 降一档难度）。
 *
 * 签名与行为均与拆分前一致（`createPaperGroupedByDoc` 的 `retake` 特化）。
 */
export function createRetakePaper(input: {
  /** 需要补考的章（错题章范围；内部按 order 升序）。 */
  chapters: Chapter[];
  /** docId → 该文档全部章（choice 干扰项源）；缺省时退化为用范围章自身。 */
  docChapters?: ReadonlyMap<string, readonly Chapter[]>;
  learnerState?: LearnerState;
  /** F1 画像：补考卷各章同样走「有证据看实测 / 无证据看先验」（缺省 = 现状）。 */
  profile?: LearnerProfile;
  /** 测试注入时间戳。 */
  now?: number;
}): Paper {
  return createPaperGroupedByDoc({ ...input, mode: "retake", allowSubjective: false });
}

/**
 * 目标级客观卷（F6 阶段 1 「知识底座参考分」）—— 语义 = 范围章综合测，
 * 标题沿用「综合测」，落库与判卷完全复用既有链路。
 *
 * ⚠️ **不走** `createPaperAndSave`：该入口的 `canCreatePaperMode("final-test")`
 * 要求 `selected === total`（全本），而目标范围通常只是全库子集（G1）。
 * 卷型校验由服务层按「范围章数 ≥ `PAPER_MODE_MIN_CHAPTERS["final-test"]`」自行把关。
 */
export function createGoalPaper(input: {
  /** 目标范围章（内部按 order 升序并跨文档分组）。 */
  chapters: Chapter[];
  docChapters?: ReadonlyMap<string, readonly Chapter[]>;
  learnerState?: LearnerState;
  profile?: LearnerProfile;
  /** 是否允许主观题（= 是否配置了 AI 判分）。 */
  allowSubjective?: boolean;
  /** 测试注入时间戳。 */
  now?: number;
}): Paper {
  return createPaperGroupedByDoc({ ...input, mode: "final-test" });
}
