/**
 * 「章节列表」Tab（原「切分结果」）—— 工具条**常显** + 结构化章列表 + 编辑模式。
 *
 * P0 修复（B1）：旧实现的整条工具条被 `{firstChapter && …}` 包住，
 * 于是「还没有章节」时「立即切分」按钮根本不渲染 —— 用户永远无法完成首次
 * 切分，功能死锁。现在工具条无条件渲染，空态卡里也给一个切分入口。
 *
 * 分工（docs/library-module-design-2026-09.md v2 硬契约）：
 * - 切分 = 代码（splitDocumentNow，确定性、无重试）；
 * - 精修 = AI（analyzeChaptersNow，可重跑，读全局配置 useAiReady）；
 * - 编辑 = 代码（applyChapterEdit，重命名 / 区间合并 / 排序，操作即保存）。
 */
import { useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useI18n } from '../../../i18n';
import { storage } from '../../../stores/useLoopStore';
import { useAiTask } from '../../../stores/useAiTaskStore';
import { buildActiveProvider } from '../../../stores/useSettingsStore';
import { useAiReady } from '../../../hooks/useAiReady';
import { Button } from '../../../components/ui/button';
import { ConfirmDialog } from '../../../components/ui/confirm-dialog';
import { AiTaskStatusLine } from '../../../components/ai-task-status-line';
import { notifyDocsChanged } from '../../../components/layout/AppShell';
import { splitDocumentNow, SplitServiceError } from '../split-service';
import { applyChapterEdit, ChapterEditError } from '../chapter-edit-service';
import type { ChapterEdit, ChapterEditResult } from '../chapter-edit-service';
import { autoIndexAfterImport } from '../index-service';
import { analyzeChaptersNow } from '../analyze-service';
import { chapterCharCount } from '../chapter-preview';
import { ChapterRow } from './ChapterRow';
import { ChapterEditRow } from './ChapterEditRow';
import type { SourceDocument, Chapter, LearnerState } from '../../../domain';

interface SplitTabProps {
  doc: SourceDocument;
  chapters: Chapter[];
  learner: LearnerState | null;
  onChanged: () => Promise<void>;
}

export default function SplitTab({ doc, chapters, learner, onChanged }: SplitTabProps) {
  const { m: t } = useI18n();
  // 「重新切分」是纯本地操作（切分归代码、零 AI），保留组件内 busy；
  // 「仅 AI 精修」走全局任务注册表（refine:{docId}，切页重挂可恢复 loading/终态）。
  const [splitting, setSplitting] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const refineTask = useAiTask(`refine:${doc.id}`);

  // ---- 编辑模式（操作即保存，无草稿态）----
  const [editing, setEditing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmMerge, setConfirmMerge] = useState(false);

  // 全局 AI 配置（响应式）：替代原 ai/active 的恒 null stub（B2 修复）
  const aiReady = useAiReady();

  const hasChapters = chapters.length > 0;
  const totalKeyPoints = useMemo(
    () =>
      chapters.reduce(
        (sum, c) => sum + (c.keyPointRefs?.length ?? c.keyPoints?.length ?? 0),
        0,
      ),
    [chapters],
  );
  /** 字数口径统一走 `chapterCharCount`（与 ChapterRow 的「N 字」单一真源）。 */
  const totalChars = useMemo(
    () => chapters.reduce((sum, c) => sum + chapterCharCount(c), 0),
    [chapters],
  );
  /** 切分由代码完成，故恒为「本地启发式」；AI 是否精修过看 analysis.chaptersAt。 */
  const refined = Boolean(doc.analysis?.chaptersAt);

  // 章节列表变化时清理失效选中 / 重命名态（防止编辑期间数据被其他入口改动后残留）。
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set([...prev].filter((id) => chapters.some((c) => c.id === id)));
      return next.size === prev.size ? prev : next;
    });
    setRenamingId((prev) => (prev && !chapters.some((c) => c.id === prev) ? null : prev));
  }, [chapters]);

  // ---- 编辑动作 ----

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** 已勾选的章（保持章节顺序）。 */
  const picked = useMemo(
    () => chapters.filter((c) => selectedIds.has(c.id)),
    [chapters, selectedIds],
  );

  /**
   * 合并区间 = 所选章的**最小到最大位置**之间的全部章（含未勾选的中间章）。
   * 这是引擎 `mergeChapterRange` 的语义，确认框必须显式告知实际章数。
   */
  const mergeRange = useMemo(() => {
    if (picked.length < 2) return undefined;
    const ids = chapters.map((c) => c.id);
    const idx = picked.map((c) => ids.indexOf(c.id)).filter((i) => i >= 0);
    if (idx.length < 2) return undefined;
    const from = Math.min(...idx);
    const to = Math.max(...idx);
    const list = chapters.slice(from, to + 1);
    return { from, to, list, count: list.length };
  }, [chapters, picked]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /** 三个编辑动作的统一出口：落库 → 后台向量重算 → 刷新父级 → 提示。 */
  const runEdit = async (edit: ChapterEdit, noticeOf: (r: ChapterEditResult) => string) => {
    setSaving(true);
    setNotice(undefined);
    try {
      const result = await applyChapterEdit(
        { id: doc.id, textPreview: doc.textPreview },
        { storage, chapters, edit },
      );
      // 结构变更后旧向量已随 chunk 失效 → 补后台重算入队（与 runSplit 同做法）。
      autoIndexAfterImport();
      notifyDocsChanged();
      await onChanged();
      setNotice(noticeOf(result));
      setSelectedIds(new Set());
      setRenamingId(null);
    } catch (e) {
      if (e instanceof ChapterEditError) {
        setNotice(e.kind === 'chapter-not-found' ? t.learn.detail.chaptersEdit.stale : e.message);
        if (e.kind === 'chapter-not-found') await onChanged(); // 数据过期 → 重新拉取
      } else {
        setNotice(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setSaving(false);
    }
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const ids = chapters.map((c) => c.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    void runEdit(
      { kind: 'reorder', orderedIds: arrayMove(ids, from, to) },
      () => t.learn.detail.chaptersEdit.reorderedNotice,
    );
  };

  const commitRename = (chapterId: string, title: string) => {
    const current = chapters.find((c) => c.id === chapterId);
    setRenamingId(null);
    // 空串 / 值未变 → 不写库（与引擎的空白回退语义一致）。
    if (!current || title.trim().length === 0 || title.trim() === current.title) return;
    void runEdit({ kind: 'rename', chapterId, title }, () => t.learn.detail.chaptersEdit.renamedNotice);
  };

  const confirmMergeEdit = () => {
    if (!mergeRange) return;
    const list = mergeRange.list;
    setConfirmMerge(false);
    void runEdit(
      { kind: 'merge', fromId: list[0].id, toId: list[list.length - 1].id },
      (r) => t.learn.detail.chaptersEdit.mergedNotice(r.absorbed),
    );
  };

  const toggleEditing = () => {
    setEditing((v) => !v);
    setSelectedIds(new Set());
    setRenamingId(null);
  };

  // ---- 切分 / 精修 ----

  const runSplit = async () => {
    if (splitting || refineTask.running) return;
    setSplitting(true);
    setNotice(undefined);
    try {
      const result = await splitDocumentNow(doc, { storage });
      setNotice(
        t.learn.detail.split.result(
          result.chapters.length,
          result.carriedMastery,
          result.droppedMastery,
          false,
        ),
      );
      // 重切后旧 chunk 与旧向量一并失效 → 补后台重算入队（G1），避免向量索引静默清零。
      autoIndexAfterImport();
      notifyDocsChanged();
      await onChanged();
    } catch (e) {
      const err = e instanceof SplitServiceError ? e : new Error(String(e));
      if (err.message.includes('no-body')) {
        setNotice(t.learn.detail.split.noBody);
      } else if (err.message.includes('no-chapters')) {
        setNotice(t.learn.detail.split.noChapters);
      } else {
        setNotice(err.message || t.common.loading);
      }
    } finally {
      setSplitting(false);
    }
  };

  const runAnalyze = () => {
    if (!aiReady || !hasChapters || refineTask.running || splitting) return;
    const provider = buildActiveProvider();
    void refineTask.run(async (_report, done) => {
      const result = await analyzeChaptersNow(doc, chapters, { storage, provider });
      // 三类结果分开提示（不再静默），结果文案进任务终态（切页回来仍可见）：
      // - 有批失败 → 明确「N 批未精修」（这些章保持原样）；
      // - 无变更（含全部批失败）→ 「本次未产生精修建议」；
      // - 否则 → 既有结果文案。
      if (result.failedBatches > 0) {
        done(t.learn.detail.analyze.failedBatches(result.failedBatches));
      } else if (result.changed === 0) {
        done(t.learn.detail.analyze.noSuggestion);
      } else {
        done(t.learn.detail.analyze.result(result.changed, result.merged));
      }
      notifyDocsChanged();
      await onChanged();
    }).catch(() => {
      // 失败终态经 refineTask.message 渲染到下方通知条。
    });
  };

  const onSplitClick = () => {
    if (hasChapters) setConfirmOpen(true);
    else void runSplit();
  };

  const busy = saving || splitting;

  // 精修 running / 终态统一交 AiTaskStatusLine（freshness 门 + dismiss），组件内不再派生。

  return (
    <div className="space-y-4">
      {/* 工具条：常显 —— 无章节时也必须能触发首次切分（B1） */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface p-3">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-ink-2">
          <span>{t.learn.detail.split.strategyHeadings}</span>
          <span>·</span>
          <span>{refined ? t.learn.detail.split.refinedYes : t.learn.detail.split.refinedNo}</span>
          <span>·</span>
          <span>{t.learn.detail.split.stats(chapters.length, totalKeyPoints)}</span>
          {totalChars > 0 && (
            <>
              <span>·</span>
              <span>{t.learn.detail.chapters.totalChars(totalChars)}</span>
            </>
          )}
        </div>

        {/* 窄屏：按钮区整行占满（不再与信息区各占一半）；sm 起回到右侧 */}
        <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
          {editing && hasChapters && (
            <Button
              size="sm"
              variant="default"
              disabled={!mergeRange || saving}
              title={mergeRange ? undefined : t.learn.detail.chaptersEdit.mergeHint}
              onClick={() => setConfirmMerge(true)}
              data-testid="chapter-merge-btn"
            >
              {t.learn.detail.chaptersEdit.mergeSelected(picked.length)}
            </Button>
          )}
          <Button
            size="sm"
            variant={hasChapters ? 'outline' : 'default'}
            onClick={onSplitClick}
            loading={splitting}
            disabled={refineTask.running || saving}
          >
            {hasChapters ? t.learn.detail.split.resplit : t.learn.detail.split.split}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={runAnalyze}
            loading={refineTask.running}
            disabled={!aiReady || !hasChapters || busy}
          >
            {t.learn.detail.split.analyzeOnly}
          </Button>
          {hasChapters && (
            <Button
              size="sm"
              variant="outline"
              onClick={toggleEditing}
              disabled={saving || splitting}
              data-testid="chapter-edit-toggle"
            >
              {editing
                ? t.learn.detail.chaptersEdit.doneEditing
                : t.learn.detail.chaptersEdit.editChapters}
            </Button>
          )}
          {!aiReady && (
            <a
              href="#/settings"
              className="inline-flex items-center text-xs text-primary hover:underline"
            >
              {t.learn.detail.split.goConfigure}
            </a>
          )}
        </div>
      </div>

      {/* 通知条：切分 / 编辑结果为组件内 state（本地操作，恒新鲜） */}
      {notice && (
        <div className="rounded-lg border border-line bg-surface p-3">
          <p className="text-xs text-ink-2">{notice}</p>
        </div>
      )}

      {/* 精修任务：running 进度 / done·error 终态（统一状态行） */}
      <AiTaskStatusLine
        task={refineTask}
        runningFallback={t.aiTask.running}
        formatError={(raw) => t.learn.detail.analyze.failed(raw)}
        onDismiss={refineTask.clear}
      />

      {/* 章行列表（编辑态 / 浏览态）或空态（空态内置切分入口，双重保险） */}
      {!hasChapters ? (
        <div className="rounded-lg border border-dashed border-line bg-surface p-6 text-center">
          <p className="text-sm font-medium text-ink-1">{t.learn.detail.chapters.emptyTitle}</p>
          <p className="mt-1 text-xs text-ink-3">{t.learn.detail.chapters.emptyDesc}</p>
          <Button
            size="sm"
            variant="default"
            className="mt-3"
            onClick={() => void runSplit()}
            disabled={splitting || refineTask.running}
          >
            {t.learn.detail.chapters.split}
          </Button>
        </div>
      ) : editing ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext
            items={chapters.map((c) => c.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-2">
              {chapters.map((ch, idx) => (
                <ChapterEditRow
                  key={ch.id}
                  chapter={ch}
                  index={idx + 1}
                  learner={learner}
                  selected={selectedIds.has(ch.id)}
                  renaming={renamingId === ch.id}
                  busy={saving}
                  onToggleSelect={() => toggleSelect(ch.id)}
                  onStartRename={() => setRenamingId(ch.id)}
                  onCommitRename={(title) => commitRename(ch.id, title)}
                  onCancelRename={() => setRenamingId(null)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <div className="space-y-2">
          {chapters.map((ch, idx) => (
            <ChapterRow
              key={ch.id}
              chapter={ch}
              index={idx + 1}
              learner={learner}
              doc={doc}
            />
          ))}
        </div>
      )}

      {/* 重新切分确认弹窗 */}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t.learn.detail.split.confirmTitle}
        description={t.learn.detail.split.confirmDesc(chapters.length)}
        confirmLabel={t.learn.detail.split.confirmOk}
        cancelLabel={t.common.cancel}
        onConfirm={runSplit}
      />

      {/* 合并确认弹窗：必须显式告知「实际区间与章数」（区间内未勾选章也会被合并） */}
      {mergeRange && (
        <ConfirmDialog
          open={confirmMerge}
          onOpenChange={setConfirmMerge}
          title={t.learn.detail.chaptersEdit.mergeConfirmTitle}
          description={
            <div className="space-y-2">
              <p>
                {t.learn.detail.chaptersEdit.mergeConfirmRange(
                  mergeRange.from + 1,
                  mergeRange.to + 1,
                  mergeRange.count,
                )}
              </p>
              <ul className="list-disc space-y-0.5 pl-4">
                {mergeRange.list.slice(0, 5).map((c) => (
                  <li key={c.id} className="truncate">
                    {c.title}
                  </li>
                ))}
              </ul>
              {mergeRange.count > 5 && (
                <p className="text-ink-3">
                  {t.learn.detail.chaptersEdit.mergeConfirmMore(mergeRange.count - 5)}
                </p>
              )}
              <p>{t.learn.detail.chaptersEdit.mergeConfirmNote}</p>
              <p className="font-medium text-amber-700">
                {t.learn.detail.chaptersEdit.mergeConfirmWarn}
              </p>
            </div>
          }
          confirmLabel={t.learn.detail.chaptersEdit.mergeOk}
          cancelLabel={t.common.cancel}
          onConfirm={confirmMergeEdit}
        />
      )}
    </div>
  );
}
