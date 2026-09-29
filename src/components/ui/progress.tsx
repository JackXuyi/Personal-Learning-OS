import * as React from "react";
import { Progress as BaseProgress } from "@base-ui/react/progress";
import { cn } from "../../lib/utils";

/**
 * Progress（UI Kit；Base UI 底层，2026-09-29 进度条统一迁移）。
 *
 * - Root 直接承载轨道视觉（h-1.5 / bg-subtle / rounded-full / overflow-hidden），
 *   `className` 可覆写高度、宽度与轨道背景（tailwind-merge 后写优先）；
 * - Indicator 宽度百分比由 Base UI 内联注入（value 相对 min/max），
 *   填充色默认 `bg-primary`，覆写走 `indicatorClassName`；
 * - Base UI 托管 `role="progressbar"` 与 aria 语义（value 为 null = indeterminate）。
 *
 * 领域语义包装见 `primitives.tsx::Bar`（目标刻度线）；业务代码**不得**再手写
 * track+fill 进度条（本控件为唯一来源）。
 */
function Progress({
  className,
  indicatorClassName,
  value,
  ...props
}: React.ComponentProps<typeof BaseProgress.Root> & {
  /** 填充条覆写（颜色 / 过渡时长）；默认 `bg-primary transition-all`。 */
  indicatorClassName?: string;
}) {
  return (
    <BaseProgress.Root
      data-slot="progress"
      value={value}
      className={cn(
        "relative h-1.5 w-full overflow-hidden rounded-full bg-subtle",
        className,
      )}
      {...props}
    >
      <BaseProgress.Track className="h-full w-full">
        <BaseProgress.Indicator
          data-slot="progress-indicator"
          className={cn(
            "h-full rounded-full bg-primary transition-all",
            indicatorClassName,
          )}
        />
      </BaseProgress.Track>
    </BaseProgress.Root>
  );
}

export { Progress };
