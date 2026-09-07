/**
 * Assessment Engine（测评引擎）—— 生成题目并评估作答。
 *
 * 配置了 Provider 时交由模型出题与判分（下一里程碑的提示词流水线）；
 * 未配置时退化为确定性的本地题目，让闭环始终可演示。
 */
import type { AIProvider } from "../ai";
import type {
  Answer,
  CognitiveLevel,
  Evaluation,
  KnowledgeUnit,
  Question,
  QuestionType,
} from "../domain";
import { newId } from "../domain";

export interface AssessmentEngine {
  generateForUnit(
    unit: KnowledgeUnit,
    type?: QuestionType,
    cognitiveLevel?: CognitiveLevel,
  ): Promise<Question>;
  evaluate(question: Question, answer: Answer): Promise<Evaluation>;
}

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

export function createAssessmentEngine(provider?: AIProvider): AssessmentEngine {
  const askProvider = Boolean(provider?.isConfigured());

  return {
    async generateForUnit(unit, type = "understanding", cognitiveLevel = "understand") {
      if (askProvider && provider) {
        try {
          return await provider.generateAssessment({ unitId: unit.id, cognitiveLevel, questionType: type });
        } catch (err: unknown) {
          console.warn(`[assessment-engine] provider fell back to local: ${String(err)}`);
        }
      }
      const id = newId("q");
      return {
        id,
        unitId: unit.id,
        type,
        cognitiveLevel,
        prompt: `Explain "${unit.title}" in your own words and give one concrete example.`,
        difficulty: 2,
        referenceAnswer: unit.summary,
      };
    },

    async evaluate(question, answer) {
      if (askProvider && provider) {
        try {
          return await provider.evaluateAnswer(question, answer);
        } catch (err: unknown) {
          console.warn(`[assessment-engine] provider evaluation fell back to local: ${String(err)}`);
        }
      }
      // 本地启发式评分：没有 AI 时只标记明显的自测结果。
      const answered = answer.content.trim().length > 0;
      const matchesReference =
        Boolean(question.referenceAnswer) &&
        normalize(answer.content) === normalize(question.referenceAnswer ?? "");
      return {
        questionId: question.id,
        correct: answered && matchesReference,
        score: answered ? (matchesReference ? 1 : undefined) : 0,
        feedback: matchesReference
          ? "Matched the reference answer."
          : "Open-ended answer — AI scoring required for a precise grade.",
        misconceptionsDetected: [],
      };
    },
  };
}
