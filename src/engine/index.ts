/**
 * Core Engine layer — the seven engines behind the learning loop.
 *
 *   Knowledge Engine · Knowledge Graph · Learner Model · Mastery Engine
 *   Assessment Engine · Learning Planner · Recommendation Engine
 *
 * Plus `loop.ts`, the orchestration demo that closes the loop.
 */
export * from "./knowledge-engine";
export * from "./graph-engine";
export * from "./learner-model";
export * from "./mastery-engine";
export * from "./assessment-engine";
export * from "./learning-planner";
export * from "./recommendation-engine";
export * from "./loop";
