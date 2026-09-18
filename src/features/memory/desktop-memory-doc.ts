/**
 * 记忆文档的磁盘通道（F9 · D12-A）—— Rust `memory_doc` 模块 4 条命令的薄封装。
 * 方案：docs/learner-memory-design-2026-09.md §8.21。
 *
 * 为什么要有它（D12-A 的理由）：用户原话是「写入 md 文档，用户可以手动修改」——
 * 只有真的落成磁盘文件，「手动修改」才能用**用户自己的编辑器**（而不是只能在 App 里改）。
 *
 * 三条硬边界：
 * 1. **单向镜像**：磁盘文件是 App 内文档的一份副本，真源始终是 `plos.memory.doc.v1`。
 *    外部编辑**不会**自动载入 —— 由用户在页头显式点「从文件载入」（见 UC-11 的口径说明）。
 * 2. **失败即降级**：任何失败返回 `undefined`，**不抛错、不影响 App 内功能**
 *    （一个可选的镜像能力不该让主流程变脆）。
 * 3. **复用既有降级件**：纯浏览器走 `downloadText`（**直接 import，不复制第二份**）。
 */
import { invoke, isTauri } from "@tauri-apps/api/core";
import { downloadText } from "../data/portability/desktop-backup";

/** 磁盘文件名（与 `src-tauri/src/memory_doc.rs::MEMORY_FILE_NAME` 同名同后缀）。 */
const MEMORY_FILE_NAME = "learner-memory.md";

/** 记忆落盘能力是否可用（仅桌面端）。 */
export function isDesktopFileAvailable(): boolean {
  return isTauri();
}

/** 记忆目录绝对路径（桌面端才会真正 invoke；浏览器返回空串）。 */
export async function memoryDocDir(): Promise<string> {
  if (!isTauri()) return "";
  try {
    return await invoke<string>("memory_doc_dir");
  } catch {
    return "";
  }
}

/**
 * 把文档写入磁盘，返回绝对路径；**失败 / 非桌面端 → `undefined`**。
 *
 * 浏览器（`isTauri() === false`）：走 `downloadText` 落一份 `.md`，
 * 返回 `undefined`（调用方据此显示「当前环境不能直接落盘」而不是假装同步成功）。
 */
export async function saveMemoryDocToFile(doc: string): Promise<string | undefined> {
  if (!isTauri()) {
    downloadText(MEMORY_FILE_NAME, doc, "text/markdown");
    return undefined;
  }
  try {
    return await invoke<string>("memory_doc_save", { contents: doc });
  } catch {
    return undefined;
  }
}

/** 读磁盘文件内容；**不存在 / 失败 / 非桌面端 → `undefined`**（不抛）。 */
export async function readMemoryDocFromFile(): Promise<string | undefined> {
  if (!isTauri()) return undefined;
  try {
    return await invoke<string>("memory_doc_read");
  } catch {
    return undefined;
  }
}

/** 在系统文件管理器中显示该文件（非桌面端 / 失败 → 静默）。 */
export async function revealMemoryDoc(): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke("memory_doc_reveal");
  } catch {
    // 定位失败只影响「找到文件」这一步，不影响文档本身 —— 不弹错。
  }
}
