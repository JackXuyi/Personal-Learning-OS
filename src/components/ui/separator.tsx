import * as React from "react";
import { cn } from "../../lib/utils";

/**
 * Separator（UI Kit；shadcn 同构手写，原生 div，无 headless 依赖）。
 * decorative=true（默认）时无 role/aria，供纯视觉分隔。
 */
type SeparatorProps = React.ComponentProps<"div"> & {
  orientation?: "horizontal" | "vertical";
  decorative?: boolean;
};

function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  role,
  ...props
}: SeparatorProps) {
  const semantics = decorative
    ? {}
    : { role: role ?? "separator", "aria-orientation": orientation };
  return (
    <div
      data-slot="separator"
      aria-orientation={orientation}
      className={cn(
        "shrink-0 bg-border",
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
        className,
      )}
      {...semantics}
      {...props}
    />
  );
}

export { Separator };
