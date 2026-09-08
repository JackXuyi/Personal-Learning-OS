/**
 * 导入资料 Modal（V2 章节式导入，T5）—— 三步闭环「步骤 1」的入口。
 *
 * 链路：输入标题与正文 → 保存为 SourceDocument（原始素材永远属于你，
 * 正文存 textPreview）→ 本地切分引擎 splitDocument() 产出有序 Chapter →
 * 展示切分预览（章标题列表，可人工微调 UI 在后续里程碑）→ 整批写入 storage。
 *
 * 与旧版「概念抽取导入」的差异（docs §2 融合矩阵 #8）：
 * V2 首版导入直接以「章节」为产物；AI 概念抽取 / 图谱单元（原 ImportModal
 * 候选确认段）属 N5 概念层，届时随 knowledge-engine 提示词管线回归，
 * 不在此保留半成品 UI。
 */
import { useState } from "react";
import type { DocumentFormat, SourceDocument } from "../../domain";
import { newId } from "../../domain";
import { splitDocument } from "../../engine";
import { refineSplitResult } from "../../ai";
import { buildActiveProvider } from "../../stores/useSettingsStore";
import { storage } from "../../stores/useLoopStore";
import { useI18n } from "../../i18n";

interface ImportModalProps {
  /** 关闭（不写入）。 */
  onClose: () => void;
  /** 写入完成（返回新文档 id 与切分出的章节 id，供目录页高亮 / 跳转）。 */
  onImported: (docId: string, chapterIds: string[]) => void;
}

export default function ImportModal({ onClose, onImported }: ImportModalProps) {
  const { m } = useI18n();
  const fmt = m.learn.import;

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
  const [preview, setPreview] = useState<{
    docId: string;
    docTitle: string;
    chapterIds: string[];
    chapterTitles: string[];
    /** 是否经过了 AI 精修（标题/要点/过碎合并）。 */
    refined?: boolean;
  }>();

  const splitFormat = FORMAT_OPTIONS.find((o) => o.value === format)?.split ?? "auto";

  /** 保存资料 → 本地切分 → 写回章节 → 展示预览（不自动关闭，用户确认后进入）。 */
  const splitAndPreview = async () => {
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

      const { chapters: heuristic } = splitDocument(
        { documentId: doc.id, text: body, format: splitFormat },
        // TXT 段落聚类偏小章更利于逐章学完；Markdown 标题切分默认 #/##
        { targetCharsPerChapter: 1_600, minParagraphsPerChapter: 3 },
      );
      // T12：Provider 就绪时对启发式结果做 AI 精修（标题/要点/过碎合并）；
      // 失败或未配置 → 静默回退启发式章节，不阻断导入。
      let chapters = heuristic;
      let refined = false;
      if (heuristic.length > 0) {
        const out = await refineSplitResult(buildActiveProvider(), heuristic, body);
        chapters = out.chapters;
        refined = out.refined;
      }
      if (chapters.length > 0) {
        await storage.saveChapters(doc.id, chapters);
      }
      setPreview({
        docId: doc.id,
        docTitle: doc.title,
        chapterIds: chapters.map((c) => c.id),
        chapterTitles: chapters.map((c) => c.title),
        refined,
      });
      if (chapters.length === 0) {
        setNotice(fmt.tooShort);
      }
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

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-6 backdrop-blur-sm">
      <div className="my-4 w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-2xl">
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900">{fmt.title}</h3>
            <p className="text-xs text-slate-400">{fmt.subtitle}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-slate-400 hover:bg-slate-50 hover:text-slate-600"
          >
            ✕
          </button>
        </div>

        <div className="space-y-5 px-6 py-5">
          {/* 1) 资料 */}
          <div className="space-y-3">
            <p className="text-sm font-medium text-slate-700">{fmt.stepSource(1)}</p>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={fmt.titlePlaceholder}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
            />
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={fmt.bodyPlaceholder}
              rows={8}
              className="w-full resize-y rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs leading-relaxed outline-none focus:border-indigo-400"
            />
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">{fmt.format}</span>
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value as DocumentFormat)}
                className="rounded-lg border border-slate-200 px-2 py-1 text-sm outline-none"
              >
                {FORMAT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {content.trim() ? (
                <button
                  onClick={saveDocOnly}
                  disabled={busy}
                  className="ml-auto rounded-lg border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  {fmt.saveOnly}
                </button>
              ) : null}
            </div>
          </div>

          {/* 2) 切分预览 */}
          {preview ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-700">{fmt.stepPreview(2)}</p>
              <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 px-4 py-3">
                <p className="text-sm font-medium text-slate-800">
                  {fmt.previewHead(preview.docTitle, preview.chapterTitles.length)}
                  {preview.refined ? (
                    <span className="ml-2 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-medium text-indigo-600">
                      {fmt.refinedBadge}
                    </span>
                  ) : null}
                </p>
                {preview.chapterTitles.length > 0 ? (
                  <ol className="mt-2 max-h-40 list-decimal space-y-1 overflow-y-auto pl-5 text-xs text-slate-600">
                    {preview.chapterTitles.map((t, i) => (
                      <li key={`${t}-${i}`}>{t || m.chapter.ordinal(i + 1)}</li>
                    ))}
                  </ol>
                ) : (
                  <p className="mt-1 text-xs text-amber-600">{fmt.noSplitWarn}</p>
                )}
              </div>
            </div>
          ) : null}

          {notice ? <p className="text-xs text-amber-600">{notice}</p> : null}
        </div>

        {/* 底部 */}
        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            {m.common.cancel}
          </button>
          {preview ? (
            preview.chapterIds.length > 0 ? (
              <button
                onClick={() => onImported(preview.docId, preview.chapterIds)}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
              >
                {fmt.startLearning(preview.chapterIds.length)}
              </button>
            ) : (
              <button
                onClick={() => onImported(preview.docId, [])}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
              >
                {fmt.doneSaved}
              </button>
            )
          ) : (
            <button
              onClick={splitAndPreview}
              disabled={busy || !content.trim()}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
            >
              {busy ? fmt.busy : fmt.saveSplit}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
