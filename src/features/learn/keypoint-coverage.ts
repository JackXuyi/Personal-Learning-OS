/**
 * 要点「原文引用」的覆盖度与选目标 —— 纯派生、零 IO、零 React。
 *
 * 为什么需要（docs/library-keypoint-persist-design-2026-09.md §4.3）：
 * `storage.saveChapters` 是**整批**语义，而要点分析的落库已改为**逐章增量**
 * （中断只丢当前章），于是「跑到哪了」这个事实只能从章节数据本身读出来。
 * 刻意**不**落成 `doc.analysis` 字段 —— `domain/document.ts` 已立约定
 * 「同一事实不在两处记录」（方案 D3）。
 *
 * 单一真源：本模块的三个导出共用同一个谓词 `hasKeyPointRefs`。
 * - UI 的覆盖度行（`KnowledgeTab`）此前是内联 `filter` 数出来的；
 * - 服务层的 `onlyMissing` 选目标此前是另一个内联 `filter`；
 * 两处都在数同一个条件，抽到这里后只剩一把尺子（「同一规则散在多处＝根因」）。
 */
import type { Chapter } from "../../domain";

/** 章是否已有 ≥1 条原文引用 —— 覆盖度与选目标共用的唯一判据。 */
export function hasKeyPointRefs(chapter: Chapter): boolean {
  return (chapter.keyPointRefs?.length ?? 0) > 0;
}

export interface KeyPointCoverage {
  /** 已有 ≥1 条原文引用的章数。 */
  withRefs: number;
  /** 章总数。 */
  total: number;
  /** 尚无引用的章数（= total - withRefs）。 */
  missing: number;
  /** true = 还有章待补（total > 0 且 missing > 0）→「仅补齐缺失」可用。 */
  incomplete: boolean;
}

/** 从章节列表派生覆盖度（无章时 `incomplete=false`：没有可补的对象）。 */
export function keyPointCoverage(chapters: readonly Chapter[]): KeyPointCoverage {
  const total = chapters.length;
  let withRefs = 0;
  for (const c of chapters) if (hasKeyPointRefs(c)) withRefs += 1;
  const missing = total - withRefs;
  return { withRefs, total, missing, incomplete: total > 0 && missing > 0 };
}

/**
 * 「要点分析」的选目标判据。
 *
 * - `onlyMissing=true` → 只补尚无原文引用的章（续跑，跳过已完成的章，不重复消耗 AI）；
 * - `false`（默认）→ 全部重跑（覆盖旧引用）。
 *
 * 与 `AnalyzeConceptsOptions.onlyMissing` 同口径（`analyze-service.ts::analyzeConceptsNow`）。
 */
export function keyPointsTargets(
  chapters: readonly Chapter[],
  onlyMissing: boolean,
): Chapter[] {
  return onlyMissing ? chapters.filter((c) => !hasKeyPointRefs(c)) : [...chapters];
}
