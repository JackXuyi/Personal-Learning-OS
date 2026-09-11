/**
 * 导入层错误 → 用户文案的唯一映射点（G2 修复）。
 *
 * 导入适配层（`github.ts` / `local-files.ts` / `pdf.ts`）**只产出 `kind`**，
 * 不产出用户可见文案；语言属于 UI 层，在此统一按 kind 查表。
 * 这样「英文界面看到中文报错」的结构性缺口被从根上切断：
 * 只要新增 kind，typecheck 会强制 zh/en 同时补齐文案（`Record<Kind, string>`）。
 */
import { GithubImportError } from "./github";
import type { GhErrorKind } from "./github";
import type { LocalFileError, LocalFileErrorKind } from "./local-files";

/** GitHub 错误文案表（由 `m.learn.import.github.errors` 满足）。 */
export type GithubErrorLabels = Record<GhErrorKind, string>;
/** 本地文件错误文案表（由 `m.learn.import.local.errors` 满足）。 */
export type LocalErrorLabels = Record<LocalFileErrorKind, string>;

/** 任意异常 → GitHub 文案（非 GithubImportError 走 message 兜底）。 */
export function githubErrorText(err: unknown, labels: GithubErrorLabels): string {
  if (err instanceof GithubImportError) return labels[err.kind];
  return err instanceof Error ? err.message : String(err);
}

/** 本地文件转换失败 → 文案。 */
export function localErrorText(err: LocalFileError, labels: LocalErrorLabels): string {
  return labels[err.error];
}
