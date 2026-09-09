/**
 * GitHub 公开仓库来源面板（URL → 解析 → 预览清单 → 交 ImportModal 导入）。
 *
 * 职责（docs/knowledge-import-design-2026-09.md §7.3 / §8.7）：
 * - 输入链接 → 「解析」：parseGithubUrl + 仓库元信息 + md 文件清单（repo/tree），
 *   blob 单文件构造占位清单（正文在导入时才拉取，避免预览阶段下载大文本）；
 * - 解析成功：展示仓库卡（fullName / description / 文件数）+ 可滚动文件清单，
 *   并把 preview 通过 onPreview 上抛，供 ImportModal 底部主按钮启用与导入；
 * - 解析失败：行内错误展示（私有仓库 / 不存在 / 限流 / 无 md 等），preview 置空；
 * - URL 变化时自动清空旧 preview（防止导入旧目标）。
 *
 * 本面板不直接写 storage；导入动作（buildGithubUnit → 共享管道）在 ImportModal。
 */
import { useEffect, useState } from "react";
import { useI18n } from "../../../i18n";
import {
  GithubImportError,
  resolveGithubUrl,
} from "./github";
import type { GithubPreview } from "./github";
import { formatBytes } from "./types";

interface GithubPanelProps {
  /** 解析成功/失败/清空时上抛当前可导入目标（null = 不可导入）。 */
  onPreview: (preview: GithubPreview | null) => void;
  /** 导入进行中禁用解析按钮。 */
  disabled?: boolean;
}

export default function GithubPanel({ onPreview, disabled }: GithubPanelProps) {
  const { m } = useI18n();
  const fmt = m.learn.import.github;

  const [url, setUrl] = useState("");
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string>();
  const [preview, setPreview] = useState<GithubPreview>();

  // URL 变化 → 清空旧预览与错误（避免底部按钮误导旧目标）。
  useEffect(() => {
    setError(undefined);
    setPreview(undefined);
    onPreview(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  async function resolve() {
    const raw = url.trim();
    if (!raw) return;
    setResolving(true);
    setError(undefined);
    setPreview(undefined);
    onPreview(null);
    try {
      const p = await resolveGithubUrl((input, init) => fetch(input, init), raw);
      setPreview(p);
      onPreview(p);
    } catch (err) {
      const message =
        err instanceof GithubImportError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      setError(message);
    } finally {
      setResolving(false);
    }
  }

  return (
    <div className="space-y-3" data-testid="github-panel">
      {/* URL 输入 + 解析 */}
      <div className="space-y-2">
        <label htmlFor="plos-gh-url" className="block text-xs font-medium text-ink-2">
          {fmt.label}
        </label>
        <div className="flex gap-2">
          <input
            id="plos-gh-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") resolve();
            }}
            placeholder={fmt.placeholder}
            disabled={disabled}
            data-testid="github-url-input"
            className="w-full rounded-lg border border-line bg-app-bg px-3 py-2 font-mono text-xs text-ink-1 outline-none transition-colors placeholder:text-ink-3 focus:border-primary disabled:opacity-50"
          />
          <button
            onClick={resolve}
            disabled={disabled || resolving || !url.trim()}
            data-testid="github-resolve-btn"
            className="shrink-0 rounded-lg border border-line px-3 py-2 text-sm text-ink-1 transition-colors hover:bg-subtle disabled:opacity-40"
          >
            {resolving ? fmt.resolving : fmt.resolve}
          </button>
        </div>
        <p className="text-xs text-ink-3">{fmt.hint}</p>
      </div>

      {/* 解析错误 */}
      {error ? <p className="text-xs text-state-weak">{error}</p> : null}

      {/* 预览卡：仓库信息 + 文件清单 */}
      {preview ? (
        <div className="rounded-xl border border-line bg-subtle/50 px-4 py-3">
          <p className="text-sm font-semibold text-ink-1">{preview.meta.fullName}</p>
          {preview.meta.description ? (
            <p className="mt-0.5 line-clamp-2 text-xs text-ink-3">{preview.meta.description}</p>
          ) : null}
          <p className="mt-1.5 text-xs text-ink-2">
            {fmt.importN(preview.files.length)}
            {preview.skipped > 0 ? (
              <span className="ml-1.5 text-state-weak">· {fmt.skipped(preview.skipped)}</span>
            ) : null}
          </p>
          {preview.files.length > 0 ? (
            <ul data-testid="github-files-list" className="mt-2 max-h-36 space-y-0.5 overflow-y-auto">
              {preview.files.map((f) => (
                <li key={f.path} className="flex items-center gap-2 rounded px-1.5 py-0.5 text-xs">
                  <span className="font-bold text-state-mastered">✓</span>
                  <span className="min-w-0 flex-1 truncate text-ink-2">{f.path}</span>
                  {f.size > 0 ? (
                    <span className="shrink-0 tabular-nums text-ink-3">{formatBytes(f.size)}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-line bg-app-bg px-4 py-5 text-center text-xs text-ink-3">
          {fmt.emptyPreview}
        </p>
      )}
    </div>
  );
}
