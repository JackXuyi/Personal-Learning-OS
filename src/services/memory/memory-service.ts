/**
 * 记忆服务（F9）—— 记忆文档的**唯一读写与状态变更入口**。
 * 方案：docs/learner-memory-design-2026-09.md §8.7 / §4.4。
 *
 * 为什么必须有这一层（而不是让页面/调用侧直接碰 storage）：
 * 1. **一个真源**：文档正文 `plos.memory.doc.v1` 与元数据 `plos.memory.meta.v1` 必须
 *    **成对更新**（只写 doc 不写 meta → 下轮整理把所有行判成「用户改过」而冻结；
 *    只写 meta 不写 doc → 墓碑与实际行不一致）。成对这件事只在一个地方发生。
 * 2. **解析收口**：注入侧一律走 `loadMemoryEntries`，解析器只有 `domain/memory.ts` 一份
 *    （`ai/` 不得 import `features/`，故 `ai/` 只接收解析好的 `MemoryEntry[]`）。
 * 3. **错误只产 enum**（`rules/engineering-code-style`）：文案由 UI 侧 `useI18n` 映射。
 *
 * ⚠️ 本模块**不取 `Date.now()`** —— `now` 一律由调用方注入（时间基准唯一，同 F2/F3）。
 * ⚠️ 本模块**不调 `useLoopStore.refresh()`** —— 记忆按 D2 不影响计划，故它不是计划输入。
 * ⚠️ 会被 `tests/learner-memory.test.ts` 在 strip-types 下直跑：不得用 TS 参数属性。
 */
import type {
  GeneratedEntry,
  MemoryDocMeta,
  MemoryDocScaffold,
  MemoryEntry,
  ParsedMemoryDoc,
} from "../../domain";
import { EMPTY_MEMORY_META, parseMemoryDoc, stripListPrefix, MEMORY_KEY_MARK_RE } from "../../domain";
import type { StorageAdapter } from "../../storage/types";
import type { MemoryFactTexts } from "./memory-facts";
import { deriveAllFacts } from "./memory-facts";
import type { MergeStats } from "./memory-doc-merge";
import { mergeMemoryDoc } from "./memory-doc-merge";
import type { MemorySignals } from "./memory-signals";

/** 记忆操作的失败分类（UI 按 kind 取 i18n 文案）。 */
export type MemoryErrorKind = "save-failed" | "invalid-doc";

export class MemoryError extends Error {
  // ⚠️ 显式字段赋值（不用 TS 参数属性）：strip-types 不支持。
  readonly kind: MemoryErrorKind;
  constructor(kind: MemoryErrorKind, message?: string) {
    super(message ?? kind);
    this.name = "MemoryError";
    this.kind = kind;
  }
}

/**
 * 「会写进用户文档的文字」集合（i18n 注入）。
 *
 * ⚠️ 与普通 UI 文案不同：**已存在的文档永不因语言切换而重写**（合并器护栏 ②），
 * 这里只在**新建节 / 首次生成骨架**时被用到。故同一份用户文档可能中英混排 ——
 * 这是刻意取舍，不是 bug（方案 §8.19 有记录）。
 */
export interface MemoryTexts {
  /** 文档骨架文案（H1 / 抬头 / 「我的补充」/ 六个节标题）。 */
  scaffold: MemoryDocScaffold;
  /** 「最后整理：」前缀（时间戳与机读标记 `<!--t:-->` 由合并器拼）。 */
  lastMergedPrefix: string;
}

/** 通道 A 整理入参。 */
export interface RefreshOptions extends MemoryTexts {
  /** 时间基准（`/memory` 页 mount 时取一次）。 */
  now: number;
  /** 通道 A 的句子模板（i18n 注入；这些句子会落进用户文档）。 */
  facts: MemoryFactTexts;
}

/**
 * 读取**生效条目**（注入侧一律调它；唯一真源）。
 *
 * 文档为空 / 只有骨架 → `[]`；调用方据此走「不追加记忆块」分支 → 零回归。
 */
export async function loadMemoryEntries(store: StorageAdapter): Promise<MemoryEntry[]> {
  const doc = await store.getMemoryDoc();
  return parseMemoryDoc(doc).entries;
}

/** 文档 + 元数据 + 解析结果的合并视图（UI 一次读齐，避免三次 IO 错位）。 */
export async function loadMemory(
  store: StorageAdapter,
): Promise<{ doc: string; meta: MemoryDocMeta; parsed: ParsedMemoryDoc }> {
  const [doc, meta] = await Promise.all([store.getMemoryDoc(), store.getMemoryMeta()]);
  return { doc, meta, parsed: parseMemoryDoc(doc) };
}

/**
 * 通道 A：**确定性整理**（零 AI、零外发）。
 *
 * 序：读文档+meta → 四条规则派生（门槛不达标即不产出）→ 合并器（只改系统未动过的行）
 * → **成对落库**。返回 `stats` 供页面如实报告「本轮更新 N 条 / 保留你改写的 M 条」。
 *
 * 幂等：`generated` 相同且用户没动过时，二轮起 `stats.updated === 0` 且文档逐字节不变。
 */
export async function refreshFromFacts(
  store: StorageAdapter,
  signals: MemorySignals,
  opts: RefreshOptions,
): Promise<MergeStats> {
  const [doc, meta] = await Promise.all([store.getMemoryDoc(), store.getMemoryMeta()]);
  const generated = deriveAllFacts(signals, opts.now, opts.facts);
  const result = mergeMemoryDoc({
    doc,
    generated,
    meta,
    scaffold: opts.scaffold,
    lastMergedPrefix: opts.lastMergedPrefix,
    now: opts.now,
  });
  await persist(store, result.doc, result.meta);
  return result.stats;
}

/** 通道 B 落库（用户点「写进文档」后调用；**模型调用本身零写入**，见 `memory-import.ts`）。 */
export async function applyAiEntries(
  store: StorageAdapter,
  entries: readonly GeneratedEntry[],
  opts: MemoryTexts & { now: number },
): Promise<MergeStats> {
  const [doc, meta] = await Promise.all([store.getMemoryDoc(), store.getMemoryMeta()]);
  const result = mergeMemoryDoc({
    doc,
    generated: entries,
    meta,
    scaffold: opts.scaffold,
    lastMergedPrefix: opts.lastMergedPrefix,
    now: opts.now,
  });
  await persist(store, result.doc, result.meta);
  return result.stats;
}

/**
 * 用户手动编辑：**原样落库，完全不过合并器**（R10 的硬护栏）。
 *
 * 为什么不能过合并器：合并器的职责是「系统改写自己的行」，用户文本必须逐字节保存。
 * 也**不动 meta** —— 用户改过的行之所以能被识别为「改过」，靠的正是
 * `lastWritten[key]` 保持系统旧值（合并器据此比对）；此处若「顺手同步」meta，
 * 就把用户的改写**伪装成系统原文**，下一轮整理会直接覆盖掉。
 */
export async function saveUserDoc(store: StorageAdapter, doc: string): Promise<void> {
  if (typeof doc !== "string") throw new MemoryError("invalid-doc");
  try {
    await store.saveMemoryDoc(doc);
  } catch {
    throw new MemoryError("save-failed");
  }
}

/**
 * 清空全部记忆（UC-10，页面上的「清空全部记忆」，需二次确认）。
 *
 * ⚠️ 与 F4 `clearAll()` 的清库口径**不同**：清库走 D13-B 裁剪（留用户手写的字），
 * 而这里是用户**明确选择**清空这一份文档 —— 含手写区与 `dismissed`。
 */
export async function clearMemoryDoc(store: StorageAdapter): Promise<void> {
  await persist(store, "", EMPTY_MEMORY_META);
}

/**
 * 记录「文档已落盘到磁盘」的时刻（UC-11 的**基线**）。**只改 meta，不碰文档**。
 *
 * 为什么需要基线：外部改动探测只能靠「磁盘 mtime > 基线」判定，而「基线」必须由
 * App 自己写下 —— 没有它就无法区分「磁盘上的是我们刚写的」与「别人改过的」。
 *
 * ⚠️ 只在**用户显式落盘成功后**调用。不做「落库后自动写盘 + 自动记基线」：
 * 那会让 App 在用户用外部编辑器改完之后**静默覆盖**那些改动（本模块最核心的承诺
 * 是「用户写下的字不被覆盖」，文件级同样适用）。显式写盘把决定权留给用户。
 */
export async function markFileSaved(store: StorageAdapter, at: number): Promise<void> {
  const meta = await store.getMemoryMeta();
  await saveMeta(store, { ...meta, lastSavedAt: at });
}

/**
 * 磁盘副本是否领先于 App 的基线（UC-11 的判定）。
 *
 * 返回**外部改动时刻**；无法判定 → `undefined`。两条「不猜」：
 * - 没有磁盘副本（`mtime === undefined`）→ `undefined`；
 * - **从未落盘过**（`meta.lastSavedAt === undefined`）→ `undefined`。
 *   基线缺失时「磁盘文件比基线新」在数学上成立（当作 0），但那是**假设**，
 *   而它会让第一次打开页面的用户看到一条无从解释的提示 —— 本仓库的「诚实例外」惯例。
 *
 * ⚠️ 收成纯函数放在这里（而不是写在页面里）：判定与 mtime 读取的**语义**都属记忆域，
 * 页面只负责渲染；也让它能被 `node` 单测直跑（页面是 `.tsx`，strip-types 下测不了）。
 */
export function externalChangeAt(
  mtime: number | undefined,
  meta: MemoryDocMeta,
): number | undefined {
  if (mtime === undefined) return undefined;
  const baseline = meta.lastSavedAt;
  if (baseline === undefined) return undefined;
  return mtime > baseline ? mtime : undefined;
}

/** 「恢复被删的记忆」（UC-09）：清空墓碑 → 下次整理即可写回。只改 meta。 */
export async function restoreDismissed(store: StorageAdapter): Promise<void> {
  const meta = await store.getMemoryMeta();
  if (meta.dismissed.length === 0) return;
  // ⚠️ 必须**同时删掉这些键的 `lastWritten` 记录**：清除 `dismissed` 后，
  // 「文档里没有该行 + `lastWritten` 里还有该键」正是合并器判定「用户删掉了」的形态
  // → 下一轮会立刻把它重新葬回去，按钮看起来毫无作用（TC-UC04-03 要求「恢复后写回文档」）。
  // 删掉之后该键在合并器眼里就是「全新条目」→ 正常入节。
  const lastWritten = { ...meta.lastWritten };
  for (const key of meta.dismissed) delete lastWritten[key];
  await saveMeta(store, { ...meta, lastWritten, dismissed: [] });
}

/**
 * 「用系统的版本」：让某一行的控制权交回系统（UC-09 / TC-UC04-04）。
 *
 * 判据是合并器的唯一依据：把 `lastWritten[key]` 置为**用户当前的写法** ⇒
 * 下轮比对「当前文本 === lastWritten」成立 ⇒ 该行被允许更新。
 *
 * ⚠️ 两种入口必须分开处理 `lastWritten`：
 * - **行仍在文档里**（用户改过措辞）→ 置为当前行文本（把「改过」抹平）；
 * - **行已被删掉**（墓碑态，`currentLine` 为空）→ **必须删除 `lastWritten[key]`**。
 *   若置为空串，`lastWritten[key] !== undefined` 会让合并器判成「用户又删了一次」，
 *   直接把它重新葬回 `dismissed` —— 按钮看起来「点了没反应」。
 */
export async function useSystemVersion(
  store: StorageAdapter,
  key: string,
  currentLine: string,
): Promise<void> {
  const meta = await store.getMemoryMeta();
  const text = rowTextOf(currentLine);
  const lastWritten = { ...meta.lastWritten };
  if (text) lastWritten[key] = text;
  else delete lastWritten[key];
  await saveMeta(store, {
    ...meta,
    lastWritten,
    dismissed: meta.dismissed.filter((k) => k !== key),
  });
}

/** 成对落库（先 doc 后 meta —— 顺序固定，与 `local.ts` 的 persist 口径一致）。 */
async function persist(store: StorageAdapter, doc: string, meta: MemoryDocMeta): Promise<void> {
  try {
    await store.saveMemoryDoc(doc);
    await store.saveMemoryMeta(meta);
  } catch {
    throw new MemoryError("save-failed");
  }
}

async function saveMeta(store: StorageAdapter, meta: MemoryDocMeta): Promise<void> {
  try {
    await store.saveMemoryMeta(meta);
  } catch {
    throw new MemoryError("save-failed");
  }
}

/**
 * 行文本归一化：容忍调用方传「原始 markdown 行」（`- … <!--m:key-->`）或「纯文本」。
 * 剥掉列表前缀与行尾标记 —— 与合并器的 `currentTextOf` 同口径，否则比对永不相等。
 */
function rowTextOf(line: string): string {
  return stripListPrefix(line.replace(MEMORY_KEY_MARK_RE, "")).trim();
}
