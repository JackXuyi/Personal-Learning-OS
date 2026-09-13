/**
 * 图谱节点（React Flow 自定义节点）。
 *
 * 视觉对齐改造前的 SVG 节点：掌握度四色 + 缺口 indigo 脉冲圈 + 导入琥珀虚线框
 * + skill 菱形。主体用内嵌 `<svg>` 而非 HTML 盒：菱形要精确复刻原 polygon 的
 * 「宽 w × 高 32」形状（旋转方块的对角线相等，画不出扁菱形）；颜色则一律走
 * PLOS token（改造前是硬编码 hex，见方案 §7.4）。
 *
 * 不挂 `<Handle>`：本图不连线（`nodesConnectable={false}`），React Flow 以节点
 * 边界作为边的锚点。
 */
import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import {
  NODE_H,
  NODE_R,
  nodeVisualOf,
  type UnitFlowNode,
} from "./graph-flow-model";

function UnitNodeImpl({ data }: NodeProps<UnitFlowNode>) {
  const { unit, mastery, width, isGap, isHighlight, title } = data;
  const v = nodeVisualOf(unit, mastery);
  const diamond = v.shape === "diamond";
  const halfW = width / 2;
  const halfH = NODE_H / 2;

  return (
    <div className="relative" style={{ width, height: NODE_H }}>
      {/* overflow-visible：缺口圈 / 高亮框会外扩到节点盒之外 */}
      <svg
        width={width}
        height={NODE_H}
        className="absolute inset-0 overflow-visible"
        aria-hidden="true"
      >
        {/* 缺口节点：indigo 外圈脉冲 */}
        {isGap ? (
          <circle
            cx={halfW}
            cy={halfH}
            r={halfH + 6}
            fill="none"
            stroke="var(--plos-primary)"
            strokeWidth={1.6}
            className="animate-pulse"
          />
        ) : null}
        {/* 导入新节点：琥珀虚线外圈 */}
        {isHighlight ? (
          <rect
            x={-7}
            y={-7}
            width={width + 14}
            height={NODE_H + 14}
            rx={NODE_R + 6}
            fill="none"
            stroke="var(--plos-state-weak)"
            strokeWidth={1.6}
            strokeDasharray="5 4"
          />
        ) : null}
        {/* 主体 */}
        {diamond ? (
          <polygon
            points={`${halfW},0 ${width},${halfH} ${halfW},${NODE_H} 0,${halfH}`}
            fill={v.fill}
            stroke={v.stroke}
            strokeWidth={1.4}
          />
        ) : (
          <rect
            x={0}
            y={0}
            width={width}
            height={NODE_H}
            rx={NODE_R}
            fill={v.fill}
            stroke={v.stroke}
            strokeWidth={1.4}
          />
        )}
      </svg>
      <span className="absolute inset-0 z-10 flex items-center justify-center px-2 text-[12.5px] font-medium text-ink-1">
        <span className="truncate">{title}</span>
      </span>
    </div>
  );
}

export default memo(UnitNodeImpl);
