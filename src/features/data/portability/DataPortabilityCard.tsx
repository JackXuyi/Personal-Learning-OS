/**
 * 数据可携带卡片（设置 → 本地存储）—— 导出 / 导入 / 单章 Markdown
 * （方案 docs/data-portability-export-import-design-2026-09.md §5 / §7 / §8.12）。
 *
 * 约定：
 *  - 文案全部走 i18n；**错误只存分类**，渲染时才映射文案（服务层只产 enum）；
 *  - 不新增 store、不新增持久化 key：导出 / 导入是一次性动作，状态留在组件里；
 *  - 导入完成后必须刷新既有 store（`storage` 是模块级单例，其他页面持有内存镜像，
 *    不刷新就会出现「首页还显示旧计划、资料库还显示旧文档」）。
 */
import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { Card } from "../../../components/primitives";
import { Button } from "../../../components/ui/button";
import { Checkbox } from "../../../components/ui/checkbox";
import { ConfirmDialog } from "../../../components/ui/confirm-dialog";
import { Select } from "../../../components/ui/select";
import { Spinner } from "../../../components/ui/spinner";
import { useI18n } from "../../../i18n";
import type { Messages } from "../../../i18n";
import { storage, useLoopStore } from "../../../stores/useLoopStore";
import { useIndexStore } from "../../../stores/useIndexStore";
import { decodeBytes } from "../../learn/import/decode";
import {
  COUNT_KEYS,
  chapterMarkdownName,
  defaultBackupName,
  humanBytes,
  parseBackup,
  preImportBackupName,
} from "./backup-format";
import type { BackupFile, EntityCounts } from "./backup-format";
import { backupDir, backupList, backupRead, backupReveal, backupSave, downloadText, isDesktopBackupAvailable } from "./desktop-backup";
import type { BackupEntry } from "./desktop-backup";
import { exportBackup } from "./export-service";
import { importBackup } from "./import-service";
import type { ImportErrorKind, ImportStats } from "./import-service";
import { chapterBodyOf, chapterToMarkdown } from "./markdown-export";

/** 卡片需要的本机数据规模（由设置页读取后传入，避免同屏读两遍库）。 */
export interface PortabilityCounts {
  docs: number;
  chapters: number;
  papers: number;
  goals: number;
  evidence: number;
}

interface Props {
  counts?: PortabilityCounts;
  /** 导入成功后通知父级重算数据规模（导入会换掉整库内容）。 */
  onDataChanged?: () => void;
}

type Busy = "export" | "import" | "md";

/** 落盘结果（导出 / Markdown 共用）。 */
interface SaveInfo {
  name: string;
  bytes: number;
  /** 桌面端：绝对路径；浏览器：undefined（走下载）。 */
  path?: string;
}

export default function DataPortabilityCard({ counts, onDataChanged }: Props) {
  const { m } = useI18n();
  const d = m.settings.storage.data;
  const desktop = isDesktopBackupAvailable();

  const [busy, setBusy] = useState<Busy>();
  const [saved, setSaved] = useState<SaveInfo>();
  const [exportNote, setExportNote] = useState<string>();
  const [error, setError] = useState<ImportErrorKind | "unknown">();
  const [pendingRaw, setPendingRaw] = useState<string>();
  const [pending, setPending] = useState<BackupFile>();
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [ownBackup, setOwnBackup] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [stats, setStats] = useState<ImportStats>();
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [dir, setDir] = useState<string>();

  // 单章 Markdown 的两级选择
  const [docs, setDocs] = useState<{ id: string; title: string }[]>([]);
  const [docId, setDocId] = useState("");
  const [chapters, setChapters] = useState<{ id: string; title: string }[]>([]);
  const [chapterId, setChapterId] = useState("");
  const [mdSaved, setMdSaved] = useState<SaveInfo>();

  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadDocs();
    if (desktop) void loadBackups();
    // 仅在挂载时读一次（卡片随「本地存储」分区挂载/卸载）。
  }, [desktop]);

  // 切换资料时重取章列表（两级联动的唯一真源是 storage）。
  useEffect(() => {
    void (async () => {
      if (!docId) {
        setChapters([]);
        setChapterId("");
        return;
      }
      try {
        const list = await storage.listChapters(docId);
        setChapters(list.map((c) => ({ id: c.id, title: c.title })));
        setChapterId(list[0]?.id ?? "");
      } catch {
        setChapters([]);
        setChapterId("");
      }
    })();
  }, [docId]);

  async function loadDocs() {
    try {
      const list = await storage.listDocuments();
      setDocs(list.map((x) => ({ id: x.id, title: x.title })));
      setDocId((prev) => (prev && list.some((x) => x.id === prev) ? prev : (list[0]?.id ?? "")));
    } catch {
      setDocs([]);
    }
  }

  async function loadBackups() {
    try {
      const [path, list] = await Promise.all([backupDir(), backupList()]);
      setDir(path);
      setBackups(list);
    } catch {
      setBackups([]);
    }
  }

  /* ---------------- 导出 ---------------- */

  async function onExport() {
    setBusy("export");
    setError(undefined);
    setSaved(undefined);
    setExportNote(undefined);
    try {
      const { json, file, snapshot } = await exportBackup(storage);
      const name = defaultBackupName();
      const bytes = new Blob([json]).size;
      if (desktop) {
        setSaved({ name, bytes, path: await backupSave(name, json) });
        void loadBackups();
      } else {
        downloadText(name, json);
        setSaved({ name, bytes });
      }
      if (isEmptyCounts(file.counts)) setExportNote(d.exportEmpty);
      const orphans = snapshot.orphanUnits + snapshot.orphanRelations + snapshot.orphanEmbeddings;
      if (orphans > 0) setExportNote(d.exportOrphans(orphans));
    } catch {
      setError("unknown");
    } finally {
      setBusy(undefined);
    }
  }

  /* ---------------- 导入 ---------------- */

  async function onPickFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // 允许重复选同一个文件（不清空 input，第二次 change 不触发）。
    event.target.value = "";
    if (!file) return;
    try {
      const raw = decodeBytes(await file.arrayBuffer()).text;
      openPreview(raw);
    } catch {
      setError("not-json");
      setPending(undefined);
      setPendingRaw(undefined);
    }
  }

  async function onPickRecent(name: string) {
    setError(undefined);
    try {
      openPreview(await backupRead(name));
    } catch {
      setError("unknown");
    }
  }

  /** 解析并进入预览态；解析失败**零写入**（校验在 clearAll 之前）。 */
  function openPreview(raw: string) {
    setStats(undefined);
    setSaved(undefined);
    setExportNote(undefined);
    const parsed = parseBackup(raw);
    if (!parsed.ok) {
      setError(parsed.kind);
      setPending(undefined);
      setPendingRaw(undefined);
      return;
    }
    setError(undefined);
    setPending(parsed.file);
    setPendingRaw(raw);
    setMode("merge");
    setOwnBackup(false);
  }

  async function runImport() {
    if (!pendingRaw || !pending) return;
    setConfirming(false);
    setBusy("import");
    setError(undefined);
    try {
      const outcome = await importBackup(storage, pendingRaw, {
        mode,
        // 桌面端才具备自动预备份；浏览器端由「我已自行备份」勾选兜底。
        preBackup: desktop ? (json) => backupSave(preImportBackupName(), json) : undefined,
      });
      if (!outcome.ok) {
        setError(outcome.kind);
        if (outcome.partial) setStats(outcome.partial);
        return;
      }
      setStats(outcome.stats);
      setPending(undefined);
      setPendingRaw(undefined);
      await refreshAfterImport();
      onDataChanged?.();
      void loadDocs();
      if (desktop) void loadBackups();
    } catch {
      setError("unknown");
    } finally {
      setBusy(undefined);
    }
  }

  /**
   * 导入后刷新：`storage` 是模块级单例，各页面持有它的内存镜像 —— 不刷新就会
   * 出现「首页还显示旧计划、资料库还显示旧文档」的脏状态（UC-07）。
   */
  async function refreshAfterImport() {
    try {
      await useLoopStore.getState().refresh(m);
    } catch {
      /* 刷新失败不回滚导入：数据已落库，页面重进即可 */
    }
    try {
      await useIndexStore.getState().refreshCoverage();
    } catch {
      /* 覆盖率是派生统计，失败不影响已写入的数据 */
    }
  }

  /* ---------------- 单章 Markdown ---------------- */

  async function onExportMarkdown() {
    if (!docId || !chapterId) return;
    setBusy("md");
    setError(undefined);
    setMdSaved(undefined);
    try {
      const [doc, list] = await Promise.all([
        storage.getDocument(docId),
        storage.listChapters(docId),
      ]);
      const chapter = list.find((c) => c.id === chapterId);
      if (!doc || !chapter) {
        setError("unknown");
        return;
      }
      const text = chapterToMarkdown({
        chapter,
        body: chapterBodyOf(doc, chapter),
        pointsHeading: d.mdPointsHeading,
      });
      const name = chapterMarkdownName();
      const bytes = new Blob([text]).size;
      if (desktop) {
        setMdSaved({ name, bytes, path: await backupSave(name, text) });
        void loadBackups();
      } else {
        downloadText(name, text, "text/markdown");
        setMdSaved({ name, bytes });
      }
    } catch {
      setError("unknown");
    } finally {
      setBusy(undefined);
    }
  }

  /* ---------------- 渲染 ---------------- */

  const fileCountsLabel = countsText(d, pending?.counts);
  const localCountsLabel = countsText(d, localCounts(counts));
  const replaceNeedsOwnBackup = !desktop && mode === "replace";
  const canImport = !busy && !!pendingRaw && (!replaceNeedsOwnBackup || ownBackup);

  return (
    <Card className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-ink-1">{d.title}</h3>
        <p className="mt-0.5 text-[11px] leading-relaxed text-ink-2">{d.desc}</p>
      </div>

      {/* ── 导出完整备份 ── */}
      <div className="border-t border-line pt-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-ink-1">{d.exportTitle}</p>
            <p className="mt-0.5 text-[11px] text-ink-3">
              {counts ? d.exportHint(localCountsLabel) : "…"}
            </p>
          </div>
          <Button
            type="button"
            data-testid="settings-data-export"
            disabled={!!busy}
            onClick={() => void onExport()}
          >
            {busy === "export" ? <Spinner className="size-3.5" /> : null}
            {busy === "export" ? d.exporting : d.export}
          </Button>
        </div>
        {saved ? (
          <p data-testid="settings-data-export-done" className="mt-2 break-all text-xs text-ink-2">
            ✓ {saved.path ? d.exportDonePath(saved.path) : d.exportDoneDownload}（{saved.name} ·{" "}
            {humanBytes(saved.bytes)}）
          </p>
        ) : null}
        {exportNote ? <p className="mt-1 text-xs text-ink-3">• {exportNote}</p> : null}
        {desktop && saved?.path ? (
          <button
            type="button"
            data-testid="settings-data-reveal"
            onClick={() => void backupReveal(saved.path!).catch(() => setError("unknown"))}
            className="mt-1.5 rounded-md border border-line px-2.5 py-1 text-xs text-ink-2 transition-colors hover:bg-subtle hover:text-ink-1"
          >
            {d.reveal}
          </button>
        ) : null}
      </div>

      {/* ── 从备份导入 ── */}
      <div className="border-t border-line pt-3">
        <p className="text-sm text-ink-1">{d.importTitle}</p>
        <p className="mt-0.5 text-[11px] text-ink-3">{d.importHint}</p>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => void onPickFile(e)}
        />
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            data-testid="settings-data-import"
            disabled={!!busy}
            onClick={() => fileInput.current?.click()}
            className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-2 transition-colors hover:bg-subtle hover:text-ink-1 disabled:opacity-50"
          >
            {d.importPick}
          </button>
        </div>

        {/* 导入预览态（已解析、未确认） */}
        {pending ? (
          <div className="mt-3 space-y-2 rounded-lg border border-line bg-subtle/60 p-3">
            <p className="text-xs font-medium text-ink-1">{d.importPreviewTitle}</p>
            <p className="text-[11px] text-ink-3">
              {d.previewMeta(
                pending.backend,
                pending.exportVersion,
                new Date(pending.exportedAt).toLocaleString(),
              )}
            </p>
            <p data-testid="settings-data-preview-counts" className="text-xs text-ink-2">
              {fileCountsLabel || d.exportEmpty}
            </p>

            <div className="border-t border-line pt-2">
              <p className="text-[11px] font-medium text-ink-3">{d.modeLabel}</p>
              <div className="mt-1.5 space-y-1.5">
                <ModeOption
                  value="merge"
                  current={mode}
                  label={d.modeMerge}
                  hint={d.modeMergeHint}
                  onSelect={setMode}
                />
                <ModeOption
                  value="replace"
                  current={mode}
                  label={d.modeReplace}
                  hint={d.modeReplaceHint}
                  warn={d.replaceWarn}
                  onSelect={setMode}
                />
              </div>
            </div>

            {replaceNeedsOwnBackup ? (
              <label className="flex cursor-pointer items-start gap-2 border-t border-line pt-2 text-[11px] text-ink-2">
                <Checkbox
                  data-testid="settings-data-own-backup"
                  checked={ownBackup}
                  onCheckedChange={(v) => setOwnBackup(v === true)}
                />
                <span>
                  {d.needOwnBackup}
                  <span className="mt-0.5 block text-ink-3">{d.needOwnBackupLabel}</span>
                </span>
              </label>
            ) : null}

            <div className="flex gap-2 border-t border-line pt-2">
              <Button
                type="button"
                data-testid="settings-data-start-import"
                disabled={!canImport}
                onClick={() => (mode === "replace" ? setConfirming(true) : void runImport())}
              >
                {busy === "import" ? <Spinner className="size-3.5" /> : null}
                {busy === "import" ? d.importing : d.startImport}
              </Button>
              <button
                type="button"
                disabled={!!busy}
                onClick={() => {
                  setPending(undefined);
                  setPendingRaw(undefined);
                }}
                className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-2 transition-colors hover:bg-subtle hover:text-ink-1 disabled:opacity-50"
              >
                {d.cancel}
              </button>
            </div>
          </div>
        ) : null}

        {/* 结果态（成功统计 / 中途失败的部分统计） */}
        {stats ? <StatsPanel stats={stats} m={m} onReveal={(p) => void backupReveal(p).catch(() => setError("unknown"))} /> : null}

        {/* 最近备份（桌面端专属：浏览器没有固定目录） */}
        {desktop ? (
          <div className="mt-3 border-t border-line pt-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] font-medium text-ink-3">{d.backupsTitle}</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  data-testid="settings-data-refresh-backups"
                  onClick={() => void loadBackups()}
                  className="rounded-md border border-line px-2 py-0.5 text-[11px] text-ink-3 transition-colors hover:bg-subtle hover:text-ink-1"
                >
                  {d.backupsRefresh}
                </button>
                <button
                  type="button"
                  data-testid="settings-data-open-dir"
                  onClick={() => void backupDir().then((p) => backupReveal(p)).catch(() => setError("unknown"))}
                  className="rounded-md border border-line px-2 py-0.5 text-[11px] text-ink-3 transition-colors hover:bg-subtle hover:text-ink-1"
                >
                  {d.openDir}
                </button>
              </div>
            </div>
            {dir ? (
              <p className="mt-1 break-all font-mono text-[11px] text-ink-3">
                {d.backupDirLabel}：{dir}
              </p>
            ) : null}
            <div data-testid="settings-data-backups" className="mt-1.5">
              {backups.length === 0 ? (
                <p className="text-[11px] text-ink-3">{d.backupsEmpty}</p>
              ) : (
                <ul className="divide-y divide-line">
                  {backups.map((entry) => (
                    <li key={entry.name} className="flex items-center justify-between gap-3 py-1.5">
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-2">
                        {entry.name}
                      </span>
                      <span className="shrink-0 text-[11px] text-ink-3">
                        {humanBytes(entry.bytes)}
                      </span>
                      <button
                        type="button"
                        data-testid={`settings-data-recent-${entry.name}`}
                        disabled={!!busy}
                        onClick={() => void onPickRecent(entry.name)}
                        className="shrink-0 rounded-md border border-line px-2 py-0.5 text-[11px] text-ink-2 transition-colors hover:bg-subtle hover:text-ink-1 disabled:opacity-50"
                      >
                        {d.importFromList}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {/* ── 单章 Markdown ── */}
      <div data-testid="settings-data-md-section" className="border-t border-line pt-3">
        <p className="text-sm text-ink-1">{d.mdTitle}</p>
        <p className="mt-0.5 text-[11px] text-ink-3">{d.mdDesc}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Select
            value={docId}
            onValueChange={setDocId}
            ariaLabel={d.mdPickDoc}
            className="h-8 w-52 text-xs"
            options={docs.map((x) => ({ value: x.id, label: x.title }))}
          />
          <Select
            value={chapterId}
            onValueChange={setChapterId}
            ariaLabel={d.mdPickChapter}
            className="h-8 w-52 text-xs"
            disabled={chapters.length === 0}
            options={chapters.map((x) => ({ value: x.id, label: x.title }))}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="settings-data-md-button"
            disabled={!!busy || !chapterId}
            onClick={() => void onExportMarkdown()}
          >
            {busy === "md" ? <Spinner className="size-3.5" /> : null}
            {d.mdExport}
          </Button>
        </div>
        {docs.length === 0 ? <p className="mt-1.5 text-[11px] text-ink-3">{d.mdNoChapters}</p> : null}
        {mdSaved ? (
          <p className="mt-1.5 break-all text-xs text-ink-2">
            ✓ {mdSaved.path ? d.exportDonePath(mdSaved.path) : d.exportDoneDownload}（{mdSaved.name} ·{" "}
            {humanBytes(mdSaved.bytes)}）
          </p>
        ) : null}
      </div>

      {/* 明文提醒：备份里有全部笔记，别随手发给别人（§12.2）。 */}
      <p className="border-t border-line pt-3 text-[11px] leading-relaxed text-ink-3">{d.notice}</p>

      {error ? (
        <p data-testid="settings-data-error" className="text-xs text-ink-2">
          • {errorText(error, stats, d)}
        </p>
      ) : null}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        destructive
        title={d.confirmReplaceTitle}
        description={d.confirmReplaceBody(fileCountsLabel, localCountsLabel)}
        confirmLabel={d.modeReplace}
        cancelLabel={d.cancel}
        onConfirm={() => void runImport()}
      />
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* 局部组件与纯辅助                                                     */
/* ------------------------------------------------------------------ */

function ModeOption({
  value,
  current,
  label,
  hint,
  warn,
  onSelect,
}: {
  value: "merge" | "replace";
  current: "merge" | "replace";
  label: string;
  hint: string;
  warn?: string;
  onSelect: (v: "merge" | "replace") => void;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      data-testid={`settings-data-mode-${value}`}
      onClick={() => onSelect(value)}
      className={`flex w-full items-start gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors ${
        active ? "border-primary/50 bg-surface" : "border-line hover:bg-subtle"
      }`}
    >
      <span
        aria-hidden
        className={`mt-[3px] size-3 shrink-0 rounded-full border ${
          active ? "border-primary bg-primary" : "border-line"
        }`}
      />
      <span className="min-w-0">
        <span className="text-xs text-ink-1">
          {label}
          {warn ? <span className="ml-1.5 text-[10px] text-state-failed">⚠ {warn}</span> : null}
        </span>
        <span className="mt-0.5 block text-[11px] text-ink-3">{hint}</span>
      </span>
    </button>
  );
}

function StatsPanel({
  stats,
  m,
  onReveal,
}: {
  stats: ImportStats;
  m: Messages;
  onReveal: (path: string) => void;
}) {
  const d = m.settings.storage.data;
  const written = countsText(d, stats.written);
  return (
    <div
      data-testid="settings-data-stats"
      className="mt-3 space-y-1 rounded-lg border border-line bg-subtle/60 p-3 text-xs text-ink-2"
    >
      <p className="font-medium text-ink-1">
        {d.importDone(stats.mode === "replace" ? d.modeReplace : d.modeMerge)}
      </p>
      <p>{d.statsWritten(written || "—")}</p>
      {stats.learnerStateKept + stats.cardStatesOverwritten > 0 ? (
        <p>{d.statsKept(stats.learnerStateKept + stats.cardStatesOverwritten)}</p>
      ) : null}
      <p>{d.statsSkipped(stats.evidenceSkipped, stats.orphansSkipped)}</p>
      {stats.evidenceDropped > 0 ? <p>{d.statsDropped(stats.evidenceDropped)}</p> : null}
      {stats.preBackupPath ? (
        <div className="break-all">
          <p className="font-mono text-[11px]">{d.preBackup(stats.preBackupPath)}</p>
          <button
            type="button"
            onClick={() => onReveal(stats.preBackupPath!)}
            className="mt-1 rounded-md border border-line px-2 py-0.5 text-[11px] text-ink-2 transition-colors hover:bg-subtle hover:text-ink-1"
          >
            {d.reveal}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** 条数串：`资料 3 · 章节 44 · …`；0 值不展示（避免一屏 0）。 */
function countsText(
  d: Messages["settings"]["storage"]["data"],
  counts: Partial<EntityCounts> | undefined,
): string {
  if (!counts) return "";
  return COUNT_KEYS.filter((k) => (counts[k] ?? 0) > 0)
    .map((k) => `${d.countLabels[k]} ${counts[k]}`)
    .join(" · ");
}

/** 设置页传入的规模快照 → EntityCounts 子集（只映射它真读了的 5 项）。 */
function localCounts(counts: PortabilityCounts | undefined): Partial<EntityCounts> {
  if (!counts) return {};
  return {
    documents: counts.docs,
    chapters: counts.chapters,
    papers: counts.papers,
    goals: counts.goals,
    evidence: counts.evidence,
  };
}

function isEmptyCounts(counts: EntityCounts): boolean {
  return COUNT_KEYS.every((k) => counts[k] === 0);
}

/** 错误分类 → 文案（服务层只回分类，这里是唯一的映射点）。 */
function errorText(
  kind: ImportErrorKind | "unknown",
  stats: ImportStats | undefined,
  d: Messages["settings"]["storage"]["data"],
): string {
  switch (kind) {
    case "not-json":
      return d.errNotJson;
    case "not-backup":
      return d.errNotBackup;
    case "version-newer":
      return d.errVersionNewer(0);
    case "unsupported-version":
      return d.errUnsupportedVersion;
    case "corrupt":
      return d.errCorrupt;
    case "sqlite-blocked":
      return d.errSqliteBlocked;
    case "quota":
      return d.errQuota;
    case "write-failed":
      return d.errWriteFailed(countsText(d, stats?.written) || "—");
    default:
      return d.errUnknown;
  }
}
