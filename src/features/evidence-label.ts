/**
 * Evidence log 的「动作 → i18n 键」映射（跨页共享，唯一真源）。
 *
 * 背景（G2，docs/learn-feynman-restatement-design-2026-09.md §3.4）：
 * `EvidenceKind` 扩到第三种（`"restatement"`）后，两处消费点若各写各的映射
 * 就会**静默错标** ——
 *   - `features/home/HomePage.tsx` 曾用窄字面量参数（新 kind 会 typecheck 报错，≤好报错）；
 *   - `features/goals/GoalDetailPage.tsx` 曾用内联三元
 *     （`e.kind === "assessment" ? "assessment" : "review-points"`，
 *     新 kind 会被**静默**显示成「复习要点」，typecheck 不拦）。
 *
 * 因此把映射抽成本函数，两页共用 —— 第三次扩展时只改这一处。
 *
 * 顺带统一：HomePage 原先 review → `units.action.review`（"复习"），
 * 与 GoalDetailPage 的 `units.action["review-points"]`（"复习要点"）不一致；
 * 现统一取语义更准的 **`review-points`**（证据行 = "复习要点提交"，
 * 见 `domain/evidence.ts` 的 kind 注释）。
 */
import type { EvidenceKind } from "../domain";

/** `m.units.action` 中与证据动作对应的键。 */
export type EvidenceActionKey = "assessment" | "review-points" | "restatement" | "card";

/** EvidenceKind → `m.units.action` 键（穷尽 switch：新增 kind 会在此 typecheck 报错）。 */
export function evidenceActionKey(kind: EvidenceKind): EvidenceActionKey {
  switch (kind) {
    case "assessment":
      return "assessment";
    case "review":
      return "review-points";
    case "restatement":
      return "restatement";
    case "card":
      return "card";
  }
}
