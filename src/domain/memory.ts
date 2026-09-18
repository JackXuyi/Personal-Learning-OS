/**
 * 学习者记忆（F9 —— 系统推测的第三层理解）的领域对象与**唯一 markdown 解析器**。
 * 方案：docs/learner-memory-design-2026-09.md（v2：记忆 = 一份可读可改的 markdown 文档）。
 *
 * 三条硬口径（§1.3 / §4.3.1）：
 *
 * 1. **真源是一段 markdown 文本**（`plos.memory.doc.v1`），不是待办清单 ——
 *    没有 `pending/accepted/rejected`，没有确认按钮；用户靠**改文字**与**删行**纠正。
 * 2. **两种标记各管一件事**：`<!--m:KEY-->`（行尾）= 条目身份，
 *    `<!--s:category-->`（节标题行尾）= 节身份。行尾标记是「用户随便改正文」的前提下
 *    仍然成立的身份来源 —— **绝不用位置/序号当身份**（用户删一行、改标题即错位）。
 * 3. **`parseMemoryDoc` 必须落在 domain 层**：`ai/`（提示词）与 `features/`（合并、UI）
 *    都要用它，而 `ai/` 不得 import `features/`（依赖单向）。
 *
 * ⚠️ 本文件不得 import `features/` / React；纯类型 + 常量 + 纯函数（可被
 * `node --experimental-strip-types` 直测）。
 */
import { hashId } from "../lib/hash";

/** 记忆类别（D9：固定 6 类，不做自由标签）。 */
export type MemoryCategory =
  | "identity" // 基本信息：领域 / 职业方向 / 学历层次 / 相关年限
  | "domain" // 知识领域与技能栈
  | "preference" // 学习偏好：讲解深浅 / 举例方式 / 语言风格
  | "cognition" // 认知特征：抽象 vs 具体、先总后分 vs 先例后理
  | "cadence" // 节奏：活跃时段 / 有效时长 / 复习遵守度（**仅确定性通道可产**）
  | "goal-intent"; // 学习意图

/** 类别全集（**顺序即新建节的插入顺序**，见 `mergeMemoryDoc`）。 */
export const MEMORY_CATEGORIES: readonly MemoryCategory[] = [
  "identity",
  "domain",
  "preference",
  "cognition",
  "cadence",
  "goal-intent",
];

/**
 * 键前缀 → 类别。**前缀表是唯一真源**：解析（本文件）与合并（`memory-doc-merge.ts`）
 * 都读它，不各写一份判断。
 *
 * 三类前缀各有来源：`cadence-*` / `pref-*` / `cog-*` 等 = 通道 A 的**规则键**（规则级稳定）；
 * `ai-<category>-<fingerprint>` = 通道 B 的**内容派生键**（同一句话重跑同键）。
 */
const KEY_PREFIX: readonly { prefix: string; category: MemoryCategory }[] = [
  { prefix: "ai-identity-", category: "identity" },
  { prefix: "ai-domain-", category: "domain" },
  { prefix: "ai-preference-", category: "preference" },
  { prefix: "ai-cognition-", category: "cognition" },
  { prefix: "ai-goal-intent-", category: "goal-intent" },
  { prefix: "identity-", category: "identity" },
  { prefix: "domain-", category: "domain" },
  { prefix: "pref-", category: "preference" },
  { prefix: "cog-", category: "cognition" },
  { prefix: "cadence-", category: "cadence" },
  { prefix: "intent-", category: "goal-intent" },
];

/** 由键推类别；无法识别 → `undefined`（该行按手写行处理，**仍会被注入**）。 */
export function categoryOfKey(key: string): MemoryCategory | undefined {
  for (const { prefix, category } of KEY_PREFIX) {
    if (key.startsWith(prefix)) return category;
  }
  return undefined;
}

/**
 * 文档中一条**生效中的**记忆。
 *
 * - `key` 有值 → 系统维护的行（`text` 可能是用户改过的文本；是否被改由合并器与
 *   `MemoryDocMeta.lastWritten` 比对得出，见方案 §4.3.3）。
 * - `key` 无值 → **用户手写行**（含标记被删而降级的行）：系统永不改动，**但同样注入 AI**。
 */
export interface MemoryEntry {
  key?: string;
  category?: MemoryCategory;
  text: string;
}

/** `parseMemoryDoc` 的结果。 */
export interface ParsedMemoryDoc {
  /**
   * 全部生效条目，**文档顺序**（UI 的行级徽标靠它对齐；注入顺序由
   * `buildMemoryContextBlock` 再排序 —— 手写行优先，见方案 §4.3.7）。
   */
  entries: MemoryEntry[];
  /** 手写行在 `entries` 中的下标集合。 */
  manualIndexes: number[];
  /** 文档抬头声明的「最后整理」时刻（`<!--t:…-->` 机读标记）；解析失败 → `undefined`。 */
  lastMergedAt?: number;
}

/**
 * 文档侧元数据（**不进文档正文**，落 `plos.memory.meta.v1`）。
 *
 * ⚠️ 定义在 `domain/` 而不是合并模块：`storage/` 的方法签名要用它，而
 * `storage/` 不得 import `features/`（依赖单向）。这是本方案唯一的类型归属陷阱。
 */
export interface MemoryDocMeta {
  /**
   * `key → 系统最后一次写入的正文`（不含行首 `- ` 与行尾标记）。
   *
   * **这是区分「系统原文未动」与「用户改过」的唯一依据**：
   * 当前行文本 === `lastWritten[key]` → 用户没碰 → 允许系统更新；
   * 当前行文本 !== `lastWritten[key]` → 用户改过 → **永久冻结**（`lastWritten` 不更新，
   * 这样下一轮仍判为「改过」）。
   */
  lastWritten: Record<string, string>;
  /** 用户删掉的键 —— 系统**不再写回**（进 `dismissed` 即殡葬，除非用户点「恢复」）。 */
  dismissed: string[];
  /** 系统最后一次整理的时刻（页面报告用；文档抬头另有一条机读标记）。 */
  lastMergedAt: number;
  /** 最近一次落盘到磁盘的时刻（仅 D12-A；用于与文件 mtime 比对）。 */
  lastSavedAt?: number;
}

/** 空元数据（缺省值；**不制造任何系统条目**）。 */
export const EMPTY_MEMORY_META: MemoryDocMeta = {
  lastWritten: {},
  dismissed: [],
  lastMergedAt: 0,
};

/** 待写入的一条（通道 A 的规则产出 或 通道 B 的模型产出，形态统一）。 */
export interface GeneratedEntry {
  key: string;
  category: MemoryCategory;
  text: string;
}

/**
 * 尺寸与容量护栏（UI / 服务层 / 合并算法共用同一常量，防两处口径漂移）。
 *
 * ⚠️ **可调常量，不是散落各处的魔法数**：门槛类在 `MEMORY_FACT_MIN_SAMPLES`，
 * 尺寸类在本表。改这里一处即可（方案 R5/R6 的取舍都挂在这两个表上）。
 */
export const MEMORY_LIMITS = {
  /** 单条结论文本上限（超出在**渲染**时截断并省略号，不静默丢整条）。 */
  textChars: 120,
  /** 每个类别节的行数上限（超出淘汰**最旧的系统所有行**；用户改过/手写的永不淘汰）。 */
  maxLinesPerCategory: 4,
  /** 整份文档字符上限（护栏；到顶后停止新增，不删用户内容）。 */
  docMaxChars: 4_000,
  /** 单次 AI 归纳最多新增条目数（防一次灌 8 条把文档冲垮）。 */
  aiItemsPerRun: 8,
  /** 喂给模型的样本条数上限。 */
  sampleMaxItems: 40,
  /** 喂给模型的样本总字符上限（掩码后）。 */
  sampleChars: 6_000,
  /** 单条样本截断长度。 */
  sampleItemChars: 400,
} as const;

/**
 * 确定性通道（通道 A）的最小样本门槛（键 = 规则键）。
 *
 * **不达标不产出** —— 用 3 条记录断言「你常在深夜学习」是编造，不是推断。
 */
export const MEMORY_FACT_MIN_SAMPLES = {
  "cadence-window": { evidence: 20, spanDays: 7 },
  "cadence-review": { cardReps: 15 },
  "pref-study-mode": { evidence: 20 },
  "cog-output-habit": { restatements: 3 },
} as const;

/** 规则键（通道 A 的四条派生规则）。 */
export type MemoryFactKey = keyof typeof MEMORY_FACT_MIN_SAMPLES;

// ===== 文档格式的解析原语（解析与合并共用同一套，防两套口径）=====

/** `<!--m:KEY-->`：行尾条目标记（键字符集与文件名同级保守）。 */
export const MEMORY_KEY_MARK_RE = /<!--m:([A-Za-z0-9._-]+)-->$/;
/** `<!--s:category-->`：节标题行尾标记。 */
export const MEMORY_SECTION_MARK_RE = /<!--s:([a-z-]+)-->$/;
/** `<!--t:epochMs-->`：抬头「最后整理」的**机读**标记（语言无关，见方案 §13 偏差表）。 */
export const MEMORY_TIME_MARK_RE = /<!--t:(\d+)-->/;

/** 列表行前缀（`- ` / `* `）；非列表行按普通行处理。 */
const LIST_PREFIX_RE = /^\s*[-*]\s+/;
/**
 * 行尾的**任意** HTML 注释标记。
 *
 * 用于**降级行**（键非法 / 用户把标记改坏）：把残留标记一并剥掉 —— 用户文档里的
 * 系统术语不该被当作他的话发给模型。合法条目的键已由 `MEMORY_KEY_MARK_RE` 剥离，
 * 两者对本函数覆盖的情形等价。
 */
const ANY_MARKER_RE = /<!--[^>]*-->$/;
/** 引用块行（`>`）—— 抬头规则说明**不参与注入**（否则会把说明当记忆发给模型）。 */
const QUOTE_RE = /^\s*>/;
/** 标题行（`#`…`######`）。 */
const HEADING_RE = /^\s*#{1,6}\s/;

/** 去掉列表前缀与首尾空白。 */
export function stripListPrefix(line: string): string {
  return line.replace(LIST_PREFIX_RE, "").trim();
}

/** 行尾条目键（无标记 / 键非法 → `undefined`）。 */
export function keyMarkOf(line: string): string | undefined {
  const m = MEMORY_KEY_MARK_RE.exec(line.trimEnd());
  return m ? m[1] : undefined;
}

/** 行尾节标记 → 类别（无标记或类别非法 → `undefined`）。 */
export function sectionCategoryOf(line: string): MemoryCategory | undefined {
  const m = MEMORY_SECTION_MARK_RE.exec(line.trimEnd());
  if (!m) return undefined;
  return MEMORY_CATEGORIES.find((c) => c === m[1]);
}

/**
 * 解析记忆文档（**只读方向**；`ai/` 与 `features/` 共用，故落 domain 层）。
 *
 * 规则（全部纯函数，**绝不抛错**）：
 * ① 只有含合法 `<!--m:KEY-->` 的**行**才是系统条目；键非法 → **降级为手写行**
 *    （仍进 `entries`、`key === undefined`，系统不再更新它）；
 * ② 抬头 `>` 引用块**不产出条目**（说明文字不是记忆；`<!--t:-->` 也从这里读）；
 * ③ 空行、标题行、节标记行不产出条目；
 * ④ 其余非空普通行 = **手写行**（含用户新增节里的内容）。
 *
 * ⚠️ 返回**文档顺序**：UI 的行级徽标按文档顺序对齐渲染。注入时的「手写行优先」
 * 由 `buildMemoryContextBlock` 负责排序（两件事分开，避免解析层承担展示语义）。
 */
export function parseMemoryDoc(doc: string): ParsedMemoryDoc {
  const trimmed = doc.trim();
  if (!trimmed) return { entries: [], manualIndexes: [] };

  const entries: MemoryEntry[] = [];
  const manualIndexes: number[] = [];
  let lastMergedAt: number | undefined;

  for (const raw of doc.split("\n")) {
    const line = raw.trimEnd();
    const timeMark = MEMORY_TIME_MARK_RE.exec(line);
    if (timeMark) lastMergedAt = Number(timeMark[1]);

    if (!line.trim()) continue;
    if (HEADING_RE.test(line)) continue;
    if (sectionCategoryOf(line)) continue;
    if (QUOTE_RE.test(line)) continue;

    const key = keyMarkOf(line);
    const category = key ? categoryOfKey(key) : undefined;
    if (key && category) {
      entries.push({ key, category, text: stripListPrefix(line.replace(MEMORY_KEY_MARK_RE, "")) });
      continue;
    }
    // 无标记 / 键非法 → 手写行：剥掉残留标记（不让系统术语进提示词）
    manualIndexes.push(entries.length);
    entries.push({ text: stripListPrefix(line.replace(ANY_MARKER_RE, "")) });
  }

  return lastMergedAt === undefined
    ? { entries, manualIndexes }
    : { entries, manualIndexes, lastMergedAt };
}

/**
 * 文档骨架的**文案**（全部走 i18n，由 UI 传入）。
 *
 * ⚠️ 这是「会写进用户文档的文字」：已存在的文档**永不因语言切换而重写**
 * （合并器护栏 ②），只有**新建节**用当前语言。这是刻意的取舍。
 */
export interface MemoryDocScaffold {
  /** 文档 H1（如「学习者记忆」）。 */
  title: string;
  /** 抬头规则说明（多行；本函数会补 `> ` 前缀）。 */
  intro: string;
  /** 手写区标题（如「我的补充」）。合并器**永不改动**该节内容。 */
  manualHeading: string;
  /** 六个类别的节标题。 */
  headings: Record<MemoryCategory, string>;
}

/** 抬头规则说明的引用块（`intro` 多行 → `>` 引用行）。 */
export function introBlockLines(intro: string): string[] {
  return intro
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => `> ${l}`);
}

/**
 * 空文档的骨架：`# 标题` + 抬头引用块 + `## 我的补充`。
 *
 * ⚠️ **刻意不写「我的补充」的正文占位句** —— 任何非空普通行都会被
 * `parseMemoryDoc` 当成手写记忆注入 AI，占位句会被当成用户的话发给模型
 * （见方案 §13 实施偏差表）。引导语一律放进抬头引用块（`>` 行不参与注入）。
 */
export function emptyMemoryDoc(scaffold: MemoryDocScaffold): string {
  return [`# ${scaffold.title}`, "", ...introBlockLines(scaffold.intro), "", `## ${scaffold.manualHeading}`, ""].join(
    "\n",
  );
}

/**
 * 文档抬头的「最后整理」时刻格式化（**机读标记之外的给人看的那部分**）。
 *
 * 固定格式 `YYYY-MM-DD HH:mm`（本地时区）：不随语言变，避免同一份用户在磁盘上
 * 长期保存的文件因语言切换而被改写。机读部分由 `<!--t:epochMs-->` 承担
 * （`parseMemoryDoc` 只认它，故语言无关）。
 */
export function formatMemoryTimestamp(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 归一化文本（折叠空白 + 全角转半角 + 小写）—— 指纹计算的唯一入参。 */
export function normalizeMemoryText(text: string): string {
  return text
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * 指纹（AI 条目的键 + 「不得重复提出」的比对锚）。
 *
 * ⚠️ 走 `hashId`（`src/lib/hash.ts`）—— 同输入同输出，故「同一句话重跑 = 同键 =
 * 原地更新而非追加」（这是文档不会被同一件事反复撑厚的机制之一）。
 */
export function memoryFingerprint(category: MemoryCategory, text: string): string {
  return hashId(`${category}\u0000${normalizeMemoryText(text)}`);
}

/** AI 新条目的键：`ai-<category>-<fingerprint>`（`categoryOfKey` 可反推回类别）。 */
export function aiEntryKey(category: MemoryCategory, text: string): string {
  return `ai-${category}-${memoryFingerprint(category, text)}`;
}

/**
 * 清库前的**记忆侧裁剪**（D13-B：清系统可重算条目、保留用户手写与改过的行）。
 *
 * 为什么需要它：F4 的 `clearAll()`（replace 导入 / 用户清库）会把整库清空，
 * 若记忆文档整份留下，就会出现「学习记录清空了、系统还记着你是怎样的人」；
 * 若整份清掉，又会丢掉用户**手写过、改写过**的内容 —— 那是不可再生的。
 *
 * 判据直接复用合并器的唯一依据：`lastWritten[key] === 当前行文本` = 系统原文未动（可再生）；
 * 不相等 = 用户改过；无键 = 用户手写。**后两类一律保留**。
 *
 * 保留的改写行不会「复活」成可更新行：`lastWritten` 仍保持旧值 → 下轮仍判为「改过」。
 *
 * @returns 裁剪后的文档与元数据；若没有任何用户内容，返回 `doc: ""`（回到空态）。
 */
export function pruneMemoryDocForClear(
  doc: string,
  meta: MemoryDocMeta,
): { doc: string; meta: MemoryDocMeta } {
  const keptEdited = new Set<string>();
  if (doc.trim()) {
    const lines = doc.split("\n");
    const keptFlags = lines.map((line) => {
      if (!line.trim()) return false;
      if (HEADING_RE.test(line) || QUOTE_RE.test(line)) return true; // 结构行先留着，稍后再判空节
      const key = keyMarkOf(line);
      const category = key ? categoryOfKey(key) : undefined;
      if (!key || !category) return true; // 手写行 / 降级行 → 保留
      const text = stripListPrefix(line.replace(MEMORY_KEY_MARK_RE, ""));
      if (meta.lastWritten[key] !== undefined && text === meta.lastWritten[key]) return false; // 系统未动 → 丢
      keptEdited.add(key); // 用户改过 → 保留并继续冻结
      return true;
    });

    // 去掉「只剩标题、没有内容」的节（含用户自定义节）：避免清库后留下空壳
    const kept: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (!keptFlags[i]) continue;
      if (HEADING_RE.test(lines[i])) {
        const nextContent = lines.findIndex(
          (l, j) => j > i && keptFlags[j] && !HEADING_RE.test(l),
        );
        const nextHeading = lines.findIndex((l, j) => j > i && HEADING_RE.test(l) && keptFlags[j]);
        const hasContent = nextContent !== -1 && (nextHeading === -1 || nextContent < nextHeading);
        if (!hasContent) continue;
      }
      kept.push(lines[i]);
    }
    const hasEntry = kept.some(
      (l) => l.trim() && !HEADING_RE.test(l) && !QUOTE_RE.test(l),
    );
    if (hasEntry) {
      const lastWritten: Record<string, string> = {};
      for (const key of Object.keys(meta.lastWritten)) {
        if (keptEdited.has(key)) lastWritten[key] = meta.lastWritten[key];
      }
      return {
        doc: `${kept.join("\n").trimEnd()}\n`,
        // dismissed 保留：那是用户的**意图**（「别再提这件事」），不是可再生的数据
        meta: { lastWritten, dismissed: [...meta.dismissed], lastMergedAt: 0 },
      };
    }
  }
  return { doc: "", meta: { lastWritten: {}, dismissed: [...meta.dismissed], lastMergedAt: 0 } };
}
