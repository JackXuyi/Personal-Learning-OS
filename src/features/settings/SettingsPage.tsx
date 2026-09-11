import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Card, SectionTitle } from "../../components/primitives";
import { PageContainer } from "../../components/layout/AppShell";
import { useLangStore } from "../../stores/useLangStore";
import { useI18n, type Messages } from "../../i18n";
import { storage } from "../../stores/useLoopStore";
import {
  isDesktopLogAvailable,
  logGetConfig,
  logOpenDir,
  logReadRecent,
  logSetConfig,
  type LogConfigView,
  type LogLevel,
} from "../../lib/desktop-log";
import AIModelsSection from "./AIModelsSection";

/**
 * 设置（docs/settings-top-tab-layout-design-2026-09.md：外层分区改顶部横向 Tab；
 * 分区化源起 docs/ui-workbench-plan-2026-09.md §24-26）。
 *
 * 顶部横向 Segment Tab：AI 模型 / 本地存储 / 学习行为 / 外观与语言 / 快捷键 / 日志 / 关于；
 * AI 分区内容 = 原「AI 模型中心」（抽至 AIModelsSection，零功能回退）；
 * Storage 分区展示真实计数（读 storage）；其余分区为说明卡；
 * 日志分区（docs/tauri-log-config-design-2026-09.md）为桌面端专属，纯浏览器隐藏。
 */

type SectionKey = "ai" | "storage" | "learning" | "appearance" | "shortcuts" | "logs" | "about";

const SECTION_ORDER: SectionKey[] = [
  "ai",
  "storage",
  "learning",
  "appearance",
  "shortcuts",
  "logs",
  "about",
];

/** Storage 分区数据规模快照。 */
interface StorageCounts {
  docs: number;
  chapters: number;
  papers: number;
  goals: number;
  evidence: number;
}

/** 后端徽标文案：适配器 name（local=本机 localStorage；memory=内存预览）。 */
function backendLabelOf(name: string, sg: Messages["settings"]["storage"]): string {
  return name.includes("local") ? sg.storageLocal : sg.storageMemory;
}

export default function SettingsPage() {
  const { m, lang } = useI18n();
  const st = m.settings;
  const langMode = useLangStore((s) => s.mode);
  const setLangMode = useLangStore((s) => s.setMode);

  const [section, setSection] = useState<SectionKey>("ai");
  const [counts, setCounts] = useState<StorageCounts | undefined>();

  // Storage 分区计数：一次读取（docs/chapters 需逐文档；本地规模小）。
  useEffect(() => {
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
      } catch {
        /* 计数失败保持 undefined（Storage 分区显示占位）。 */
      }
    })();
  }, []);

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
          <StorageSection counts={counts} st={st} loading={m.common.loading} />
        ) : section === "learning" ? (
          <LearningSection st={st} />
        ) : section === "appearance" ? (
          <AppearanceSection
            langMode={langMode}
            setLangMode={setLangMode}
            lang={lang}
            m={m}
          />
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

/* ------------------------------------------------------------------ */
/* 分区内容                                                            */
/* ------------------------------------------------------------------ */

function SectionShell({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="text-base font-semibold text-ink-1">{title}</h3>
      {desc ? <p className="mt-0.5 text-sm text-ink-2">{desc}</p> : null}
      <div className="mt-3">{children}</div>
    </div>
  );
}

function StorageSection({ counts, st, loading }: { counts: StorageCounts | undefined; st: Messages["settings"]; loading: string }) {
  const sg = st.storage;
  return (
    <SectionShell title={sg.title} desc={sg.desc}>
      <Card className="space-y-3">
        <dl className="space-y-1.5 text-sm">
          <KV k={sg.backend} v={backendLabelOf(storage.name, sg)} />
        </dl>
        <div className="border-t border-line pt-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-ink-3">{sg.counts}</p>
          {counts ? (
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
              <StatCell label={sg.docCount(counts.docs)} />
              <StatCell label={sg.chapterCount(counts.chapters)} />
              <StatCell label={sg.paperCount(counts.papers)} />
              <StatCell label={sg.goalCount(counts.goals)} />
              <StatCell label={sg.evidenceCount(counts.evidence)} />
            </div>
          ) : (
            <p className="mt-2 text-xs text-ink-3">{loading}</p>
          )}
        </div>
        <p className="border-t border-line pt-3 text-[11px] leading-relaxed text-ink-3">{sg.note}</p>
      </Card>
    </SectionShell>
  );
}

function StatCell({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-line bg-subtle/60 px-2.5 py-2 text-center">
      <p className="truncate text-xs text-ink-2">{label}</p>
    </div>
  );
}

function LearningSection({ st }: { st: Messages["settings"] }) {
  const sg = st.learning;
  return (
    <SectionShell title={sg.title} desc={sg.desc}>
      <Card>
        <ul className="space-y-2 text-sm text-ink-2">
          {sg.items.map((item, i) => (
            <li key={i} className="flex items-baseline gap-2">
              <span className="h-1 w-1 shrink-0 translate-y-[-2px] rounded-full bg-ink-3" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </Card>
    </SectionShell>
  );
}

function AppearanceSection({
  langMode,
  setLangMode,
  lang,
  m,
}: {
  langMode: "auto" | "zh" | "en";
  setLangMode: (v: "auto" | "zh" | "en") => void;
  lang: "zh" | "en";
  m: Messages;
}) {
  const gl = m.settings.lang;
  return (
    <SectionShell title={m.settings.sections.appearance}>
      <Card>
        <h3 className="text-sm font-semibold text-ink-1">{gl.title}</h3>
        <div className="mt-2 flex gap-1 rounded-lg border border-line bg-subtle p-1">
          {(
            [
              ["auto", gl.auto],
              ["zh", gl.zh],
              ["en", gl.en],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setLangMode(value)}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                langMode === value
                  ? "bg-surface text-primary shadow-sm"
                  : "text-ink-2 hover:text-ink-1"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
          {langMode === "auto" ? `${gl.autoHint} ${gl.current(lang)}` : gl.current(lang)}
        </p>
      </Card>
    </SectionShell>
  );
}

function ShortcutsSection({ st }: { st: Messages["settings"] }) {
  const sg = st.shortcuts;
  return (
    <SectionShell title={sg.title} desc={sg.desc}>
      <Card>
        <div className="divide-y divide-line">
          {sg.items.map((item, i) => (
            <div key={i} className="flex items-center justify-between gap-4 py-2 first:pt-0 last:pb-0">
              <kbd className="rounded border border-line bg-subtle px-2 py-0.5 font-mono text-xs text-ink-2">
                {item.keys}
              </kbd>
              <span className="text-sm text-ink-2">{item.action}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 border-t border-line pt-2 text-[11px] leading-relaxed text-ink-3">{sg.more}</p>
      </Card>
    </SectionShell>
  );
}

/** 日志级别（与 Rust LogLevel 对应，值为协议常量）。 */
const LOG_LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];

/**
 * 日志分区（docs/tauri-log-config-design-2026-09.md，桌面端专属）：
 * 开关 / 级别 / 只读目录 + 打开 Finder + 恢复默认（决策 D3）/ 最近 200 行预览。
 * 配置真源在 Rust（config.json），本组件只经命令读写，改后即时生效。
 */
function LogsSection({ st }: { st: Messages["settings"] }) {
  const lg = st.logs;
  const [config, setConfig] = useState<LogConfigView>();
  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState<string>();

  const load = async () => {
    try {
      const [cfg, recent] = await Promise.all([logGetConfig(), logReadRecent()]);
      setConfig(cfg);
      setLines(recent);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const update = async (patch: { enabled?: boolean; level?: LogLevel }) => {
    if (!config) return;
    const next = {
      enabled: patch.enabled ?? config.enabled,
      level: patch.level ?? config.level,
      // D3：UI 不提供自定义路径，dir 恒写 null = 默认目录（也承担「恢复默认」）。
      dir: null,
    };
    try {
      const dir = await logSetConfig(next);
      setConfig({ ...config, ...next, dir, lastError: null });
      setError(undefined);
      setLines(await logReadRecent());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <SectionShell title={lg.title} desc={lg.desc}>
      <Card className="space-y-4">
        {/* 开关 */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-ink-1">{lg.enabledLabel}</p>
            <p className="mt-0.5 text-[11px] text-ink-3">{lg.enabledHint}</p>
          </div>
          <div className="flex shrink-0 gap-1 rounded-lg border border-line bg-subtle p-1">
            {(
              [
                [true, "ON"],
                [false, "OFF"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={label}
                type="button"
                data-testid={`settings-log-enabled-${value ? "on" : "off"}`}
                aria-pressed={config?.enabled === value}
                onClick={() => void update({ enabled: value })}
                className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                  config?.enabled === value
                    ? "bg-surface text-primary shadow-sm"
                    : "text-ink-2 hover:text-ink-1"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* 级别 */}
        <div className="flex items-center justify-between gap-4 border-t border-line pt-4">
          <p className="text-sm text-ink-1">{lg.levelLabel}</p>
          <div className="flex shrink-0 gap-1 rounded-lg border border-line bg-subtle p-1">
            {LOG_LEVELS.map((level) => (
              <button
                key={level}
                type="button"
                data-testid={`settings-log-level-${level}`}
                aria-pressed={config?.level === level}
                onClick={() => void update({ level })}
                className={`rounded-md px-2.5 py-1 font-mono text-xs transition-colors ${
                  config?.level === level
                    ? "bg-surface text-primary shadow-sm"
                    : "text-ink-2 hover:text-ink-1"
                }`}
              >
                {level}
              </button>
            ))}
          </div>
        </div>

        {/* 目录（只读，决策 D3） */}
        <div className="space-y-2 border-t border-line pt-4">
          <p className="text-sm text-ink-1">{lg.dirLabel}</p>
          <p className="break-all rounded-lg border border-line bg-subtle/60 px-2.5 py-2 font-mono text-[11px] text-ink-2">
            {config?.dir ?? "…"}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              data-testid="settings-log-open"
              onClick={() => void logOpenDir().catch((e) => setError(e instanceof Error ? e.message : String(e)))}
              className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-2 transition-colors hover:bg-subtle hover:text-ink-1"
            >
              {lg.openDir}
            </button>
            <button
              type="button"
              data-testid="settings-log-reset"
              onClick={() => void update({})}
              className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-2 transition-colors hover:bg-subtle hover:text-ink-1"
            >
              {lg.resetDir}
            </button>
          </div>
        </div>

        {/* 最近日志预览 */}
        <div className="border-t border-line pt-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-ink-1">{lg.previewTitle}</p>
            <button
              type="button"
              data-testid="settings-log-refresh"
              onClick={() => void load()}
              className="rounded-md border border-line px-2.5 py-1 text-xs text-ink-2 transition-colors hover:bg-subtle hover:text-ink-1"
            >
              {lg.refresh}
            </button>
          </div>
          {config?.lastError ? (
            <p className="mt-2 text-xs text-ink-2">
              • {lg.writeError}：{config.lastError}
            </p>
          ) : null}
          <div
            data-testid="settings-log-preview"
            className="mt-2 max-h-64 overflow-auto rounded-lg border border-line bg-subtle/60 p-2 font-mono text-[11px] leading-relaxed text-ink-2"
          >
            {lines.length === 0 ? (
              <p className="text-ink-3">{lg.previewEmpty}</p>
            ) : (
              lines.map((line, i) => (
                <p key={i} className="whitespace-pre-wrap break-all">
                  {line}
                </p>
              ))
            )}
          </div>
        </div>

        {error ? <p className="text-xs text-ink-2">• {error}</p> : null}
      </Card>
    </SectionShell>
  );
}

function AboutSection({ st }: { st: Messages["settings"] }) {
  const ag = st.about;
  return (
    <SectionShell title={ag.title}>
      <Card>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-base font-semibold text-ink-1">{ag.name}</p>
            <p className="text-sm text-ink-2">{ag.tagline}</p>
          </div>
          <span className="rounded border border-line bg-subtle px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-3">
            {ag.badge}
          </span>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-ink-2">{ag.desc}</p>
        <p className="mt-3 border-t border-line pt-3 text-[11px] leading-relaxed text-ink-3">
          {ag.repoNote}
        </p>
      </Card>
    </SectionShell>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-ink-3">{k}</dt>
      <dd className="truncate text-ink-1">{v}</dd>
    </div>
  );
}
