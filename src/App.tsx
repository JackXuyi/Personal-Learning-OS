import { HashRouter, Route, Routes } from "react-router-dom";
import AppShell from "./components/layout/AppShell";
import HomePage from "./features/home/HomePage";
import SpacesPage from "./features/spaces/SpacesPage";
import KnowledgePage from "./features/knowledge/KnowledgePage";
import AssessmentPage from "./features/assessment/AssessmentPage";
import CareerPage from "./features/career/CareerPage";
import StudyPage from "./features/study/StudyPage";
import SettingsPage from "./features/settings/SettingsPage";

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route path="spaces" element={<SpacesPage />} />
          <Route path="knowledge" element={<KnowledgePage />} />
          <Route path="assessment" element={<AssessmentPage />} />
          <Route path="career" element={<CareerPage />} />
          <Route path="study" element={<StudyPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<HomePage />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
