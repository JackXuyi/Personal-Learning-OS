/**
 * 侧边栏（平铺单列 + 图标）。
 *
 * 由 AppShell 拆出（docs/nav-sidebar-redesign-design-2026-09.md §8.2）：
 * - 每项一行：`图标 + 名称`，原常驻的第二行 hint 改由 hover / focus 浮层承载，
 *   并在 NavLink 上挂 `title` 兜底（触屏与无 hover 场景）；
 * - 图标着色由 `NavLink` 的函数式 children 拿到 `isActive` 决定（className 回调
 *   取不到 children 内部，故不能只靠 className）；
 * - `<nav>` **不得**设 `overflow-*`：CSS 规范中一个方向非 visible 会把另一个方向的
 *   visible 计算成 auto，右侧浮层会被裁切。8 项固定，无需内部滚动。
 */
import { NavLink } from "react-router-dom";
import { useI18n } from "../../i18n";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { NAV_COMING, NAV_ITEMS } from "./nav-items";

export default function NavSidebar() {
  const { m } = useI18n();
  const providerReady = useSettingsStore((s) => s.providerReady);
  const ComingIcon = NAV_COMING.icon;
  const comingEntry = m.nav[NAV_COMING.navKey];

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-surface">
      <div className="border-b border-line px-5 py-3.5">
        <p className="text-sm font-semibold tracking-tight text-ink-1">{m.nav.brand}</p>
        <p className="mt-0.5 text-xs text-ink-3">{m.nav.brandSub}</p>
      </div>
      <nav className="flex-1 space-y-0.5 p-3">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const entry = m.nav[item.navKey];
          const dot = item.readyDot && providerReady;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              title={entry.hint}
              data-testid={`nav-${item.navKey}`}
              className={({ isActive }) =>
                `group relative flex items-center gap-2.5 rounded-md px-3 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 ${
                  isActive
                    ? "bg-subtle text-ink-1"
                    : "text-ink-2 hover:bg-subtle hover:text-ink-1"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon
                    className={`h-4 w-4 shrink-0 ${
                      isActive ? "text-primary" : "text-ink-3 group-hover:text-ink-2"
                    }`}
                    strokeWidth={1.75}
                    aria-hidden
                  />
                  <span className="truncate text-sm">{entry.label}</span>
                  {dot ? (
                    <span
                      className="ml-auto h-1.5 w-1.5 rounded-full bg-state-mastered"
                      title={m.nav.readyTooltip}
                    />
                  ) : null}
                  <span
                    role="tooltip"
                    className="pointer-events-none absolute left-full top-1/2 z-30 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink-2 opacity-0 shadow-sm transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
                  >
                    {entry.hint}
                  </span>
                </>
              )}
            </NavLink>
          );
        })}
        <div
          aria-disabled
          title={comingEntry.hint}
          data-testid={`nav-${NAV_COMING.navKey}-placeholder`}
          className="flex cursor-not-allowed items-center gap-2.5 rounded-md px-3 py-2 text-ink-3"
        >
          <ComingIcon className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
          <span className="truncate text-sm">{comingEntry.label}</span>
          <span className="ml-auto rounded border border-line bg-subtle px-1.5 py-0.5 font-mono text-[10px]">
            {NAV_COMING.badge}
          </span>
        </div>
      </nav>
      <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-xs text-ink-3">
        <span>{m.nav.footerHint}</span>
        <span className="rounded border border-line bg-subtle px-1.5 py-0.5 font-mono text-[10px] text-ink-2">
          {m.nav.footerBadge}
        </span>
      </div>
    </aside>
  );
}
