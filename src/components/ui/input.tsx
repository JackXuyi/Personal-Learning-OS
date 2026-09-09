import * as React from "react";
import { cn } from "../../lib/utils";

/**
 * Input（UI Kit；shadcn 同构手写，原生 input）。
 * - token：border-input=line、ring=primary；聚焦 = 边框变品牌色 + 柔 ring
 *   （对齐仓库既有 focus:border-primary 语言并提升可发现性）。
 * - 默认透明底，随所在卡片色；需要内嵌灰底时调用方追加 `bg-app-bg`。
 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-sm text-foreground transition-[color,box-shadow] outline-none",
        "placeholder:text-muted-foreground/70",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
