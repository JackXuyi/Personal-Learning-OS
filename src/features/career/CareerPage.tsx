import { ScaffoldPage } from "../scaffold";

export default function CareerPage() {
  return (
    <ScaffoldPage
      title="Career"
      subtitle="One kind of Learning Goal — a job description that maps to skills & evidence."
      scope={[
        "Career goals supported by the Learning Goal model (type: career)",
        "Home dashboard demonstrates the AI Application Engineer example end-to-end",
        "Skill gap detection + dependency-first plan are live in the engines",
      ]}
      nextSteps={[
        "Paste a job description and auto-derive required units",
        "Evidence tracking: projects, interviews, assessments per skill",
        "Interview ability scoring & interview readiness report",
        "Resume ↔ skill graph mapping (out of MVP, tracked in roadmap Phase 3)",
      ]}
    />
  );
}
