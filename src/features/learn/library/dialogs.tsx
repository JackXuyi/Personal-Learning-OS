/**
 * 资料级操作弹窗组（docs/library-module-design-2026-09.md §8.5 / §7.6）：
 * RenameDocDialog / DocumentMetaDialog / UpdateDocModal（三来源替换正文）/
 * AppendDocModal / DeleteDocDialog。
 *
 * 边界：弹窗只负责「收输入 → 调 library-actions 服务 → 回报结果」；
 * 列表刷新经 DOCS_CHANGED_EVENT，页面无需手动透传。
 */
import { useEffect, useState } from "react";
import type { DocumentFormat, SourceDocument } from "../../../domain";
import { Button } from "../../../components/ui/button";
import { ConfirmDialog } from "../../../components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { Select } from "../../../components/ui/select";
import { useI18n } from "../../../i18n";
import { storage } from "../../../stores/useLoopStore";
import { notifyDocsChanged } from "../../../components/layout/AppShell";
import LocalFilePanel from "../import/LocalFilePanel";
import GithubPanel from "../import/GithubPanel";
import { fileToUnit } from "../import/local-files";
import { buildGithubUnit, GithubImportError } from "../import/github";
import type { GithubPreview } from "../import/github";
import { githubErrorText, localErrorText } from "../import/error-text";
import type { ImportUnit } from "../import/types";
import { LIMITS } from "../import/types";
import {
  appendDocumentBody,
  deleteDocumentCascade,
  previewDeleteCascade,
  renameDocument,
  replaceDocumentBody,
  updateDocumentMeta,
} from "../library-actions";
import { autoIndexAfterImport } from "../index-service";
import type { DeleteReport, ReplacePhaseKey } from "../library-actions";
import type { DocActionKind } from "./DocActionsMenu";

const FORMAT_OPTIONS: { value: DocumentFormat; label: string }[] = [
  { value: "markdown", label: "Markdown" },
  { value: "note", label: "笔记" },
  { value: "web", label: "网页" },
  { value: "txt", label: "纯文本" },
];

const inputCls =
  "w-full rounded-lg border border-line bg-app-bg px-3 py-2 text-sm text-ink-1 outline-none transition-colors placeholder:text-ink-3 focus:border-primary disabled:opacity-50";

/* ── 重命名 ─────────────────────────────────────────────────────────── */

export function RenameDocDialog({
  doc,
  onClose,
}: {
  doc: SourceDocument | undefined;
  onClose: () => void;
}) {
  const { m } = useI18n();
  const t = m.learn.library.rename;
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string>();

  useEffect(() => {
    setTitle(doc?.title ?? "");
    setError(undefined);
  }, [doc?.id]);

  const submit = async () => {
    if (!doc) return;
    try {
      await renameDocument(doc, title);
      notifyDocsChanged();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.empty);
    }
  };

  return (
    <Dialog open={!!doc} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
        </DialogHeader>
        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setError(undefined);
          }}
          onKeyDown={(e) => e.key === "Enter" && void submit()}
          placeholder={t.label}
          aria-label={t.label}
          autoFocus
          spellCheck={false}
          data-testid="rename-input"
          className={inputCls}
        />
        {error ? <p className="text-xs text-state-weak">{error}</p> : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {m.common.cancel}
          </Button>
          <Button onClick={() => void submit()} disabled={!title.trim()} data-testid="rename-submit">
            {m.common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── 编辑元信息 ─────────────────────────────────────────────────────── */

export function DocumentMetaDialog({
  doc,
  onClose,
}: {
  doc: SourceDocument | undefined;
  onClose: () => void;
}) {
  const { m } = useI18n();
  const t = m.learn.library.meta;
  const [title, setTitle] = useState("");
  const [source, setSource] = useState("");
  const [format, setFormat] = useState<DocumentFormat>("markdown");

  useEffect(() => {
    setTitle(doc?.title ?? "");
    setSource(doc?.source ?? "");
    setFormat(doc?.format ?? "markdown");
  }, [doc?.id]);

  const submit = async () => {
    if (!doc) return;
    await updateDocumentMeta(doc, {
      title: title.trim() ? title : undefined,
      source,
      format,
    });
    notifyDocsChanged();
    onClose();
  };

  return (
    <Dialog open={!!doc} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription />
        </DialogHeader>
        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="text-xs text-ink-3">{t.name}</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              aria-label={t.name}
              spellCheck={false}
              data-testid="meta-name"
              className={inputCls}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-ink-3">{t.source}</span>
            <input
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder={t.sourcePlaceholder}
              aria-label={t.source}
              spellCheck={false}
              data-testid="meta-source"
              className={inputCls}
            />
          </label>
          <div className="flex items-center gap-2">
            <span className="text-xs text-ink-3">{t.format}</span>
            <Select
              ariaLabel={t.format}
              value={format}
              onValueChange={(v) => setFormat(v as DocumentFormat)}
              options={FORMAT_OPTIONS}
              className="h-8 w-auto"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {m.common.cancel}
          </Button>
          <Button onClick={() => void submit()} data-testid="meta-submit">
            {m.common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── 替换正文（三来源；复用导入面板的来源准备，落库走 library-actions） ── */

type PhaseStatus = "pending" | "active" | "done";
const REPLACE_PHASES: ReplacePhaseKey[] = ["save", "split", "migrate"];

export function UpdateDocModal({
  doc,
  onClose,
}: {
  doc: SourceDocument | undefined;
  onClose: () => void;
}) {
  const { m } = useI18n();
  const t = m.learn.library.replace;
  const [tab, setTab] = useState<"paste" | "local" | "github">("paste");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [phases, setPhases] = useState<PhaseStatus[]>(() => REPLACE_PHASES.map(() => "pending"));
  const [result, setResult] = useState<string>();
  // 粘贴
  const [body, setBody] = useState("");
  const [format, setFormat] = useState<DocumentFormat>("markdown");
  // 本地 / GitHub 面板
  const [files, setFiles] = useState<File[]>([]);
  const [ghPreview, setGhPreview] = useState<GithubPreview | undefined>();

  useEffect(() => {
    setTab("paste");
    setBusy(false);
    setNotice(undefined);
    setResult(undefined);
    setBody("");
    setFiles([]);
    setGhPreview(undefined);
    setPhases(REPLACE_PHASES.map(() => "pending"));
  }, [doc?.id]);

  if (!doc) return null;

  const setPhase = (key: ReplacePhaseKey, status: PhaseStatus) =>
    setPhases((prev) => prev.map((s, i) => (REPLACE_PHASES[i] === key ? status : s)));

  const canSubmit =
    (tab === "paste" && body.trim().length > 0) ||
    (tab === "local" && files.length > 0) ||
    (tab === "github" && !!ghPreview);

  const buildUnit = async (): Promise<ImportUnit | undefined> => {
    if (tab === "paste") {
      return { title: doc.title, format, splitFormat: format === "markdown" ? "markdown" : "auto", text: body.trim() };
    }
    if (tab === "local") {
      const out = await fileToUnit(files[0]);
      if ("error" in out) {
        setNotice(localErrorText(out, m.learn.import.local.errors));
        return undefined;
      }
      return out;
    }
    if (ghPreview) return await buildGithubUnit((input, init) => fetch(input, init), ghPreview);
    return undefined;
  };

  const submit = async () => {
    if (busy || !doc) return;
    setBusy(true);
    setNotice(undefined);
    setResult(undefined);
    setPhases(REPLACE_PHASES.map(() => "pending"));
    try {
      const unit = await buildUnit();
      if (!unit) return;
      const res = await replaceDocumentBody(doc, unit, {
        storage,
        onPhase: (k, s) => setPhase(k, s),
      });
      setResult(t.done(res.chapters.length, res.carriedMastery, res.droppedMastery));
      // 正文已变 → 旧 chunk 与其向量已被 rebuildChunks 清掉（G1）：补一次后台重算入队，
      // 否则该资料的向量索引会静默清零、检索退化成纯 FTS。
      autoIndexAfterImport();
      notifyDocsChanged();
    } catch (err) {
      if (err instanceof GithubImportError) {
        // GitHub 错误按 kind 取文案（G2）。
        setNotice(githubErrorText(err, m.learn.import.github.errors));
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        setNotice(
          msg.includes("上限") || msg.includes("limit")
            ? m.learn.library.append.tooLarge
            : msg,
        );
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!doc} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.desc}</DialogDescription>
        </DialogHeader>

        <div className="flex gap-1 border-b border-line pb-2">
          {(
            [
              ["paste", m.learn.import.sourceTab.paste],
              ["local", m.learn.import.sourceTab.local],
              ["github", m.learn.import.sourceTab.github],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => !busy && setTab(key)}
              disabled={busy}
              data-testid={`replace-tab-${key}`}
              className={`rounded-t-lg border-b-2 px-3 py-1.5 text-sm transition-colors ${
                tab === key
                  ? "border-primary font-medium text-ink-1"
                  : "border-transparent text-ink-3 hover:text-ink-1"
              } disabled:opacity-40`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          {tab === "paste" ? (
            <div className="space-y-3">
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={m.learn.import.bodyPlaceholder}
                rows={7}
                disabled={busy}
                data-testid="replace-paste-body"
                className="w-full resize-y rounded-lg border border-line bg-app-bg px-3 py-2 font-mono text-xs leading-relaxed text-ink-1 outline-none transition-colors placeholder:text-ink-3 focus:border-primary disabled:opacity-50"
              />
              <div className="flex items-center gap-2">
                <span className="text-xs text-ink-3">{m.learn.import.format}</span>
                <Select
                  ariaLabel={m.learn.import.format}
                  value={format}
                  onValueChange={(v) => setFormat(v as DocumentFormat)}
                  disabled={busy}
                  options={FORMAT_OPTIONS}
                  className="h-8 w-auto"
                />
              </div>
            </div>
          ) : null}
          {tab === "local" ? (
            <LocalFilePanel files={files} onFilesChange={setFiles} disabled={busy} />
          ) : null}
          {tab === "github" ? (
            <GithubPanel onPreview={(p) => setGhPreview(p ?? undefined)} disabled={busy} />
          ) : null}
        </div>

        {busy ? (
          <div className="rounded-xl border border-line bg-subtle/60 px-4 py-3">
            <ul className="space-y-1.5">
              {REPLACE_PHASES.map((key, i) => {
                const status = phases[i];
                return (
                  <li key={key} className="flex items-center gap-2.5 text-sm">
                    {status === "active" ? (
                      <span className="h-3 w-3 shrink-0 animate-spin rounded-full border border-primary/30 border-t-primary" />
                    ) : status === "done" ? (
                      <span className="text-xs font-bold text-state-mastered">✓</span>
                    ) : (
                      <span className="h-3 w-3 shrink-0 rounded-full border border-line" />
                    )}
                    <span className={status === "active" ? "font-medium text-ink-1" : "text-ink-3"}>
                      {t.phase[key]}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
        {result ? <p className="text-sm text-state-mastered">{result}</p> : null}
        {notice ? <p className="text-xs text-state-weak">{notice}</p> : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {m.common.cancel}
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !canSubmit} data-testid="replace-submit">
            {busy ? m.learn.import.busy : t.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── 追加内容 ───────────────────────────────────────────────────────── */

export function AppendDocModal({
  doc,
  onClose,
}: {
  doc: SourceDocument | undefined;
  onClose: () => void;
}) {
  const { m } = useI18n();
  const t = m.learn.library.append;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [result, setResult] = useState<string>();

  useEffect(() => {
    setText("");
    setBusy(false);
    setNotice(undefined);
    setResult(undefined);
  }, [doc?.id]);

  if (!doc) return null;

  const added = text.trim().length;
  const total = (doc.textPreview?.length ?? 0) + added;
  const over = total > LIMITS.githubTotalChars;

  const submit = async () => {
    if (busy || !doc) return;
    setBusy(true);
    setNotice(undefined);
    try {
      const res = await appendDocumentBody(doc, text, { storage });
      setResult(
        t.count(res.appendedChars, (doc.textPreview?.length ?? 0) + res.appendedChars) +
          ` · ${m.learn.detail.split.result(res.chapters.length, res.carriedMastery, res.droppedMastery, false)}`,
      );
      // 追加同样整篇重切 → 旧向量已失效：补后台重算（与替换同理，G1）。
      autoIndexAfterImport();
      notifyDocsChanged();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : t.tooLarge);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!doc} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.desc}</DialogDescription>
        </DialogHeader>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t.placeholder}
          rows={7}
          disabled={busy}
          data-testid="append-body"
          className="w-full resize-y rounded-lg border border-line bg-app-bg px-3 py-2 font-mono text-xs leading-relaxed text-ink-1 outline-none transition-colors placeholder:text-ink-3 focus:border-primary disabled:opacity-50"
        />
        <p className={`text-xs ${over ? "text-state-weak" : "text-ink-3"}`}>
          {t.count(added, total)}
        </p>
        {result ? <p className="text-sm text-state-mastered">{result}</p> : null}
        {notice ? <p className="text-xs text-state-weak">{notice}</p> : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {m.common.cancel}
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={busy || added === 0 || over}
            data-testid="append-submit"
          >
            {t.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── 删除（级联预检 + 二次确认） ─────────────────────────────────────── */

export function DeleteDocDialog({
  doc,
  onClose,
  onDeleted,
}: {
  doc: SourceDocument | undefined;
  onClose: () => void;
  onDeleted?: () => void;
}) {
  const { m } = useI18n();
  const t = m.learn.library.del;
  const [report, setReport] = useState<DeleteReport>();

  useEffect(() => {
    setReport(undefined);
    if (!doc) return;
    void previewDeleteCascade(doc.id, storage).then(setReport);
  }, [doc?.id]);

  if (!doc) return null;
  const r = report ?? { chapters: 0, papers: 0, concepts: 0, chunks: 0 };

  return (
    <ConfirmDialog
      open={!!doc}
      onOpenChange={(o) => !o && onClose()}
      title={t.title(doc.title)}
      description={t.desc(r.chapters, r.papers, r.concepts, r.chunks)}
      confirmLabel={t.confirm}
      cancelLabel={m.common.cancel}
      destructive
      onConfirm={() => {
        void (async () => {
          await deleteDocumentCascade(doc.id, storage);
          notifyDocsChanged();
          onDeleted?.();
          onClose();
        })();
      }}
    />
  );
}

/** 页面弹窗编排类型（LibraryPage / DocumentDetailPage 共用）。 */
export type LibraryDialogKind = Extract<DocActionKind, "rename" | "meta" | "replace" | "append" | "delete">;
