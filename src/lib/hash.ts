/**
 * djb2 32bit → base36：确定性、低碰撞、零依赖的内容派生 id 哈希。
 *
 * ⚠️ **全仓唯一真源**。本文件是「第四处才抽」这条既有约定的兑现：
 * `domain/annotation.ts` 的注释原文写着「若出现 **第四处**，才值得抽到
 * `src/lib/hash.ts`（届时三处一起换）」，F9 学习者记忆的 AI 条目键正是第四处
 * （见 docs/learner-memory-design-2026-09.md §4.2），故本次把
 * `domain/capability.ts` / `domain/annotation.ts` / `engine/flashcard-engine.ts`
 * 三处私有实现一并换源。
 *
 * ⚠️ 改造时**只换实现、不换输入拼接格式**（`\u0000` 分隔符逐字保留）——
 * 否则既有 id 全变，调度状态与批注会静默成孤儿（方案 R7）。
 *
 * 为什么 `lib/` 而不是 `domain/`：`lib` 是无依赖工具层（与 `utils.ts` 并列），
 * `domain/` 与 `engine/` 都可以向下 import 它，不产生任何反向依赖。
 */
export function hashId(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
