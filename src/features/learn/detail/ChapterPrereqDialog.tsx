/**
 * 前置调整对话框（F7 范围 4）—— 勾选 / 取消某章的**前置章节**。
 *
 * 为什么用对话框：前置是一个「一对多」的集合选择（候选是本章之外的全部章），
 * 行内放不下；且用户需要同时看到「当前哪些是自动推导的、哪些是自己加的」。
 *
 * 本组件只负责呈现与派发勾选，**不做合并逻辑** —— 生效前置由
 * `domain/knowledge.ts::chapterPrereqEntries` 算出（与计划引擎同一口径），
 * 落库统一走 `prereq-service::applyPrereqToggle`。
 *
 * 「操作即保存」：每次勾选立即落库（与章节编辑同体例，无草稿态）。
 */
import { useI18n } from '../../../i18n';
import { Button } from '../../../components/ui/button';
import { Checkbox } from '../../../components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { chapterPrereqEntries, sortChaptersByOrder } from '../../../domain';
import type { Chapter, ChapterPrereqOverride } from '../../../domain';

interface ChapterPrereqDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 正在调整的章。 */
  chapter: Chapter;
  /** 该资料的全部章（含自身，内部剔除）。 */
  chapters: Chapter[];
  /** 该章的**自动推导**前置（用于判定勾选来源是「自动」还是「人工」）。 */
  derivedIds: string[];
  /** 该章当前的人工覆盖记录。 */
  override: ChapterPrereqOverride | undefined;
  /** 落库中：禁用勾选与按钮。 */
  busy: boolean;
  onToggle: (targetId: string, want: boolean) => void;
  onReset: () => void;
}

export function ChapterPrereqDialog({
  open,
  onOpenChange,
  chapter,
  chapters,
  derivedIds,
  override,
  busy,
  onToggle,
  onReset,
}: ChapterPrereqDialogProps) {
  const { m: t } = useI18n();
  const copy = t.learn.detail.prereq;

  // 生效前置（自动 ∪ 人工增 − 人工删）—— 与计划引擎同一函数，UI 不自己算。
  const entries = chapterPrereqEntries(derivedIds, override);
  const effective = new Map(entries.map((e) => [e.chapterId, e.origin]));
  const candidates = sortChaptersByOrder(chapters).filter((c) => c.id !== chapter.id);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="chapter-prereq-dialog">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold text-ink-1">
            {copy.dialogTitle(chapter.title)}
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed text-ink-2">
            {copy.dialogDesc}
          </DialogDescription>
        </DialogHeader>

        {candidates.length === 0 ? (
          <p className="text-xs text-ink-3">{copy.dialogEmpty}</p>
        ) : (
          <div className="max-h-[45vh] space-y-1 overflow-y-auto rounded-lg border border-line p-1">
            {candidates.map((c) => {
              const origin = effective.get(c.id);
              const checked = origin !== undefined;
              return (
                <label
                  key={c.id}
                  className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-xs text-ink-2 transition-colors hover:bg-subtle"
                >
                  <Checkbox
                    checked={checked}
                    disabled={busy}
                    data-testid="chapter-prereq-candidate"
                    onCheckedChange={() => onToggle(c.id, !checked)}
                  />
                  <span className="min-w-0 flex-1 truncate text-ink-1">{c.title}</span>
                  {/* 来源只在已勾选时才有意义：自动推导 / 人工指定 */}
                  {origin !== undefined && (
                    <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-3">
                      {origin === 'auto' ? copy.originAuto : copy.originManual}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        )}

        <p className="text-xs text-ink-3">{copy.scopeNote}</p>

        <DialogFooter>
          {/* 「恢复自动」只在有人工修正时出现（没有可恢复的东西就不放按钮） */}
          {override !== undefined && (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={onReset}
              data-testid="chapter-prereq-reset"
            >
              {copy.reset}
            </Button>
          )}
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t.common.close}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
