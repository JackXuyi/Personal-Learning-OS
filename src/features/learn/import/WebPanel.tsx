/**
 * 网页来源面板（F8 范围 5）—— 链接输入 → 抓取 → 预览卡 → 交 ImportModal 导入。
 *
 * 职责（与 `GithubPanel.tsx` 同构）：
 * - 输入链接 → 「抓取」：`buildWebUnit`（URL 规范化 → Rust 抓取 → 编码判定 →
 *   Readability 提正文 → DOM→Markdown 输出层）产出一份 `ImportUnit`；
 * - 成功：渲染预览卡（标题 / 终址 / 字符数 / 标题数），并把 unit 经 `onUnit` 上抛，
 *   供 ImportModal 底部主按钮启用与导入；
 * - 失败：行内错误（文案由 `WebErrorKind` 决定，G2），unit 置空、主按钮保持禁用；
 * - 链接变化即清空旧预览与错误（防「底部按钮指向旧目标」）。
 *
 * 本面板不直接写 storage；实际导入（`runUnitImport`）在 ImportModal。
 *
 * ⚠️ 浏览器预览（`isTauri()` 为 false）下**能力可见但不可用**：面板保留 Tab 与入口，
 *    显示一行原因说明并禁用「抓取」——与 `VectorIndexCard` 的处理同构。
 *    输入框刻意**保持可输入**（用户可以先粘好链接），依据方案 UC-03 的验收描述。
 */
import { useEffect, useState } from "react";
import { useI18n } from "../../../i18n";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { buildWebUnit, browserHtmlParser } from "./web-page";
import { fetchUrl, isWebImportAvailable } from "./desktop-fetch";
import { webErrorText } from "./error-text";
import type { ImportUnit } from "./types";

interface WebPanelProps {
  /** 抓取成功/清空/失败时上抛当前可导入单位（null = 不可导入）。 */
  onUnit: (unit: ImportUnit | null) => void;
  /** 导入进行中禁用抓取。 */
  disabled?: boolean;
}

/** 预览卡数据（从 ImportUnit 摘出，避免面板持有正文）。 */
interface WebPreview {
  title: string;
  finalUrl: string;
  chars: number;
  headings: number;
}

export default function WebPanel({ onUnit, disabled }: WebPanelProps) {
  const { m } = useI18n();
  const fmt = m.learn.import.web;
  /** 桌面端才具备跨站抓取能力（浏览器预览受 CORS 约束）。 */
  const desktop = isWebImportAvailable();

  const [url, setUrl] = useState("");
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string>();
  const [preview, setPreview] = useState<WebPreview>();

  // 链接变化 → 清空旧预览与错误（避免底部按钮误导旧目标）。
  useEffect(() => {
    setError(undefined);
    setPreview(undefined);
    onUnit(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  async function fetchPage() {
    const raw = url.trim();
    if (!raw) return;
    setFetching(true);
    setError(undefined);
    setPreview(undefined);
    onUnit(null);
    try {
      const unit = await buildWebUnit({
        fetchPage: fetchUrl,
        parseHtml: browserHtmlParser,
        sourceUrl: raw,
      });
      setPreview({
        title: unit.title,
        finalUrl: unit.source ?? raw,
        chars: unit.text.length,
        headings: unit.extract?.headings ?? 0,
      });
      onUnit(unit);
    } catch (err) {
      // 文案由 kind 决定（G2）：错误对象本身不再携带面向用户的文案。
      setError(webErrorText(err, fmt.errors));
    } finally {
      setFetching(false);
    }
  }

  return (
    <div className="space-y-3" data-testid="web-panel">
      {!desktop ? (
        <p className="text-xs text-ink-3" data-testid="web-desktop-only">
          {fmt.desktopOnly}
        </p>
      ) : null}

      {/* 链接输入 + 抓取 */}
      <div className="space-y-2">
        <label htmlFor="plos-web-url" className="block text-xs font-medium text-ink-2">
          {fmt.label}
        </label>
        <div className="flex gap-2">
          <Input
            id="plos-web-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void fetchPage();
            }}
            placeholder={fmt.placeholder}
            disabled={disabled || fetching}
            data-testid="web-url-input"
            className="font-mono text-xs"
          />
          <Button
            variant="outline"
            onClick={() => void fetchPage()}
            disabled={disabled || fetching || !desktop || !url.trim()}
            data-testid="web-fetch-btn"
            className="shrink-0"
          >
            {fetching ? fmt.fetching : fmt.fetch}
          </Button>
        </div>
        <p className="text-xs text-ink-3">{fmt.hint}</p>
      </div>

      {/* 抓取错误（文案按 kind 取 i18n） */}
      {error ? <p className="text-xs text-state-weak">{error}</p> : null}

      {/* 预览卡：错误时整块让位给上面的错误行（不并列展示） */}
      {preview ? (
        <div
          className="rounded-xl border border-line bg-subtle/50 px-4 py-3"
          data-testid="web-preview"
        >
          <p className="text-sm font-semibold text-ink-1">{preview.title}</p>
          <p className="mt-0.5 truncate font-mono text-xs text-ink-3">{preview.finalUrl}</p>
          <p className="mt-1.5 text-xs tabular-nums text-ink-2">
            {fmt.previewStat(preview.chars, preview.headings)}
          </p>
        </div>
      ) : error ? null : (
        <p className="rounded-xl border border-dashed border-line bg-app-bg px-4 py-5 text-center text-xs text-ink-3">
          {fmt.emptyPreview}
        </p>
      )}
    </div>
  );
}
