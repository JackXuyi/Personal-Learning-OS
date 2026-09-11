import { useEffect, useState } from "react";
import { Link, Outlet, useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import CommandPalette from "../../components/CommandPalette";
import ImportModal from "../../features/learn/ImportModal";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useI18n } from "../../i18n";
import NavSidebar from "./NavSidebar";

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

/**
 * 侧栏形态变更（docs/nav-sidebar-redesign-design-2026-09.md）：
 * 原五分组（TODAY/LEARN/KNOWLEDGE/GOALS/SYSTEM）+ 双行文案已改为**平铺单列 + 图标**，
 * hint 由 hover 浮层承载。结构与渲染下沉到 `NavSidebar.tsx` / `nav-items.ts`，
 * 本文件只保留布局壳职责：Sidebar + Header + Outlet + 全局浮层。
 */
export default function AppShell() {
  const providerReady = useSettingsStore((s) => s.providerReady);
  const { m } = useI18n();
  const navigate = useNavigate();
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
      <NavSidebar />

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
