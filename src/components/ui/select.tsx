import * as React from "react";
import { Select as BaseSelect } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils";

/**
 * Select（UI Kit；Base UI 底层，M2 落地，docs 方案 §6.3）。
 * 受控单选便捷封装：value 为 option.value（string），onValueChange 每次变更回调。
 * label 可为 i18n 词/ReactNode；弹层（Positioner/Popup）由本组件统一装配。
 */

export interface SelectOption {
  value: string;
  label: React.ReactNode;
}

interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  /** 宽度/高度等样式覆写（默认 w-full h-9） */
  className?: string;
  ariaLabel?: string;
  id?: string;
}

function Select({
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
  className,
  ariaLabel,
  id,
}: SelectProps) {
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
        className={cn(
          "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-surface px-3 text-sm text-ink-1",
          "transition-colors outline-none select-none",
          "hover:bg-subtle/60 data-pressed:bg-subtle",
          "focus-visible:ring-2 focus-visible:ring-ring/25",
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
              "rounded-md border border-line bg-surface p-1 text-sm text-ink-1 shadow-lg",
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
