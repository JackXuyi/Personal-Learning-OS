/**
 * 「章节测评试卷」Tab —— 一键出卷 + 已生成卷与成绩展示 + 卷型推荐。
 *
 * 三处关键行为（docs/library-module-design-2026-09.md §8.17）：
 * - **B4**：mount 时读 `listPapers()` + `listPaperResults()`，按 `scope.chapterIds` 反查章。
 * - **一键出卷（本轮新增）**：直接在 Tab 内 `createPaperAndSave` 落库并刷新列表，
 *   不跳向导、不跳答题页 —— 让「为这一章出卷」在资料上下文内闭环。
 *   出卷细节（本地确定性卷 / AI 就绪门 / 失败回退）全部复用 `quiz/paper-flow`，
 *   与 `/quiz/new` 向导同源，不另起一套。
 * - **卷型校验同源**：推荐卷型（如单章推荐阶段测、总章数不足推荐综合测）在很多
 *   组合下其实不可出。旧实现把非法 mode 直接拼进 `/quiz/new?mode=`，向导会照单
 *   收下并产出语义错误的卷。现在先过 `canCreatePaperMode`，不可出则退到第一个
 *   可出卷型并在提示里如实说明。
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../../components/ui/button';
import { useI18n } from '../../../i18n';
import { storage } from '../../../stores/useLoopStore';
import { PAPER_MODE_DURATION_MIN, sortChaptersByOrder } from '../../../domain';
import { availablePaperModes, canCreatePaperMode } from '../../../engine';
import { createPaperAndSave, PaperFlowError } from '../../quiz/paper-flow';
import { recommendDocPaper, recommendPaper } from '../paper-advice';
import type {
  Chapter,
  LearnerState,
  Paper,
  PaperMode,
  PaperResult,
  SourceDocument,
} from '../../../domain';

interface PapersTabProps {
  doc: SourceDocument;
  chapters: Chapter[];
  learner: LearnerState | null;
}

/** 资料级一键出卷的 busy 键（章级用章 id）。 */
const DOC_KEY = '__doc__';

export default function PapersTab({ doc, chapters, learner }: PapersTabProps) {
  const { m } = useI18n();
  const t = m.learn.detail;

  const [papers, setPapers] = useState<Paper[]>([]);
  const [results, setResults] = useState<PaperResult[]>([]);
  /** 正在出卷的键（章 id 或 DOC_KEY）；非空时全部按钮禁用，避免并发建卷。 */
  const [busyKey, setBusyKey] = useState<string>();
  /** 出卷结果提示（带新卷 id 时给「去答题」直达）。 */
  const [notice, setNotice] = useState<{ text: string; paperId?: string }>();

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [ps, rs] = await Promise.all([
          storage.listPapers(),
          storage.listPaperResults(),
        ]);
        if (!alive) return;
        setPapers(ps);
        setResults(rs);
      } catch (e) {
        console.error('[PapersTab] 加载试卷失败：', e);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const resultByPaper = useMemo(() => {
    const map = new Map<string, PaperResult>();
    for (const r of results) map.set(r.paperId, r);
    return map;
  }, [results]);

  /** chapterId → 该章已有的卷（按创建时间倒序）。 */
  const byChapter = useMemo(() => {
    const known = new Set(chapters.map((c) => c.id));
    const map = new Map<string, Paper[]>();
    for (const p of papers) {
      for (const cid of p.scope.chapterIds) {
        if (!known.has(cid)) continue; // 已删除的章 → 过滤（TC-EDGE-04）
        const list = map.get(cid) ?? [];
        list.push(p);
        map.set(cid, list);
      }
    }
    for (const list of map.values()) list.sort((a, b) => b.createdAt - a.createdAt);
    return map;
  }, [papers, chapters]);

  /** 含已删除章的卷（范围失效）单独提示。 */
  const staleCount = useMemo(() => {
    const known = new Set(chapters.map((c) => c.id));
    return papers.filter((p) => p.scope.chapterIds.some((cid) => !known.has(cid))).length;
  }, [papers, chapters]);

  const docAdvice = useMemo(
    () => recommendDocPaper({ chapters, learner }),
    [chapters, learner],
  );

  /**
   * 一键出卷：落库后**留在本页**刷新列表（不跳走）。
   *
   * 卷型处理：推荐卷型先过 `canCreatePaperMode`；不可出（例：单章推荐阶段测）
   * 则退到当前范围下第一个可出卷型，并在提示里说明改用了什么。
   */
  const createNow = async (key: string, picked: Chapter[], want: PaperMode) => {
    setBusyKey(key);
    setNotice(undefined);
    try {
      const ordered = sortChaptersByOrder(picked);
      const shape = { selected: ordered.length, total: chapters.length };
      const usable = canCreatePaperMode(want, shape);
      const mode = (usable ? want : availablePaperModes(shape)[0]) as
        | Exclude<PaperMode, 'retake'>
        | undefined;
      if (!mode) {
        setNotice({ text: t.papers.errNoMode });
        return;
      }
      const { paper, ai } = await createPaperAndSave({
        chapters: ordered,
        allChapters: chapters,
        mode,
        learnerState: learner,
        text: doc.textPreview,
      });
      setPapers((prev) => [paper, ...prev]);
      setNotice({
        text:
          t.papers.created(paper.questions.length) +
          (ai ? t.papers.createdAi : t.papers.createdLocal) +
          (usable ? '' : t.papers.createdFallback(m.quiz.mode[mode])),
        paperId: paper.id,
      });
    } catch (e) {
      setNotice({
        text:
          e instanceof PaperFlowError && e.kind === 'invalid-mode'
            ? t.papers.errNoMode
            : t.papers.createFailed(e instanceof Error ? e.message : ''),
      });
    } finally {
      setBusyKey(undefined);
    }
  };

  /** 跳向导的链接：补考卷向导不支持，此时不带 mode，避免误导。 */
  const wizardLink = (ids: string[], mode: PaperMode) =>
    `/quiz/new?doc=${doc.id}&chapters=${ids.join(',')}` +
    (mode === 'retake' ? '' : `&mode=${mode}`);

  if (chapters.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line bg-surface p-6 text-center">
        <p className="text-sm font-medium text-ink-1">{t.papers.emptyTitle}</p>
        <p className="mt-1 text-xs text-ink-3">{t.papers.emptyDesc}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 出卷结果提示（无 toast 体系，与 SplitTab 同款样式） */}
      {notice && (
        <div
          data-testid="papers-notice"
          className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface p-3"
        >
          <p className="text-xs text-ink-2">{notice.text}</p>
          {notice.paperId && (
            <Link
              to={`/quiz/${notice.paperId}`}
              className="text-xs text-primary hover:underline sm:ml-auto"
            >
              {t.papers.goAnswer}
            </Link>
          )}
        </div>
      )}

      {/* 资料级推荐：全部章达标 → 建议综合测 */}
      {docAdvice && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-subtle p-3">
          <span className="text-xs font-medium text-ink-2">{t.papers.docAdvice}</span>
          <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-xs text-ink-1">
            {m.quiz.mode[docAdvice.mode]}
          </span>
          <span className="text-xs text-ink-3">
            {t.papers.duration(PAPER_MODE_DURATION_MIN[docAdvice.mode])}
          </span>
          <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
            <Button
              size="sm"
              onClick={() => void createNow(DOC_KEY, chapters, docAdvice.mode)}
              disabled={!!busyKey}
            >
              {busyKey === DOC_KEY ? t.papers.creating : t.papers.createNow}
            </Button>
            <Link
              to={wizardLink(chapters.map((c) => c.id), docAdvice.mode)}
              className="text-xs text-primary hover:underline"
            >
              {t.papers.customNew}
            </Link>
          </div>
        </div>
      )}

      {staleCount > 0 && (
        <div className="rounded-lg border border-line bg-surface p-3">
          <p className="text-xs text-ink-3">
            {t.papers.staleScope} · {staleCount}
          </p>
        </div>
      )}

      {/* 每章一行 */}
      {chapters.map((ch, idx) => {
        const list = byChapter.get(ch.id) ?? [];
        const advice = recommendPaper({ chapter: ch, learner });
        return (
          <div key={ch.id} className="rounded-lg border border-line bg-surface p-4">
            <div className="flex items-center gap-2">
              <span className="min-w-5 text-xs text-ink-3">{idx + 1}</span>
              <Link
                to={`/learn/chapter/${ch.id}`}
                className="truncate text-sm font-medium text-ink-1 hover:text-primary"
              >
                {ch.title}
              </Link>
            </div>

            {list.length === 0 ? (
              /* 未出卷：给推荐卷型 + 难度带 + 预计时长 + 一键出卷 */
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-xs text-ink-3">{t.papers.reason[advice.reason]}</span>
                <span className="rounded-full border border-line bg-subtle px-2 py-0.5 text-xs text-ink-1">
                  {m.quiz.mode[advice.mode]}
                </span>
                <span className="text-xs text-ink-3">
                  {t.papers.difficulty(advice.band)}
                </span>
                <span className="text-xs text-ink-3">
                  {t.papers.duration(PAPER_MODE_DURATION_MIN[advice.mode])}
                </span>
                <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
                  <Button
                    size="sm"
                    onClick={() => void createNow(ch.id, [ch], advice.mode)}
                    disabled={!!busyKey}
                  >
                    {busyKey === ch.id ? t.papers.creating : t.papers.createNow}
                  </Button>
                  <Link
                    to={wizardLink([ch.id], advice.mode)}
                    className="text-xs text-primary hover:underline"
                  >
                    {t.papers.customNew}
                  </Link>
                </div>
              </div>
            ) : (
              <>
                <ul className="mt-3 space-y-2">
                  {list.map((p) => {
                    const result = resultByPaper.get(p.id);
                    const target =
                      p.status === 'done' ? `/report/${p.id}` : `/quiz/${p.id}`;
                    return (
                      <li
                        key={p.id}
                        className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-subtle px-3 py-2"
                      >
                        <span className="text-xs font-medium text-ink-1">
                          {m.quiz.mode[p.scope.mode]}
                        </span>
                        <span className="text-xs text-ink-3">
                          {t.papers.itemCount(p.questions.length)}
                        </span>
                        <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-xs text-ink-2">
                          {m.quiz.status[p.status]}
                        </span>
                        {result && (
                          <span className="text-xs font-semibold text-ink-1">
                            {t.papers.score(Math.round(result.totalScore * 100))}
                          </span>
                        )}
                        <Link
                          to={target}
                          className="text-xs text-primary hover:underline sm:ml-auto"
                        >
                          {p.status === 'done' ? t.papers.viewReport : t.papers.goAnswer}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
                <div className="mt-2 flex w-full items-center gap-2 sm:w-auto">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void createNow(ch.id, [ch], advice.mode)}
                    disabled={!!busyKey}
                  >
                    {busyKey === ch.id ? t.papers.creating : t.papers.createAgain}
                  </Button>
                  <Link
                    to={wizardLink([ch.id], advice.mode)}
                    className="text-xs text-primary hover:underline"
                  >
                    {t.papers.customNew}
                  </Link>
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
