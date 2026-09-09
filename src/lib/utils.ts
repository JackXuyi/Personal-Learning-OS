import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** 类名合并工具：供 components/ui 生成层使用（shadcn 惯例，见 docs/ui-component-system-shadcn-design-2026-09.md §4.3）。 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
