/**
 * 导入资料 Modal（V2 章节式导入，T5；UI Workbench U5 翻新）—— 全产品统一入库入口。
 *
 * 链路：标题与正文 → 保存 SourceDocument（正文永远属于你，存 textPreview）→
 * 本地切分 splitDocument() 产出有序 Chapter → AI 精修（refineSplitResult，
 * 未配置 Provider 静默回退启发式）→ 整批写入 storage。
 *
 * U5 变更（docs/ui-workbench-plan-2026-09.md §27/U5）：
 * - 视觉全面 token 化（B 案语义 token，替换旧 slate/indigo）；
 * - 导入期间展示五阶段进度（读取文档 → 检测结构 → 提炼要点 → 创建章节 →
 *   关联目标），每阶段最小可见时长（≈160ms）保证 ≤2s 一阶段全程有反馈；
 * - 完成以「结果卡」呈现：n 章 / n 要点 / 结构修正（AI 合并过碎小节计数）→
 *   [开始学习]（直达首章）/ [检查结构]（回资料库目录核对）。
 *
 * 说明：阶段标签为 UX 反馈文案，与实际流水线（save → split → refine →
 * saveChapters）映射，不新造引擎能力（方案 U5 约束：不绑架 Domain）。
 */
import { useState } from "react";
import type { DocumentFormat, SourceDocument } from "../../domain";
import { newId } from "../../domain";
import { splitDocument } from "../../engine";
import { refineSplitResult } from "../../ai";
import { buildActiveProvider } from "../../stores/useSettingsStore";
import { storage } from "../../stores/useLoopStore";
import { useI18n } from "../../i18n";

type PhaseKey = "read" | "detect" | "refine" | "create" | "link";
type PhaseStatus = "pending" | "active" | "done";

const PHASE_ORDER: PhaseKey[] = ["read", "detect", "refine", "create", "link"];

/** 快阶段的最小可见时长：让每个进度状态至少出现一帧（本地切分是毫秒级）。 */
const MIN_PHASE_MS = 160;

interface ImportModalProps {
  /** 关闭（不写入）。 */
  onClose: () => void;
  /** 写入完成（返回新文档 id 与章节 id，供 AppShell 跳转首章）。 */
  onImported: (docId: string, chapterIds: string[]) => void;
  /** 结果卡「检查结构」：关闭并回到资料库目录核对。 */
  onInspect?: () => void;
}

interface PreviewState {
  docId: string;
  docTitle: string;
  chapterIds: string[];
  chapterTitles: string[];
  /** 是否经过了 AI 精修（标题/要点/过碎合并）。 */
  refined?: boolean;
  /** AI 自动合并的过碎小节数（结构修正；启发式 → 精修后减少的章数）。 */
  merged: number;
  /** 全资料要点总数（各章 keyPoints 之和）。 */
  totalPoints: number;
}

export default function ImportModal({ onClose, onImported, onInspect }: ImportModalProps) {
  const { m } = useI18n();
  const fmt = m.learn.import;
  const phasesI18n = fmt.phaseLabel;

  const FORMAT_OPTIONS: { value: DocumentFormat; label: string; split: "markdown" | "txt" | "auto" }[] = [
    { value: "markdown", label: "Markdown", split: "markdown" },
    { value: "note", label: fmt.formatNote, split: "auto" },
    { value: "web", label: fmt.formatWeb, split: "auto" },
    { value: "txt", label: fmt.formatTxt, split: "txt" },
  ];

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [format, setFormat] = useState<DocumentFormat>("markdown");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | undefined>();
  const [phases, setPhases] = useState<PhaseStatus[]>(
    () => PHASE_ORDER.map(() => "pending" as const),
  );
  const [preview, setPreview] = useState<PreviewState>();

  const splitFormat = FORMAT_OPTIONS.find((o) => o.value === format)?.split ?? "auto";

  const setPhase = (key: PhaseKey, status: PhaseStatus) =>
    setPhases((prev) => prev.map((s, i) => (PHASE_ORDER[i] === key ? status : s)));
  const settle = (ms = MIN_PHASE_MS) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  /** 逐阶段跑流水线：先亮 active 状态一小段时间，完成即标记 done。 */
  async function runPhase<T>(key: PhaseKey, fn: () => Promise<T>): Promise<T> {
    setPhase(key, "active");
    await settle();
    const out = await fn();
    setPhase(key, "done");
    return out;
  }

  /** 保存资料 → 切分 → AI 精修 → 写入 → 结果卡（阶段进度全程可见）。 */
  const splitAndPreview = async () => {
    const body = content.trim();
    if (!body) return;
    setBusy(true);
    setNotice(undefined);
    setPreview(undefined);
    setPhases(PHASE_ORDER.map(() => "pending"));
    try {
      const doc: SourceDocument = {
        id: newId("doc"),
        title: title.trim() || fmt.unnamedDoc,
        format,
        importedAt: Date.now(),
        status: "ready",
        textPreview: body,
      };
      await runPhase("read", () => storage.saveDocument(doc));

      const { chapters: heuristic } = await runPhase("detect", async () => {
        const out = splitDocument(
          { documentId: doc.id, text: body, format: splitFormat },
          // TXT 段落聚类偏小章更利于逐章学完；Markdown 标题切分默认 #/##
          { targetCharsPerChapter: 1_600, minParagraphsPerChapter: 3 },
        );
        return out;
      });

      if (heuristic.length === 0) {
        // 内容过短/无结构：资料已保存，不演剩余阶段（避免「已创建 0 章」的误导）。
        setPreview({
          docId: doc.id,
          docTitle: doc.title,
          chapterIds: [],
          chapterTitles: [],
          refined: false,
          merged: 0,
          totalPoints: 0,
        });
        setNotice(fmt.tooShort);
        return;
      }

      // T12：Provider 就绪时对启发式结果做 AI 精修（标题/要点/过碎合并）；
      // 失败或未配置 → 静默回退启发式章节，不阻断导入。
      const out = await runPhase("refine", () =>
        refineSplitResult(buildActiveProvider(), heuristic, body),
      );
      const chapters = out.chapters;
      const merged = Math.max(0, heuristic.length - chapters.length);

      await runPhase("create", () => storage.saveChapters(doc.id, chapters));

      setPhase("link", "active");
      await settle();
      setPhase("link", "done");
      setPreview({
        docId: doc.id,
        docTitle: doc.title,
        chapterIds: chapters.map((c) => c.id),
        chapterTitles: chapters.map((c) => c.title),
        refined: out.refined,
        merged,
        totalPoints: chapters.reduce((n, c) => n + c.keyPoints.length, 0),
      });
    } catch (err) {
      setNotice(fmt.splitFail(err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  };

  /** 仅保存资料（不切分章节）。 */
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

  const structureNote =
    preview && preview.chapterIds.length > 0
      ? preview.merged > 0
        ? fmt.mergedN(preview.merged)
        : preview.refined
          ? fmt.structureRefined
          : fmt.structureLocal
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

        <div className="space-y-5 px-6 py-5">
          {/* 1) 资料 */}
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">
              {fmt.stepSource(1)}
            </p>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={fmt.titlePlaceholder}
              className="w-full rounded-lg border border-line bg-app-bg px-3 py-2 text-sm text-ink-1 outline-none transition-colors placeholder:text-ink-3 focus:border-accent"
            />
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={fmt.bodyPlaceholder}
              rows={8}
              className="w-full resize-y rounded-lg border border-line bg-app-bg px-3 py-2 font-mono text-xs leading-relaxed text-ink-1 outline-none transition-colors placeholder:text-ink-3 focus:border-accent"
            />
            <div className="flex items-center gap-2">
              <span className="text-xs text-ink-3">{fmt.format}</span>
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value as DocumentFormat)}
                className="rounded-lg border border-line bg-surface px-2 py-1 text-sm text-ink-1 outline-none transition-colors focus:border-accent"
              >
                {FORMAT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {content.trim() && !busy && !preview ? (
                <button
                  onClick={saveDocOnly}
                  className="ml-auto rounded-lg border border-line px-3 py-1 text-xs text-ink-2 transition-colors hover:bg-subtle hover:text-ink-1"
                >
                  {fmt.saveOnly}
                </button>
              ) : null}
            </div>
          </div>

          {/* 2) 阶段进度（导入中，全程可见 ≤2s/阶段） */}
          {busy ? (
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
                        <span className="block text-xs text-ink-3">
                          {fmt.phaseHint[key]}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {/* 3) 结果卡（导入完成：n 章 / n 要点 / 结构修正） */}
          {!busy && preview ? (
            <div className="rounded-xl border border-line bg-subtle/60 px-4 py-3">
              <p className="flex items-center gap-2 text-sm font-semibold text-ink-1">
                <span className="text-state-mastered">✓</span>
                <span>
                  {preview.chapterIds.length > 0
                    ? fmt.resultTitle(preview.docTitle)
                    : fmt.savedDoc(preview.docTitle)}
                </span>
              </p>
              {preview.chapterIds.length > 0 ? (
                <>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-2">
                    <span className="tabular-nums">{fmt.statChapter(preview.chapterIds.length)}</span>
                    <span className="tabular-nums">{fmt.statPoints(preview.totalPoints)}</span>
                    {structureNote ? (
                      <span className="text-ink-3">{structureNote}</span>
                    ) : null}
                  </div>
                  <ol className="mt-2 max-h-40 list-decimal space-y-1 overflow-y-auto pl-5 text-xs text-ink-2">
                    {preview.chapterTitles.map((t, i) => (
                      <li key={`${t}-${i}`}>{t || m.chapter.ordinal(i + 1)}</li>
                    ))}
                  </ol>
                </>
              ) : (
                <p className="mt-1 text-xs text-state-weak">{fmt.noSplitWarn}</p>
              )}
            </div>
          ) : null}

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
          {preview ? (
            preview.chapterIds.length > 0 ? (
              <>
                {onInspect ? (
                  <button
                    onClick={onInspect}
                    className="rounded-lg border border-line px-4 py-2 text-sm text-ink-1 transition-colors hover:bg-subtle"
                  >
                    {fmt.inspect}
                  </button>
                ) : null}
                <button
                  onClick={() => onImported(preview.docId, preview.chapterIds)}
                  className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/90"
                >
                  {fmt.startLearning(preview.chapterIds.length)}
                </button>
              </>
            ) : (
              <button
                onClick={() => onImported(preview.docId, [])}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/90"
              >
                {fmt.doneSaved}
              </button>
            )
          ) : (
            <button
              onClick={splitAndPreview}
              disabled={busy || !content.trim()}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/90 disabled:opacity-40"
            >
              {busy ? fmt.busy : fmt.saveSplit}
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
