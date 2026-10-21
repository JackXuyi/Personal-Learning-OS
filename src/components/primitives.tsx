import type { ReactNode } from "react";
import type { MasteryBand } from "../engine";
import { useI18n } from "../i18n";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Progress } from "./ui/progress";

/**
 * 公共 UI 原语（B 案语义 token，docs/ui-workbench-plan-2026-09.md §5）。
 *
 * 约定：
 * - 中性色一律走语义 token（surface / line / subtle / ink-1..3 / primary）；
 * - `Card` 语义收窄：仅主行动卡 / 空态卡使用；普通内容块用 divider + 留白；
 * - U0 起新增 Workbench 三件套：`Section`（divider 标题）、`KnowledgeRow`（知识行）、
 *   `EvidenceRow`（证据行）、`ActionCard`（下一步动作卡，全站唯一允许「抬升」的主卡）。
 */

/* ── 状态语义色（dot/徽标用；B 案只作用于点与徽标，不染背景） ─────────── */

export type StatusTone = "mastered" | "learning" | "weak" | "idle" | "failed";

const toneDot: Record<StatusTone, string> = {
  mastered: "bg-state-mastered",
  learning: "bg-state-learning",
  weak: "bg-state-weak",
  idle: "bg-state-idle",
  failed: "bg-state-failed",
};

/**
 * 掌握度徽标配色 —— 走 main.css 的状态语义三件套（浅底 / 描边 / 字）。
 *
 * ⚠️ 保持**既有视觉语义**逐档对齐（红 → failed、琥珀 → weak、绿 → mastered），
 * 只换名字不换观感。`learning` 用红底是既有设计（低掌握 = 待补），是否改走
 * indigo 属独立的视觉决策，本轮不动。
 */
const bandStyles: Record<MasteryBand, string> = {
  "not-started": "bg-subtle text-ink-3 border-line",
  learning: "bg-failed-soft text-failed-ink border-failed-border",
  proficient: "bg-weak-soft text-weak-ink border-weak-border",
  mastered: "bg-mastered-soft text-mastered-ink border-mastered-border",
};

/** 掌握度徽标：基于 `Badge`（outline）+ 领域状态色表（方案 §7，M3 收敛）。 */
export function BandBadge({ band }: { band: MasteryBand }) {
  const { m } = useI18n();
  const label = m.units.band[band];
  return (
    <Badge variant="outline" className={bandStyles[band]}>
      {label}
    </Badge>
  );
}

/** 仅用于主行动卡 / 空态卡等需要抬升语义的块；普通内容用 divider 分层。 */
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-xl border border-line bg-surface p-5 shadow-sm ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * 空态 —— 全站唯一形态（12 处自写容器 + 20 处 dashed 空态卡收口于此）。
 *
 * 纯展示：文案由调用方经 i18n 传入，本组件不含任何文案与状态逻辑
 * （「ui/ 与原语层零文案」约定）。
 */
export function EmptyState({
  title,
  desc,
  action,
  className = "",
}: {
  title: string;
  desc?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-testid="empty-state"
      className={`rounded-xl border border-dashed border-line bg-surface p-6 ${className}`}
    >
      <p className="text-base font-semibold text-ink-1">{title}</p>
      {desc ? <p className="mt-1 text-sm text-ink-2">{desc}</p> : null}
      {action ? <div className="mt-4 flex flex-wrap gap-3">{action}</div> : null}
    </div>
  );
}

/**
 * 错误态 —— 在空态之上追加「技术细节行」+ 一个行动出口。
 *
 * ⚠️ 刻意**不提供** `onRetry` / `retryLabel` 便捷 props —— 那需要组件内给默认文案
 * （「重试」），违反「ui/ 与原语层不含文案」的约定。行动出口一律由调用方传
 * `<Button onClick={…}>{m.xxx.retry}</Button>`，文案始终走 i18n。
 */
export function ErrorState({
  title,
  desc,
  detail,
  action,
  className = "",
}: {
  title: string;
  desc?: string;
  detail?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-testid="error-state"
      className={`rounded-xl border border-dashed border-line bg-surface p-6 ${className}`}
    >
      <p className="text-base font-semibold text-state-failed">{title}</p>
      {desc ? <p className="mt-1 text-sm text-ink-2">{desc}</p> : null}
      {detail ? <p className="mt-2 break-all text-xs text-ink-3">{detail}</p> : null}
      {action ? <div className="mt-4 flex flex-wrap gap-3">{action}</div> : null}
    </div>
  );
}

export function SectionTitle({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div>
        <h2 className="text-lg font-semibold text-ink-1">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-sm text-ink-2">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Bar({
  value,
  className = "",
  target,
  targetLabel,
}: {
  value: number;
  className?: string;
  /** 目标刻度（0..1），在进度条上画一条刻度线。 */
  target?: number;
  targetLabel?: string;
}) {
  const pct = Math.round(value * 100);
  const targetPct = target !== undefined ? Math.round(target * 100) : undefined;
  const { m } = useI18n();
  return (
    <div className="relative">
      {/* 轨道/填充由 UI Kit `ui/progress` 承载；className 契约不变（作用于填充色）。 */}
      <Progress
        value={Math.min(100, Math.max(0, pct))}
        indicatorClassName={className}
      />
      {targetPct !== undefined ? (
        <div
          className="absolute top-1/2 z-10 h-3.5 w-0.5 -translate-y-1/2 rounded-full bg-ink-3"
          style={{ left: `${Math.min(100, Math.max(0, targetPct))}%` }}
          title={targetLabel ?? m.common.targetLine(targetPct)}
        />
      ) : null}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-ink-3">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-ink-1">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-ink-2">{hint}</p> : null}
    </div>
  );
}

/* ── Workbench 三件套（U0 新增；docs/ui-workbench-plan-2026-09.md §5.4） ── */

/** Divider 式分组标题（替代套边框小标题）。 */
export function Section({
  title,
  action,
  className = "",
}: {
  title: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-center justify-between gap-3 ${className}`}>
      <h3 className="text-xs font-semibold tracking-wide text-ink-2">{title}</h3>
      {action}
    </div>
  );
}

/** 知识行 —— 一行一知识：状态点 + 名称 + 掌握度 + 元信息 + 可选动作。 */
export function KnowledgeRow({
  title,
  tone,
  bandLabel,
  mastery,
  meta,
  actionLabel,
  onAction,
  className = "",
}: {
  title: string;
  /** 状态语义（决定行首圆点颜色）；缺省不显示圆点。 */
  tone?: StatusTone;
  /** 可选的档位/状态文字（如「学习中」），弱化显示在标题旁。 */
  bandLabel?: string;
  /** 掌握度 0..1；提供则在右侧渲染百分比。 */
  mastery?: number;
  /** 右侧元信息（如「上次测评 2 天前」）。 */
  meta?: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 border-b border-line py-2 last:border-b-0 ${className}`}
    >
      <span className="flex min-w-0 items-center gap-2">
        {tone ? (
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${toneDot[tone]}`} />
        ) : null}
        <span className="truncate text-sm text-ink-1">{title}</span>
        {bandLabel ? <span className="shrink-0 text-xs text-ink-3">{bandLabel}</span> : null}
      </span>
      <span className="flex shrink-0 items-center gap-3">
        {mastery !== undefined ? (
          <span className="w-10 text-right text-xs tabular-nums text-ink-2">
            {Math.round(mastery * 100)}%
          </span>
        ) : null}
        {meta ? <span className="text-xs text-ink-3">{meta}</span> : null}
        {actionLabel && onAction ? (
          <button
            type="button"
            onClick={onAction}
            className="text-xs font-medium text-primary transition-colors hover:text-primary/70"
          >
            {actionLabel}
          </button>
        ) : null}
      </span>
    </div>
  );
}

/** 证据行 —— 时间 · 动作·主题 · 结论 · Δ · 来源（Evidence-based learning）。 */
export function EvidenceRow({
  time,
  title,
  verdict,
  delta,
  deltaTone = "neutral",
  source,
}: {
  /** 相对/绝对时间文字（由调用方格式化）。 */
  time?: string;
  /** 动作 · 主题（如「测评 · Reranking」）。 */
  title: string;
  /** 结论（如「答对 · 理解」）。 */
  verdict?: string;
  /** 掌握度变化（如「43% → 48%」）。 */
  delta?: string;
  deltaTone?: "up" | "down" | "neutral";
  source?: string;
}) {
  const deltaColor =
    deltaTone === "up"
      ? "text-state-mastered"
      : deltaTone === "down"
        ? "text-state-failed"
        : "text-ink-3";
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line py-2 text-sm last:border-b-0">
      <span className="flex min-w-0 items-baseline gap-2">
        {time ? <span className="shrink-0 text-xs tabular-nums text-ink-3">{time}</span> : null}
        <span className="truncate text-ink-1">{title}</span>
        {verdict ? <span className="shrink-0 text-xs text-ink-3">{verdict}</span> : null}
      </span>
      <span className="flex shrink-0 items-center gap-3">
        {delta ? <span className={`text-xs tabular-nums ${deltaColor}`}>{delta}</span> : null}
        {source ? <span className="hidden max-w-56 truncate text-xs text-ink-3 lg:inline">{source}</span> : null}
      </span>
    </div>
  );
}

/** 下一步动作卡 —— 全站唯一允许「抬升」的主卡（Today / Plan 头部）。 */
export function ActionCard({
  eyebrow,
  title,
  subtitle,
  mastery,
  reasons,
  ctaLabel,
  onCta,
  eta,
}: {
  /** 顶部小徽标（如 REVIEW / 补考）。 */
  eyebrow?: string;
  title: string;
  subtitle?: string;
  /** 掌握度 0..1（显示进度条 + 百分比）。 */
  mastery?: number;
  /** why-now 理由行。 */
  reasons?: string[];
  ctaLabel: string;
  onCta: () => void;
  /** 主行动旁的耗时估计（如「约 12 分钟」）。 */
  eta?: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {eyebrow ? (
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">
              {eyebrow}
            </p>
          ) : null}
          <h3 className="mt-0.5 text-base font-semibold text-ink-1">{title}</h3>
          {subtitle ? <p className="mt-0.5 text-sm text-ink-2">{subtitle}</p> : null}
        </div>
        {mastery !== undefined ? (
          <div className="w-36 shrink-0">
            <p className="text-right text-xs font-medium tabular-nums text-ink-2">
              {Math.round(mastery * 100)}%
            </p>
            <Bar value={mastery} className="mt-1 bg-primary" />
          </div>
        ) : null}
      </div>

      {reasons && reasons.length > 0 ? (
        <div className="mt-4 border-t border-line pt-3">
          <ul className="space-y-1">
            {reasons.map((r, i) => (
              <li key={i} className="flex items-baseline gap-2 text-sm text-ink-2">
                <span className="h-1 w-1 shrink-0 translate-y-[-2px] rounded-full bg-ink-3" />
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-4 flex items-center justify-end gap-3">
        {eta ? <span className="text-xs text-ink-3">{eta}</span> : null}
        <Button type="button" onClick={onCta}>
          {ctaLabel}
        </Button>
      </div>
    </div>
  );
}

/* ── SegmentedTabs —— 胶囊分段控件（资料列表页过滤；与设置页 Segment 视觉同源） ── */

/** 胶囊分段控件：`items` 渲染为一组按钮，选中项 primary 实底。 */
export function SegmentedTabs<T extends string>({
  value,
  onChange,
  items,
  className = "",
  testIdPrefix,
}: {
  value: T;
  onChange: (v: T) => void;
  items: { value: T; label: string }[];
  className?: string;
  testIdPrefix?: string;
}) {
  return (
    <div
      role="tablist"
      className={`inline-flex items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5 ${className}`}
    >
      {items.map((it) => {
        const selected = it.value === value;
        return (
          <button
            key={it.value}
            type="button"
            role="tab"
            aria-selected={selected}
            data-testid={testIdPrefix ? `${testIdPrefix}-${it.value}` : undefined}
            onClick={() => onChange(it.value)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              selected
                ? "bg-primary text-white"
                : "text-ink-2 hover:bg-subtle hover:text-ink-1"
            }`}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
