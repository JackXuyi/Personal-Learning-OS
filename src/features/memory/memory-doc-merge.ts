/**
 * 行级三态合并（F9 的**承重墙**）—— docs/learner-memory-design-2026-09.md §4.3.3。
 *
 * 这是「无需用户确认」这个决策能站得住的**唯一技术依据**：它保证用户的每一次手动
 * 修改都被尊重 —— 系统**只改「它自己写过、且用户没动过」的行**，其余一律原样保留。
 *
 * 五态判定（逐 `generated` 条目按 `key` 定位；**被 `dismissed` 的键最优先跳过**）：
 *
 * | 文档里的状态 | 判定 | 动作 |
 * |---|---|---|
 * | 有该键，文本 === `lastWritten[key]` | 系统所有（未动） | 原地替换为新文本；刷新 `lastWritten[key]` |
 * | 有该键，文本 !== `lastWritten[key]` | **用户改过** | **原样保留**；`lastWritten[key]` 不更新（故下轮仍判为改过）；`keptMine++` |
 * | 无该键，且 `key ∈ lastWritten` | **用户删掉了** | 进 `dismissed`；不写回；`dismissedNow++` |
 * | 无该键，且 `key ∉ lastWritten` | 新条目 | 追加到对应类别节；`added++` |
 * | `key ∈ dismissed` | **用户不要的** | 直接跳过；`skippedDismissed++` |
 *
 * 结构性护栏（全部代码层，可单测）：
 * ① **无法识别的行一律原样保留** —— 用户手写行 / 标记被删而降级的行 / 注释 / 空行 /
 *    用户新增的整个节，合并器一概不碰；
 * ② 新建节按 `MEMORY_CATEGORIES` 固定顺序插入；已存在的节**不重排、不改标题、不动其中的非标记行**；
 * ③ 每类行数超限时，只淘汰**系统所有且用户没动过**的行（用户改过 / 手写的永不参与淘汰）；
 * ④ 文档达 `docMaxChars` 时停止新增（**不删任何用户内容**）；
 * ⑤ `doc` 为空串 → 生成完整骨架。
 *
 * 纯函数（输入输出全是字符串与对象），`tests/learner-memory.test.ts` 主战场。
 */
import type {
  GeneratedEntry,
  MemoryCategory,
  MemoryDocMeta,
  MemoryDocScaffold,
  ParsedMemoryDoc,
} from "../../domain";
import {
  MEMORY_CATEGORIES,
  MEMORY_KEY_MARK_RE,
  MEMORY_LIMITS,
  MEMORY_TIME_MARK_RE,
  categoryOfKey,
  emptyMemoryDoc,
  formatMemoryTimestamp,
  keyMarkOf,
  sectionCategoryOf,
  stripListPrefix,
} from "../../domain";

export interface MergeInput {
  doc: string;
  generated: readonly GeneratedEntry[];
  meta: MemoryDocMeta;
  /** 骨架文案（标题 / 抬头 / 节标题）；**只在新建节与空文档时使用**。 */
  scaffold: MemoryDocScaffold;
  /** 「最后整理」标签（i18n，如「最后整理：」）—— 时间戳与机读标记由本模块拼。 */
  lastMergedPrefix: string;
  /** 时间基准（入口注入一次；本模块不取 `Date.now()`）。 */
  now: number;
}

export interface MergeStats {
  /** 更新的行数（用户没碰过的）。 */
  updated: number;
  /** 保留用户改写的行数。 */
  keptMine: number;
  /** 新增的行数。 */
  added: number;
  /** 本轮因「用户删过」而未写回的条数。 */
  skippedDismissed: number;
  /** 本轮识别出「用户新删掉的」条数（已进 `dismissed`）。 */
  dismissedNow: number;
  /** 因每类行数上限被淘汰的条数（**只统计系统行**）。 */
  trimmed: number;
}

export interface MergeResult {
  doc: string;
  meta: MemoryDocMeta;
  stats: MergeStats;
}

/** 差异项：用户改过 / 删过，但系统当前仍推出**不同**的值。 */
export interface MemoryDiffEntry {
  key: string;
  category: MemoryCategory;
  /** 用户当前文档里的写法（删掉 → `undefined`）。 */
  mine?: string;
  /** 系统当前推出的写法。 */
  theirs: string;
}

const HEADING_RE = /^\s*#{1,6}\s/;
const QUOTE_RE = /^\s*>/;

/** 一次合并的全部输出（文档 + 元数据 + 本次动作报告）。 */
export function mergeMemoryDoc(input: MergeInput): MergeResult {
  const { generated, meta, scaffold, lastMergedPrefix, now } = input;
  const lines = (input.doc.trim() ? input.doc : emptyMemoryDoc(scaffold)).split("\n");
  const stats: MergeStats = {
    updated: 0,
    keptMine: 0,
    added: 0,
    skippedDismissed: 0,
    dismissedNow: 0,
    trimmed: 0,
  };

  // ---- 1) 建索引：key → 行号（**重复键取第一个**；第二个按手写行保留，不静默删用户内容）
  const sysLine = new Map<string, number>();
  /** 无键行的文本集合 —— 用于识别「标记被用户删掉」的降级行（见下方分支）。 */
  const manualTexts = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const key = keyMarkOf(lines[i]);
    if (!key || !categoryOfKey(key)) {
      const text = currentTextOf(lines[i]);
      if (text && !HEADING_RE.test(lines[i]) && !QUOTE_RE.test(lines[i])) manualTexts.add(text);
      continue;
    }
    if (!sysLine.has(key)) sysLine.set(key, i);
  }

  const lastWritten: Record<string, string> = { ...meta.lastWritten };
  const dismissed = new Set(meta.dismissed);
  const pending: GeneratedEntry[] = [];
  const seen = new Set<string>();

  // ---- 2) 三态判定
  for (const g of generated) {
    if (seen.has(g.key) || !g.text.trim()) continue;
    seen.add(g.key);

    if (dismissed.has(g.key)) {
      stats.skippedDismissed++;
      continue;
    }
    const idx = sysLine.get(g.key);
    if (idx === undefined) {
      /**
       * ⚠️ 「文档里没有该键」有**两种**成因，必须分开（TC-UC03-02 / TC-UC04-01）：
       *
       * | 成因 | 判据 | 动作 |
       * |---|---|---|
       * | 用户**删掉了**整行 | 文档里也找不到那句文本 | 进 `dismissed`，永不写回 |
       * | 用户**只删了行尾标记**（降级为手写行） | 该句文本仍以无键行形式存在 | 当**新条目**追加（原行一字不动） |
       *
       * 后者若被误判成「删掉了」，用户会看到「我没删它，它却再也不更新了」；
       * 而设计对这种情况的要求是「该行降级为手写行 + 该节末尾新增一条系统行」。
       */
      const degraded = lastWritten[g.key] !== undefined && manualTexts.has(lastWritten[g.key]);
      if (lastWritten[g.key] !== undefined && !degraded) {
        // 用户删掉了这一行 → 墓碑，永不再写回
        dismissed.add(g.key);
        stats.dismissedNow++;
      } else {
        pending.push(g);
      }
      continue;
    }
    const current = currentTextOf(lines[idx]);
    if (current === lastWritten[g.key]) {
      const text = g.text.trim();
      // ⚠️ 文本没变 → **既不重写行、也不计入 `updated`**。若照写不误，每次打开
      // `/memory` 都会报告「已更新 N 条」，而用户看到的内容一字未变 —— 报告失真
      // 而且每次开页都写一次 localStorage（TC-UC02-08 要求二次整理 `updated === 0`）。
      // 顺带的好处：用户把列表符号从 `-` 改成 `*` 时不会被系统改回去。
      if (current !== text) {
        lines[idx] = `- ${text} <!--m:${g.key}-->`;
        stats.updated++;
      }
      lastWritten[g.key] = text;
    } else {
      // 用户改过 → 永久冻结（lastWritten 保持系统旧值，故下轮仍判为改过）
      stats.keptMine++;
    }
  }

  // ---- 3) 新条目入节（按 MEMORY_CATEGORIES 顺序，保证新建节的次序稳定）
  for (const category of MEMORY_CATEGORIES) {
    const items = pending.filter((p) => p.category === category);
    if (items.length === 0) continue;
    for (const item of items) {
      const text = item.text.trim();
      const line = `- ${text} <!--m:${item.key}-->`;
      // ④ 文档容量护栏：到顶即停止新增（不删用户内容、不报 trimmed —— trimmed 只统计淘汰）
      if (lines.join("\n").length + line.length + 1 > MEMORY_LIMITS.docMaxChars) break;
      const at = sectionInsertIndex(lines, category, scaffold);
      lines.splice(at, 0, line);
      lastWritten[item.key] = text;
      stats.added++;
    }
  }

  // ---- 4) 每类行数上限：淘汰最旧的**系统所有且用户没动过**的行
  for (const category of MEMORY_CATEGORIES) {
    const idxs: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      const key = keyMarkOf(lines[i]);
      if (key && categoryOfKey(key) === category) idxs.push(i);
    }
    const excess = idxs.length - MEMORY_LIMITS.maxLinesPerCategory;
    if (excess <= 0) continue;

    const order = Object.keys(lastWritten);
    const evictable = idxs
      .filter((i) => {
        const key = keyMarkOf(lines[i]);
        // 只淘汰「该键的规范行」（重复键的第二行按手写行保留）+ 文本仍是系统写的那份
        return key !== undefined && sysLine.get(key) === i && currentTextOf(lines[i]) === lastWritten[key];
      })
      .sort((a, b) => order.indexOf(keyMarkOf(lines[a])!) - order.indexOf(keyMarkOf(lines[b])!));

    let need = excess;
    const toRemove: number[] = [];
    for (const i of evictable) {
      if (need <= 0) break;
      toRemove.push(i);
      const key = keyMarkOf(lines[i])!;
      // ⚠️ 淘汰的键**同时从 `lastWritten` 移除**：保留它会让我们下轮把它误判为
      // 「用户删掉了」并写进 `dismissed` —— 那是**伪造用户意图**（页面会显示
      // 「你没要的 N 条」）。代价是被再次提出时会重新进入文档（有序轮换），
      // 两害相权取其轻：宁可轮换，不冒充用户。
      delete lastWritten[key];
      need--;
      stats.trimmed++;
    }
    for (const i of toRemove.sort((a, b) => b - a)) lines.splice(i, 1);
  }

  // ---- 5) 抬头「最后整理」行（机读标记 `<!--t:-->` 是跨语言唯一可解析的锚）
  upsertLastMergedLine(lines, lastMergedPrefix, now);

  return {
    doc: `${trimBlankEdges(lines).join("\n")}\n`,
    meta: {
      lastWritten,
      dismissed: [...dismissed],
      lastMergedAt: now,
      lastSavedAt: meta.lastSavedAt,
    },
    stats,
  };
}

/**
 * 差异清单（**只读，不写**）：用户改过 / 删过，而系统当前仍推出不同的值。
 *
 * UI 用它渲染「系统现在认为 X，你写的是 Y」并提供「用系统的版本」按钮
 * （该按钮走 `useSystemVersion` → 把键从 `dismissed` 移除 + `lastWritten[key]`
 * 置为当前行文本 → 下轮整理即可更新）。
 */
export function memoryDiffs(
  parsed: ParsedMemoryDoc,
  generated: readonly GeneratedEntry[],
  meta: MemoryDocMeta,
): MemoryDiffEntry[] {
  const dismissed = new Set(meta.dismissed);
  const byKey = new Map<string, string>();
  for (const e of parsed.entries) if (e.key) byKey.set(e.key, e.text);

  const out: MemoryDiffEntry[] = [];
  const seen = new Set<string>();
  for (const g of generated) {
    if (seen.has(g.key) || !g.text.trim()) continue;
    seen.add(g.key);
    const mine = byKey.get(g.key);
    if (mine === undefined) {
      // 用户删过（墓碑）→ 只在**系统仍推出**时提示，且 `mine` 为 undefined
      if (dismissed.has(g.key)) out.push({ key: g.key, category: g.category, theirs: g.text.trim() });
      continue;
    }
    const systemValue = meta.lastWritten[g.key];
    const editedByUser = systemValue !== undefined && mine !== systemValue;
    if (editedByUser && mine !== g.text.trim()) {
      out.push({ key: g.key, category: g.category, mine, theirs: g.text.trim() });
    }
  }
  return out;
}

/** 行内正文（剥掉行首 `- ` 与行尾标记，去除首尾空白）。 */
function currentTextOf(line: string): string {
  return stripListPrefix(line.replace(MEMORY_KEY_MARK_RE, ""));
}

/** 某类别节的区间（`start` 含、`end` 不含）；无该节 → `undefined`。 */
function sectionRange(
  lines: readonly string[],
  category: MemoryCategory,
): { heading: number; start: number; end: number } | undefined {
  let heading = -1;
  for (let i = 0; i < lines.length; i++) {
    if (HEADING_RE.test(lines[i]) && sectionCategoryOf(lines[i]) === category) {
      heading = i;
      break;
    }
  }
  if (heading === -1) return undefined;
  let end = lines.length;
  for (let j = heading + 1; j < lines.length; j++) {
    if (HEADING_RE.test(lines[j])) {
      end = j;
      break;
    }
  }
  return { heading, start: heading + 1, end };
}

/** 该节内下一个新行的插入位置（末尾非空行之后）。 */
function sectionInsertIndex(
  lines: string[],
  category: MemoryCategory,
  scaffold: MemoryDocScaffold,
): number {
  let range = sectionRange(lines, category);
  if (!range) {
    // 新建节：按 MEMORY_CATEGORIES 顺序插到「最后一个序号更小的节」之后；
    // 还没有任何有序节时，插到「我的补充」节之后（手写区紧邻抬头，位置稳定）。
    const order = MEMORY_CATEGORIES.indexOf(category);
    let at = -1;
    for (let i = 0; i < lines.length; i++) {
      if (!HEADING_RE.test(lines[i])) continue;
      const cat = sectionCategoryOf(lines[i]);
      if (cat && MEMORY_CATEGORIES.indexOf(cat) < order) {
        const r = sectionRange(lines, cat);
        if (r) at = r.end;
      }
    }
    if (at === -1) at = manualSectionEnd(lines, scaffold);
    lines.splice(at, 0, "", `## ${scaffold.headings[category]} <!--s:${category}-->`);
    range = sectionRange(lines, category);
    if (!range) return at; // 理论上不可达（刚插入）；兜底避免返回 -1 把内容插到文档开头
  }
  let at = range.start;
  for (let i = range.start; i < range.end; i++) {
    if (lines[i].trim()) at = i + 1;
  }
  return at;
}

/** 「我的补充」节之后的位置（找不到该节 → 抬头引用块之后 → 文档末尾）。 */
function manualSectionEnd(lines: readonly string[], scaffold: MemoryDocScaffold): number {
  for (let i = 0; i < lines.length; i++) {
    if (!HEADING_RE.test(lines[i])) continue;
    const title = lines[i].replace(/^\s*#{1,6}\s*/, "").replace(MEMORY_KEY_MARK_RE, "").trim();
    if (title === scaffold.manualHeading) {
      for (let j = i + 1; j < lines.length; j++) {
        if (HEADING_RE.test(lines[j])) return j;
      }
      return trimTrailingBlankIndex(lines);
    }
  }
  let lastQuote = -1;
  for (let i = 0; i < lines.length; i++) if (QUOTE_RE.test(lines[i])) lastQuote = i;
  return lastQuote === -1 ? trimTrailingBlankIndex(lines) : lastQuote + 1;
}

/** 末尾空白行的起始下标（用于把新内容插在文档尾部内容之后）。 */
function trimTrailingBlankIndex(lines: readonly string[]): number {
  let at = lines.length;
  while (at > 0 && !lines[at - 1].trim()) at--;
  return at;
}

/** 写入 / 更新抬头的「最后整理」行（已存在则原地替换，不新增第二行）。 */
function upsertLastMergedLine(lines: string[], prefix: string, now: number): void {
  const text = `> ${prefix}${formatMemoryTimestamp(now)} <!--t:${now}-->`;
  const idx = lines.findIndex((l) => MEMORY_TIME_MARK_RE.test(l));
  if (idx !== -1) {
    lines[idx] = text;
    return;
  }
  let lastQuote = -1;
  for (let i = 0; i < lines.length; i++) if (QUOTE_RE.test(lines[i])) lastQuote = i;
  if (lastQuote === -1) lines.splice(0, 0, text);
  else lines.splice(lastQuote + 1, 0, text);
}

/** 折叠首尾空白行（不改动文档中间的空行结构）。 */
function trimBlankEdges(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].trim()) start++;
  while (end > start && !lines[end - 1].trim()) end--;
  return lines.slice(start, end);
}
