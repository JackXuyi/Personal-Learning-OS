import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import AppShell from "./components/layout/AppShell";
import HomePage from "./features/home/HomePage";
import LibraryPage from "./features/learn/LibraryPage";
import DocumentDetailPage from "./features/learn/DocumentDetailPage";
import ChapterReaderPage from "./features/learn/ChapterReaderPage";
import ChapterGraphPage from "./features/knowledge/ChapterGraphPage";
import CrossDocGraphPage from "./features/knowledge/CrossDocGraphPage";
import LegacyLearnRedirect from "./features/learn/LegacyLearnRedirect";
import QuizCenterPage from "./features/quiz/QuizCenterPage";
import NewQuizPage from "./features/quiz/NewQuizPage";
import QuizAnswerPage from "./features/quiz/QuizAnswerPage";
import QuizGradingPage from "./features/quiz/QuizGradingPage";
import QuizReportPage from "./features/quiz/QuizReportPage";
import AssessmentPage from "./features/assessment/AssessmentPage";
import GoalsPage from "./features/goals/GoalsPage";
import GoalFormPage from "./features/goals/GoalFormPage";
import GoalDetailPage from "./features/goals/GoalDetailPage";
import CapabilityPage from "./features/goals/CapabilityPage";
import CapabilityRunPage from "./features/goals/CapabilityRunPage";
import LearnerPage from "./features/learner/LearnerPage";
import ProgressPage from "./features/progress/ProgressPage";
import MemoryPage from "./features/memory/MemoryPage";
import PlanPage from "./features/plan/PlanPage";
import ReviewSession from "./features/study/ReviewSession";
import SettingsPage from "./features/settings/SettingsPage";

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<HomePage />} />
          {/* 原 /spaces 学习空间占位页已下线（docs/copy-optimization-design-2026-10.md §5.2 T-P0-4）：
              该页文案是开发备忘（讲 src/storage 预留、chunking 流水线），无功能、无数据、无导航入口；
              断链按历史 URL 处理 → 归首页。*/}
          <Route path="spaces" element={<Navigate to="/" replace />} />
          {/* 原 /knowledge 图谱列表被 V2 章节目录取代（docs §4 P1）；N5 图谱回归为章内概念图谱 */}
          <Route path="knowledge" element={<Navigate to="/learn" replace />} />
          {/* V2 资料库：列表页 + 详情页 + 旧链接兼容 */}
          <Route path="learn" element={<LibraryPage />} />
          <Route path="learn/doc/:docId" element={<DocumentDetailPage />} />
          <Route path="learn/chapter/:chapterId" element={<ChapterReaderPage />} />
          {/* N5 概念层回归：章概念图谱（AI 提炼 + GraphView 可视化 + 概念复习入口） */}
          <Route path="learn/chapter/:chapterId/graph" element={<ChapterGraphPage />} />
          {/* 旧路径兼容：/learn/<id> 与 /learn/<id>/graph 自动判定为章节链接或资料详情 */}
          <Route path="learn/:legacyId" element={<LegacyLearnRedirect />} />
          <Route path="learn/:legacyId/graph" element={<LegacyLearnRedirect variant="graph" />} />
          {/* 跨资料概念图谱：原侧栏 N5 占位项激活（单章 / 单资料图谱各有既有页面） */}
          <Route path="graph" element={<CrossDocGraphPage />} />
          {/* V2 试卷中心（P3/P4/P5/P6；出卷向导 / 答题 / 判卷 / 报告） */}
          <Route path="quiz" element={<QuizCenterPage />} />
          <Route path="quiz/new" element={<NewQuizPage />} />
          <Route path="quiz/:paperId/grading" element={<QuizGradingPage />} />
          <Route path="quiz/:paperId" element={<QuizAnswerPage />} />
          <Route path="report/:paperId" element={<QuizReportPage />} />
          <Route path="assessment" element={<AssessmentPage />} />
          {/* U6：/career 语义并入 /goals（多目标 CRUD）；历史链接保留 → 重定向 */}
          <Route path="career" element={<Navigate to="/goals" replace />} />
          {/* U6 Goals：多目标 CRUD（列表 / 新建 / 编辑 / 详情） */}
          <Route path="goals" element={<GoalsPage />} />
          <Route path="goals/new" element={<GoalFormPage />} />
          <Route path="goals/:goalId/edit" element={<GoalFormPage />} />
          {/* F6 目标级能力评测（语义更窄者优先：capability 路由必须先于详情页） */}
          <Route path="goals/:goalId/capability" element={<CapabilityPage />} />
          <Route path="goals/:goalId/capability/run/:runId" element={<CapabilityRunPage />} />
          <Route path="goals/:goalId" element={<GoalDetailPage />} />
          {/* U6 My Learner：纯视图画像 */}
          <Route path="learner" element={<LearnerPage />} />
          {/* F3 复盘与趋势：独立分析页（D1 —— /learner 保持「系统怎么理解我」的定位，只挂入口卡） */}
          <Route path="progress" element={<ProgressPage />} />
          {/* F9 学习者记忆：一份「系统整理、用户可改」的文档（D2 —— 不影响计划与配额） */}
          <Route path="memory" element={<MemoryPage />} />
          {/* /study 概念层队列已迁移为 V2 章级 /plan（docs §2 融合矩阵 #5）；/study/session 保留概念复习会话 */}
          <Route path="study" element={<Navigate to="/plan" replace />} />
          <Route path="plan" element={<PlanPage />} />
          <Route path="study/session" element={<ReviewSession />} />
          {/* 分区 URL 化（docs/settings-left-menu-layout-design-2026-10.md §8.6）：
              两条路由指向同一组件；无段时 SettingsPage 内部 replace 到 /settings/ai。 */}
          <Route path="settings" element={<SettingsPage />} />
          <Route path="settings/:section" element={<SettingsPage />} />
          <Route path="*" element={<HomePage />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
