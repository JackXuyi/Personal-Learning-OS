import { Card, SectionTitle } from "../../components/primitives";
import { PageContainer } from "../../components/layout/AppShell";
import { ScaffoldPage } from "../scaffold";

/**
 * 学习 —— 计划与记录。
 *
 * 后续里程碑：
 *  1. LearningPlanner 输出 → 持久化的“计划”实体（截止日期、每单元节奏）。
 *  2. 学习记录器：记录尝试次数/用时，将评测结果回灌到闭环。
 *  3. 记录回顾界面：展示每次记录的掌握度变化（证据链）。
 */
export default function StudyPage() {
  return (
    <ScaffoldPage
      title="学习"
      subtitle="学习计划与学习记录——把规划器输出接入可执行的记录。"
      scope={[
        "LearningPlanner 依据差距 + 目标重要性计算排序后的单元队列",
        "RecommendationEngine 选出唯一下一步动作并给出可解释原因",
        "MasteryEngine 随时间施加遗忘衰减",
      ]}
      nextSteps={[
        "持久化生成的计划（带排期与截止日期的 LearningPlan 实体）",
        "记录学习过程：时长、尝试次数、自评 → 提交证据",
        "按 Learning Space 渲染计划时间线视图",
      ]}
    />
  );
}

/** 计划视图上线前的占位组件——记录预期的布局。 */
export function StudyPlanPreview() {
  return (
    <PageContainer>
      <SectionTitle
        title="学习"
        subtitle="学习计划与学习记录"
      />
      <Card>
        <p className="text-sm text-slate-500">
          由 LearningPlanner 引擎生成的计划会在此按 Learning Space 分组列出，
          包含每单元的节奏安排与复习计划。
        </p>
      </Card>
    </PageContainer>
  );
}
