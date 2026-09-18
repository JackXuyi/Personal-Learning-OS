/**
 * AI 记忆归纳管道（F9 通道 B）—— 把（已掩码的）用户文本样本整理成若干条「长期观察」。
 * 方案：docs/learner-memory-design-2026-09.md §4.3.6 / §8.10。
 *
 * 与 `resume-pipeline.ts` 同构：**自持** LIMITS + 提示词 + 纯解析器 + 执行器，
 * 只从 `pipeline-core` 复用 `chatJson` / `isRecord` / `str` / `TEMPERATURE`。
 *
 * 为什么归 `ai/` 而不是 `features/memory/`：
 * - 提示词与解析器是**模型侧契约**，与 F1 的 `resume-pipeline` / `overview-pipeline` 同级；
 * - `MemorySample` / `ExistingMemory` 的**类型归属也必须在这里** —— `features/` 会 import
 *   它们（features → ai 是允许方向），反过来就破了依赖单向（`ai/` 不得 import `features/`）。
 *
 * ⚠️ **外发只发生在用户显式点击后**（D6：不做定时/自动归纳）。本模块只负责「把已备好的
 * 东西发出去、把回来的东西按代码层规则过滤」，**不碰 storage**（零写入由调用侧保证）。
 *
 * ⚠️ 会被 `tests/learner-memory.test.ts` 在 strip-types 下直跑：不得用 TS 参数属性。
 */
import type { GeneratedEntry, MemoryCategory } from "../domain";
import { aiEntryKey, MEMORY_LIMITS, normalizeMemoryText } from "../domain";
import type { AIProvider } from "./types";
import { chatJson, isRecord, str, TEMPERATURE } from "./pipeline-core";

/**
 * 记忆归纳的护栏。
 *
 * ⚠️ **尺寸类数字一律从 `domain/memory.ts::MEMORY_LIMITS` 取，绝不在这里重写一遍**：
 * 同一组上限散在 `domain` 与 `ai` 两处就是「两把尺子」—— 改一处忘另一处时，
 * 采样裁剪与文档渲染会对不上，而且没有任何测试会失败。本表只放 **AI 侧独有**的东西
 * （回传条数与敏感属性黑名单）。
 *
 * （对照：`PIPELINE_LIMITS` 里镜像 `engine` 常量是因为分层不允许 `ai/` import `engine/`；
 * 而 `ai/` **可以** import `domain/`，故此处没有镜像的必要。）
 */
export const MEMORY_PIPELINE_LIMITS = {
  /** 送进提示词的样本条数上限（= `MEMORY_LIMITS.sampleMaxItems`）。 */
  sampleMaxItems: MEMORY_LIMITS.sampleMaxItems,
  /** 送进提示词的样本总字符上限（= `MEMORY_LIMITS.sampleChars`）。 */
  sampleChars: MEMORY_LIMITS.sampleChars,
  /** 单次归纳最多采纳条数（= `MEMORY_LIMITS.aiItemsPerRun`）。 */
  itemsPerRun: MEMORY_LIMITS.aiItemsPerRun,
  /** 单条结论文本上限（= `MEMORY_LIMITS.textChars`）。 */
  textChars: MEMORY_LIMITS.textChars,
  /** 回传给模型的「已记下的观察」条数上限（对齐每类行数上限 × 类别数）。 */
  existingMaxItems: 24,
  /** 回传给模型的「用户不要的」条数上限。 */
  unwantedMaxItems: 24,
  /**
   * 禁止推断的敏感属性（**提示词 + 解析器双层**）。
   *
   * 为什么代码层也要拦：与 F1 对提示词注入的处理姿态一致 —— 不依赖「模型会乖」。
   * 这些属性与学习无关，且一旦被写进文档就会被当作事实反复注入（方案 §13.1）。
   */
  forbiddenTopics: [
    "年龄",
    "岁数",
    // ⚠️ 单字「岁」也要拦：模型最自然的写法是「用户今年 35 岁」，
    // 它**不含**「年龄」二字 —— 只列「年龄」等于这道闸对最常见的写法失效（TC-UC06-04）。
    "岁",
    "性别",
    "民族",
    "种族",
    "籍贯",
    "健康状况",
    "疾病",
    "病史",
    "政治倾向",
    "宗教信仰",
    "婚姻",
    "生育",
    "收入",
    "年薪",
    "身份证",
  ],
} as const;

/**
 * 可交给模型归纳的类别（**白名单，排除 `cadence`**）。
 *
 * `cadence` 是通道 A 的地盘：活跃时段 / 复习遵守度都能**算准**，让模型从笔记文本里猜
 * 等于用更差的信息源覆盖更好的（方案 §4.3.6 第 1 层）。
 */
export const AI_MEMORY_CATEGORIES: readonly MemoryCategory[] = [
  "identity",
  "domain",
  "preference",
  "cognition",
  "goal-intent",
];

/** 喂给模型的样本（**已掩码**）。原文不出本模块。 */
export interface MemorySample {
  kind: "note" | "restatement";
  id: string;
  text: string;
}

/** 已在文档里的系统条目（**回传给模型，防它换个说法重复记一遍**）。 */
export interface ExistingMemory {
  key: string;
  category: MemoryCategory;
  text: string;
}

/**
 * 系统提示词（全文见方案 §4.3.6）。
 *
 * 三条硬约束的理由：
 * - 「要么 ≥3 条样本支撑，要么不写」—— 幻觉结论会进入用户的**自我认知**（R2）；
 * - 「同一件事必须复用原 key」—— 文档模式下模型看不到用户否掉了什么，不给它清单，
 *   它每次都会换个说法再写一遍，文档会越积越厚（v2 新增的「已记下的观察」回传）；
 * - 「禁止输出姓名 / 联系方式 / 公司全称 / URL」—— 文档是长期保存的资产（R4）。
 */
export const MEMORY_SYSTEM = [
  "你在为一位自学者整理一份「关于他/她的长期观察」，这份观察会直接写进一份他本人可以修改的文档。",
  "只输出 JSON 数组，不要 markdown 围栏与解释文字。",
  "硬约束：",
  "- 只依据给定样本与行为摘要，不得引入任何外部假设或常识补全；",
  "- 禁止推断：年龄、性别、民族、健康状况、政治倾向、宗教信仰、婚姻生育、收入；",
  "- 禁止输出姓名、联系方式、公司全称、住址、任何 URL；",
  `- 每条必须归入以下类别之一：${AI_MEMORY_CATEGORIES.join(" | ")}；`,
  "- 一条结论要么有至少 3 条样本支撑，要么不要写。宁可少写，不要写不确定的；",
  `- 每条 ≤ ${MEMORY_PIPELINE_LIMITS.textChars} 字，最多 ${MEMORY_PIPELINE_LIMITS.itemsPerRun} 条；句子用「你」开头，像一句观察，不用书面报告腔；`,
  "- 下面会给你「已经记下的观察」。如果某条新观察与其中一条**说的是同一件事**，",
  "  必须复用那条的 key（表示更新），不要换一种说法再记一条；",
  "- 「用户不要的观察」里的东西，一句都不要提。",
  '格式：[{"key":"ai-cognition-1f3k 或留空","category":"cognition","text":"…","confidence":"medium","evidenceIds":["ann_xxx","rst_yyy"]}]',
].join("\n");

/**
 * 宽松解析：非数组 / 字段缺失 / 类别非法 / 命中黑名单 / 无匹配 `evidenceIds` → 丢弃该条，
 * **绝不抛错**（附加产物不该炸掉整条链路，同 `parseResumeDraft` 的策略）。
 *
 * 四层过滤（全部**代码层**，见 §4.3.6）：
 * | 层 | 规则 | 目的 |
 * |---|---|---|
 * | 1 | 类别白名单（5 类，**排除 `cadence`**） | 可计算的不让模型猜 |
 * | 2 | `forbiddenTopics` 命中 → 丢该条 | 不依赖「模型会乖」 |
 * | 3 | `evidenceIds` 全部无法在样本中匹配 → 丢该条 | **零伪造引用** |
 * | 4 | 键不在 `existing` 内 → 丢弃该键、按文本重算 | 防模型把新内容写到别人的行上 |
 *
 * ⚠️ 第 4 层是**安全阀**而非洁癖：文档模式下「行」的身份靠行尾键，模型编一个键
 * 就能把一条新结论**原地覆盖到用户改过的行上** —— 那正是本方案最严重的失败模式（R10）。
 */
export function parseMemoryDraft(
  raw: unknown,
  sampleIds: ReadonlySet<string>,
  existing: readonly ExistingMemory[],
): GeneratedEntry[] {
  if (!Array.isArray(raw)) return [];

  const existingKeys = new Set(existing.map((e) => e.key));
  const out: GeneratedEntry[] = [];
  const seenKeys = new Set<string>();

  for (const item of raw) {
    if (out.length >= MEMORY_PIPELINE_LIMITS.itemsPerRun) break;
    if (!isRecord(item)) continue;

    // 层 1：类别白名单（`cadence` 不在其中）
    const category = str(item.category) ?? "";
    if (!(AI_MEMORY_CATEGORIES as readonly string[]).includes(category)) continue;

    const text = (str(item.text) ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
    if (!text) continue;

    // 层 2：敏感属性黑名单 —— **独立于提示词**的第二道闸
    const normalized = normalizeMemoryText(text);
    if (MEMORY_PIPELINE_LIMITS.forbiddenTopics.some((t) => text.includes(t) || normalized.includes(t))) {
      continue;
    }

    // 层 3：零伪造引用 —— 必须至少一条 evidenceId 能对回真实样本
    const ids = Array.isArray(item.evidenceIds) ? item.evidenceIds : [];
    const hasEvidence = ids.some((id) => {
      const s = str(id);
      return s !== undefined && sampleIds.has(s);
    });
    if (!hasEvidence) continue;

    const cat = category as MemoryCategory;
    // 层 4：键回填校验 —— 只有出现在 `existing` 里的键才被接受
    const rawKey = str(item.key)?.trim();
    const key = rawKey && existingKeys.has(rawKey) ? rawKey : aiEntryKey(cat, text);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    out.push({ key, category: cat, text: text.slice(0, MEMORY_PIPELINE_LIMITS.textChars) });
  }

  return out;
}

/**
 * 执行一次记忆归纳调用。
 *
 * 未配置 / 网络失败 / JSON 不可解析一律抛 `AiProviderError`（类型化、可重试）——
 * **绝不返回「看起来像观察」的半成品**。解析器不做写入，故任何失败分支下
 * 文档与 meta 都逐字节不变（TC-UC06-08 / TC-UC06-09 断言的就是这一点）。
 *
 * 温度复用 `TEMPERATURE.grade`（0.1）：与简历解析 / 主观批改同口径 —— 事实归纳类，越低越稳。
 */
export async function extractMemoryDraft(
  provider: AIProvider,
  args: {
    samples: readonly MemorySample[];
    behaviorSummary: string;
    existing: readonly ExistingMemory[];
    /** 用户不要的（`dismissed` 的键 + 用户改写过的条目），供提示词声明「不要再提」。 */
    unwanted: readonly { category: MemoryCategory; text: string }[];
  },
): Promise<GeneratedEntry[]> {
  // 样本在调用侧已裁剪过一次；此处**再兜一遍**（防呆：这是唯一外发路径）。
  const samples = args.samples.slice(0, MEMORY_PIPELINE_LIMITS.sampleMaxItems);
  const sampleIds = new Set(samples.map((s) => s.id));

  const sampleLines: string[] = [];
  let used = 0;
  for (const s of samples) {
    const line = `[${s.id}] ${s.kind === "note" ? "笔记" : "复述"}：${sanitizeSample(s.text)}`;
    if (used + line.length > MEMORY_PIPELINE_LIMITS.sampleChars) break;
    used += line.length;
    sampleLines.push(line);
  }

  const existingLines = args.existing
    .slice(0, MEMORY_PIPELINE_LIMITS.existingMaxItems)
    .map((e) => `[${e.key}] ${e.text}`);
  const unwantedLines = args.unwanted
    .slice(0, MEMORY_PIPELINE_LIMITS.unwantedMaxItems)
    .map((u) => sanitizeSample(u.text));

  const user = [
    args.behaviorSummary ? `【行为摘要（本地统计，可信）】\n${args.behaviorSummary}` : "",
    `【用户文本样本】\n${sampleLines.length > 0 ? sampleLines.join("\n") : "（无）"}`,
    existingLines.length > 0 ? `【已经记下的观察】\n${existingLines.join("\n")}` : "",
    unwantedLines.length > 0 ? `【用户不要的观察（不要再提）】\n${unwantedLines.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const raw = await chatJson(
    provider,
    [
      { role: "system", content: MEMORY_SYSTEM },
      { role: "user", content: user },
    ],
    TEMPERATURE.grade,
  );
  return parseMemoryDraft(raw, sampleIds, args.existing);
}

/** 样本 / 既有条目的防注入归一化（用户文本属**不可信输入**：剥离围栏 + 去控制字符）。 */
function sanitizeSample(text: string): string {
  return text
    .replace(/```/g, "'''")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim();
}
