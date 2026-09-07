import { ScaffoldPage } from "../scaffold";

export default function AssessmentPage() {
  return (
    <ScaffoldPage
      title="Assessment"
      subtitle="Adaptive questions — Recall to Interview — that update your Learner State."
      scope={[
        "Assessment Engine contract: generate + evaluate with AI or local fallback",
        "Learner Model updates mastery / misconceptions / confidence from evaluations",
        "Question types & Bloom cognitive levels modeled in the domain layer",
      ]}
      nextSteps={[
        "Take a question for any knowledge unit (demo mode)",
        "AI answer evaluation prompt pipeline (provider-aware)",
        "Dynamic difficulty: correct → harder, wrong → easier + remediation",
        "Misconception detection & misconception review queue",
      ]}
    />
  );
}
