/**
 * 章节阅读（/learn/:chapterId）—— 三步闭环「步骤 1」的逐章学习页（T5，UI Workbench U3）。
 *
 * 本文件**只做两件事**：按路由把 doc / chapter / learner 读出来，以及两个早退
 * （章不存在 → 错误态；还没读到 → 骨架）。读完就交给 `reader/ChapterReader`。
 *
 * ⚠️ **早退之后不得再出现任何 hook**。早先的形态是早退后面还挂着「译文缓存命中
 * → 自动恢复视图」的 effect：首次渲染 89 个 hook、数据到位后 90 个，直接触发
 * 「React has detected a change in the order of Hooks」——hook 是按调用顺序串起来
 * 的链表，长度一变，后面所有 hook 的状态就整体错位。修法不是把 effect 挪进去，
 * 而是把「数据未就绪」这件事从组件内部拿掉：**未就绪就不挂载**。
 *
 * 七区布局、状态机写回、译文口径见 `reader/` 下各组件的文档注释
 * （docs/ui-workbench-plan-2026-09.md §6-U3 + docs/learn-chapter-qa-design-2026-09.md §7
 * + docs/learn-feynman-restatement-design-2026-09.md §7
 * + docs/learn-ai-translation-design-2026-10.md §14.10）。
 */
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ErrorState } from "../../components/primitives";
import type { Chapter, LearnerState, SourceDocument } from "../../domain";
import { storage } from "../../stores/useLoopStore";
import { useI18n } from "../../i18n";
import ChapterReader from "./reader/ChapterReader";

export default function ChapterReaderPage() {
  const { m } = useI18n();
  const t = m.learn.reader;
  const { chapterId = "" } = useParams();
  const [chapter, setChapter] = useState<Chapter | undefined>();
  const [doc, setDoc] = useState<SourceDocument | undefined>();
  const [learner, setLearner] = useState<LearnerState | undefined>();
  const [missing, setMissing] = useState(false);

  /**
   * 按章 id 反查所属文档（storage 没有「按章查文档」的入口，只能逐个文档的章
   * 列表里找）。顺带推进状态机：打开阅读 = not-started → learning（幂等，仅首次）。
   */
  useEffect(() => {
    void (async () => {
      const [ds, ls] = await Promise.all([
        storage.listDocuments(),
        storage.getLearnerState(),
      ]);
      setLearner(ls);
      for (const d of ds) {
        const chapters = await storage.listChapters(d.id);
        const found = chapters.find((c) => c.id === chapterId);
        if (found) {
          if (found.status === "not-started") {
            const updated = chapters.map((c) =>
              c.id === found.id ? { ...c, status: "learning" as const } : c,
            );
            await storage.saveChapters(d.id, updated);
            setChapter(updated.find((c) => c.id === found.id));
          } else {
            setChapter(found);
          }
          setDoc(d);
          return;
        }
      }
      setMissing(true);
    })();
  }, [chapterId]);

  if (missing) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-8">
        <ErrorState
          title={t.missingTitle}
          desc={t.missingDesc}
          action={
            <Link to="/learn" className="text-sm font-medium text-primary hover:underline">
              {t.backToCatalog}
            </Link>
          }
        />
      </div>
    );
  }

  if (!chapter || !doc) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-16 text-center">
        <p className="text-sm text-ink-3">{t.opening}</p>
      </div>
    );
  }

  return (
    <ChapterReader
      doc={doc}
      chapter={chapter}
      learner={learner}
      onChapterChange={setChapter}
      onLearnerChange={setLearner}
    />
  );
}
