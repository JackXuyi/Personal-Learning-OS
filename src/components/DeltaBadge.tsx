/**
 * 掌握度变化徽标 —— 复习/作答提交后的即时反馈。
 *
 * **三态**：上升 emerald（积极）· 下降 red（警示）· **不变中性灰**。
 * ⚠️ 判据**不能**用 `delta >= 0` 判「涨」：0 会落进绿色分支渲染成「+0%」，
 * 而绿色在说「涨了」—— 自评本来就不动掌握度（V2 双证据原则，见
 * `stores/useLoopStore.ts::submitAnswer` 的 rating 分支），用颜色暗示增长是
 * 纯粹的谎报。数值保留一位小数的百分比步进，并诚实标注「启发式估计」；
 * 可选附「下次复习：约 N 天后」—— 增量不变时它才是这一次动作的**真实产出**，
 * 必须保留（自评的产出就是「重新安排了复习」）。
 *
 * 口径先例：`ReviewSession::SummaryView` 的就绪度呈现早就是这一条 —— `delta !== 0`
 * 才渲染彩色增量，为 0 时只显示目标值（且它的 `delta >= 0` 落在已确认非零的分支里，
 * 是对的）。这里补的是同一个判断，不是新规矩。
 */
import { useI18n } from "../i18n";

export function DeltaBadge({
  delta,
  nextReviewInDays,
}: {
  delta: number;
  nextReviewInDays?: number;
}) {
  const { m } = useI18n();
  const unchanged = delta === 0;
  const up = delta > 0;
  const sign = up ? "+" : "−";
  const pct = Math.round(Math.abs(delta) * 100);
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <span
        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold tabular-nums ${
          unchanged
            ? "border-line bg-surface text-ink-2"
            : up
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-red-200 bg-red-50 text-red-600"
        }`}
      >
        {unchanged ? m.common.delta.unchanged : `${sign}${pct}%`}
      </span>
      {nextReviewInDays !== undefined ? (
        <span className="text-xs text-ink-2">
          {m.common.delta.nextReview(nextReviewInDays)}
          <span className="ml-1 text-ink-3">（{m.common.delta.heuristic}）</span>
        </span>
      ) : (
        <span className="text-[10px] text-ink-3">{m.common.delta.heuristic}</span>
      )}
    </span>
  );
}
