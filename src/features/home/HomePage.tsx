import { useEffect } from "react";
import { Link } from "react-router-dom";
import { BandBadge, Bar, Card, SectionTitle, Stat } from "../../components/primitives";
import { PageContainer } from "../../components/layout/AppShell";
import { bandOf } from "../../engine";
import { useLoopStore } from "../../stores/useLoopStore";

const LOOP_STEPS = [
  "文档",
  "知识",
  "图谱",
  "测评",
  "掌握度",
  "下一步",
];

const GOAL_TYPE_LABELS: Record<string, string> = {
  career: "职业",
  study: "学习",
  exam: "考试",
  personal: "个人",
  research: "研究",
  project: "项目",
};

const IMPORTANCE_LABELS: Record<string, string> = {
  high: "高",
  medium: "中",
  low: "低",
};

export default function HomePage() {
  const snapshot = useLoopStore((s) => s.snapshot);
  const loading = useLoopStore((s) => s.loading);
  const error = useLoopStore((s) => s.error);
  const refresh = useLoopStore((s) => s.refresh);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <PageContainer>
      <SectionTitle
        title="学习闭环"
        subtitle="验证闭环：学习 → 证明 → 适应。Demo 数据与 README 中的职业示例一致。"
      />

      {/* 闭环流水线 */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        {LOOP_STEPS.map((step, i) => (
          <span key={step} className="flex items-center gap-2">
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600">
              {step}
            </span>
            {i < LOOP_STEPS.length - 1 ? (
              <span className="text-slate-300">→</span>
            ) : null}
          </span>
        ))}
      </div>

      {error ? (
        <Card>
          <p className="text-sm text-red-600">{error}</p>
        </Card>
      ) : null}

      {loading && !snapshot ? (
        <Card>
          <p className="text-sm text-slate-500">正在运行学习闭环…</p>
        </Card>
      ) : null}

      {snapshot ? (
        <div className="space-y-6">
          {/* 目标就绪度 */}
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  当前目标
                </p>
                <p className="mt-1 text-lg font-semibold text-slate-900">
                  {snapshot.goal.title}
                </p>
                <p className="text-sm text-slate-500">
                  {GOAL_TYPE_LABELS[snapshot.goal.type] ?? snapshot.goal.type} · 重要性{" "}
                  {IMPORTANCE_LABELS[snapshot.goal.importance] ?? snapshot.goal.importance}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-8">
                <Stat
                  label="就绪度"
                  value={`${Math.round(snapshot.readiness * 100)}%`}
                  hint="掌握度 ≥ 80% 的单元"
                />
                <Stat
                  label="待补缺口"
                  value={`${snapshot.actions.length}`}
                  hint="来自学习规划器"
                />
              </div>
            </div>
            <div className="mt-4">
              <Bar value={snapshot.readiness} />
            </div>
          </Card>

          {/* 最佳下一步 */}
          {snapshot.next ? (
            <Card className="border-indigo-200 bg-indigo-50/50">
              <SectionTitle
                title="最佳下一步"
                subtitle="由推荐引擎给出——附带理由（可解释）。"
              />
              <div className="flex items-center gap-3">
                <span className="rounded-md bg-indigo-600 px-2 py-0.5 text-xs font-medium text-white">
                  {actionKindLabel(snapshot.next.kind)}
                </span>
                <span className="text-sm font-semibold text-slate-900">
                  {unitTitle(snapshot.next.unitId)}
                </span>
              </div>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-600">
                {snapshot.next.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </Card>
          ) : null}

          {/* 完整学习计划 */}
          <Card>
            <SectionTitle
              title="学习计划"
              subtitle="学习规划器按依赖优先级排序。"
            />
            <PlanList />
          </Card>
        </div>
      ) : null}
    </PageContainer>
  );
}

function PlanList() {
  const snapshot = useLoopStore((s) => s.snapshot);
  if (!snapshot || snapshot.actions.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        没有待补缺口——目标进展正常。{" "}
        <Link to="/knowledge" className="text-indigo-600 hover:underline">
          查看你的知识图谱
        </Link>
        。
      </p>
    );
  }
  return (
    <ol className="space-y-2">
      {snapshot.actions.map((action, i) => {
        const mastery = snapshot.masteryByUnit[action.unitId] ?? 0;
        return (
          <li
            key={action.id}
            className="flex items-center justify-between gap-4 rounded-lg border border-slate-100 px-3 py-2"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span className="w-6 shrink-0 text-sm font-medium text-slate-400">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                {actionKindLabel(action.kind)}
              </span>
              <span className="truncate text-sm font-medium text-slate-800">
                {unitTitle(action.unitId)}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="text-xs text-slate-400">掌握度 {Math.round(mastery * 100)}%</span>
              <BandBadge band={bandOf(mastery)} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function unitTitle(unitId: string): string {
  const labels: Record<string, string> = {
    "rag-retrieval": "检索",
    "rag-embedding": "Embedding",
    "rag-chunking": "分块",
    "rag-reranking": "重排序",
    "rag-evaluation": "评估",
    "rag-production": "生产部署",
    "vector-search": "向量检索",
    agent: "智能体",
    react: "React",
    typescript: "TypeScript",
    python: "Python",
    rag: "RAG",
  };
  return labels[unitId] ?? unitId;
}

function actionKindLabel(kind: string): string {
  const labels: Record<string, string> = {
    learn: "学习",
    review: "复习",
    practice: "练习",
    remediation: "补救",
    assessment: "测评",
    explore: "探索",
  };
  return labels[kind] ?? kind;
}
