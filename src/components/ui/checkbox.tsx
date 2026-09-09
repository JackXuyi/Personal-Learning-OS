import * as React from "react";
import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox";
import { Check } from "lucide-react";
import { cn } from "../../lib/utils";

/**
 * Checkbox（UI Kit；Base UI 底层，M2 落地，docs 方案 §6.3）。
 * - Root 原生语义为 button[role=checkbox]，aria 由 Base UI 托管；
 * - 勾选态 data-checked / 未选 data-unchecked / 半选 data-indeterminate。
 */
function Checkbox({
  className,
  children,
  ...props
}: React.ComponentProps<typeof BaseCheckbox.Root>) {
  return (
    <BaseCheckbox.Root
      data-slot="checkbox"
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-line bg-surface text-primary-foreground",
        "transition-colors outline-none",
        "hover:border-primary/60",
        "focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
        "data-checked:border-primary data-checked:bg-primary",
        "data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <BaseCheckbox.Indicator className="flex items-center justify-center text-current data-unchecked:hidden">
        {children ?? <Check className="size-3" strokeWidth={3} aria-hidden />}
      </BaseCheckbox.Indicator>
    </BaseCheckbox.Root>
  );
}

export { Checkbox };
