/**
 * 导入资料 Modal（V2 章节式导入，T5；UI Workbench U5 翻新）—— 全产品统一入库入口。
 *
 * V3 变更（docs/knowledge-import-design-2026-09.md，多来源导入）：
 * - 顶部新增三来源 Tab：粘贴（现状回归）/ 本地文件 / GitHub；
 * - 本地 / GitHub 面板只负责「来源准备」，真正导入统一走底部主按钮 → 共享管道
 *   （import/pipeline.ts：save → split → refine → saveChapters）；
 * - 单份导入沿用 U5 五阶段进度 + 单份结果卡；批量导入显示「正在导入 i/n · title」
 *   文件级进度 + 汇总卡（✓ 每份 n 章 / ✗ 失败原因）；
 * - 结果动作：单份成功 → [开始学习] 直达首章（现状）；批量/仅保存 → 回资料库目录。
 *
 * 说明：阶段标签为 UX 反馈文案，与实际流水线（save → split → refine →
 * saveChapters）映射，不新造引擎能力（方案约束：不绑架 Domain）。
 */
import { useState } from "react";
import type { DocumentFormat, SourceDocument } from "../../domain";
import { newId } from "../../domain";
import { buildActiveProvider } from "../../stores/useSettingsStore";
import { storage } from "../../stores/useLoopStore";
import { useI18n } from "../../i18n";
import LocalFilePanel from "./import/LocalFilePanel";
import GithubPanel from "./import/GithubPanel";
import type { ImportTab, ImportUnit, ImportSummary } from "./import/types";
import { runUnitImport, runBatchImport } from "./import/pipeline";
import { fileToUnit } from "./import/local-files";
import { buildGithubUnit } from "./import/github";
import type { GithubPreview } from "./import/github";
import type { ImportPhaseKey } from "./import/pipeline";

type PhaseStatus = "pending" | "active" | "done";

const PHASE_ORDER: ImportPhaseKey[] = ["read", "detect", "refine", "create", "link"];

/** 单份导入的阶段最小可见时长（保持 U5 观感；批量导入不延迟，加速队列）。 */
const MIN_PHASE_MS = 160;

interface ImportModalProps {
  /** 关闭（不写入）。 */
  onClose: () => void;
  /** 写入完成（返回新文档 id 与章节 id，供 AppShell 跳转首章）。 */
  onImported: (docId: string, chapterIds: string[]) => void;
  /** 结果卡「检查结构」/批量完成：关闭并回到资料库目录核对。 */
  onInspect?: () => void;
}

/** 单份成功结果（结果卡状态机数据）。 */
interface SingleResult {
  docId: string;
  docTitle: string;
  chapterIds: string[];
  chapterTitles: string[];
  /** 是否经过 AI 精修（标题/要点/过碎合并）。 */
  refined: boolean;
  /** AI 自动合并的过碎小节数。 */
  merged: number;
  /** 全资料要点总数。 */
  totalPoints: number;
}

export default function ImportModal({ onClose, onImported, onInspect }: ImportModalProps) {
  const { m } = useI18n();
  const fmt = m.learn.import;
  const phasesI18n = fmt.phaseLabel;

  const [tab, setTab] = useState<ImportTab>("paste");
  /** 当前运行模式：single（五阶段 + 单份卡）| batch（文件级进度 + 汇总卡）。 */
  const [runMode, setRunMode] = useState<"single" | "batch">();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | undefined>();
  const [phases, setPhases] = useState<PhaseStatus[]>(() => PHASE_ORDER.map(() => "pending"));
  /** 批量文件级进度：i / total / title。 */
  const [batchTick, setBatchTick] = useState<{ i: number; total: number; title: string }>();
  /** 单份结果卡数据（单份导入成功后置）。 */
  const [single, setSingle] = useState<SingleResult>();
  /** 批量汇总（多份导入后置；failed 含预转换失败与管道失败）。 */
  const [summary, setSummary] = useState<ImportSummary>();

  // --- 粘贴 Tab 表单状态（回归基线，现状字段） ---
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [format, setFormat] = useState<DocumentFormat>("markdown");
  const FORMAT_OPTIONS: { value: DocumentFormat; label: string; split: ImportUnit["splitFormat"] }[] = [
    { value: "markdown", label: "Markdown", split: "markdown" },
    { value: "note", label: fmt.formatNote, split: "auto" },
    { value: "web", label: fmt.formatWeb, split: "auto" },
    { value: "txt", label: fmt.formatTxt, split: "txt" },
  ];
  const splitFormat = FORMAT_OPTIONS.find((o) => o.value === format)?.split ?? "auto";

  // --- 本地 / GitHub 面板提升状态 ---
  const [localFiles, setLocalFiles] = useState<File[]>([]);
  const [ghPreview, setGhPreview] = useState<GithubPreview | undefined>();

  const setPhase = (key: ImportPhaseKey, status: PhaseStatus) =>
    setPhases((prev) => prev.map((s, i) => (PHASE_ORDER[i] === key ? status : s)));

  const resetRun = () => {
    setNotice(undefined);
    setPhases(PHASE_ORDER.map(() => "pending"));
    setBatchTick(undefined);
    setSingle(undefined);
    setSummary(undefined);
  };

  /** 单份导入：U5 五阶段 + 单份结果卡。 */
  async function runSingleImport(unit: ImportUnit) {
    setRunMode("single");
    setBusy(true);
    resetRun();
    try {
      const result = await runUnitImport(unit, {
        storage,
        provider: buildActiveProvider(),
        minPhaseMs: MIN_PHASE_MS,
        onPhase: (key, status) => setPhase(key, status),
      });
      setSingle({
        docId: result.docId,
        docTitle: result.unit.title,
        chapterIds: result.chapterIds,
        chapterTitles: result.chapterTitles,
        refined: result.refined,
        merged: result.merged,
        totalPoints: result.totalPoints,
      });
      if (result.chapterIds.length === 0) setNotice(fmt.tooShort);
    } catch (err) {
      setNotice(fmt.splitFail(err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  }

  /** 批量导入：文件级进度 + 汇总卡（单份失败不阻断队列）。 */
  async function runBatch(units: readonly ImportUnit[], preFailed: { title: string; reason: string }[]) {
    setRunMode("batch");
    setBusy(true);
    resetRun();
    try {
      const out = await runBatchImport(units, {
        storage,
        provider: buildActiveProvider(),
        minPhaseMs: 0,
        onUnitStart: (i, total, unit) => setBatchTick({ i, total, title: unit.title }),
      });
      setSummary({
        ok: out.ok,
        failed: [...preFailed, ...out.failed],
      });
    } catch (err) {
      setNotice(fmt.splitFail(err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  }

  // --- 主按钮动作：按 Tab 组装 ImportUnit 后交给共享执行器 ---
  async function runTabAction() {
    if (busy) return;
    if (tab === "paste") {
      const body = content.trim();
      if (!body) return;
      await runSingleImport({
        title: title.trim() || fmt.unnamedDoc,
        format,
        splitFormat,
        text: body,
      });
      return;
    }
    if (tab === "local") {
      if (localFiles.length === 0) return;
      // 预转换：把 File 归一化为 ImportUnit；转换失败（扫描件/读取失败）计入 failed。
      const units: ImportUnit[] = [];
      const failed: { title: string; reason: string }[] = [];
      for (const file of localFiles) {
        const out = await fileToUnit(file);
        if ("error" in out) failed.push({ title: file.name, reason: out.message });
        else units.push(out);
      }
      if (units.length === 0) {
        setNotice(fmt.batch.allFailed);
        return;
      }
      // 1 份成功且无失败 → 单份体验（结果卡可直达首章）；否则批量汇总。
      if (units.length === 1 && failed.length === 0) await runSingleImport(units[0]);
      else await runBatch(units, failed);
      return;
    }
    // github：解析预览已有 → 拉取正文并合并为一份资料。
    if (ghPreview) {
      setNotice(undefined);
      try {
        const unit = await buildGithubUnit((input, init) => fetch(input, init), ghPreview);
        await runSingleImport(unit);
      } catch (err) {
        setNotice(err instanceof Error ? err.message : String(err));
      }
    }
  }

  /** 仅保存资料（粘贴 Tab，不切分章节）。 */
  const saveDocOnly = async () => {
    const body = content.trim();
    if (!body) return;
    setBusy(true);
    setNotice(undefined);
    try {
      const doc: SourceDocument = {
        id: newId("doc"),
        title: title.trim() || fmt.unnamedDoc,
        format,
        importedAt: Date.now(),
        status: "ready",
        textPreview: body,
      };
      await storage.saveDocument(doc);
      setNotice(fmt.savedDoc(doc.title));
    } finally {
      setBusy(false);
    }
  };

  // --- 底部主按钮启用条件 / 文案 ---
  const primaryLabel = busy
    ? fmt.busy
    : tab === "local"
      ? fmt.local.import(localFiles.length)
      : fmt.saveSplit;
  const primaryDisabled =
    busy ||
    (tab === "paste" && !content.trim()) ||
    (tab === "local" && localFiles.length === 0) ||
    (tab === "github" && !ghPreview);

  // 完成态：单份结果卡（含章）→ 开始学习直达首章；否则回资料库。
  const done = single || summary;
  const singleWithChapters = single && single.chapterIds.length > 0;
  const finishedOk = (done && !busy) || false;

  const switchTab = (next: ImportTab) => {
    if (busy) return;
    setTab(next);
    resetRun();
  };

  const renderSourceArea = () => {
    if (tab === "local") {
      return (
        <LocalFilePanel
          files={localFiles}
          onFilesChange={setLocalFiles}
          disabled={busy}
        />
      );
    }
    if (tab === "github") {
      return (
        <GithubPanel
          onPreview={(p) => setGhPreview(p ?? undefined)}
          disabled={busy}
        />
      );
    }
    // 粘贴（现状表单）
    return (
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">
          {fmt.stepSource(1)}
        </p>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={fmt.titlePlaceholder}
          disabled={busy}
          className="w-full rounded-lg border border-line bg-app-bg px-3 py-2 text-sm text-ink-1 outline-none transition-colors placeholder:text-ink-3 focus:border-accent disabled:opacity-50"
        />
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={fmt.bodyPlaceholder}
          rows={8}
          disabled={busy}
          className="w-full resize-y rounded-lg border border-line bg-app-bg px-3 py-2 font-mono text-xs leading-relaxed text-ink-1 outline-none transition-colors placeholder:text-ink-3 focus:border-accent disabled:opacity-50"
        />
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-3">{fmt.format}</span>
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value as DocumentFormat)}
            disabled={busy}
            className="rounded-lg border border-line bg-surface px-2 py-1 text-sm text-ink-1 outline-none transition-colors focus:border-accent disabled:opacity-50"
          >
            {FORMAT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {content.trim() && !busy && !done ? (
            <button
              onClick={saveDocOnly}
              className="ml-auto rounded-lg border border-line px-3 py-1 text-xs text-ink-2 transition-colors hover:bg-subtle hover:text-ink-1"
            >
              {fmt.saveOnly}
            </button>
          ) : null}
        </div>
      </div>
    );
  };

  const renderProgress = () => {
    if (!busy) return null;
    if (runMode === "batch" && batchTick) {
      // 文件级进度：正在导入 i/n · title
      return (
        <div className="rounded-xl border border-line bg-subtle/60 px-4 py-3">
          <p className="text-sm font-semibold text-ink-1">{fmt.progressTitle}</p>
          <p className="mt-1 flex items-center gap-2 text-sm text-ink-2">
            <span className="mt-1 h-3 w-3 shrink-0 animate-spin rounded-full border border-accent/30 border-t-accent" />
            <span className="min-w-0 truncate">
              {fmt.batch.importing(batchTick.i, batchTick.total, batchTick.title)}
            </span>
          </p>
        </div>
      );
    }
    // 单份五阶段（U5 观感保留）
    return (
      <div className="rounded-xl border border-line bg-subtle/60 px-4 py-3">
        <p className="text-sm font-semibold text-ink-1">{fmt.progressTitle}</p>
        <ul className="mt-2 space-y-1.5">
          {PHASE_ORDER.map((key, i) => {
            const status = phases[i];
            return (
              <li key={key} className="flex items-start gap-2.5">
                <PhaseIcon status={status} />
                <span className="min-w-0">
                  <span
                    className={`block text-sm ${
                      status === "done"
                        ? "text-ink-2"
                        : status === "active"
                          ? "font-medium text-ink-1"
                          : "text-ink-3"
                    }`}
                  >
                    {phasesI18n[key]}
                  </span>
                  <span className="block text-xs text-ink-3">{fmt.phaseHint[key]}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    );
  };

  const renderResult = () => {
    if (busy) return null;
    // 单份结果卡
    if (single) {
      const structureNote =
        single.chapterIds.length > 0
          ? single.merged > 0
            ? fmt.mergedN(single.merged)
            : single.refined
              ? fmt.structureRefined
              : fmt.structureLocal
          : undefined;
      return (
        <div className="rounded-xl border border-line bg-subtle/60 px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink-1">
            <span className="text-state-mastered">✓</span>
            <span>
              {single.chapterIds.length > 0
                ? fmt.resultTitle(single.docTitle)
                : fmt.savedDoc(single.docTitle)}
            </span>
          </p>
          {single.chapterIds.length > 0 ? (
            <>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-2">
                <span className="tabular-nums">{fmt.statChapter(single.chapterIds.length)}</span>
                <span className="tabular-nums">{fmt.statPoints(single.totalPoints)}</span>
                {structureNote ? <span className="text-ink-3">{structureNote}</span> : null}
              </div>
              <ol className="mt-2 max-h-40 list-decimal space-y-1 overflow-y-auto pl-5 text-xs text-ink-2">
                {single.chapterTitles.map((t, i) => (
                  <li key={`${t}-${i}`}>{t || m.chapter.ordinal(i + 1)}</li>
                ))}
              </ol>
            </>
          ) : (
            <p className="mt-1 text-xs text-state-weak">{fmt.noSplitWarn}</p>
          )}
        </div>
      );
    }
    // 批量汇总卡
    if (summary) {
      return (
        <div className="rounded-xl border border-line bg-subtle/60 px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink-1">
            <span className="text-state-mastered">✓</span>
            <span>
              {fmt.batch.summaryTitle(
                summary.ok.length,
                summary.failed.length,
              )}
            </span>
          </p>
          <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
            {summary.ok.map((r) => (
              <li key={r.docId} className="flex items-center gap-2 text-xs text-ink-2">
                <span className="text-state-mastered">✓</span>
                <span className="min-w-0 flex-1 truncate">{r.unit.title}</span>
                <span className="shrink-0 tabular-nums text-ink-3">
                  {fmt.statChapter(r.chapterIds.length)}
                </span>
              </li>
            ))}
            {summary.failed.map((f, i) => (
              <li key={`${f.title}-${i}`} className="flex items-start gap-2 text-xs text-state-weak">
                <span>✗</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{f.title}</span>
                  <span className="block text-ink-3">{f.reason}</span>
                </span>
              </li>
            ))}
          </ul>
          {summary.failed.length > 0 ? (
            <p className="mt-1.5 text-xs text-state-weak">
              {fmt.batch.failedN(summary.failed.length)}
            </p>
          ) : null}
        </div>
      );
    }
    return null;
  };

  /** 底部主按钮动作：单份有章 → 跳首章；批量/仅保存 → 回资料库。 */
  const primaryAction = () => {
    if (single) {
      onImported(single.docId, single.chapterIds);
      return;
    }
    if (summary) {
      // 仅当全部成功且唯一有章时可直达；否则回资料库目录核对。
      if (summary.ok.length === 1 && summary.failed.length === 0) {
        const only = summary.ok[0];
        onImported(only.docId, only.chapterIds);
        return;
      }
      onInspect?.();
    }
  };

  const finishedActionLabel = single
    ? single.chapterIds.length > 0
      ? fmt.startLearning(single.chapterIds.length)
      : fmt.doneSaved
    : summary
      ? fmt.batch.doneToLibrary
      : undefined;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-1/40 p-6 backdrop-blur-sm">
      <div className="my-4 w-full max-w-2xl rounded-xl border border-line bg-surface shadow-2xl">
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <div>
            <h3 className="text-base font-semibold text-ink-1">{fmt.title}</h3>
            <p className="mt-0.5 text-xs text-ink-3">{fmt.subtitle}</p>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            aria-label={m.common.close}
            className="rounded-lg px-2 py-1 text-sm text-ink-3 transition-colors hover:bg-subtle hover:text-ink-1 disabled:opacity-40"
          >
            ✕
          </button>
        </div>

        {/* 来源 Tab */}
        <div className="flex gap-1 border-b border-line px-6 pt-3">
          {(
            [
              ["paste", fmt.sourceTab.paste],
              ["local", fmt.sourceTab.local],
              ["github", fmt.sourceTab.github],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => switchTab(key)}
              disabled={busy}
              data-testid={`import-source-tab-${key}`}
              className={`rounded-t-lg border-b-2 px-3 py-1.5 text-sm transition-colors ${
                tab === key
                  ? "border-accent font-medium text-ink-1"
                  : "border-transparent text-ink-3 hover:text-ink-1"
              } disabled:opacity-40`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="space-y-5 px-6 py-5">{renderSourceArea()}</div>

        {/* 进度 / 结果区（来源区下方统一呈现） */}
        <div className="space-y-5 px-6 pb-5">
          {renderProgress()}
          {renderResult()}
          {notice ? <p className="text-xs text-state-weak">{notice}</p> : null}
        </div>

        {/* 底部 */}
        <div className="flex items-center justify-end gap-2 border-t border-line px-6 py-4">
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-line px-4 py-2 text-sm text-ink-2 transition-colors hover:bg-subtle hover:text-ink-1 disabled:opacity-40"
          >
            {m.common.cancel}
          </button>
          {finishedOk && done ? (
            <>
              {single && singleWithChapters && onInspect ? (
                <button
                  onClick={onInspect}
                  className="rounded-lg border border-line px-4 py-2 text-sm text-ink-1 transition-colors hover:bg-subtle"
                >
                  {fmt.inspect}
                </button>
              ) : null}
              {finishedActionLabel ? (
                <button
                  onClick={primaryAction}
                  className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/90"
                >
                  {finishedActionLabel}
                </button>
              ) : null}
            </>
          ) : (
            <button
              onClick={runTabAction}
              disabled={primaryDisabled}
              data-testid="import-primary-btn"
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/90 disabled:opacity-40"
            >
              {primaryLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** 阶段状态图标：active 转圈 / done 对勾 / pending 空心圆。 */
function PhaseIcon({ status }: { status: PhaseStatus }) {
  if (status === "active") {
    return (
      <span className="mt-1 h-3 w-3 shrink-0 animate-spin rounded-full border border-accent/30 border-t-accent" />
    );
  }
  if (status === "done") {
    return <span className="mt-0.5 text-xs font-bold text-state-mastered">✓</span>;
  }
  return <span className="mt-1 h-3 w-3 shrink-0 rounded-full border border-line" />;
}
