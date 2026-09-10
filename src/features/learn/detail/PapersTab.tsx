/**
 * 「章节测评试卷」Tab —— 展示已生成卷与成绩，并按学习情况推荐卷型。
 *
 * 两处关键修正（docs/library-detail-page-design-2026-09.md §8.17）：
 * - **B4**：旧实现完全没读 storage，每章硬编码「暂无试卷」。现在 mount 时读
 *   `listPapers()` + `listPaperResults()`，按 `scope.chapterIds` 反查章。
 * - **只展示、不生成**：本页**零写入**（无 savePaper / deletePaper），出卷动作
 *   一律跳 `/quiz/new` 由用户确认（TC-EDGE-07）。
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../../../i18n';
import { storage } from '../../../stores/useLoopStore';
import { PAPER_MODE_DURATION_MIN } from '../../../domain';
import { recommendDocPaper, recommendPaper } from '../paper-advice';
import type { Chapter, LearnerState, Paper, PaperResult, SourceDocument } from '../../../domain';

interface PapersTabProps {
  doc: SourceDocument;
  chapters: Chapter[];
  learner: LearnerState | null;
}

export default function PapersTab({ doc, chapters, learner }: PapersTabProps) {
  const { m } = useI18n();
  const t = m.learn.detail;

  const [papers, setPapers] = useState<Paper[]>([]);
  const [results, setResults] = useState<PaperResult[]>([]);

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
          <Link
            to={`/quiz/new?doc=${doc.id}&chapters=${chapters.map((c) => c.id).join(',')}&mode=${docAdvice.mode}`}
            className="ml-auto text-xs text-primary hover:underline"
          >
            {t.papers.goNew}
          </Link>
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
              /* 未出卷：给推荐卷型 + 难度带 + 预计时长 */
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
                <Link
                  to={`/quiz/new?doc=${doc.id}&chapters=${ch.id}&mode=${advice.mode}`}
                  className="ml-auto text-xs text-primary hover:underline"
                >
                  {t.papers.goNew}
                </Link>
              </div>
            ) : (
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
                        className="ml-auto text-xs text-primary hover:underline"
                      >
                        {p.status === 'done' ? t.papers.viewReport : t.papers.goAnswer}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
