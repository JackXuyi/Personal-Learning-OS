import { ScaffoldPage } from "../scaffold";

export default function CareerPage() {
  return (
    <ScaffoldPage
      title="职业"
      subtitle="一种 Learning Goal——通过职位描述映射到技能与证据。"
      scope={[
        "Career 目标由 Learning Goal 模型支持（type: career）",
        "首页仪表盘端到端演示了 AI Application Engineer 示例",
        "技能差距检测 + 依赖优先计划已在引擎中实装",
      ]}
      nextSteps={[
        "粘贴职位描述并自动推导所需单元",
        "证据追踪：每个技能对应的项目、面试、测评",
        "面试能力评分与面试就绪报告",
        "简历 ↔ 技能图谱映射（超出 MVP，列入路线图 Phase 3）",
      ]}
    />
  );
}
