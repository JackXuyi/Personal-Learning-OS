/**
 * AI 简历解析管道（F1）—— 把一份（已掩码的）简历文本整理成 `ResumeDraft`。
 *
 * 与 `overview-pipeline.ts` 同构：**自持** LIMITS + 提示词 + 纯解析器 + 执行器，
 * 只从 `pipelines.ts` 复用 `chatJson` / `isRecord` / `str`。
 *
 * 产出边界（D1）：**只**产出 `background` + `level` 建议值 + 供用户核对的原始条目
 * （years / education / skills）。`weeklyMinutes` 与 `preferences` **不由简历推断**
 * —— 简历里没有「每周愿意投入多少时间」「喜欢怎么学」，AI 只能编。
 *
 * 诚实降级：未配置 / 调用失败 / 内容不可解析一律抛 `AiProviderError`（类型化、可
 * 重试），绝不返回「看起来像档案」的半成品。
 */
import type { LearnerLevel } from "../domain";
import { LEARNER_LEVELS } from "../domain";
import type { AIProvider } from "./types";
import { chatJson, isRecord, str, TEMPERATURE } from "./pipeline-core";

/** 简历解析的尺寸护栏（自持一份，不扩大 `PIPELINE_LIMITS`）。 */
export const RESUME_LIMITS = {
  /** 掩码后的简历文本上限（超出拒绝并提示精简）。 */
  maxChars: 30_000,
  /** 背景摘要上限（与 `PROFILE_LIMITS.backgroundChars` 同值，分层约束下各自注释来源）。 */
  backgroundChars: 600,
  /** 水平建议理由上限。 */
  reasonChars: 120,
  /** 技能栈条数上限。 */
  skillMax: 8,
  /** 单条技能字符上限。 */
  skillChars: 24,
  /** 学历字段字符上限。 */
  educationChars: 40,
} as const;

export const RESUME_SYSTEM = [
  "你在为一位自学者整理背景档案。只输出 JSON，不要 markdown 围栏与解释文字。",
  "硬约束：",
  "- 禁止输出姓名、手机号、邮箱、身份证号、住址、个人主页链接；",
  "- background 只写「学历层次 / 相关年限 / 领域 / 主要技能」四类事实，不写主观评价、不写公司全称；",
  "- level 只能取 beginner|basic|intermediate|advanced，且必须能从年限与技能栈支撑；无法判断则省略该字段；",
  "- 不要推断「每周可投入时间」与「学习偏好」—— 这些信息简历中不存在，不要编造；",
  "- 无法确定的事实一律省略，不要用常识补全。",
  '格式：{"background":"…","level":"intermediate","levelReason":"…","years":3,"education":"本科","skills":["…"]}',
].join("\n");

/**
 * AI 解析草稿（**纯数据**：不含原文、不含 promptText）。
 * 由 `features/profile/resume-import.ts` 二次清洗后交给 UI 确认。
 */
export interface ResumeDraft {
  /** 写入 `profile.background` 的摘要（落库前还会再过一次 `maskPii`）。 */
  background?: string;
  /** 水平建议值（**默认不勾选**，用户显式点选才写入）。 */
  level?: LearnerLevel;
  /** 建议理由，供用户判断，不落库。 */
  levelReason?: string;
  /** 供用户核对的原始条目。 */
  years?: number;
  education?: string;
  skills: string[];
}

const isLevel = (v: unknown): v is LearnerLevel =>
  typeof v === "string" && (LEARNER_LEVELS as readonly string[]).includes(v);

/**
 * 宽松解析模型产出：字段缺失 / 类型不符 → 该字段 `undefined`，**绝不抛错**
 * （与 `parseOverviewTitle` 同策略：附加解析产物不该炸掉整条链路）。
 */
export function parseResumeDraft(raw: unknown): ResumeDraft {
  if (!isRecord(raw)) return { skills: [] };

  const bg = str(raw.background)?.trim();
  const level = isLevel(raw.level) ? raw.level : undefined;
  const reason = str(raw.levelReason)?.trim();
  const yearsRaw = raw.years;
  const years =
    typeof yearsRaw === "number" && Number.isFinite(yearsRaw) && yearsRaw >= 0 && yearsRaw <= 80
      ? Math.round(yearsRaw)
      : undefined;
  const edu = str(raw.education)?.trim();

  const skills: string[] = [];
  const seen = new Set<string>();
  if (Array.isArray(raw.skills)) {
    for (const item of raw.skills) {
      const s = (str(item) ?? "").trim().slice(0, RESUME_LIMITS.skillChars);
      if (!s || seen.has(s)) continue;
      seen.add(s);
      skills.push(s);
      if (skills.length >= RESUME_LIMITS.skillMax) break;
    }
  }

  return {
    ...(bg ? { background: bg.slice(0, RESUME_LIMITS.backgroundChars) } : {}),
    ...(level ? { level } : {}),
    ...(reason ? { levelReason: reason.slice(0, RESUME_LIMITS.reasonChars) } : {}),
    ...(years !== undefined ? { years } : {}),
    ...(edu ? { education: edu.slice(0, RESUME_LIMITS.educationChars) } : {}),
    skills,
  };
}

/** 草稿是否为空（无背景、无建议档位、无任何可核对条目）→ 调用方按「解析失败」处理。 */
export function isEmptyResumeDraft(draft: ResumeDraft): boolean {
  return (
    !draft.background &&
    !draft.level &&
    draft.years === undefined &&
    !draft.education &&
    draft.skills.length === 0
  );
}

/**
 * 执行一次简历解析调用。
 *
 * 温度复用 `TEMPERATURE.grade`（0.1）：与章内提问 / 主观题批改同口径 ——
 * **事实抽取类**任务，越低越稳。
 */
export async function extractResumeDraft(
  provider: AIProvider,
  maskedText: string,
): Promise<ResumeDraft> {
  const raw = await chatJson(
    provider,
    [
      { role: "system", content: RESUME_SYSTEM },
      { role: "user", content: `【简历文本】\n${maskedText}` },
    ],
    TEMPERATURE.grade,
  );
  return parseResumeDraft(raw);
}
