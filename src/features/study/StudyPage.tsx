import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BandBadge, Card, SectionTitle } from "../../components/primitives";
import { PageContainer } from "../../components/layout/AppShell";
import { DeltaBadge } from "../../components/DeltaBadge";
import { bandOf } from "../../engine";
import { useLoopStore, storage } from "../../stores/useLoopStore";
import { useSessionStore } from "../../stores/useSessionStore";
import type { LearnerState } from "../../domain";
import { actionKindLabel, unitTitle } from "../units";

/**
 * 学习 —— 今日队列页。
 *
 * 队列 = 学习规划器输出的缺口动作（依赖优先）。每项都可直接进入
 * 复习会话；「全部开始」从队首开始依次完成。
 */
export default function StudyPage() {
  const navigate = useNavigate();
  const snapshot = useLoopStore((s) => s.snapshot);
  const loading = useLoopStore((s) => s.loading);
  const refresh = useLoopStore((s) => s.refresh);
  const records = useSessionStore((s) => s.records);
  const clearRecords = useSessionStore((s) => s.clear);

  const [learner, setLearner] = useState<LearnerState | undefined>();

  useEffect(() => {
    void (async () => {
      await refresh();
      setLearner(await storage.getLearnerState());
    })();
  }, [refresh]);

  const actions = snapshot?.actions ?? [];
  const done = [...records].reverse();

  return (
    <PageContainer>
      <SectionTitle
        title="学习 · 今日计划"
        subtitle={
          snapshot
            ? `目标：${snapshot.goal.title} · 就绪度 ${Math.round(snapshot.readiness * 100)}%`
            : "加载学习队列…"
        }
      />

      {loading && !snapshot ? (
        <Card>
          <p className="text-sm text-slate-500">正在读取今日队列…</p>
        </Card>
      ) : null}

      {snapshot && actions.length === 0 ? (
        <Card className="border-emerald-200 bg-emerald-50/40">
          <p className="text-lg font-semibold text-slate-900">🎉 今日队列已清空</p>
          <p className="mt-1 text-sm text-slate-500">
            所有缺口单元都达标了，可以测评巩固，或查看章节目录。
          </p>
          <div className="mt-4 flex gap-3">
            <Link
              to="/assessment"
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              去测评巩固
            </Link>
            <Link
              to="/learn"
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              查看章节目录
            </Link>
          </div>
        </Card>
      ) : null}

      {snapshot && actions.length > 0 ? (
        <>
          <Card className="mb-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-slate-800">
                  今日复习队列（{actions.length} 项 · 按推荐序）
                </p>
                <p className="mt-0.5 text-xs text-slate-400">
                  依次复习缺口单元；间隔建议为启发式估计。
                </p>
              </div>
              <button
                onClick={() => navigate("/study/session")}
                className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
              >
                ▶ 全部开始
              </button>
            </div>
            <ol className="mt-4 space-y-2">
              {actions.map((action) => {
                const mastery = snapshot.masteryByUnit[action.unitId] ?? 0;
                const hint = queueHint(action.unitId, mastery, learner);
                return (
                  <li
                    key={action.id}
                    className="group flex items-center justify-between gap-4 rounded-lg border border-slate-100 px-3 py-2.5 transition hover:border-indigo-100 hover:bg-indigo-50/30"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                        {actionKindLabel(action.kind)}
                      </span>
                      <span className="truncate text-sm font-medium text-slate-800">
                        {unitTitle(action.unitId)}
                      </span>
                      <span className="hidden text-xs text-slate-400 sm:inline">{hint}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="text-xs text-slate-400">
                        掌握度 {Math.round(mastery * 100)}%
                      </span>
                      <BandBadge band={bandOf(mastery)} />
                      <button
                        onClick={() => navigate(`/study/session?unit=${action.unitId}`)}
                        aria-label={`复习 ${unitTitle(action.unitId)}`}
                        className="rounded-md px-2 py-1 text-sm text-indigo-600 opacity-0 transition hover:bg-indigo-100 group-hover:opacity-100"
                      >
                        ▶
                      </button>
                    </div>
                  </li>
                );
              })}
            </ol>
          </Card>
        </>
      ) : null}

      {/* 今日已完成 */}
      {done.length > 0 ? (
        <Card>
          <SectionTitle
            title="今日已完成"
            subtitle={`${done.length} 次提交 · 掌握度变化为启发式估计`}
            action={
              <button
                onClick={clearRecords}
                className="text-xs font-medium text-slate-400 hover:text-slate-600"
              >
                清空记录
              </button>
            }
          />
          <ul className="space-y-2">
            {done.map((r) => (
              <li
                key={`${r.unitId}-${r.at}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2"
              >
                <span className="text-sm font-medium text-slate-700">
                  {unitTitle(r.unitId)}
                  <span className="ml-2 text-xs font-normal text-slate-400">
                    {r.mode === "assessment" ? "测评" : "复习"}
                    {r.rating ? ` · ${ratingLabel(r.rating)}` : r.correct !== undefined ? ` · ${r.correct ? "答对" : "答错"}` : ""}
                  </span>
                </span>
                <DeltaBadge delta={r.masteryDelta} nextReviewInDays={r.nextReviewInDays} />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </PageContainer>
  );
}

function ratingLabel(rating: string): string {
  return (
    { forget: "忘记", hard: "困难", good: "记得", easy: "轻松" }[rating] ?? rating
  );
}

/** 队列项的启发式间隔提示。 */
function queueHint(unitId: string, mastery: number, learner?: LearnerState): string {
  if (mastery <= 0) return "新内容";
  const last = learner?.byUnit[unitId]?.lastReviewedAt;
  if (!last) return "尚未复习";
  const days = Math.max(0, Math.floor((Date.now() - last) / 86_400_000));
  if (days <= 0) return "今天刚复习";
  return `上次 ${days} 天前 · ${days >= 3 ? "建议今天" : "可延后"}`;
}
