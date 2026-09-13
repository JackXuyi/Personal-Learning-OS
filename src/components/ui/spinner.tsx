import { cn } from "../../lib/utils";

/**
 * Spinner（UI Kit；docs/ai-loading-unify-design-2026-09.md §8.3）。
 *
 * 统一 loading 视觉：border 旋转环，颜色 currentColor 自动适配按钮变体/文字色。
 * 默认尺寸适配按钮内使用（size-3.5）；独立使用传 className 覆盖（如 size-5）。
 */
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      data-slot="spinner"
      className={cn(
        "inline-block shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent",
        className ?? "size-3.5",
      )}
    />
  );
}
