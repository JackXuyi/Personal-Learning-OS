import { useEffect, useState } from "react";
import { SectionTitle } from "../../components/primitives";
import { PageContainer } from "../../components/layout/AppShell";
import { useLangStore } from "../../stores/useLangStore";
import { useI18n } from "../../i18n";
import { storage } from "../../stores/useLoopStore";
import { isDesktopLogAvailable } from "../../lib/desktop-log";
import AIModelsSection from "./AIModelsSection";
import type { PackCandidate } from "../data/portability/KnowledgePackCard";
import StorageSection, { type StorageCounts } from "./sections/StorageSection";
import LearningSection from "./sections/LearningSection";
import AppearanceSection from "./sections/AppearanceSection";
import ShortcutsSection from "./sections/ShortcutsSection";
import LogsSection from "./sections/LogsSection";
import AboutSection from "./sections/AboutSection";
import { SECTION_ORDER, type SectionKey } from "./settings-nav";

/**
 * 设置页壳（布局：docs/settings-left-menu-layout-design-2026-10.md）。
 *
 * 分区键与可见性真源在 `settings-nav.ts`；分区内容各自成文件（`sections/`）。
 * AI 分区 = 原「AI 模型中心」（`AIModelsSection`，零功能回退）；
 * Storage 分区展示真实计数（读 storage）；帮助与诊断分区为桌面端专属，纯浏览器隐藏。
 */

export default function SettingsPage() {
  const { m, lang } = useI18n();
  const st = m.settings;
  const langMode = useLangStore((s) => s.mode);
  const setLangMode = useLangStore((s) => s.setMode);

  const [section, setSection] = useState<SectionKey>("ai");
  const [counts, setCounts] = useState<StorageCounts | undefined>();
  /**
   * 可打包资料（F10 社区知识包卡片）。
   *
   * ⚠️ 与 `counts` **同源读取**（下面同一个循环里产出）—— 分成两次读库就是「两把尺子」：
   * 两次 `listDocuments()` 之间可能夹着一次导入 / 删除，卡片列出的资料与计数对不上。
   */
  const [packCandidates, setPackCandidates] = useState<PackCandidate[] | undefined>();

  // Storage 分区计数：一次读取（docs/chapters 需逐文档；本地规模小）。
  // 抽成函数而非内联 effect：导入（数据可携带卡 / 知识包卡）换掉整库后需要重算一次。
  const reloadCounts = () => {
    void (async () => {
      try {
        const [docs, papers, goals, evidence] = await Promise.all([
          storage.listDocuments(),
          storage.listPapers(),
          storage.listGoals(),
          storage.listEvidence(),
        ]);
        let chapters = 0;
        for (const d of docs) chapters += (await storage.listChapters(d.id)).length;
        setCounts({ docs: docs.length, chapters, papers: papers.length, goals: goals.length, evidence: evidence.length });
        // 同一份 `docs` 既出计数也出候选列表（见上面 packCandidates 的注释）。
        setPackCandidates(docs.map((x) => ({ id: x.id, title: x.title })));
      } catch {
        /* 计数失败保持 undefined（Storage 分区显示占位）。 */
      }
    })();
  };

  useEffect(reloadCounts, []);

  return (
    <PageContainer>
      <SectionTitle title={m.nav.settings.label} subtitle={m.nav.settings.hint} />

      {/* ── 分区导航：顶部横向 Segment Tab（日志分区仅桌面端显示） ── */}
      <div
        role="tablist"
        className="mt-4 flex gap-1 overflow-x-auto rounded-lg border border-line bg-subtle p-1"
      >
        {SECTION_ORDER.filter((k) => k !== "logs" || isDesktopLogAvailable()).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={section === key}
            data-testid={`settings-tab-${key}`}
            onClick={() => setSection(key)}
            className={`flex-1 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              section === key
                ? "bg-surface text-primary shadow-sm"
                : "text-ink-2 hover:bg-subtle hover:text-ink-1"
            }`}
          >
            {st.sections[key]}
          </button>
        ))}
      </div>

      {/* ── 分区内容 ───────────────────────────────────────────────── */}
      <div className="mt-6 min-w-0">
        {section === "ai" ? (
          <AIModelsSection />
        ) : section === "storage" ? (
          <StorageSection
            counts={counts}
            packCandidates={packCandidates}
            st={st}
            loading={m.common.loading}
            onDataChanged={reloadCounts}
          />
        ) : section === "learning" ? (
          <LearningSection st={st} />
        ) : section === "appearance" ? (
          <AppearanceSection langMode={langMode} setLangMode={setLangMode} lang={lang} m={m} />
        ) : section === "shortcuts" ? (
          <ShortcutsSection st={st} />
        ) : section === "logs" ? (
          <LogsSection st={st} />
        ) : (
          <AboutSection st={st} />
        )}
      </div>
    </PageContainer>
  );
}
