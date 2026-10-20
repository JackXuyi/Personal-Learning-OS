import { useEffect, useState } from "react";
import { Card } from "../../../components/primitives";
import type { Messages } from "../../../i18n";
import {
  logGetConfig,
  logOpenDir,
  logReadRecent,
  logSetConfig,
  type LogConfigView,
  type LogLevel,
} from "../../../lib/desktop-log";
import { SectionShell } from "../SectionShell";

/** 日志级别（与 Rust LogLevel 对应，值为协议常量）。 */
const LOG_LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];

/**
 * 帮助与诊断分区（docs/tauri-log-config-design-2026-09.md，桌面端专属）：
 * 开关 / 级别 / 只读目录 + 打开 Finder + 恢复默认（决策 D3）/ 最近 200 行预览。
 * 配置真源在 Rust（config.json），本组件只经命令读写，改后即时生效。
 */
export default function LogsSection({ st }: { st: Messages["settings"] }) {
  const lg = st.logs;
  const [config, setConfig] = useState<LogConfigView>();
  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState<string>();

  const load = async () => {
    try {
      const [cfg, recent] = await Promise.all([logGetConfig(), logReadRecent()]);
      setConfig(cfg);
      setLines(recent);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const update = async (patch: { enabled?: boolean; level?: LogLevel }) => {
    if (!config) return;
    const next = {
      enabled: patch.enabled ?? config.enabled,
      level: patch.level ?? config.level,
      // D3：UI 不提供自定义路径，dir 恒写 null = 默认目录（也承担「恢复默认」）。
      dir: null,
    };
    try {
      const dir = await logSetConfig(next);
      setConfig({ ...config, ...next, dir, lastError: null });
      setError(undefined);
      setLines(await logReadRecent());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <SectionShell title={lg.title} desc={lg.desc}>
      <Card className="space-y-4">
        {/* 开关 */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-ink-1">{lg.enabledLabel}</p>
            <p className="mt-0.5 text-[11px] text-ink-3">{lg.enabledHint}</p>
          </div>
          <div className="flex shrink-0 gap-1 rounded-lg border border-line bg-subtle p-1">
            {(
              [
                [true, "ON"],
                [false, "OFF"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={label}
                type="button"
                data-testid={`settings-log-enabled-${value ? "on" : "off"}`}
                aria-pressed={config?.enabled === value}
                onClick={() => void update({ enabled: value })}
                className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                  config?.enabled === value
                    ? "bg-surface text-primary shadow-sm"
                    : "text-ink-2 hover:text-ink-1"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* 级别 */}
        <div className="flex items-center justify-between gap-4 border-t border-line pt-4">
          <p className="text-sm text-ink-1">{lg.levelLabel}</p>
          <div className="flex shrink-0 gap-1 rounded-lg border border-line bg-subtle p-1">
            {LOG_LEVELS.map((level) => (
              <button
                key={level}
                type="button"
                data-testid={`settings-log-level-${level}`}
                aria-pressed={config?.level === level}
                onClick={() => void update({ level })}
                className={`rounded-md px-2.5 py-1 font-mono text-xs transition-colors ${
                  config?.level === level
                    ? "bg-surface text-primary shadow-sm"
                    : "text-ink-2 hover:text-ink-1"
                }`}
              >
                {lg.levels[level]}
              </button>
            ))}
          </div>
        </div>

        {/* 目录（只读，决策 D3） */}
        <div className="space-y-2 border-t border-line pt-4">
          <p className="text-sm text-ink-1">{lg.dirLabel}</p>
          <p className="break-all rounded-lg border border-line bg-subtle/60 px-2.5 py-2 font-mono text-[11px] text-ink-2">
            {config?.dir ?? "…"}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              data-testid="settings-log-open"
              onClick={() => void logOpenDir().catch((e) => setError(e instanceof Error ? e.message : String(e)))}
              className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-2 transition-colors hover:bg-subtle hover:text-ink-1"
            >
              {lg.openDir}
            </button>
            <button
              type="button"
              data-testid="settings-log-reset"
              onClick={() => void update({})}
              className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-2 transition-colors hover:bg-subtle hover:text-ink-1"
            >
              {lg.resetDir}
            </button>
          </div>
        </div>

        {/* 最近日志预览 */}
        <div className="border-t border-line pt-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-ink-1">{lg.previewTitle}</p>
            <button
              type="button"
              data-testid="settings-log-refresh"
              onClick={() => void load()}
              className="rounded-md border border-line px-2.5 py-1 text-xs text-ink-2 transition-colors hover:bg-subtle hover:text-ink-1"
            >
              {lg.refresh}
            </button>
          </div>
          {config?.lastError ? (
            <p className="mt-2 text-xs text-ink-2">
              • {lg.writeError}：{config.lastError}
            </p>
          ) : null}
          <div
            data-testid="settings-log-preview"
            className="mt-2 max-h-64 overflow-auto rounded-lg border border-line bg-subtle/60 p-2 font-mono text-[11px] leading-relaxed text-ink-2"
          >
            {lines.length === 0 ? (
              <p className="text-ink-3">{lg.previewEmpty}</p>
            ) : (
              lines.map((line, i) => (
                <p key={i} className="whitespace-pre-wrap break-all">
                  {line}
                </p>
              ))
            )}
          </div>
        </div>

        {error ? <p className="text-xs text-ink-2">• {error}</p> : null}
      </Card>
    </SectionShell>
  );
}
