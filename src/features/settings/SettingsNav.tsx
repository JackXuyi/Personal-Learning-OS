import { NavLink } from "react-router-dom";
import { useI18n } from "../../i18n";
import { visibleSections, type SectionKey } from "./settings-nav";

/**
 * 设置分区左栏（docs/settings-left-menu-layout-design-2026-10.md §8.2）。
 *
 * **一份 DOM 两个形态**：窄窗（< lg）是内容上方的全宽限高列表；宽窗是 200px sticky 竖列。
 * 不做两套渲染分支 ⇒ 选中态天然不会与内容不同步。
 *
 * ⚠️ `data-testid` 沿用 `settings-tab-<key>`（与已删除的顶部 Tab 同名），既有选择器零改动。
 * ⚠️ sticky 不配 `backdrop-filter`（macOS WKWebView 残影，`ui:check` 第 6 类）。
 * ⚠️ `<nav>` 只在窄窗设 `overflow-y-auto`（单方向，避免另一方向被算成 auto 裁切浮层）。
 */
export default function SettingsNav({ current }: { current: SectionKey }) {
  const { m } = useI18n();
  return (
    <nav
      aria-label={m.nav.settings.label}
      data-testid="settings-nav"
      className={[
        "flex max-h-56 flex-col gap-0.5 overflow-y-auto",
        "lg:sticky lg:top-6 lg:max-h-none lg:w-[200px] lg:shrink-0 lg:self-start lg:overflow-visible",
      ].join(" ")}
    >
      {visibleSections().map((key) => (
        <NavLink
          key={key}
          to={`/settings/${key}`}
          end
          title={m.settings.sections[key]}
          data-testid={`settings-tab-${key}`}
          className={({ isActive }) =>
            `rounded-md px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
              isActive || current === key
                ? "bg-subtle font-medium text-ink-1"
                : "text-ink-2 hover:bg-subtle hover:text-ink-1"
            }`
          }
        >
          <span className="block truncate">{m.settings.sections[key]}</span>
        </NavLink>
      ))}
    </nav>
  );
}
