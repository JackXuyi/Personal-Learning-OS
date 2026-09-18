/**
 * 记忆 AI 归纳编排（F9 通道 B）—— 备料（本地统计 + 样本 + 现有条目）→ 调用 → 过滤。
 * 方案：docs/learner-memory-design-2026-09.md §8.9。
 *
 * 与 `features/profile/resume-import.ts` 同构：**纯编排**，只依赖 `domain` / `ai` /
 * 同目录纯函数，**不 import stores 与 React** → 单测可注入假 provider，零真实网络。
 *
 * 三条边界（对齐 D6 / R2 / §4.4）：
 * 1. **零写入**：本模块不碰 storage —— `runMemoryAi` 连 `store` 参数都没有，
 *    「任何失败分支下文档与 meta 逐字节不变」是**结构性成立**的，不靠自觉。
 * 2. **只准备不发送**：`prepareAiRun` 供弹窗渲染隐私告知与只读预览；
 *    真正外发只在用户点「发送」之后（`runMemoryAi`）。
 * 3. **错误只产 kind**，文案由 UI 走 i18n 映射。
 *
 * ⚠️ 会被 `tests/learner-memory.test.ts` 在 strip-types 下直跑：不得用 TS 参数属性。
 */
import type { GeneratedEntry, MemoryCategory, MemoryDocMeta, ParsedMemoryDoc } from "../../domain";
import { categoryOfKey, normalizeMemoryText } from "../../domain";
import type { AIProvider } from "../../ai/types";
import { AiProviderError } from "../../ai/types";
import type { ExistingMemory, MemorySample } from "../../ai/memory-pipeline";
import { extractMemoryDraft } from "../../ai/memory-pipeline";
import { collectSamples } from "./memory-samples";
import type { MemorySignals } from "./memory-signals";

/** 记忆归纳失败的分类（UI 按 kind 取 i18n 文案）。 */
export type MemoryRunErrorKind =
  | "ai-not-configured"
  | "not-enough-samples"
  | "ai-failed"
  | "empty-draft";

export class MemoryRunError extends Error {
  // ⚠️ 显式字段赋值（不用 TS 参数属性）：strip-types 不支持。
  readonly kind: MemoryRunErrorKind;
  constructor(kind: MemoryRunErrorKind, message?: string) {
    super(message ?? kind);
    this.name = "MemoryRunError";
    this.kind = kind;
  }
}

/**
 * 跑一次 AI 归纳所需的最少样本数。
 *
 * 取值理由：提示词自己要求「一条结论要么有 ≥3 条样本支撑，要么不写」——
 * 少于 3 条样本时**连它自己的规则都不可能满足**，外发只会白花一次调用、
 * 还把用户的文字送出去（R3）。UI 用它算「还差 N 条」并禁用按钮（R2③）。
 */
export const MEMORY_AI_MIN_SAMPLES = 3;

export interface MemoryRunResult {
  /** 采纳的条目（由 UI 交给合并器 → `applyMemoryAi`）。 */
  entries: GeneratedEntry[];
  /** 因命中「用户不要的观察」而被代码层丢弃的条数（提示词之外的第二道闸）。 */
  skippedUnwanted: number;
  /** 实际发送的样本字符数（UI 的报告用；与预览里显示的数字同源）。 */
  sentChars: number;
  /** 其中会**更新**已有行的条数（键命中现有条目）。 */
  updatedCount: number;
  /** 其中会**新增**行的条数。 */
  addedCount: number;
}

export interface PreparedAiRun {
  samples: MemorySample[];
  behaviorSummary: string;
  /** 已记下的系统条目（回传给模型 → 同一件事不会换种说法再记一条）。 */
  existing: ExistingMemory[];
  /** 用户明确不要的观察（`dismissed`），供提示词声明「不要再提」+ 代码层兜底丢弃。 */
  unwanted: { category: MemoryCategory; text: string }[];
  canRun: boolean;
  /** `canRun === false` 时还差几条样本（UI 的「还差 N 条」）。 */
  missing: number;
}

/**
 * 备料（**不外发、不写库**）。
 *
 * 弹窗在第一步（隐私告知）就调它，于是「将发送 N 条 / M 字」与实际发送内容
 * 用的是**同一份**数据 —— 预览与实发不可能漂移。
 */
export function prepareAiRun(args: {
  signals: MemorySignals;
  parsed: ParsedMemoryDoc;
  meta: MemoryDocMeta;
}): PreparedAiRun {
  const { signals, parsed, meta } = args;
  const collected = collectSamples(signals.annotations, signals.restatements);

  const existing: ExistingMemory[] = parsed.entries
    .filter((e): e is { key: string; category: MemoryCategory; text: string } =>
      e.key !== undefined && e.category !== undefined,
    )
    .map((e) => ({ key: e.key, category: e.category, text: e.text }));

  // 用户不要的 = `dismissed`（**明确拒绝过**的键）。文本取系统最后写过的那句 ——
  // ⚠️ 用户**改写**过的行不进这个清单：它已以用户当前文本出现在 `existing` 里
  //（模型看得到 → 不会重复提出），把它列进「不要再提」反而会**误导模型回避
  // 用户其实认可的话题**（方案 §8.9 的写法在此收窄，见 runbook 偏差记录）。
  const unwanted = meta.dismissed
    .map((key) => {
      const category = categoryOfKey(key);
      const text = meta.lastWritten[key];
      return category && text ? { category, text } : undefined;
    })
    .filter((u): u is { category: MemoryCategory; text: string } => u !== undefined);

  const missing = Math.max(0, MEMORY_AI_MIN_SAMPLES - collected.samples.length);
  return {
    samples: collected.samples,
    behaviorSummary: behaviorSummaryOf(signals),
    existing,
    unwanted,
    canRun: missing === 0,
    missing,
  };
}

/**
 * 真正调用一次归纳（用户确认后）。**零写入** —— 结果交给合并路径去落库。
 *
 * 失败一律抛 `MemoryRunError`（类型化）：
 * - `ai-not-configured` —— 未配置模型（早退，不产生任何请求）；
 * - `not-enough-samples` —— 样本不足（早退，**不外发**）；
 * - `ai-failed` —— 网络 / 解析失败（`AiProviderError` 归一化）；
 * - `empty-draft` —— 模型没给出任何可用条目（如实说「没有新的发现」，不编）。
 */
export async function runMemoryAi(args: {
  provider: AIProvider;
  samples: readonly MemorySample[];
  behaviorSummary: string;
  existing: readonly ExistingMemory[];
  unwanted: readonly { category: MemoryCategory; text: string }[];
}): Promise<MemoryRunResult> {
  if (!args.provider.isConfigured()) throw new MemoryRunError("ai-not-configured");
  if (args.samples.length < MEMORY_AI_MIN_SAMPLES) throw new MemoryRunError("not-enough-samples");

  let entries: GeneratedEntry[];
  try {
    entries = await extractMemoryDraft(args.provider, {
      samples: args.samples,
      behaviorSummary: args.behaviorSummary,
      existing: args.existing,
      unwanted: args.unwanted,
    });
  } catch (err) {
    // 早退已查过 `isConfigured()`，但配置可能在调用途中被改（设置页另一处 UI）——
    // 这条兜底把「未配置」与「网络/解析失败」分开，UI 才能给出正确引导。
    if (err instanceof AiProviderError && err.code === "not-configured") {
      throw new MemoryRunError("ai-not-configured");
    }
    throw new MemoryRunError("ai-failed");
  }

  // 「用户不要的」**代码层兜底**：模型偶尔还是会换个说法重提，这里强制丢弃并如实计数
  // （提示词是软的，这一层是硬的 —— 与 `parseMemoryDraft` 的四层过滤同一姿态）。
  const { kept, skipped } = dropUnwanted(entries, args.unwanted);

  const existingKeys = new Set(args.existing.map((e) => e.key));
  const updatedCount = kept.filter((e) => existingKeys.has(e.key)).length;
  const sentChars = args.samples.reduce((n, s) => n + s.text.length, 0);

  if (kept.length === 0) throw new MemoryRunError("empty-draft");

  return {
    entries: kept,
    skippedUnwanted: skipped,
    sentChars,
    updatedCount,
    addedCount: kept.length - updatedCount,
  };
}

/**
 * 丢弃与「用户不要的观察」说的是同一件事的条目。
 *
 * 判据是**双向包含**的归一化文本比对（不做语义判定 —— 方案明确不做嵌入聚类：
 * 做不好会静默吃掉用户内容，比冗余更糟）。所以这里只拦「明显同一句」的情况，
 * 剩余的同义重复**如实呈现**给用户在预览里判断。
 */
function dropUnwanted(
  entries: readonly GeneratedEntry[],
  unwanted: readonly { category: MemoryCategory; text: string }[],
): { kept: GeneratedEntry[]; skipped: number } {
  if (unwanted.length === 0) return { kept: [...entries], skipped: 0 };
  const banned = unwanted.map((u) => ({ category: u.category, text: normalizeMemoryText(u.text) }));
  const kept: GeneratedEntry[] = [];
  let skipped = 0;

  for (const e of entries) {
    const normalized = normalizeMemoryText(e.text);
    if (!normalized) continue;
    const hit = banned.some(
      (b) =>
        b.category === e.category &&
        (b.text === normalized || b.text.includes(normalized) || normalized.includes(b.text)),
    );
    if (hit) skipped++;
    else kept.push(e);
  }
  return { kept, skipped };
}

/**
 * 行为摘要（喂给模型的一段本地统计）。
 *
 * 为什么需要：模型看不到 `EvidenceEntry`，没有这段它就只能从笔记文本里**猜**节奏与
 * 频次 —— 而那是通道 A 已经算准的事。给它数字，两通道才**互补而非重复**。
 *
 * ⚠️ **只给计数，不给结论**：一旦在这里写成「常在深夜学习」，就等于把
 * `memory-facts.ts` 的派生规则实现第二遍（「两把尺子」）。结论只由通道 A 产。
 */
function behaviorSummaryOf(signals: MemorySignals): string {
  const byKind: Record<string, number> = {};
  for (const e of signals.evidence) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
  const kindLine = Object.entries(byKind)
    .map(([k, n]) => `${k} ${n}`)
    .join(" / ");
  const withNote = signals.annotations.filter((a) => a.note.trim()).length;
  const reps = Object.values(signals.cards).reduce((n, c) => n + c.reps, 0);
  const coverages = signals.restatements
    .map((r) => r.feedback?.coverage)
    .filter((c): c is number => typeof c === "number");

  return [
    `学习记录条数：${signals.evidence.length}${kindLine ? `（${kindLine}）` : ""}`,
    `批注：${signals.annotations.length} 处（其中带笔记 ${withNote} 处）`,
    `复述：${signals.restatements.length} 次${coverages.length > 0 ? "（部分带覆盖率反馈）" : ""}`,
    `卡片复习累计次数：${reps}`,
    `在学资料章数：${signals.chapterCount}`,
    `学习目标数：${signals.goals.length}`,
  ].join("\n");
}
