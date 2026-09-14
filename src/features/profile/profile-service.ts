/**
 * 画像服务层（F1）—— 校验 / 归一 / 合并的**纯函数**集合。
 *
 * 边界：
 * - 纯编排，只依赖 `domain` 与 `ai`，**不 import stores 与 React**
 *   → `node --experimental-strip-types` 可直跑单测；
 * - **不产生文案**：只抛类型化 `ProfileError`，由 UI 侧 `useI18n` 映射；
 * - 读写落库不在此层（唯一写路径是 `useLoopStore.saveProfile`）。
 *
 * ⚠️ 本文件会被 `tests/learner-profile.test.ts` 在 strip-types 下直跑 ——
 * 不得使用 TS 参数属性（`constructor(readonly x: T)`）与 `enum`。
 */
import type { LearnerProfile, LearnerLevel, StudyDepth, StudyStyle } from "../../domain";
import { LEARNER_LEVELS, PROFILE_LIMITS } from "../../domain";
import type { ResumeDraft } from "../../ai/resume-pipeline";

/** 画像错误分类（UI 按 kind 取 i18n 文案，不暴露原始错误）。 */
export type ProfileErrorKind = "invalid-level" | "save-failed";

export class ProfileError extends Error {
  // ⚠️ 显式字段赋值（不用 TS 参数属性）：strip-types 不支持。
  readonly kind: ProfileErrorKind;
  constructor(kind: ProfileErrorKind, message?: string) {
    super(message ?? kind);
    this.name = "ProfileError";
    this.kind = kind;
  }
}

/** 表单产出的原始输入（未校验；`weeklyMinutes` 由调用方 parse 成 number 或留空）。 */
export interface LearnerProfileInput {
  level: string;
  weeklyMinutes?: number;
  depth?: string;
  style?: string;
  background?: string;
  backgroundSource?: "manual" | "resume";
}

const isRecordLoose = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isLevel = (v: unknown): v is LearnerLevel =>
  typeof v === "string" && (LEARNER_LEVELS as readonly string[]).includes(v);

const DEPTHS: readonly StudyDepth[] = ["breadth", "depth"];
const STYLES: readonly StudyStyle[] = ["reading", "practice", "quiz"];

/**
 * 归一化一份（可能来自 localStorage 旧数据 / 表单的）画像。
 *
 * | 输入情形 | 行为 |
 * |---|---|
 * | `level` 缺失 / 非法 | 返回 `undefined`（**视为未填写**，不猜档位） |
 * | `preferences` 缺失 / 枚举非法 | `depth` 回 `"depth"`、`style` 回 `"reading"`，不整条丢弃 |
 * | `weeklyMinutes` 非数字 / 越界 | 置 `undefined`（= 未声明） |
 * | `background` 超长 | 截断到 `PROFILE_LIMITS.backgroundChars` |
 * | `backgroundSource` 非法 | 置 `"manual"` |
 * | `updatedAt` 非数字 | 置 `Date.now()` |
 */
export function normalizeProfile(raw: unknown): LearnerProfile | undefined {
  if (!isRecordLoose(raw)) return undefined;
  if (!isLevel(raw.level)) return undefined;

  const prefsRaw = isRecordLoose(raw.preferences) ? raw.preferences : {};
  const depth = DEPTHS.includes(prefsRaw.depth as StudyDepth)
    ? (prefsRaw.depth as StudyDepth)
    : "depth";
  const style = STYLES.includes(prefsRaw.style as StudyStyle)
    ? (prefsRaw.style as StudyStyle)
    : "reading";

  const wm = raw.weeklyMinutes;
  const weeklyMinutes =
    typeof wm === "number" &&
    Number.isFinite(wm) &&
    wm >= PROFILE_LIMITS.weeklyMinutesMin &&
    wm <= PROFILE_LIMITS.weeklyMinutesMax
      ? Math.round(wm)
      : undefined;

  const bgRaw = typeof raw.background === "string" ? raw.background.trim() : "";
  const background = bgRaw ? bgRaw.slice(0, PROFILE_LIMITS.backgroundChars) : undefined;
  const backgroundSource = raw.backgroundSource === "resume" ? "resume" : "manual";
  const updatedAt =
    typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt)
      ? raw.updatedAt
      : Date.now();

  return {
    level: raw.level,
    preferences: { depth, style },
    backgroundSource,
    updatedAt,
    ...(weeklyMinutes !== undefined ? { weeklyMinutes } : {}),
    ...(background ? { background } : {}),
  };
}

/** 表单输入 → 落库值；档位非法时抛 `ProfileError("invalid-level")`。 */
export function toProfile(input: LearnerProfileInput, now = Date.now()): LearnerProfile {
  const normalized = normalizeProfile({ ...input, updatedAt: now });
  if (!normalized) throw new ProfileError("invalid-level", "画像档位非法。");
  return normalized;
}

/**
 * 简历草稿合并（UC-04 / TC-UC04-05）：**只**覆盖 `background` / `backgroundSource`
 * 与（用户显式勾选时的）`level`；`weeklyMinutes` 与 `preferences` **原样保留**
 * —— 简历推不出这两项，不能被 AI 草稿顺手清掉或改写。
 *
 * 返回 `undefined` 的唯一种情形：**原本没有画像**且用户**未采用** AI 建议档位。
 * 此时没有合法 `level` 可用，本函数**绝不**替用户猜一个（防「系统替我设了
 * beginner」的假象），由调用方提示用户先选择档位。
 */
export function mergeResumeDraft(
  base: LearnerProfile | undefined,
  draft: ResumeDraft,
  applyLevel: boolean,
  now = Date.now(),
): LearnerProfile | undefined {
  const level = applyLevel && draft.level ? draft.level : base?.level;
  if (!level) return undefined;
  const background = draft.background
    ? draft.background.slice(0, PROFILE_LIMITS.backgroundChars)
    : base?.background;
  return {
    level,
    preferences: base?.preferences ?? { depth: "depth", style: "reading" },
    ...(base?.weeklyMinutes !== undefined ? { weeklyMinutes: base.weeklyMinutes } : {}),
    ...(background ? { background } : {}),
    backgroundSource: draft.background ? "resume" : (base?.backgroundSource ?? "manual"),
    updatedAt: now,
  };
}
