/**
 * 「我的划线」面板 —— 阅读页右栏第 7 区（F5 第 2 条，docs/learn-highlight-note-design-2026-09.md §7.2）。
 *
 * 三种状态：
 * - **无正文快照**（`hasBody === false`）：如实说明不能划线，不显示入口；
 * - **空态**：引导去左栏选中一段话（不制造无效按钮）；
 * - **列表**：quote 摘要 + 笔记（可空）+ 定位/编辑/删除。
 *
 * 两条诚实降级：
 * - 正文里定位不到的条目**照常展示**，只加一条「正文中未定位到」标注 + 保留删除入口
 *   —— 渲染差异不该让用户的手写笔记消失（服务层也不会因定位失败删记录）；
 * - 本组件**不碰 storage**：编辑/删除都走 props 回调（页面注入服务层）。
 */
import { useState } from "react";
import type { Annotation } from "../../../domain";
import { ANNOTATION_LIMITS, hasNote, quoteExcerpt } from "../../../domain";
import { Section } from "../../../components/primitives";
import { Button } from "../../../components/ui/button";
import { ConfirmDialog } from "../../../components/ui/confirm-dialog";
import { Textarea } from "../../../components/ui/textarea";
import { useI18n } from "../../../i18n";
import type { AnnotationStatus } from "../annotation-service";

interface ChapterAnnotationsPanelProps {
  /** 本章批注（已按 `start` 升序）。 */
  annotations: readonly Annotation[];
  /** 本章是否有正文快照（决定「不能划线」还是「空态引导」）。 */
  hasBody: boolean;
  /** 正文里成功定位到的 id（不在其中 → 标注「正文中未定位到」）。 */
  locatedIds: readonly string[];
  onLocate: (a: Annotation) => void;
  onUpdateNote: (a: Annotation, note: string) => Promise<{ status: AnnotationStatus }>;
  onRemove: (a: Annotation) => void;
}

export default function ChapterAnnotationsPanel({
  annotations,
  hasBody,
  locatedIds,
  onLocate,
  onUpdateNote,
  onRemove,
}: ChapterAnnotationsPanelProps) {
  const { m } = useI18n();
  const t = m.learn.reader.annotations;
  const [editingId, setEditingId] = useState<string | undefined>();
  const [draft, setDraft] = useState("");
  const [pendingDelete, setPendingDelete] = useState<Annotation | undefined>();
  const [error, setError] = useState<string | undefined>();

  const startEdit = (a: Annotation) => {
    setEditingId(a.id);
    setDraft(a.note);
    setError(undefined);
  };

  const saveEdit = async (a: Annotation) => {
    const r = await onUpdateNote(a, draft);
    if (r.status !== "ok") {
      setError(t.status.error);
      return;
    }
    setEditingId(undefined);
    setDraft("");
    setError(undefined);
  };

  return (
    <section className="space-y-2">
      <Section title={t.eyebrow(annotations.length)} />

      {!hasBody ? (
        <p className="text-sm text-ink-3">{t.noBody}</p>
      ) : annotations.length === 0 ? (
        <p className="text-sm text-ink-3">{t.empty}</p>
      ) : (
        <ul className="space-y-1.5" data-testid="reader-annotation-list">
          {annotations.map((a) => {
            const located = locatedIds.includes(a.id);
            const editing = editingId === a.id;
            return (
              <li
                key={a.id}
                data-testid="reader-annotation-item"
                className="rounded-lg border border-line bg-surface px-2.5 py-2 transition-colors hover:border-ink-3/40"
              >
                <p className="border-l-2 border-primary/50 pl-2 text-xs leading-5 text-ink-1">
                  {quoteExcerpt(a.quote)}
                </p>

                {editing ? (
                  <div className="mt-1.5 space-y-1.5">
                    <Textarea
                      value={draft}
                      rows={3}
                      autoFocus
                      className="text-xs"
                      placeholder={t.notePlaceholder}
                      data-testid="reader-annotation-note-edit"
                      onChange={(e) => setDraft(e.target.value)}
                    />
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] tabular-nums text-ink-3">
                        {t.noteCount(draft.length, ANNOTATION_LIMITS.maxNoteChars)}
                      </span>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditingId(undefined);
                            setError(undefined);
                          }}
                        >
                          {t.cancel}
                        </Button>
                        <Button
                          size="sm"
                          disabled={draft.length > ANNOTATION_LIMITS.maxNoteChars}
                          data-testid="reader-annotation-note-save"
                          onClick={() => void saveEdit(a)}
                        >
                          {t.save}
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p
                    data-testid="reader-annotation-note"
                    className="mt-0.5 pl-2 text-xs leading-5 text-ink-2"
                  >
                    {hasNote(a) ? a.note : t.noNote}
                  </p>
                )}

                {!located ? (
                  <p data-testid="reader-annotation-orphan" className="mt-0.5 pl-2 text-[11px] text-ink-3">
                    ⚠ {t.orphan}
                  </p>
                ) : null}

                {error && editing ? (
                  <p className="mt-0.5 pl-2 text-[11px] text-destructive">{error}</p>
                ) : null}

                {!editing ? (
                  <div className="mt-1 flex items-center gap-1 pl-1">
                    {located ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-1.5 text-[11px]"
                        onClick={() => onLocate(a)}
                      >
                        {t.locate}
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-1.5 text-[11px]"
                      data-testid="reader-annotation-edit"
                      onClick={() => startEdit(a)}
                    >
                      {t.edit}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-1.5 text-[11px]"
                      data-testid="reader-annotation-delete"
                      onClick={() => setPendingDelete(a)}
                    >
                      {t.remove}
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(undefined);
        }}
        title={t.removeConfirmTitle}
        description={t.removeConfirmDesc}
        confirmLabel={t.remove}
        cancelLabel={t.cancel}
        destructive
        onConfirm={() => {
          if (pendingDelete) onRemove(pendingDelete);
          setPendingDelete(undefined);
        }}
      />
    </section>
  );
}
