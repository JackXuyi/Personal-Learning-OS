import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Card, SectionTitle } from "../../components/primitives";
import { PageContainer } from "../../components/layout/AppShell";
import { buildActiveProvider, useSettingsStore } from "../../stores/useSettingsStore";
import { useLangStore } from "../../stores/useLangStore";
import { useI18n, type Messages } from "../../i18n";
import { storage } from "../../stores/useLoopStore";
import { labelOfLocalModel, labelOfProvider } from "../../ai/presets";
import AIModelsSection from "./AIModelsSection";

/**
 * 设置（U6b 分区化，docs/ui-workbench-plan-2026-09.md §24-26）。
 *
 * 左分区导航：AI 模型 / 本地存储 / 学习行为 / 外观与语言 / 快捷键 / 关于；
 * 顶部 Local-first 摘要卡（数据留本机 · AI 可选本地或云端）。
 * AI 分区内容 = 原「AI 模型中心」（抽至 AIModelsSection，零功能回退）；
 * Storage 分区展示真实计数（读 storage）；其余分区为说明卡。
 */

type SectionKey = "ai" | "storage" | "learning" | "appearance" | "shortcuts" | "about";

const SECTION_ORDER: SectionKey[] = [
  "ai",
  "storage",
  "learning",
  "appearance",
  "shortcuts",
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
function backendNoteOf(name: string, lf: { storageLocal: string; storageMemory: string }): string {
  return name.includes("local") ? lf.storageLocal : lf.storageMemory;
}

/** 当前 AI 徽标文案（与模型中心同源：active → provider/label）。 */
function modelNoteOf(
  active: ReturnType<typeof useSettingsStore.getState>["active"],
  providerReady: boolean,
  lf: { builtinQwen: string; noModel: string },
): string {
  if (!active) return lf.noModel;
  if (active.source === "local") return `${lf.builtinQwen} · ${labelOfLocalModel(active.model)}`;
  return `${labelOfProvider(active.provider)} · ${active.model || "(未填模型)"}${providerReady ? "" : "（未测试）"}`;
}

export default function SettingsPage() {
  const { m, lang } = useI18n();
  const st = m.settings;
  const langMode = useLangStore((s) => s.mode);
  const setLangMode = useLangStore((s) => s.setMode);
  const active = useSettingsStore((s) => s.active);
  const providerReady = useSettingsStore((s) => s.providerReady);
  const liveReady = active !== null && buildActiveProvider().isConfigured();

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

  const lf = st.localFirst;
  const activeModelNote = modelNoteOf(active, providerReady, lf);

  return (
    <PageContainer>
      <SectionTitle title={m.nav.settings.label} subtitle={m.nav.settings.hint} />

      {/* ── Local-first 摘要卡 ─────────────────────────────────────── */}
      <Card className="mt-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-accent">
          {lf.eyebrow}
        </p>
        <h2 className="mt-0.5 text-lg font-semibold text-ink-1">{lf.title}</h2>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-ink-2">{lf.desc}</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-line bg-subtle/60 px-3 py-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-ink-3">
              {lf.storageNote}
            </p>
            <p className="mt-0.5 flex items-center gap-1.5 text-sm font-medium text-ink-1">
              <span className="h-1.5 w-1.5 rounded-full bg-state-mastered" />
              {backendNoteOf(storage.name, lf)}
            </p>
          </div>
          <div className="rounded-lg border border-line bg-subtle/60 px-3 py-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-ink-3">
              {lf.modelNote}
            </p>
            <p className="mt-0.5 flex items-center gap-1.5 text-sm font-medium text-ink-1">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  active && (providerReady || liveReady) ? "bg-state-mastered" : "bg-state-idle"
                }`}
              />
              <span className="truncate">{activeModelNote}</span>
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setSection("ai")}
          className="mt-3 text-xs font-medium text-accent transition-colors hover:text-accent/70"
        >
          {lf.learnMore} →
        </button>
      </Card>

      {/* ── 分区骨架：左导航 + 右内容 ──────────────────────────────── */}
      <div className="mt-6 grid gap-6 lg:grid-cols-[220px_1fr]">
        <aside className="flex flex-col gap-0.5 self-start lg:sticky lg:top-6">
          {SECTION_ORDER.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setSection(key)}
              className={`rounded-md px-3 py-1.5 text-left text-sm transition-colors ${
                section === key
                  ? "bg-subtle font-medium text-ink-1"
                  : "text-ink-2 hover:bg-subtle hover:text-ink-1"
              }`}
            >
              {st.sections[key]}
            </button>
          ))}
        </aside>

        <div className="min-w-0">
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
          ) : (
            <AboutSection st={st} />
          )}
        </div>
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
          <KV k={sg.backend} v={backendNoteOf(storage.name, st.localFirst)} />
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
                  ? "bg-surface text-accent shadow-sm"
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
