/**
 * 导入资料 Modal（T5 · spec §5.3）—— 本地优先的资料入库 + 知识单元生成。
 *
 * 链路：输入标题与正文 → 保存为 SourceDocument（原始素材永远属于你）→
 * 生成知识单元候选（AI 抽取可用时自动，否则手动创建降级）→ 逐条核对 →
 * 写入知识图谱（Evidence：每条单元都回链到 sourceDocumentId）。
 *
 * 诚实护栏：关系抽取属于 AI 提示词管线的下一里程碑，这里只提供
 * 「标题/摘要命中既有单元 → 建议 related」的可解释启发式，不假装懂语义。
 */
import { useMemo, useState } from "react";
import type { DocumentFormat, KnowledgeKind, KnowledgeUnit, SourceDocument } from "../../domain";
import { newId } from "../../domain";
import { graphEngine } from "../../engine/graph-engine";
import { createKnowledgeEngine } from "../../engine/knowledge-engine";
import { storage } from "../../stores/useLoopStore";
import { buildActiveProvider } from "../../stores/useSettingsStore";
import { kindLabel } from "../units";

interface Candidate {
  /** 会话内标识（未入库前无稳定 id）。 */
  localId: string;
  title: string;
  kind: KnowledgeKind;
  summary?: string;
  source: "ai" | "manual";
}

interface ImportModalProps {
  /** 关闭前已存在的图谱（用于去重与关系建议）。 */
  existing: { title: string; id: string }[];
  /** 关闭（不写入）。 */
  onClose: () => void;
  /** 写入完成（返回新文档 id 与新写入的单元 id，供页面高亮）。 */
  onImported: (docId: string, addedUnitIds: string[]) => void;
}

const FORMAT_OPTIONS: { value: DocumentFormat; label: string }[] = [
  { value: "note", label: "笔记" },
  { value: "markdown", label: "Markdown" },
  { value: "web", label: "网页" },
  { value: "txt", label: "纯文本" },
];

/** 可解释的 related 启发式：新单元标题/摘要命中既有单元名 → 建议关联。 */
export function suggestRelated(
  candidate: Pick<Candidate, "title" | "summary">,
  existing: { title: string; id: string }[],
): { id: string; title: string }[] {
  const text = `${candidate.title} ${candidate.summary ?? ""}`;
  return existing.filter((e) => e.title.length >= 2 && text.includes(e.title));
}

export default function ImportModal({ existing, onClose, onImported }: ImportModalProps) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [format, setFormat] = useState<DocumentFormat>("note");
  const [busy, setBusy] = useState(false);
  const [aiNotice, setAiNotice] = useState<string | undefined>();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [checked, setChecked] = useState(true);

  // 手动添加子表单
  const [manualOpen, setManualOpen] = useState(false);
  const [mTitle, setMTitle] = useState("");
  const [mKind, setMKind] = useState<KnowledgeKind>("concept");
  const [mSummary, setMSummary] = useState("");

  const provider = useMemo(() => buildActiveProvider(), []);
  const engine = useMemo(() => createKnowledgeEngine(provider), [provider]);
  const aiReady = engine.hasExtraction;

  const existingTitles = useMemo(() => new Set(existing.map((e) => e.title)), [existing]);

  const toggle = (localId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(localId)) next.delete(localId);
      else next.add(localId);
      return next;
    });
  };

  /** 把手动表单里的输入收进候选列表。 */
  const addManual = () => {
    const name = mTitle.trim();
    if (!name) return;
    const localId = `m-${Date.now()}-${candidates.length}`;
    setCandidates((prev) => [
      ...prev,
      { localId, title: name, kind: mKind, summary: mSummary.trim() || undefined, source: "manual" },
    ]);
    setSelected((prev) => new Set(prev).add(localId));
    setMTitle("");
    setMSummary("");
    setManualOpen(false);
  };

  /** AI 抽取（Provider 提示词管线就绪后生效；当前骨架会返回空并友好提示）。 */
  const runAiExtraction = async () => {
    if (!aiReady) return;
    const name = title.trim() || "未命名资料";
    setBusy(true);
    setAiNotice(undefined);
    try {
      const doc: SourceDocument = {
        id: newId("doc"),
        title: name,
        format,
        importedAt: Date.now(),
        status: "ready",
        textPreview: content.trim() || undefined,
      };
      const units = await engine.extract(doc);
      if (units.length === 0) {
        setAiNotice("模型暂未返回知识单元——抽取提示词管线还在路上，可以先手动添加，资料本身已保存在本地。");
        return;
      }
      setCandidates((prev) => {
        const fresh = units.map((u) => ({
          localId: `ai-${Date.now()}-${u.id}`,
          title: u.title,
          kind: u.kind,
          summary: u.summary,
          source: "ai" as const,
        }));
        const all = [...prev, ...fresh];
        setSelected(new Set(all.map((c) => c.localId)));
        return all;
      });
    } catch (err) {
      setAiNotice(`AI 抽取失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  /** 写入图谱：保存文档 + 添加勾选的候选（title 去重）+ 可选 related 建议。 */
  const commit = async () => {
    const name = title.trim() || "未命名资料";
    const picks = candidates.filter((c) => selected.has(c.localId));
    if (picks.length === 0) return;

    setBusy(true);
    try {
      const doc: SourceDocument = {
        id: newId("doc"),
        title: name,
        format,
        importedAt: Date.now(),
        status: "ready",
        textPreview: content.trim() || undefined,
      };
      await storage.saveDocument(doc);

      const units: KnowledgeUnit[] = picks.map((p) => ({
        id: newId("ku"),
        title: p.title,
        kind: p.kind,
        summary: p.summary,
        sourceDocumentId: doc.id,
        tags: [],
        createdAt: Date.now(),
      }));

      let graph = await storage.getGraph();
      const addedIds: string[] = [];
      for (const unit of units) {
        if (graph.units.some((u) => u.title === unit.title)) continue; // title 去重
        graph = graphEngine.addUnit(graph, unit);
        addedIds.push(unit.id);
        if (checked) {
          for (const rel of suggestRelated(unit, existing)) {
            graph = graphEngine.connect(graph, unit.id, rel.id, "related", 0.5);
          }
        }
      }
      if (addedIds.length === 0) {
        setAiNotice("这些单元在图谱里已经存在了，没有新增内容。");
        return;
      }
      await storage.saveGraph(graph);
      onImported(doc.id, addedIds);
    } finally {
      setBusy(false);
    }
  };

  const dupTitles = candidates.filter((c) => existingTitles.has(c.title));

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-6 backdrop-blur-sm">
      <div className="my-4 w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-2xl">
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900">导入资料</h3>
            <p className="text-xs text-slate-400">原始素材保存在本地；知识单元会回链到这份资料（Evidence）。</p>
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
              placeholder="把笔记 / Markdown / 网页正文粘贴到这里…"
              rows={5}
              className="w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
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
                  onClick={async () => {
                    const doc: SourceDocument = {
                      id: newId("doc"),
                      title: title.trim() || "未命名资料",
                      format,
                      importedAt: Date.now(),
                      status: "ready",
                      textPreview: content.trim(),
                    };
                    await storage.saveDocument(doc);
                    setAiNotice(`资料「${doc.title}」已保存到本地知识库。`);
                  }}
                  className="ml-auto rounded-lg border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
                >
                  仅保存资料
                </button>
              ) : null}
            </div>
          </div>

          {/* 2) 生成单元 */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-700">2 · 从这份资料生成知识单元</p>
              <button
                onClick={() => setManualOpen((v) => !v)}
                className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-100"
              >
                ＋ 手动添加单元
              </button>
            </div>

            {manualOpen ? (
              <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <input
                    value={mTitle}
                    onChange={(e) => setMTitle(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addManual()}
                    placeholder="单元名，如：混合检索"
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-indigo-400"
                  />
                  <select
                    value={mKind}
                    onChange={(e) => setMKind(e.target.value as KnowledgeKind)}
                    className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none"
                  >
                    {(["concept", "skill", "fact", "procedure", "principle"] as KnowledgeKind[]).map(
                      (k) => (
                        <option key={k} value={k}>
                          {kindLabel(k)}
                        </option>
                      ),
                    )}
                  </select>
                </div>
                <input
                  value={mSummary}
                  onChange={(e) => setMSummary(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addManual()}
                  placeholder="一句话摘要（可选）"
                  className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-indigo-400"
                />
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setManualOpen(false)}
                    className="rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
                  >
                    取消
                  </button>
                  <button
                    onClick={addManual}
                    className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700"
                  >
                    添加
                  </button>
                </div>
              </div>
            ) : null}

            {aiReady ? (
              <button
                onClick={runAiExtraction}
                disabled={busy}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                {busy ? "正在阅读你的资料…" : "✨ AI 自动抽取单元（模型已配置）"}
              </button>
            ) : (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                配置 AI（Ollama / OpenAI 兼容）后，可从资料自动抽取知识单元；当前可先手动添加。
              </p>
            )}

            {aiNotice ? <p className="text-xs text-amber-600">{aiNotice}</p> : null}
          </div>

          {/* 3) 候选确认 */}
          {candidates.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-700">
                  3 · 候选确认（{candidates.filter((c) => selected.has(c.localId)).length} 将写入）
                </p>
                <label className="flex items-center gap-1.5 text-xs text-slate-500">
                  <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
                  自动关联相关既有单元
                </label>
              </div>
              <ul className="max-h-56 space-y-1.5 overflow-y-auto">
                {candidates.map((c) => {
                  const dup = existingTitles.has(c.title);
                  const on = selected.has(c.localId);
                  return (
                    <li
                      key={c.localId}
                      className={`flex items-start gap-2.5 rounded-lg border px-3 py-2 ${
                        dup ? "border-slate-100 bg-slate-50 opacity-60" : "border-slate-200"
                      } ${on && !dup ? "border-indigo-200 bg-indigo-50/40" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={dup}
                        onChange={() => toggle(c.localId)}
                        className="mt-1"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-slate-800">{c.title}</span>
                          <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                            {kindLabel(c.kind)}
                          </span>
                          {c.source === "manual" ? (
                            <span className="shrink-0 text-[10px] text-slate-400">手动</span>
                          ) : null}
                          {dup ? (
                            <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-600">
                              图谱已存在
                            </span>
                          ) : null}
                        </div>
                        {c.summary ? <p className="mt-0.5 text-xs text-slate-500">{c.summary}</p> : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
              {dupTitles.length > 0 ? (
                <p className="text-xs text-amber-600">
                  {dupTitles.length} 个单元与图谱中的名称重复，已跳过（不会覆盖已有内容）。
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* 底部 */}
        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            取消
          </button>
          <button
            onClick={commit}
            disabled={busy || candidates.filter((c) => selected.has(c.localId)).length === 0}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            {busy ? "正在写入…" : `写入知识图谱（${candidates.filter((c) => selected.has(c.localId)).length}）`}
          </button>
        </div>
      </div>
    </div>
  );
}
