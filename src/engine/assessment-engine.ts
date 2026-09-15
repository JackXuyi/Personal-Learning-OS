/**
 * Assessment Engine（测评引擎）—— 生成本地确定性题目并评估作答。
 *
 * ⚠️ **本引擎不出题给 AI**（F6 T13 止损）：曾有一条「provider 已配置时交由模型
 * 出题与判分」的分支，但 `AIProvider.generateAssessment` / `evaluateAnswer` 的
 * 四个实现（builtin / openai-compatible / registry / active）**全部只抛
 * not-implemented 且零调用方** —— 那段 try/catch 在运行时只会走 catch 并
 * `console.warn`，属「看似接了 AI、实际恒本地」的假接线，会误导后来者以为
 * AI 测评只差实现。该分支与那两个接口方法已一并删除。
 *
 * 现在行为唯一且诚实：**未接入 AI 时退化为确定性的本地题目 + pending 判分**。
 * 真正的 AI 评测管线是 F6 的目标级能力评测（`ai/capability.ts` 三管线 +
 * `features/goals/capability-service.ts` 编排），与本引擎分层。
 */
import type {
  Answer,
  CognitiveLevel,
  Evaluation,
  KnowledgeUnit,
  Question,
  QuestionType,
} from "../domain";
import { newId } from "../domain";
import type { Messages } from "../i18n/messages/zh";
import { zh } from "../i18n/messages/zh";

export interface AssessmentEngine {
  generateForUnit(
    unit: KnowledgeUnit,
    type?: QuestionType,
    cognitiveLevel?: CognitiveLevel,
  ): Promise<Question>;
  evaluate(question: Question, answer: Answer): Promise<Evaluation>;
}

export function createAssessmentEngine(m: Messages = zh): AssessmentEngine {
  return {
    async generateForUnit(unit, type = "understanding", cognitiveLevel = "understand") {
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
          feedback: m.engine.notAnswered,
          misconceptionsDetected: [],
        };
      }
      return {
        questionId: question.id,
        correct: false,
        score: undefined, // pending：不计入得分，不更新掌握度
        feedback: m.engine.pendingSubjective,
        misconceptionsDetected: [],
      };
    },
  };
}
