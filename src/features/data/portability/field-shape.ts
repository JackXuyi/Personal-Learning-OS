/**
 * 字段形态判定的共享工具（F4 备份 / F10 知识包共用）。
 *
 * 为什么单独成文件：`backup-format.ts` 与 `pack-format.ts` 都需要这三样，
 * 各自复制一份就是同一规则两处实现 —— 本仓库反复踩过的「同一规则散在多处
 * ＝根因」（改一处、漏一处，然后两边的校验强度悄悄分叉）。
 *
 * 本模块**零依赖**（不 import 任何领域类型、不碰 storage），因此既不会引入
 * 循环引用，也不会把任一格式的实现拖进另一方的依赖图。
 */

/** 字段形态：数组 / 键值集合 / 单体对象。 */
export type FieldShape = "array" | "record" | "object";

/** 普通对象（排除 `null` 与数组）—— 判「是不是对象」的唯一出口。 */
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 形态匹配：`array` 要求真数组；`record` / `object` 都要求普通对象。 */
export function shapeMatches(v: unknown, shape: FieldShape): boolean {
  if (shape === "array") return Array.isArray(v);
  return isPlainObject(v);
}
