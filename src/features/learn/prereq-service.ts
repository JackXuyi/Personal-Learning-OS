/**
 * 章级前置人工覆盖的服务层（F7 范围 4）—— 纯代码，零 AI。
 *
 * 分工（与 `chapter-edit-service` 同形）：
 * - 合并与归一化口径在 `domain/knowledge.ts`（`togglePrereqOverride` / `chapterPrereqEntries`）；
 * - 本模块只做「读存储 → 调纯函数 → 写存储」的编排，**不含任何判定逻辑**
 *   （判定散到 service/UI 就会长出第二套口径）。
 *
 * ⚠️ 记录为空（`added` 与 `removed` 双空）时**删除记录**而不是写入空记录 ——
 * 空记录与「无记录」在语义上都是「纯自动」，留一条空记录只会让存储里长出无意义的行。
 */
import { togglePrereqOverride } from "../../domain";
import type { ChapterPrereqOverride } from "../../domain";
import type { StorageAdapter } from "../../storage";

/** 读取全部人工覆盖（数组 → Map，口径走 `prereqOverrideMap`）。 */
export async function loadPrereqOverrides(deps: {
  storage: StorageAdapter;
}): Promise<Map<string, ChapterPrereqOverride>> {
  const list = await deps.storage.listPrereqOverrides();
  return new Map(list.map((o) => [o.chapterId, o]));
}

export interface PrereqToggleEdit {
  /** 被修正的章。 */
  chapterId: string;
  /** 前置候选章。 */
  targetId: string;
  /** 用户希望的最终状态：true = 设为前置。 */
  want: boolean;
  /** 该章当前的**自动推导**前置（判定「人工增」还是「人工删」的依据）。 */
  derived: readonly string[];
  /** 该章当前的覆盖记录（无则 `undefined`）。 */
  current: ChapterPrereqOverride | undefined;
}

/** 单条勾选 → 落库。返回新的覆盖记录（`undefined` = 已回到纯自动）。 */
export async function applyPrereqToggle(
  edit: PrereqToggleEdit,
  deps: { storage: StorageAdapter },
): Promise<ChapterPrereqOverride | undefined> {
  const next = togglePrereqOverride(
    edit.current,
    edit.chapterId,
    edit.targetId,
    edit.want,
    edit.derived,
  );
  if (next === undefined) await deps.storage.deletePrereqOverride(edit.chapterId);
  else await deps.storage.savePrereqOverride(next);
  return next;
}

/** 恢复自动：删除该章的覆盖记录（幂等）。 */
export async function clearPrereqOverride(
  chapterId: string,
  deps: { storage: StorageAdapter },
): Promise<void> {
  await deps.storage.deletePrereqOverride(chapterId);
}
