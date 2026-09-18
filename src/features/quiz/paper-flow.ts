/**
 * 出卷流程服务（paper-flow）—— 本地确定性卷 + 可选 AI 题面 + 落库。
 *
 * 抽出来的原因：`/quiz/new` 向导与资料详情页「章节试卷」Tab 都要出卷，
 * 两处各写一遍必然漂移（AI 就绪门 / 失败回退 / 卷型校验 / 落库时机）。
 * 本模块是出卷的唯一入口。
 *
 * 边界：只做「建卷 → 存卷」，**不做导航** —— 向导要跳答题页、
 * 详情页要留在本页刷新列表，去向由调用方决定。
 */
import type { Chapter, LearnerState, Paper, PaperMode } from "../../domain";
import { sortChaptersByOrder } from "../../domain";
import { canCreatePaperMode, createPaper } from "../../engine";
import { generateQuizQuestionsWithAi } from "../../ai";
import { buildActiveProvider } from "../../stores/useSettingsStore";
import { storage } from "../../stores/useLoopStore";
import { loadMemoryEntries } from "../memory/memory-service";

/** 出卷失败的分类（UI 按 kind 取 i18n 文案，不暴露原始错误）。 */
export type PaperFlowErrorKind = "invalid-mode" | "no-chapters";

export class PaperFlowError extends Error {
  readonly kind: PaperFlowErrorKind;
  constructor(kind: PaperFlowErrorKind) {
    super(kind);
    this.kind = kind;
  }
}

export interface PaperFlowInput {
  /** 范围内章（内部按 order 升序；出卷只使用这些章）。 */
  chapters: Chapter[];
  /** 同资料全部章（choice 干扰项源）；缺省 = 范围章自身。 */
  allChapters?: Chapter[];
  /** 卷型（补考卷不支持：只能由报告页触发）。 */
  mode: Exclude<PaperMode, "retake">;
  /** 学习者状态（难度自适应）。 */
  learnerState?: LearnerState | null;
  /** 资料正文（AI 出题素材）；为空则跳过 AI 题面，保持本地卷。 */
  text?: string;
}

export interface PaperFlowResult {
  paper: Paper;
  /** 题面是否由 AI 生成（false = 本地确定性题库，含 AI 失败回退）。 */
  ai: boolean;
}

/**
 * 建一张卷并落库。
 *
 * 顺序固定：卷型校验 → 本地确定性卷 →（AI 就绪且有正文）AI 题面 → 落库。
 * AI 出题失败**静默回退**本地卷（P0-3 不伪造），不抛给用户。
 */
export async function createPaperAndSave(
  input: PaperFlowInput,
): Promise<PaperFlowResult> {
  const ordered = sortChaptersByOrder(input.chapters);
  const allChapters = input.allChapters ?? ordered;
  if (ordered.length === 0) throw new PaperFlowError("no-chapters");

  // 与向导同源校验：章数不足的综合测等非法组合一律拒绝
  // ——宁可不出，也不产出语义错误的卷（详情页一键出卷会绕过向导 UI 的禁用态）。
  if (
    !canCreatePaperMode(input.mode, {
      selected: ordered.length,
      total: allChapters.length,
    })
  ) {
    throw new PaperFlowError("invalid-mode");
  }

  const provider = buildActiveProvider();
  const aiReady = provider.isConfigured();
  // F1：画像在**此处**读取（唯一出卷入口），本地卷与 AI 题面共用同一份 ——
  // 未填写 = undefined，两条路径都退回改动前行为（零回归）。
  const profile = await storage.getProfile();
  // F9：记忆在同一个入口读取（`ai/` 不得 import `features/` → 由调用侧读好再注入）。
  // 空文档 → `[]` → 管道不追加记忆块 → 与改动前逐字节相同。
  const memory = await loadMemoryEntries(storage);
  const local = createPaper({
    scope: { chapterIds: ordered.map((c) => c.id), mode: input.mode },
    chapters: ordered,
    allChapters,
    learnerState: input.learnerState ?? undefined,
    profile,
    allowSubjective: aiReady,
  });

  let paper = local;
  let ai = false;
  if (aiReady && local.questions.length > 0 && input.text) {
    try {
      paper = {
        ...local,
        questions: await generateQuizQuestionsWithAi({
          provider,
          paper: local,
          chapters: ordered,
          text: input.text,
          learner: profile,
          memory,
        }),
      };
      ai = true;
    } catch (err) {
      console.warn("[paper-flow] AI 出题失败，回退本地题库：", err);
    }
  }

  await storage.savePaper(paper);
  return { paper, ai };
}
