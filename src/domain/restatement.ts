/**
 * 章级复述（费曼式输出的产物 —— 「讲给我听」）。
 *
 * 定位：**用户产出的学习资产**，与章内提问（纯只读）性质不同 ——
 * 复述是"我写的"，因此落库（决策 D1-A）；落库后不得影响 mastery
 * （唯一写方仍是卷面，见 domain/evidence.ts 与 engine/learner-model.ts 的
 * V2 双证据注释）。
 *
 * 写入前提：**AI 必须就绪**（决策 D6-B）—— 未配置模型时面板阻断输入、
 * 服务层亦在落库之前早退，因此本记录**必然**对应一次成功的模型调用（feedback
 * 仍可能因调用失败 / 解析失败而为 undefined，那种情况文本保留、可重试）。
 *
 * 引文不变式（由 features/learn/restatement-service.ts::anchorRestatement 保证，
 * 单测断言）：
 *   - `covered[].quote` / `missed[].quote` / `errors[].evidence.quote` 为**章内相对
 *     偏移**（相对 chapter.contentRef.start），左闭右开，且必然落在本章正文内；
 *   - `errors[].quote` 为**复述文本内偏移**（锚回用户自己写的那句话）；
 *   - 锚不上的一律丢弃（零伪造引用），不产生"近似位置"。
 */
import type { SelfRating } from "./assessment";

/** 复述与反馈的尺寸护栏（UI 与服务层共用同一常量，防两处口径漂移）。 */
export const RESTATEMENT_LIMITS = {
  /** 复述太短则没有信息量，服务层直接拒绝（不进 AI）。 */
  minChars: 20,
  /** 复述字符上限（防灌水；UI 与 service 共用）。 */
  maxChars: 2_000,
} as const;

/** 一条「要点已覆盖 / 已遗漏」（引文锚回本章正文）。 */
export interface RestatementPoint {
  /** AI 给的要点描述（≤ PIPELINE_LIMITS.restatementPointMaxChars）。 */
  point: string;
  /** verbatim 章原文摘录（已通过 locateQuote 校验）。 */
  quote: string;
  /** 章内相对偏移（= 文档绝对偏移 − chapter.contentRef.start）。 */
  start: number;
  end: number;
}

/** 一处「复述与原文不符」（quote 锚回复述自身，evidence 锚回章正文）。 */
export interface RestatementMisread {
  /** 复述里被判定不准确的原话（verbatim 摘自语文本）。 */
  quote: string;
  /** 复述文本内偏移。 */
  start: number;
  end: number;
  /** 原文的正确说法（模型给的文字，非引文）。 */
  correction: string;
  /** 原文依据（锚回章正文；锚不上则整条丢弃）。 */
  evidence?: { quote: string; start: number; end: number };
}

/** 一次差距反馈快照（随复述一同落库；纯展示，不参与掌握度）。 */
export interface RestatementFeedback {
  at: number;
  covered: RestatementPoint[];
  missed: RestatementPoint[];
  errors: RestatementMisread[];
  /** 模型给的整体建议（≤ PIPELINE_LIMITS.restatementAdviceMaxChars）。 */
  advice?: string;
  /**
   * 要点覆盖率 = covered / (covered + missed)（**本地算**，不信模型自报，决策 D4-A）。
   * 分母为 0（一条都没锚上）时为 undefined —— UI 不展示伪覆盖率。
   */
  coverage?: number;
  /** 本次对照是否被截断（章正文超 bodyChars）→ UI 显式提示。 */
  truncated: boolean;
}

export interface Restatement {
  id: string;
  documentId: string;
  chapterId: string;
  /** 用户复述原文（≤ RESTATEMENT_LIMITS.maxChars）。 */
  text: string;
  createdAt: number;
  /** 最近一次 AI 差距反馈（未跑 / 失败 = undefined）。 */
  feedback?: RestatementFeedback;
}

/** 检查结果状态（UI 据此分支渲染，不做隐式兜底）。 */
export type RestatementStatus =
  /** 有 ≥1 条锚定成功的 covered/missed → 正常展示。 */
  | "ok"
  /** 模型给了内容，但一条都没能锚回正文 → 展示 advice + 显式警示。 */
  | "partial"
  /** 资料无正文快照（textPreview 为空）。 */
  | "no-body"
  /**
   * 未配置模型 → **直接阻断（零落库、零请求）**，由面板引导去配置（D6-B）；
   * 服务层保留此分支作防御性早退。
   */
  | "no-ai"
  /** 文本非法 / 调用失败 / 解析失败。 */
  | "error";

/** 失败原因分类（服务层只产分类，文案由面板走 i18n）。 */
export type RestatementErrorKind =
  /** < minChars。 */
  | "too-short"
  /** > maxChars（UI 已拦，service 侧同样拒绝）。 */
  | "too-long"
  /** 阻断门通过后模型失效（竞态）—— 「完全未配置」走 status="no-ai"，不走这里。 */
  | "not-configured"
  /** 输出无法解析。 */
  | "parse"
  /** 存储 / 读取异常。 */
  | "fetch"
  /** 其它（资料 / 章不存在）。 */
  | "generic";

export interface RestatementResult {
  status: RestatementStatus;
  /**
   * 落库后的记录（`ok` / `partial` 时存在；**`no-ai` / `error` 时恒为 `undefined`**
   * —— D6-B 下无 AI 不产生任何记录）。
   */
  record?: Restatement;
  /** 本地映射的复习档位（status="ok" 时存在；供 UI 预览"安排复习"的效果）。 */
  rating?: SelfRating;
  errorKind?: RestatementErrorKind;
  at: number;
}
