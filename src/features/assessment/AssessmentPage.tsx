import { ScaffoldPage } from "../scaffold";

export default function AssessmentPage() {
  return (
    <ScaffoldPage
      title="测评"
      subtitle="自适应题目——从回忆到面试——用于更新你的 Learner State。"
      scope={[
        "Assessment Engine 契约：使用 AI 或本地降级方案生成与评分",
        "Learner Model 根据评测更新掌握度 / 误解 / 置信度",
        "题目类型与 Bloom 认知层级已在领域层建模",
      ]}
      nextSteps={[
        "对任意知识单元作答（demo 模式）",
        "AI 答案评测 prompt 流水线（provider 感知）",
        "动态难度：答对 → 更难，答错 → 更简单 + 补救",
        "误解检测与误解复习队列",
      ]}
    />
  );
}
