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
      // P0-3 判分契约：无 AI 时不伪造判分。开放题本地无法可靠判对错——
      // 不做「与 reference 逐字相等才判对」的假判（恒判错 / 恒判对都会污染
      // 学习者模型），返回 pending（score 缺失 + feedback 标注需 AI）。
      // misconceptions 恒空：由 AI 批语回填，禁止本地猜测。
      const answered = answer.content.trim().length > 0;
      if (!answered) {
        return {
          questionId: question.id,
          correct: false,
          score: 0,
          feedback: "未作答。",
          misconceptionsDetected: [],
        };
      }
      return {
        questionId: question.id,
        correct: false,
        score: undefined, // pending：不计入得分，不更新掌握度
        feedback: "主观题需 AI 精确判分——未配置 Provider，本答案暂不计入对错。",
        misconceptionsDetected: [],
      };
    },
  };
}
