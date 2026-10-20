import type { ReactNode } from "react";

/**
 * 分区外壳：标题 + 可选说明 + 内容（6 个分区共用，避免每个分区各写一份 h3/p 结构）。
 *
 * 页面级标题由 `SettingsPage` 的 `SectionTitle` 承担；这里只负责「当前分区叫什么」。
 */
export function SectionShell({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <h3 className="text-base font-semibold text-ink-1">{title}</h3>
      {desc ? <p className="mt-0.5 text-sm text-ink-2">{desc}</p> : null}
      <div className="mt-3">{children}</div>
    </div>
  );
}
