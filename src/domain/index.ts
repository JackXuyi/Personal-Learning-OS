/**
 * Domain layer — the five core objects of Personal Learning OS.
 *
 * 1. SourceDocument — the user's own knowledge sources.
 * 2. Knowledge (KnowledgeUnit) — semantic units extracted from documents.
 * 3. KnowledgeGraph — how knowledge units relate to each other.
 * 4. LearnerState — what the user actually masters right now.
 * 5. LearningGoal — the entry point of the whole system.
 *
 * Plus the supporting types for the learning loop: assessment, evidence,
 * gaps and next actions.
 */

export * from "./document";
export * from "./knowledge";
export * from "./learner";
export * from "./goal";
export * from "./assessment";
export * from "./plan";

/** Deterministic, dependency-free id generator (local-first friendly). */
export function newId(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${rand}`;
}
