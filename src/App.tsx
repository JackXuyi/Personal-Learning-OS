import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import AppShell from "./components/layout/AppShell";
import HomePage from "./features/home/HomePage";
import SpacesPage from "./features/spaces/SpacesPage";
import ChapterCatalogPage from "./features/learn/ChapterCatalogPage";
import ChapterReaderPage from "./features/learn/ChapterReaderPage";
import ChapterGraphPage from "./features/knowledge/ChapterGraphPage";
import QuizCenterPage from "./features/quiz/QuizCenterPage";
import NewQuizPage from "./features/quiz/NewQuizPage";
import QuizAnswerPage from "./features/quiz/QuizAnswerPage";
import QuizGradingPage from "./features/quiz/QuizGradingPage";
import QuizReportPage from "./features/quiz/QuizReportPage";
import AssessmentPage from "./features/assessment/AssessmentPage";
import CareerPage from "./features/career/CareerPage";
import PlanPage from "./features/plan/PlanPage";
import ReviewSession from "./features/study/ReviewSession";
import SettingsPage from "./features/settings/SettingsPage";

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route path="spaces" element={<SpacesPage />} />
          {/* 原 /knowledge 图谱列表被 V2 章节目录取代（docs §4 P1）；N5 图谱回归为章内概念图谱 */}
          <Route path="knowledge" element={<Navigate to="/learn" replace />} />
          <Route path="learn" element={<ChapterCatalogPage />} />
          <Route path="learn/:chapterId" element={<ChapterReaderPage />} />
          {/* N5 概念层回归：章概念图谱（AI 提炼 + GraphView 可视化 + 概念复习入口） */}
          <Route path="learn/:chapterId/graph" element={<ChapterGraphPage />} />
          {/* V2 试卷中心（P3/P4/P5/P6；出卷向导 / 答题 / 判卷 / 报告） */}
          <Route path="quiz" element={<QuizCenterPage />} />
          <Route path="quiz/new" element={<NewQuizPage />} />
          <Route path="quiz/:paperId/grading" element={<QuizGradingPage />} />
          <Route path="quiz/:paperId" element={<QuizAnswerPage />} />
          <Route path="report/:paperId" element={<QuizReportPage />} />
          <Route path="assessment" element={<AssessmentPage />} />
          <Route path="career" element={<CareerPage />} />
          {/* /study 概念层队列已迁移为 V2 章级 /plan（docs §2 融合矩阵 #5）；/study/session 保留概念复习会话 */}
          <Route path="study" element={<Navigate to="/plan" replace />} />
          <Route path="plan" element={<PlanPage />} />
          <Route path="study/session" element={<ReviewSession />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<HomePage />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
