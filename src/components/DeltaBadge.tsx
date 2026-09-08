/**
 * 掌握度变化徽标 —— 复习/作答提交后的即时反馈。
 *
 * 上升显示 emerald（积极），下降显示 red（警示）；数值保留一位小数的百分比
 * 步进，并诚实标注「启发式估计」。可选附「下次复习：约 N 天后」。
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
  const up = delta >= 0;
  const sign = up ? "+" : "−";
  const pct = Math.round(Math.abs(delta) * 100);
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <span
        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold tabular-nums ${
          up
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : "border-red-200 bg-red-50 text-red-600"
        }`}
      >
        {sign}
        {pct}%
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
