/**
 * 章正文 AI 翻译的领域口径 —— 目标语言、尺寸上限、目标语言解析
 * （docs/learn-ai-translation-design-2026-10.md §4.3）。
 *
 * 为什么落 domain 而不是各自就地写：阅读页（切换视图）、设置卡片（下拉）、
 * 服务层（长度门）三处都要「目标语言」与「尺寸上限」，其中上限还必须与
 * 分块算法**是同一把尺子**。任何一侧各写一份，改一处必然漂移。
 *
 * 两条约束：
 * - 本模块是叶子层（`layer:check` A1）：只 import `i18n/types` 的**类型**
 *   （`ResolvedLang`），不碰任何值；
 * - `ai/` 层禁值导入 i18n ⇒ 给模型读的语言名放本模块的**英文表**
 *   （`TRANSLATION_LANG_EN`），界面展示名仍归 `i18n/messages/*`。
 */
import type { ResolvedLang } from "../i18n/types";

/* ------------------------------------------------------------------ */
/* 目标语言                                                            */
/* ------------------------------------------------------------------ */

/**
 * 用户可选的翻译目标（`auto` = 跟随界面语言）。
 *
 * 顺序即设置页下拉顺序：`auto` 打头（缺省档），其后中文 / 英文 / 常用外语。
 * 新增语言要三处同批：本表 + `TRANSLATION_LANG_EN` + 各 `messages/*` 的
 * `settings.models.translation.options`（缺一处 TS 就会报不满足 Record）。
 */
export const TRANSLATION_TARGETS = [
  "auto",
  "zh",
  "en",
  "ja",
  "ko",
  "fr",
  "de",
  "es",
  "ru",
] as const;

export type TranslationTarget = (typeof TRANSLATION_TARGETS)[number];

/** 解析后的实际目标语言（无 `auto`）。 */
export type TranslationLang = Exclude<TranslationTarget, "auto">;

/**
 * 提示词里给模型读的语言名（英文）。
 *
 * ⚠️ 与界面展示名**刻意分开**：`ai/` 不得值导入 i18n（`layer:check` A4），
 * 而模型读中文/英文名都行、读 `ja` / `ru` 这类代码不行。改这里不影响 UI。
 */
export const TRANSLATION_LANG_EN: Record<TranslationLang, string> = {
  zh: "Simplified Chinese",
  en: "English",
  ja: "Japanese",
  ko: "Korean",
  fr: "French",
  de: "German",
  es: "Spanish",
  ru: "Russian",
};

/** 白名单判定（持久化偏好 / 下拉回调的入参都是 `string`）。 */
export function isTranslationTarget(v: unknown): v is TranslationTarget {
  return typeof v === "string" && (TRANSLATION_TARGETS as readonly string[]).includes(v);
}

/**
 * `auto` → 界面语言；显式值 → 原样返回。
 *
 * **唯一解析入口**（UI 与服务层共用）：自己写 `t === "auto" ? lang : t`
 * 的副本会在「持久化值是 auto 但界面语言刚被改」时与服务层判不同目标
 * ⇒ 缓存命中错语言。
 */
export function resolveTranslationTarget(
  t: TranslationTarget,
  uiLang: ResolvedLang,
): TranslationLang {
  return t === "auto" ? uiLang : t;
}

/* ------------------------------------------------------------------ */
/* 译文记录（v6 · D3 改判：落 SQLite）                                  */
/* ------------------------------------------------------------------ */

/**
 * 译文索引行 —— **刻意不含正文**（与 `src-tauri/src/db/models.rs::TranslationIndexRow`
 * 逐字段对齐）。
 *
 * ⚠️ 索引与正文分两个接口不是洁癖：整库 500 章的译文几十 MB，索引查询若带上
 * `text`，每次启动都会全量 IPC 进内存 —— 那正是「下沉 SQLite 省下的内存」又被
 * 原样搬回来。`readCachedTranslation` 才按需取正文。
 */
export interface TranslationIndexRow {
  documentId: string;
  chapterId: string;
  target: TranslationLang;
  /** 原文指纹（见 `bodyFingerprint`）：读时比对，不匹配即视为无缓存。 */
  bodyHash: string;
  /** 实际块数（UI 显示「N/K 段」）。 */
  blocks: number;
  /** 失败 / 空输出被跳过的块数。 */
  skipped: number;
  /** 原文长度（整库预估与统计）。 */
  sourceChars: number;
  createdAt: number;
}

/** 完整译文（索引行 + 正文）。 */
export interface TranslationRecord extends TranslationIndexRow {
  text: string;
}

/**
 * 索引 key —— `(documentId, chapterId, target)` 三元组的**唯一**拼接口径。
 *
 * 三处都要它（内存 Map / 索引 store / 查缓存），各写一份必然有一处漏 target
 * ⇒ 「切到日文却读到英文译文」这种静默错。与 SQL 侧的主键严格同构。
 */
export function translationKeyOf(
  documentId: string,
  chapterId: string,
  target: TranslationLang,
): string {
  return `${documentId}:${chapterId}:${target}`;
}

/**
 * 原文指纹（同步、零依赖）。
 *
 * ⚠️ **不用 `crypto.subtle`**：它是异步的（调用点会从同步判定变成 await），
 * 且 SSR（`renderToStaticMarkup` 测试）环境里没有 —— 一个「判断有没有缓存」的
 * 纯函数不该依赖运行环境。
 *
 * 采样 = 长度 + 首 48 + 中 32 + 尾 48：章节被编辑 / 重切分必然改变其中至少一项。
 * 极低概率的碰撞后果是「显示了旧译文」—— 不丢数据，重翻即纠正；
 * 而全量哈希要读完整个正文（长章几十 KB）且对同一份文本反复算，收益不抵成本。
 */
export function bodyFingerprint(text: string): string {
  const n = text.length;
  if (n === 0) return "0::";
  const mid = n > 192 ? text.slice(n >> 1, (n >> 1) + 32) : "";
  return `${n}:${text.slice(0, 48)}:${mid}:${n > 48 ? text.slice(-48) : ""}`;
}

/* ------------------------------------------------------------------ */
/* 尺寸上限                                                            */
/* ------------------------------------------------------------------ */

/**
 * 单块目标字符数。
 *
 * ⚠️ **恒定值，不做自适应** —— 与要点抽取的 `adaptiveChunkChars`（按
 * `ceil(len / maxChunks)` 缩块）**刻意不同口径**：翻译的输出长度 ≈ 输入长度，
 * 真正的约束是 builtin 侧 `maxTokens = 4096`（中文 1 字 ≈ 1 token）。
 *
 * ⚠️ **700 是 2026-10-22 由 2 000 下调的**（推翻首版「恒定 2 000」）：
 * 实测本机 `qwen3.5:4b` ≈ 30 字符/秒 ⇒ 2 000 字一块要等 **70 秒**才出第一段。
 * 块大小**几乎不影响总时长**（总 token 守恒，只多几次 prefill），但它决定
 * **首字延迟**：700 字 ≈ 25 秒。代价是跨块术语一致性略降，用
 * 「每块带章标题 + 前 5 条要点」补偿。
 */
const BLOCK_CHARS = 700;

/**
 * 单批正文上限 —— **超出不是拒绝，是拆批**。
 *
 * ⚠️ 语义在 2026-10-22 二次修订（首版口径是「整章硬上限，超出直接拒绝并提示
 * 划选片段」）。那个口径对真实内容不成立：4.6 万字的长章（长篇小说、整篇论文、
 * 未切分的长文）恰恰最需要译，而它本来就是逐块翻的 —— 没有任何技术理由翻不了。
 *
 * 现在的口径：`translateChapterBody` 按段落边界把正文切成
 * `ceil(len / bodyMaxChars)` 批，逐批串行、逐批上屏，整章翻完仍只存**一条**记录
 * （主键不变，段不是持久化单位）。
 *
 * 保留的是**成本闸**含义：本地模型 30 字/秒 ⇒ 24 000 字 ≈ 13 分钟，这是「一次
 * 点击最多让用户等多久」的上界。拆批不改变首字延迟（块恒 700 字 ≈ 25 秒）。
 */
const BODY_MAX_CHARS = 24_000;

/**
 * 翻译尺寸上限（UI 与服务层共用）。
 *
 * ⚠️ 不用 `as const` 字面量类型：本项目已踩过「字面量类型被推断进参数默认值
 * ⇒ 传别的值即 TS2345」的坑（见 `LIMITS` 的教训）。这里显式标注 `number`。
 *
 * ⚠️ 2026-10-22 **删掉了 `blockMax`**：块数不该有上限 —— 该恒定的是块**尺寸**
 * （700 字，决定首字延迟），块数随正文线性增长。当初的 `blockMax = 40` 只是
 * 「整章上限」的配套副产品；闸门拆掉后它反而成了隐患：`planTextBlocks` 会在
 * 块数超限时**放大块尺寸**，于是 4.6 万字的章被改成 1148 字一块、首字延迟
 * 从 25 秒涨到 38 秒，再长就一路恶化。
 */
export const TRANSLATION_LIMITS: {
  readonly blockChars: number;
  /** 单批正文上限（超出 → 拆批，不拒绝）。 */
  readonly bodyMaxChars: number;
} = {
  blockChars: BLOCK_CHARS,
  bodyMaxChars: BODY_MAX_CHARS,
};
