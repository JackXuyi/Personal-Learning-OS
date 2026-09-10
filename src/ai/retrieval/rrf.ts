/**
 * Reciprocal Rank Fusion（RRF）—— 多路排名的融合纯函数。
 *
 * 用途：混合检索把「FTS 命中排名」与「向量命中排名」融合成单一序列。
 * 选 RRF 而非分数加权的理由：两路的分数尺度不可比（BM25 与余弦），
 * RRF 只吃**名次**，天然免调参、抗尺度差异。
 *
 * 公式：`score(d) = Σ_r 1 / (k + rank_r(d))`，rank 从 1 起，k 默认 60
 * （原论文常数，用于压低头部名次的绝对优势）。
 *
 * 约束：纯函数，零依赖。
 */

export interface FuseOptions {
  /** RRF 平滑常数（默认 60）。越小则头部名次差异被放大得越厉害。 */
  k?: number;
  /** 截断长度；不传 = 返回全部融合结果。 */
  limit?: number;
}

/**
 * 融合多路排名。
 *
 * 规则：
 * - **同一路内的重复 id 只计首次出现**（避免某路内部重复把分数刷高）；
 * - 分数相同时按 id 字典序，保证结果确定性可断言；
 * - 空排名数组 / 全空排名 → 返回空数组。
 */
export function fuseRankings(
  rankings: readonly (readonly string[])[],
  options: FuseOptions = {},
): string[] {
  const k = options.k ?? 60;
  const scores = new Map<string, number>();

  for (const ranking of rankings) {
    const seen = new Set<string>();
    for (let i = 0; i < ranking.length; i += 1) {
      const id = ranking[i];
      if (seen.has(id)) continue;
      seen.add(id);
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1));
    }
  }

  const ids = [...scores.keys()].sort(
    (a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0) || a.localeCompare(b),
  );
  return options.limit !== undefined ? ids.slice(0, Math.max(0, options.limit)) : ids;
}
