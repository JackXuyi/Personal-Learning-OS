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
import { storage } from "../../stores/useLoopStore";

interface ImportModalProps {
  /** 关闭（不写入）。 */
  onClose: () => void;
  /** 写入完成（返回新文档 id 与切分出的章节 id，供目录页高亮 / 跳转）。 */
  onImported: (docId: string, chapterIds: string[]) => void;
}

const FORMAT_OPTIONS: { value: DocumentFormat; label: string; split: "markdown" | "txt" | "auto" }[] = [
  { value: "markdown", label: "Markdown", split: "markdown" },
  { value: "note", label: "笔记", split: "auto" },
  { value: "web", label: "网页", split: "auto" },
  { value: "txt", label: "纯文本", split: "txt" },
];

export default function ImportModal({ onClose, onImported }: ImportModalProps) {
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
        title: title.trim() || "未命名资料",
        format,
        importedAt: Date.now(),
        status: "ready",
        textPreview: body,
      };
      await storage.saveDocument(doc);

      const { chapters } = splitDocument(
        { documentId: doc.id, text: body, format: splitFormat },
        // TXT 段落聚类偏小章更利于逐章学完；Markdown 标题切分默认 #/##
        { targetCharsPerChapter: 1_600, minParagraphsPerChapter: 3 },
      );
      if (chapters.length > 0) {
        await storage.saveChapters(doc.id, chapters);
      }
      setPreview({
        docId: doc.id,
        docTitle: doc.title,
        chapterIds: chapters.map((c) => c.id),
        chapterTitles: chapters.map((c) => c.title),
      });
      if (chapters.length === 0) {
        setNotice(
          "这段内容太短或缺少标题/分段，没有切出章节。资料已保存，可以粘贴更完整的内容后重试。",
        );
      }
    } catch (err) {
      setNotice(`切分失败：${err instanceof Error ? err.message : String(err)}`);
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
        title: title.trim() || "未命名资料",
        format,
        importedAt: Date.now(),
        status: "ready",
        textPreview: body,
      };
      await storage.saveDocument(doc);
      setNotice(`资料「${doc.title}」已保存到本地知识库。`);
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
            <h3 className="text-base font-semibold text-slate-900">导入资料</h3>
            <p className="text-xs text-slate-400">
              粘贴 Markdown / 笔记，系统会按标题切分成章节，逐章学习。
            </p>
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
            <p className="text-sm font-medium text-slate-700">1 · 资料</p>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="给这份资料起个名字，例如《RAG 系统设计》"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
            />
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={
                "把笔记 / Markdown 正文粘贴到这里…\n建议用 # / ## 分章节（如「# 第一章 向量化」），纯文本会按空行自动聚类。"
              }
              rows={8}
              className="w-full resize-y rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs leading-relaxed outline-none focus:border-indigo-400"
            />
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">格式</span>
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
                  仅保存资料
                </button>
              ) : null}
            </div>
          </div>

          {/* 2) 切分预览 */}
          {preview ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-700">2 · 切分预览</p>
              <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 px-4 py-3">
                <p className="text-sm font-medium text-slate-800">
                  「{preview.docTitle}」切出 {preview.chapterTitles.length} 个章节
                </p>
                {preview.chapterTitles.length > 0 ? (
                  <ol className="mt-2 max-h-40 list-decimal space-y-1 overflow-y-auto pl-5 text-xs text-slate-600">
                    {preview.chapterTitles.map((t, i) => (
                      <li key={`${t}-${i}`}>{t || `第 ${i + 1} 章`}</li>
                    ))}
                  </ol>
                ) : (
                  <p className="mt-1 text-xs text-amber-600">
                    没有切出章节——内容可能缺少标题或分段，建议补充后重试。
                  </p>
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
            取消
          </button>
          {preview ? (
            preview.chapterIds.length > 0 ? (
              <button
                onClick={() => onImported(preview.docId, preview.chapterIds)}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
              >
                开始学习 →（{preview.chapterIds.length} 章）
              </button>
            ) : (
              <button
                onClick={() => onImported(preview.docId, [])}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
              >
                完成（资料已保存）
              </button>
            )
          ) : (
            <button
              onClick={splitAndPreview}
              disabled={busy || !content.trim()}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
            >
              {busy ? "正在切分章节…" : "保存并切分章节"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
