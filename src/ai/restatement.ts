/**
 * 费曼式复述的 AI 管线（restatement）—— 提示词 + 宽容解析 + 执行器。
 *
 * 设计（docs/learn-feynman-restatement-design-2026-09.md §4.3.2 / §8.8）：
 * - **只产出 `quotes` 与文字，不产出任何偏移量**。偏移一律由 service 层用
 *   `locateQuote` 反查（「不信 AI 的偏移量」是既有护栏，见 evidence-anchor）。
 *   好处：本模块可零 IO 纯逻辑单测，`quotes` 就是可断言的原始事实。
 * - **对照基准不用检索**：`body` 与 `keyPoints` 由调用方直接给（整章正文 +
 *   章要点全量）。检索会按查询词偏置 —— 用复述去检索，命中的恰好是"你已经
 *   讲到的"，漏掉的部分永远检索不到（§3.4 G3）。
 * - **宽容取值 + 严判**：缺字段 / 空串一律丢弃该条，绝不抛错；`errors` 三条
 *   字段（quote + correction + evidence）齐全才留（没有原文依据的更正在本设计
 *   里不可展示）。
 *
 * 依赖方向：只 import `./pipeline-core`、`./types`、`./learner-context` 与
 * `domain` 的类型，**不 import `pipelines.ts`** —— 无环、无 TDZ 风险。
 * 锚定（`features/` 层）不在此处。
 */
import type { LearnerProfile } from "../domain";
import type { AIProvider, ChatMessage } from "./types";
import { chatJson, isRecord, PIPELINE_LIMITS, str, TEMPERATURE } from "./pipeline-core";
import { buildLearnerContextBlock } from "./learner-context";

export const RESTATEMENT_SYSTEM = [
  "你是严格但建设性的学科老师。用户刚学完一章，用自己的话复述了这一章。",
  "你唯一的依据是下面给出的【本章要点】与【本章正文】。",
  "",
  "请逐项对照，只输出下面的四个字段：",
  "1. covered —— 复述**准确讲到了**的要点；每条给 `point`（一句话）与 `quote`。",
  "2. missed  —— 复述**完全没有讲到**的要点；每条同样给 `point` 与 `quote`。",
  "3. errors  —— 复述中与原文**不符 / 不准确 / 过度外推**的说法；",
  "   每条给 `quote`（逐字引用**用户的复述原文**）、`correction`（原文的正确说法）、",
  "   `evidence`（【本章正文】中支撑该更正的逐字原文）。",
  "4. advice  —— ≤120 字，指出最该补的 1~2 处；不要重复上面已列的内容。",
  "",
  "硬性规则：",
  "A. 严禁使用【本章要点】【本章正文】之外的任何知识；不得补充资料未出现的信息。",
  "B. `quote` / `evidence` 必须**逐字复制**原文，不得改写、不得润色、不得把相隔很远的",
  "   两句拼在一起、不得省略中间内容。每条 ≤200 字。",
  "C. `errors` 只在确实与原文冲突时给。「没讲到」属于 missed，不属于 errors。",
  "D. 宁可少给：没有把握的条目不要输出，不要凑数。",
  "",
  '只输出 JSON：{"covered":[{"point":"…","quote":"…"}],',
  '"missed":[{"point":"…","quote":"…"}],',
  '"errors":[{"quote":"…","correction":"…","evidence":"…"}],"advice":"…"}。',
  "不要输出任何其他文字。",
].join("\n");

export interface RestatementInput {
  chapterTitle: string;
  documentTitle: string;
  /** 本章要点（已按 keyPointMergeMax 截断）。 */
  keyPoints: readonly string[];
  /** 章正文（已按 RESTATEMENT_LIMITS.bodyChars 截断）。 */
  body: string;
  /** 用户复述原文。 */
  restatement: string;
  /** F1 学习者画像：注入背景块（缺省 = 不注入，输出与改动前逐字节相同）。 */
  learner?: LearnerProfile;
}

/** 模型原始产出（**不含任何偏移量** —— 偏移一律由 service 层 locateQuote 算出）。 */
export interface RestatementDraft {
  covered: { point: string; quote: string }[];
  missed: { point: string; quote: string }[];
  errors: { quote: string; correction: string; evidence: string }[];
  advice?: string;
}

export function buildRestatementMessages(input: RestatementInput): ChatMessage[] {
  const kp = input.keyPoints
    .slice(0, PIPELINE_LIMITS.keyPointMergeMax)
    .map((k) => `· ${k}`)
    .join("\n");
  const body = input.body.slice(0, PIPELINE_LIMITS.restatementBodyChars);
  // F1：背景块只影响「讲解深浅」，绝不改变「只依据原文」的硬规则（块内自带免责声明）。
  const learnerBlock = buildLearnerContextBlock(input.learner);
  return [
    { role: "system", content: RESTATEMENT_SYSTEM },
    {
      role: "user",
      content: [
        `资料：《${input.documentTitle}》 · 当前章：《${input.chapterTitle}》`,
        "",
        "【本章要点】",
        kp || "（无）",
        "",
        "【本章正文】",
        body,
        "",
        "【用户复述】",
        input.restatement,
        ...(learnerBlock ? ["", learnerBlock] : []),
      ].join("\n"),
    },
  ];
}

/**
 * 解析模型产出。
 *
 * 策略与既有管线一致：**宽容取值 + 严判**（照抄 `parseChapterQaAnswer`）。
 * - `covered` / `missed`：逐条 `point` 与 `quote` 皆非空才留；**合计**截断
 *   `restatementMaxPoints`；`quote` 截断 `restatementQuoteMaxChars`；
 * - `errors`：`quote` + `correction` + `evidence` 三者齐全才留；截断
 *   `restatementMaxErrors`；
 * - `advice`：`trim` + 截断 `restatementAdviceMaxChars`；
 * - `!isRecord(raw)` → 全空草稿（**绝不抛错**，由 service 判 `parse` 失败）。
 */
export function parseRestatementDraft(raw: unknown): RestatementDraft {
  if (!isRecord(raw)) return { covered: [], missed: [], errors: [] };

  const { restatementMaxPoints, restatementMaxErrors } = PIPELINE_LIMITS;
  const pointCap = PIPELINE_LIMITS.restatementPointMaxChars;
  const quoteCap = PIPELINE_LIMITS.restatementQuoteMaxChars;

  const readPoints = (v: unknown, room: number): { point: string; quote: string }[] => {
    const arr = Array.isArray(v) ? v : [];
    const out: { point: string; quote: string }[] = [];
    for (const item of arr) {
      if (out.length >= room) break;
      if (!isRecord(item)) continue;
      const point = (str(item.point) ?? "").trim();
      const quote = (str(item.quote) ?? "").trim();
      if (!point || !quote) continue; // 任一为空即丢该条
      out.push({ point: point.slice(0, pointCap), quote: quote.slice(0, quoteCap) });
    }
    return out;
  };

  // covered 与 missed 共享同一上限（合计）：先 covered，剩余额度给 missed。
  const covered = readPoints(raw.covered, restatementMaxPoints);
  const missed = readPoints(raw.missed, restatementMaxPoints - covered.length);

  const rawErrors = Array.isArray(raw.errors) ? raw.errors : [];
  const errors: { quote: string; correction: string; evidence: string }[] = [];
  for (const item of rawErrors) {
    if (errors.length >= restatementMaxErrors) break;
    if (!isRecord(item)) continue;
    const quote = (str(item.quote) ?? "").trim();
    const correction = (str(item.correction) ?? "").trim();
    const evidence = (str(item.evidence) ?? "").trim();
    // 缺 evidence 的更正没有原文依据，本设计里不可展示 → 整条丢弃。
    if (!quote || !correction || !evidence) continue;
    errors.push({
      quote: quote.slice(0, quoteCap),
      correction: correction.slice(0, quoteCap),
      evidence: evidence.slice(0, quoteCap),
    });
  }

  const advice = (str(raw.advice) ?? "").trim().slice(0, PIPELINE_LIMITS.restatementAdviceMaxChars);
  return { covered, missed, errors, ...(advice ? { advice } : {}) };
}

/**
 * 执行一次复述检查调用。
 *
 * `TEMPERATURE.grade`（0.1）复用既有最低温度档：事实判定类任务，与
 * `gradeSubjectiveWithAi` / `answerChapterQuestion` 同口径。
 */
export async function extractRestatementFeedback(
  provider: AIProvider,
  input: RestatementInput,
): Promise<RestatementDraft> {
  const raw = await chatJson(provider, buildRestatementMessages(input), TEMPERATURE.grade);
  return parseRestatementDraft(raw);
}
