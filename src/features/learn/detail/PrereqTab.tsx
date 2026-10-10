/**
 * 「前置关系」Tab（F7 范围 4）—— 章级前置的自动推导 + 人工修正。
 *
 * 机制（docs/chapter-prereq-override-design-2026-09.md §1）：
 * 章与章的先后关系由概念层的 prerequisite 边**抬升**而来
 * （`domain/knowledge.ts::chapterPrerequisiteIds`）。这层推导会有偏差 ——
 * 漏掉用户明知存在的依赖、或把两章误判成有先后。本页把修正权交给用户。
 *
 * 三个刻意选择：
 * - **增量覆盖**而非整体替换：人工增 / 删叠加在自动推导之上（`ChapterPrereqOverride`）。
 *   整体替换会在概念重新抽取后冻结成一份过时清单；增量则让新边照常生效。
 * - **操作即保存**（无草稿态），与章节编辑同体例 —— 少一类「忘了保存」的丢数据。
 * - **范围限同一份资料**：候选只列本文档的章。由概念边跨资料推导出的前置极罕见
 *   （概念抽取本身按资料进行），且计划侧仍按范围过滤，不会出错；此处如实说明。
 *
 * ⚠️ 前置是**软排序**：未达标的前置章只让本章在**同类档位内**后移并在计划理由里标注，
 * 不阻断执行。页内说明必须写清楚，否则用户会以为「没前置就学不了」。
 */
import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../../i18n';
import { Button } from '../../../components/ui/button';
import { storage } from '../../../stores/useLoopStore';
import { chapterPrereqEntries, chapterPrerequisiteIds, sortChaptersByOrder } from '../../../domain';
import type { Chapter, ChapterPrereqOverride, KnowledgeGraph } from '../../../domain';
import { applyPrereqToggle, clearPrereqOverride, loadPrereqOverrides } from '../prereq-service';
import { ChapterPrereqDialog } from './ChapterPrereqDialog';

interface PrereqTabProps {
  /** 本资料的章（任意顺序，内部统一走 `sortChaptersByOrder`）。 */
  chapters: Chapter[];
  /** 概念图（自动推导的输入）。`null` = 尚未加载，按空图处理（= 无自动前置）。 */
  graph: KnowledgeGraph | null;
}

/** 空图常量：`graph` 未加载时报 `undefined` 前置，等价于「还没抽取」。 */
const EMPTY_GRAPH: KnowledgeGraph = { units: [], relations: [] };

export default function PrereqTab({ chapters, graph }: PrereqTabProps) {
  const { m: t } = useI18n();
  const copy = t.learn.detail.prereq;

  const [overrides, setOverrides] = useState<Map<string, ChapterPrereqOverride>>(new Map());
  const [target, setTarget] = useState<Chapter | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();

  // 覆盖记录只读一次（本页是唯一写方；写后本地状态同步更新，无需重读存储）。
  useEffect(() => {
    let alive = true;
    void loadPrereqOverrides({ storage }).then((map) => {
      if (alive) setOverrides(map);
    });
    return () => {
      alive = false;
    };
  }, []);

  // 章集合变化（重切分 / 合并）→ 关掉指向已消失章的对话框。
  useEffect(() => {
    setTarget((prev) => (prev && !chapters.some((c) => c.id === prev.id) ? null : prev));
  }, [chapters]);

  /** 自动推导（限本资料的章）。 */
  const derived = useMemo(
    () => chapterPrerequisiteIds(graph ?? EMPTY_GRAPH, chapters),
    [graph, chapters],
  );

  const rows = useMemo(
    () =>
      sortChaptersByOrder(chapters).map((chapter, idx) => ({
        chapter,
        index: idx + 1,
        entries: chapterPrereqEntries(derived.get(chapter.id) ?? [], overrides.get(chapter.id)),
      })),
    [chapters, derived, overrides],
  );

  const titleOf = useMemo(() => new Map(chapters.map((c) => [c.id, c.title])), [chapters]);
  /** 自动推导过任何一条前置？没有则给一句「尚未抽取」的提示（否则用户会以为功能坏了）。 */
  const hasDerived = derived.size > 0;

  const toggle = async (chapterId: string, targetId: string, want: boolean) => {
    setBusy(true);
    setNotice(undefined);
    try {
      const next = await applyPrereqToggle(
        {
          chapterId,
          targetId,
          want,
          derived: derived.get(chapterId) ?? [],
          current: overrides.get(chapterId),
        },
        { storage },
      );
      setOverrides((prev) => {
        const copy = new Map(prev);
        if (next === undefined) copy.delete(chapterId);
        else copy.set(chapterId, next);
        return copy;
      });
      setNotice(t.learn.detail.prereq.saved);
    } finally {
      setBusy(false);
    }
  };

  const reset = async (chapterId: string) => {
    setBusy(true);
    try {
      await clearPrereqOverride(chapterId, { storage });
      setOverrides((prev) => {
        const copy = new Map(prev);
        copy.delete(chapterId);
        return copy;
      });
      setNotice(t.learn.detail.prereq.resetNotice);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1 rounded-lg border border-line bg-surface p-3">
        <p className="text-xs leading-relaxed text-ink-2">{copy.desc}</p>
        <p className="text-xs text-ink-3">{copy.scopeNote}</p>
      </div>

      {notice && (
        <div className="rounded-lg border border-line bg-surface p-3">
          <p className="text-xs text-ink-2">{notice}</p>
        </div>
      )}

      {chapters.length < 2 ? (
        <div className="rounded-lg border border-dashed border-line bg-surface p-6 text-center">
          <p className="text-sm font-medium text-ink-1">{copy.empty}</p>
          <p className="mt-1 text-xs text-ink-3">{copy.emptyDesc}</p>
        </div>
      ) : (
        <>
          {!hasDerived && (
            <p className="rounded-lg border border-dashed border-line bg-surface p-3 text-xs text-ink-3">
              {copy.noDerivedHint}
            </p>
          )}
          <ul className="space-y-2" data-testid="chapter-prereq-list">
            {rows.map(({ chapter, index, entries }) => (
              <li
                key={chapter.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-line bg-surface px-4 py-3"
              >
                <span className="min-w-6 shrink-0 text-center text-xs font-medium text-ink-3">
                  {index}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-1">
                  {chapter.title}
                </span>

                <div className="flex flex-wrap items-center gap-1.5">
                  {entries.length === 0 ? (
                    <span className="text-xs text-ink-3">{copy.none}</span>
                  ) : (
                    entries.map((entry) => (
                      <span
                        key={entry.chapterId}
                        className="inline-flex max-w-[16rem] items-center gap-1 rounded-full border border-line px-2 py-0.5 text-xs text-ink-2"
                      >
                        <span className="truncate">
                          {titleOf.get(entry.chapterId) ?? entry.chapterId}
                        </span>
                        {entry.origin === 'manual' && (
                          <span className="shrink-0 text-[11px] text-ink-3">
                            {copy.originManual}
                          </span>
                        )}
                      </span>
                    ))
                  )}
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => setTarget(chapter)}
                  data-testid="chapter-prereq-adjust"
                >
                  {copy.adjust}
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}

      {target && (
        <ChapterPrereqDialog
          open
          onOpenChange={(open) => {
            if (!open) setTarget(null);
          }}
          chapter={target}
          chapters={chapters}
          derivedIds={derived.get(target.id) ?? []}
          override={overrides.get(target.id)}
          busy={busy}
          onToggle={(targetId, want) => void toggle(target.id, targetId, want)}
          onReset={() => void reset(target.id)}
        />
      )}
    </div>
  );
}
