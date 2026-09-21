/**
 * 社区知识包（F10）的**共享类型与纯函数**。
 *
 * 为什么落 domain：`storage/` 需要 `PackCounts`（`ImportedPackRecord` 的字段之一）、
 * `features/` 需要全部 → 放任何一侧都会破依赖单向（domain → engine/ai/storage →
 * stores → features）。这与 F9 把 `parseMemoryDoc` / `MemoryDocMeta` 放
 * `domain/memory.ts` 的理由**完全同源**。
 *
 * 本文件只放**纯类型 + 纯函数**：不 import storage / React / IPC，node 可直跑。
 */

// ===== 体积口径（D7「一把尺子」）=====
//
// 统一为 **UTF-8 字节** —— 与文件大小 / HTTP `Content-Length` / 磁盘占用同一把尺子。
// 三个常量与计量函数**刻意同源同处**（都在本文件）：整条链路的体积判定只认它们，
// 任何一侧都不得重写这些数字。落 domain 的理由同上：`storage/` 要用
// `PACK_LOCAL_STORE_BUDGET_BYTES` 定义 `storeCapacityBytes`，`features/` 要用全部。

/** ① 文件 / 网络层**硬拒**上限（防内存爆与 DoS）。 */
export const PACK_HARD_MAX_BYTES = 100 * 1024 * 1024; // 100 MiB
/** ② ≥ 此值改走 Worker 解析，避免阻塞主线程。 */
export const PACK_WORKER_MIN_BYTES = 8 * 1024 * 1024; // 8 MiB
/** ③ localStorage 可用量的**保守值**：导出警告与导入前置拒的**共同**依据（D7 第 ③ 层）。 */
export const PACK_LOCAL_STORE_BUDGET_BYTES = 4 * 1024 * 1024; // 4 MiB

/**
 * 精确 UTF-8 字节数。
 *
 * ⚠️ 调用方**先**用 `raw.length`（UTF-16 code unit 数）作 O(1) 上界预判 ——
 * `utf8BytesOf(text) >= text.length` 恒成立，所以 `raw.length > 上限` 可直接拒，
 * 省掉一次全串编码（100 MiB 级输入下这一下不能省）。
 */
export function utf8BytesOf(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** 包内实体计数 —— 导出时写入 manifest、导入时与包内实数交叉核对。 */
export interface PackCounts {
  documents: number;
  chapters: number;
  sections: number;
  chunks: number;
  knowledgeUnits: number;
  knowledgeRelations: number;
  /** 包内正文总字符（`documents[].textPreview.length` 之和）。 */
  chars: number;
}

/**
 * 逐字段严格相等。
 *
 * ⚠️ 刻意**不用** `JSON.stringify(a) === JSON.stringify(b)`：那样会依赖 key 的
 * 书写顺序（同一份计数换个字段顺序就判不等），是个会静默误判的坑。
 */
export function countsEqualPack(a: PackCounts, b: PackCounts): boolean {
  return (
    a.documents === b.documents &&
    a.chapters === b.chapters &&
    a.sections === b.sections &&
    a.chunks === b.chunks &&
    a.knowledgeUnits === b.knowledgeUnits &&
    a.knowledgeRelations === b.knowledgeRelations &&
    a.chars === b.chars
  );
}

/**
 * `contentHashOf` 的结构化入参 —— 与 `PackData` **结构等价**，但**刻意不**
 * 从 `pack-format.ts` 反向依赖（`PackData` 留在 features 侧，见方案 §8.2）。
 * `PackData` 可直接结构化赋值给它（`SourceDocument[]` → `readonly unknown[]` 协变）。
 */
export interface PackHashInput {
  documents: readonly unknown[];
  chaptersByDocument: Record<string, readonly unknown[]>;
  sections: readonly unknown[];
  chunks: readonly unknown[];
  knowledgeUnits: readonly unknown[];
  knowledgeRelations: readonly unknown[];
}

/**
 * 规范化序列化：对象 key **升序**、数组**保序**、`undefined` 的 key 被丢弃。
 *
 * 目的只有一个：让「同内容、不同 key 书写顺序」产生**同一个**字符串 →
 * `contentHashOf` 才可能稳定。语义与 `JSON.stringify` 对齐（`undefined` 在对象中
 * 丢键、在数组里成 `null`）。
 */
export function stableStringify(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "number":
    case "boolean":
    case "string":
      // 对这三种类型 JSON.stringify 恒返回 string（NaN / Infinity → "null"），`??` 只为收敛类型。
      return JSON.stringify(value) ?? "null";
    case "undefined":
      return "null";
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(",")}]`;
      }
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort();
      return `{${keys
        .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
        .join(",")}}`;
    }
    default:
      // function / symbol —— 正常数据里不会出现；退化到 null 而非抛错。
      return "null";
  }
}

/**
 * 内容指纹：**FNV-1a 32 位**（十六进制，固定 8 字符）。
 *
 * ⚠️ 用途**仅限**「是否同一个包」的识别提示 —— **不是**签名、**不**保证完整性、
 * **不**用于任何安全判定（32 位、无密钥）。别把它当校验和使。
 *
 * 之所以可行：`stableStringify` 消除 key 顺序差异 → 同内容必得同串。
 */
export function contentHashOf(data: PackHashInput): string {
  const bytes = new TextEncoder().encode(stableStringify(data));
  let hash = 0x811c9dc5; // FNV offset basis（32 位）
  for (const b of bytes) {
    hash ^= b;
    // Math.imul 保证 32 位乘法不丢精度（`*` 在结果 > 2^53 时会静默丢低位）。
    hash = Math.imul(hash, 0x01000193) >>> 0; // FNV prime
  }
  return hash.toString(16).padStart(8, "0");
}
