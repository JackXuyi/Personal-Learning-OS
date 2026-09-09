import * as React from "react";
import { cn } from "../../lib/utils";

/**
 * Label（UI Kit；shadcn 同构手写，纯样式无 headless 依赖）。
 * 默认排版贴合 PLOS 表单字段标题（xs/ink-2）；块级/间距由调用方追加
 * （如 `block mb-1`），tailwind-merge 会自动覆盖冲突项。
 */
function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "text-xs font-medium text-ink-2 select-none",
        "peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Label };
