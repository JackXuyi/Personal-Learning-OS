import * as React from "react";
import { Select as BaseSelect } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils";

/**
 * Select（UI Kit；Base UI 底层，M2 落地，docs 方案 §6.3）。
 * 受控单选便捷封装：value 为 option.value（string），onValueChange 每次变更回调。
 * label 可为 i18n 词/ReactNode；弹层（Positioner/Popup）由本组件统一装配。
 *
 * ⚠️ 全站**唯一**的选值下拉实现（`rules/dropdown-select.mdc`）：业务代码不得写原生
 * `<select>`，也不得直接 import `@base-ui/react/select`。尺寸只有 sm/md 两档 ——
 * 调用方**只允许**覆写宽度与背景，高度与字号一律走 `size`。
 */

export interface SelectOption {
  value: string;
  label: React.ReactNode;
}

/** 尺寸档（两档封顶；新增档位须先改 rule 与判据）。 */
const SIZE_CLASS: Record<"sm" | "md", { trigger: string; popup: string }> = {
  /** 紧凑档：页头筛选条 / 表格行 / 对话框内联控件。 */
  sm: { trigger: "h-8 text-xs", popup: "text-xs" },
  /** 默认档：表单字段。 */
  md: { trigger: "h-9 text-sm", popup: "text-sm" },
};

interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  /** 尺寸档；默认 `md`。高度/字号请走这里，不要写进 className。 */
  size?: "sm" | "md";
  /** 仅宽度/背景等样式覆写（默认 w-full + size 决定的高度字号）。 */
  className?: string;
  /** 可访问名；本仓库 Field 不做 htmlFor 关联 ⇒ 下拉一律必传。 */
  ariaLabel?: string;
  id?: string;
}

function Select({
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
  size = "md",
  className,
  ariaLabel,
  id,
}: SelectProps) {
  const sizing = SIZE_CLASS[size];
  return (
    <BaseSelect.Root
      value={value}
      onValueChange={(v) => onValueChange(v ?? "")}
      disabled={disabled}
    >
      <BaseSelect.Trigger
        id={id}
        aria-label={ariaLabel}
        data-slot="select-trigger"
        data-size={size}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-md border border-input bg-surface px-3 text-ink-1",
          sizing.trigger,
          "transition-colors outline-none select-none",
          "hover:bg-subtle/60 data-pressed:bg-subtle",
          "focus-visible:ring-2 focus-visible:ring-ring/50",
          "data-disabled:cursor-not-allowed data-disabled:opacity-50",
          className,
        )}
      >
        <BaseSelect.Value
          placeholder={placeholder}
          className="truncate text-left data-[placeholder]:text-ink-3"
        >
          {(v) => options.find((o) => o.value === v)?.label ?? null}
        </BaseSelect.Value>
        <ChevronDown className="size-4 shrink-0 text-ink-3" aria-hidden />
      </BaseSelect.Trigger>

      <BaseSelect.Portal>
        <BaseSelect.Positioner
          side="bottom"
          align="start"
          sideOffset={4}
          alignItemWithTrigger={false}
          className="z-50"
        >
          <BaseSelect.Popup
            data-slot="select-popup"
            className={cn(
              "rounded-md border border-line bg-surface p-1 text-ink-1 shadow-lg",
              sizing.popup,
              "outline-none origin-[var(--transform-origin)]",
              "transition-[opacity,scale] duration-100",
              "data-starting-style:scale-[0.98] data-starting-style:opacity-0",
              "data-ending-style:scale-[0.98] data-ending-style:opacity-0",
            )}
          >
            <BaseSelect.List className="max-h-64 overflow-auto">
              {options.map((o) => (
                <BaseSelect.Item
                  key={o.value}
                  value={o.value}
                  className={cn(
                    "flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pl-2 pr-2 text-ink-1",
                    "outline-none select-none data-highlighted:bg-subtle",
                    "data-disabled:pointer-events-none data-disabled:opacity-50",
                  )}
                >
                  <BaseSelect.ItemText className="flex-1 truncate">
                    {o.label}
                  </BaseSelect.ItemText>
                  <BaseSelect.ItemIndicator className="text-primary">
                    <Check className="size-3.5" strokeWidth={3} aria-hidden />
                  </BaseSelect.ItemIndicator>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}

export { Select };
export type { SelectProps };
