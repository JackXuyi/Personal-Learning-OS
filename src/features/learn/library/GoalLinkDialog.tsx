/**
 * 关联目标弹窗（资料 ⇄ 目标双向接线；评审 M1-1）。
 *
 * 资料详情页头部「关联目标」按钮打开：勾选目标 → saveDocument 写
 * `SourceDocument.goalIds` → DOCS_CHANGED_EVENT 通知列表刷新。
 * 关联是纯标记（不动目标的 requiredChapterIds——章节范围仍由目标表单管理）。
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { LearningGoal, SourceDocument } from "../../../domain";
import { Button } from "../../../components/ui/button";
import { Checkbox } from "../../../components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { useI18n } from "../../../i18n";
import { storage } from "../../../stores/useLoopStore";

export default function GoalLinkDialog({
  doc,
  onClose,
  onSaved,
}: {
  doc: SourceDocument | undefined;
  onClose: () => void;
  /** 保存成功（详情页刷新 doc 态）。 */
  onSaved: (next: SourceDocument) => void;
}) {
  const { m } = useI18n();
  const t = m.learn.detail;
  const [goals, setGoals] = useState<LearningGoal[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!doc) return;
    void (async () => {
      const [list] = await Promise.all([storage.listGoals()]);
      setGoals(list);
      setSelected(new Set(doc.goalIds ?? []));
      setReady(true);
    })();
  }, [doc]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async () => {
    if (!doc || saving) return;
    setSaving(true);
    try {
      const next: SourceDocument = { ...doc, goalIds: [...selected] };
      await storage.saveDocument(next);
      onSaved(next);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!doc} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t.linkGoalsTitle}</DialogTitle>
          <DialogDescription>{t.linkGoalsDesc}</DialogDescription>
        </DialogHeader>

        {!ready ? (
          <p className="py-4 text-center text-sm text-ink-3">{m.common.loading}</p>
        ) : goals.length === 0 ? (
          <div className="py-2 text-sm text-ink-2">
            <p>{t.linkGoalsEmpty}</p>
            <Link to="/goals/new" className="mt-2 inline-block font-medium text-primary hover:underline">
              {t.linkGoalsCreate}
            </Link>
          </div>
        ) : (
          <div className="max-h-64 space-y-0.5 overflow-y-auto pr-1">
            {goals.map((g) => {
              const checked = selected.has(g.id);
              return (
                <div
                  key={g.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1.5 text-sm text-ink-2 transition-colors hover:bg-surface"
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("[data-slot=checkbox]")) return;
                    toggle(g.id);
                  }}
                >
                  <Checkbox checked={checked} onCheckedChange={() => toggle(g.id)} />
                  <span className="min-w-0 flex-1 truncate">{g.title}</span>
                  <span className="shrink-0 text-[10px] text-ink-3">
                    {m.units.goalType[g.type]}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {m.common.cancel}
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={saving || !ready || goals.length === 0}
            data-testid="link-goals-submit"
          >
            {saving ? m.common.loading : m.common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
