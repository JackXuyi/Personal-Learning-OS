/**
 * 章级动作执行的共享 hook（UI Workbench U4 抽取）——
 * Today / /plan / /quiz Recommended 三处同一套「动作 → 直达路径，补考就地生成卷」
 * 逻辑，此前各自复制；收敛到本文件后各页只引用 hook。
 *
 * 与 chapter-action.ts（纯函数）分工：本文件是有 React 状态的执行器，
 * chapter-action.ts 提供 actionPath/makeRetakePaper 等纯函数。
 */
import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Chapter, NextAction } from "../../domain";
import { storage, useLoopStore } from "../../stores/useLoopStore";
import { actionPath, makeRetakePaper } from "./chapter-action";

/** chapterId → Chapter 索引（跨文档，来自 chapterPlan.chaptersByDoc）。 */
export function useChapterIndex(): Map<string, Chapter> {
  const plan = useLoopStore((s) => s.chapterPlan);
  return useMemo(() => {
    const index = new Map<string, Chapter>();
    for (const list of Object.values(plan?.chaptersByDoc ?? {})) {
      for (const c of list) index.set(c.id, c);
    }
    return index;
  }, [plan]);
}

/** 章级动作执行器：阅读/复习/测验 → 直达；补考 → 就地生成补考卷后进作答。 */
export function useRunChapterAction() {
  const navigate = useNavigate();
  const plan = useLoopStore((s) => s.chapterPlan);
  const chapterById = useChapterIndex();
  const [busyId, setBusyId] = useState<string | undefined>();

  const run = useCallback(
    async (action: NextAction) => {
      if (busyId) return;
      const chapter = chapterById.get(action.unitId);
      const path = actionPath(action, chapter);
      if (path) {
        navigate(path);
        return;
      }
      // retake-quiz：就地生成补考卷（客观 3 · 降一档）。
      if (chapter && plan) {
        setBusyId(chapter.id);
        try {
          const paper = makeRetakePaper(
            chapter,
            plan.chaptersByDoc[chapter.documentId] ?? [chapter],
            plan.learner,
          );
          await storage.savePaper(paper);
          navigate(`/quiz/${paper.id}`);
        } finally {
          setBusyId(undefined);
        }
      }
    },
    [busyId, chapterById, navigate, plan],
  );

  return { run, busyId };
}
