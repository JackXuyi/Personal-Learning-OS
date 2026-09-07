import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import AppShell from "./components/layout/AppShell";
import HomePage from "./features/home/HomePage";
import SpacesPage from "./features/spaces/SpacesPage";
import ChapterCatalogPage from "./features/learn/ChapterCatalogPage";
import ChapterReaderPage from "./features/learn/ChapterReaderPage";
import AssessmentPage from "./features/assessment/AssessmentPage";
import CareerPage from "./features/career/CareerPage";
import StudyPage from "./features/study/StudyPage";
import ReviewSession from "./features/study/ReviewSession";
import SettingsPage from "./features/settings/SettingsPage";

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route path="spaces" element={<SpacesPage />} />
          {/* 原 /knowledge 图谱列表被 V2 章节目录取代（docs §4 P1）；图谱延后 N5 */}
          <Route path="knowledge" element={<Navigate to="/learn" replace />} />
          <Route path="learn" element={<ChapterCatalogPage />} />
          <Route path="learn/:chapterId" element={<ChapterReaderPage />} />
          <Route path="assessment" element={<AssessmentPage />} />
          <Route path="career" element={<CareerPage />} />
          <Route path="study" element={<StudyPage />} />
          <Route path="study/session" element={<ReviewSession />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<HomePage />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
