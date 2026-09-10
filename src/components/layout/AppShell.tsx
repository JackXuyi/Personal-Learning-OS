import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import CommandPalette from "../../components/CommandPalette";
import ImportModal from "../../features/learn/ImportModal";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useI18n, type Messages } from "../../i18n";

/** 打开 ⌘K 命令面板（Header 搜索框触发；CommandPalette 监听同事件）。 */
export const CMD_OPEN_EVENT = "plos:open-palette";

/** 打开全局导入 Modal（Header / ⌘K / 各空态触发；AppShell 监听渲染）。 */
export const IMPORT_OPEN_EVENT = "plos:open-import";

/** 文档/章节数据已变更（导入完成）——挂载中的资料库页监听后重载。 */
export const DOCS_CHANGED_EVENT = "plos:docs-changed";

export function openCommandPalette() {
  window.dispatchEvent(new CustomEvent(CMD_OPEN_EVENT));
}

export function openImportModal() {
  window.dispatchEvent(new CustomEvent(IMPORT_OPEN_EVENT));
}

export function notifyDocsChanged() {
  window.dispatchEvent(new CustomEvent(DOCS_CHANGED_EVENT));
}

interface NavItem {
  to: string;
  label: string;
  hint?: string;
}

interface NavGroup {
  title: string;
  items: NavItem[];
  /** 组内灰显占位（不可点，如 Graph·N5 前）。 */
  coming?: { label: string; hint: string };
}

/**
 * 导航分组（UI Workbench 五组，docs/ui-workbench-plan-2026-09.md §4.1）。
 *
 * U5 调整（A 案升级 /learn 为资料库，导航唯一入口避免同路由双高亮）：
 * - LEARN 组收敛为 Plan / Assess（/quiz）；原 Learn 项语义并入资料库；
 * - KNOWLEDGE 组开放 Library（/learn 资料库观感）；Graph 灰显占位（N5 放开）；
 * U6 调整：GOALS 组开放 Goals（/goals 多目标 CRUD，/career → /goals）；
 * SYSTEM 组开放 Learner（/learner 我的画像）+ Settings。
 */
function buildNavGroups(nav: Messages["nav"]): NavGroup[] {
  return [
    { title: nav.groupToday, items: [{ to: "/", label: nav.home.label, hint: nav.home.hint }] },
    {
      title: nav.groupLearn,
      items: [
        { to: "/plan", label: nav.plan.label, hint: nav.plan.hint },
        { to: "/quiz", label: nav.quiz.label, hint: nav.quiz.hint },
      ],
    },
    {
      title: nav.groupKnowledge,
      items: [{ to: "/learn", label: nav.library.label, hint: nav.library.hint }],
      coming: { label: nav.graph.label, hint: nav.graph.hint },
    },
    { title: nav.groupGoals, items: [{ to: "/goals", label: nav.goals.label, hint: nav.goals.hint }] },
    {
      title: nav.groupSystem,
      items: [
        { to: "/learner", label: nav.learner.label, hint: nav.learner.hint },
        { to: "/settings", label: nav.settings.label, hint: nav.settings.hint },
      ],
    },
  ];
}

export default function AppShell() {
  const providerReady = useSettingsStore((s) => s.providerReady);
  const { m } = useI18n();
  const navigate = useNavigate();
  const groups = buildNavGroups(m.nav);
  const [importOpen, setImportOpen] = useState(false);

  // 全局导入 Modal：Header / ⌘K / 各空态经 IMPORT_OPEN_EVENT 打开。
  useEffect(() => {
    const onOpen = () => setImportOpen(true);
    window.addEventListener(IMPORT_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(IMPORT_OPEN_EVENT, onOpen);
  }, []);

  const closeImport = () => setImportOpen(false);

  const handleImported = (_docId: string, chapterIds: string[]) => {
    setImportOpen(false);
    notifyDocsChanged();
    // 导入完成直接落到 Learn 可点：有章 → 首章阅读；仅保存 → 资料库目录。
    navigate(chapterIds[0] ? `/learn/${chapterIds[0]}` : "/learn");
  };

  const handleInspect = () => {
    setImportOpen(false);
    notifyDocsChanged();
    navigate("/learn");
  };

  return (
    <div className="flex h-full min-h-0 bg-app-bg text-ink-1">
      <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-surface">
        <div className="border-b border-line px-5 py-3.5">
          <p className="text-sm font-semibold tracking-tight text-ink-1">{m.nav.brand}</p>
          <p className="mt-0.5 text-xs text-ink-3">{m.nav.brandSub}</p>
        </div>
        <nav className="flex-1 space-y-4 overflow-y-auto p-3">
          {groups.map((group, gi) => (
            <div key={gi}>
              <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-3">
                {group.title}
              </p>
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === "/"}
                    className={({ isActive }) =>
                      `block rounded-md px-3 py-1.5 transition-colors ${
                        isActive
                          ? "bg-subtle text-ink-1"
                          : "text-ink-2 hover:bg-subtle hover:text-ink-1"
                      }`
                    }
                  >
                    <ShellNavContent
                      item={item}
                      readyDot={item.to === "/settings" && providerReady}
                    />
                  </NavLink>
                ))}
                {group.coming ? (
                  <div className="flex items-center justify-between gap-2 rounded-md px-3 py-1.5">
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm text-ink-3">{group.coming.label}</span>
                      {group.coming.hint ? (
                        <span className="truncate text-xs text-ink-3">{group.coming.hint}</span>
                      ) : null}
                    </span>
                    <span className="shrink-0 rounded border border-line bg-subtle px-1.5 py-0.5 font-mono text-[10px] text-ink-3">
                      N5
                    </span>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </nav>
        <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-xs text-ink-3">
          <span>{m.nav.footerHint}</span>
          <span className="rounded border border-line bg-subtle px-1.5 py-0.5 font-mono text-[10px] text-ink-2">
            {m.nav.footerBadge}
          </span>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* 顶部 Header：居中全局搜索（=⌘K）+ 右侧「导入资料」与 AI 状态 */}
        <header className="relative flex h-12 shrink-0 items-center border-b border-line bg-surface px-4">
          <button
            type="button"
            onClick={openCommandPalette}
            aria-label={m.cmd.searchAria}
            className="mx-auto flex h-8 w-full max-w-md items-center justify-between gap-2 rounded-md border border-line bg-app-bg px-3 text-left text-sm text-ink-3 transition-colors hover:border-ink-2 hover:text-ink-2"
          >
            <span className="truncate">{m.cmd.placeholder}</span>
            <kbd className="shrink-0 rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[10px] text-ink-3">
              ⌘K
            </kbd>
          </button>
          <div className="absolute right-4 flex items-center gap-2">
            <button
              type="button"
              onClick={openImportModal}
              title={m.cmd.importHint}
              className="flex h-8 items-center gap-1 rounded-md border border-line bg-app-bg px-2.5 text-xs font-medium text-ink-2 transition-colors hover:border-ink-2 hover:text-ink-1"
            >
              <span aria-hidden>＋</span>
              {m.common.import}
            </button>
            <Link
              to="/settings"
              title={m.nav.readyTooltip}
              className="flex items-center gap-1.5 text-xs text-ink-2 transition-colors hover:text-ink-1"
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  providerReady ? "bg-state-mastered" : "bg-state-idle"
                }`}
              />
              <span className="hidden lg:inline">
                {providerReady ? m.nav.aiReady : m.nav.aiOffline}
              </span>
            </Link>
          </div>
        </header>

        <main className="min-w-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
      <CommandPalette />
      {importOpen ? (
        <ImportModal
          onClose={closeImport}
          onImported={handleImported}
          onInspect={handleInspect}
        />
      ) : null}
    </div>
  );
}

function ShellNavContent({
  item,
  readyDot,
}: {
  item: NavItem;
  readyDot?: boolean;
}) {
  const { m } = useI18n();
  return (
    <span className="flex items-center justify-between gap-2">
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium">{item.label}</span>
        {item.hint ? (
          <span className="truncate text-xs text-ink-3">{item.hint}</span>
        ) : null}
      </span>
      {readyDot ? (
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-state-mastered"
          title={m.nav.readyTooltip}
        />
      ) : null}
    </span>
  );
}

export function PageContainer({
  children,
  size = "default",
}: {
  children: ReactNode;
  /**
   * `default` = 既有 1024px 居中（全站默认，勿改）；
   * `wide` = 资料详情页等宽屏内容，随窗口伸展（上限 1600px），内边距按断点收放。
   */
  size?: "default" | "wide";
}) {
  const cls =
    size === "wide"
      ? "mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8"
      : "mx-auto max-w-5xl px-8 py-8";
  return <div className={cls}>{children}</div>;
}
