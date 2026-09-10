/**
 * 设置 · 向量索引卡（docs/rag-wiring-design-2026-09.md §7.2）。
 *
 * 职责：配置 Embedding 模型名（端点与 Key 继承「当前使用模型」，D3-A）、展示索引
 * 覆盖率、触发「重建索引 / 仅补齐缺失」。
 *
 * 能力判定（不靠异常兜底）：
 * - 非桌面端（无 SQLite）→ 按钮禁用并说明「需桌面端」——向量不落 localStorage（配额）；
 * - 当前模型非 API（builtin 本地模型无 embedding 能力）或未填模型名 → 明确提示。
 *
 * 数据流：本卡片 → `features/learn/index-service`（编排）→ `stores/useIndexStore`（状态）。
 * 卡片不直接调用 provider，也不直接碰 storage。
 */
import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { Card } from "../../components/primitives";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { useI18n } from "../../i18n";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { coveragePercent, useIndexStore } from "../../stores/useIndexStore";
import { rebuildIndex } from "../learn/index-service";
import { normalizeOpenAiBaseUrl } from "../../ai/openai-compatible";

/**
 * 常用 Embedding 模型建议（可自由改写）。
 *
 * 刻意只列少数几个有把握的：模型名是厂商私有字符串，猜错会让用户白跑一次请求，
 * 不如少给建议、让输入框做主。
 */
const MODEL_SUGGESTIONS: Partial<Record<string, string[]>> = {
  qwen: ["text-embedding-v3"],
  openai: ["text-embedding-3-small"],
};

export default function VectorIndexCard() {
  const { m } = useI18n();
  const t = m.settings.embedding;

  const active = useSettingsStore((s) => s.active);
  const savedEmbedding = useSettingsStore((s) => s.embedding);
  const setEmbeddingModel = useSettingsStore((s) => s.setEmbeddingModel);

  const running = useIndexStore((s) => s.running);
  const progress = useIndexStore((s) => s.progress);
  const error = useIndexStore((s) => s.error);
  const coverage = useIndexStore((s) => s.coverage);
  const coverageLoaded = useIndexStore((s) => s.coverageLoaded);
  const refreshCoverage = useIndexStore((s) => s.refreshCoverage);

  // 输入框本地态：失焦 / 回车才写库，避免每个按键都触发一次持久化。
  const [draft, setDraft] = useState(savedEmbedding?.model ?? "");
  useEffect(() => {
    setDraft(savedEmbedding?.model ?? "");
  }, [savedEmbedding?.model]);

  useEffect(() => {
    void refreshCoverage();
  }, [refreshCoverage]);

  const desktop = isTauri();
  const isApi = active?.source === "api";
  const commit = () => {
    if (draft.trim() !== (savedEmbedding?.model ?? "")) setEmbeddingModel(draft);
  };

  const endpoint =
    active?.source === "api"
      ? active.baseUrl.trim() || normalizeOpenAiBaseUrl(active.provider)
      : "";

  const suggestions = isApi ? MODEL_SUGGESTIONS[active.provider] ?? [] : [];

  // 能否向量化：桌面端 + API 模型 + 已填模型名。
  const canEmbed = desktop && isApi && !!savedEmbedding?.model;
  const [busy, setBusy] = useState(false);
  const run = (onlyMissing: boolean) => {
    if (busy || running) return;
    setBusy(true);
    void rebuildIndex({ onlyMissing })
      .catch(() => undefined) // 失败原因已由 store.error 呈现
      .finally(() => setBusy(false));
  };

  const disabled = !canEmbed || running || busy;
  const blockedReason = !desktop ? t.desktopOnly : !isApi ? t.notSupported : undefined;

  const pct = coveragePercent(coverage);
  const lastProgress = progress.total > 0 ? progress : undefined;

  return (
    <Card className="mt-4">
      <p className="text-sm font-semibold text-ink-1">{t.title}</p>
      <p className="mt-1 text-xs leading-relaxed text-ink-2">{t.desc}</p>

      {/* Embedding 模型名 */}
      <div className="mt-4">
        <label
          htmlFor="embedding-model"
          className="text-xs font-medium text-ink-2"
        >
          {t.model}
        </label>
        <div className="mt-1.5 flex items-center gap-2">
          <Input
            id="embedding-model"
            value={draft}
            placeholder={t.modelPlaceholder}
            spellCheck={false}
            data-testid="embedding-model-input"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                commit();
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
        </div>
        <p className="mt-1 text-xs text-ink-3">{t.modelHint}</p>
        {suggestions.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setDraft(s);
                  setEmbeddingModel(s);
                }}
                className="rounded-md border border-line px-2 py-0.5 text-xs text-ink-2 transition-colors hover:border-primary hover:text-primary"
              >
                {t.suggestion(s)}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* 端点（继承，只读展示） */}
      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2 border-t border-line pt-3">
        <span className="text-xs text-ink-3">{t.endpoint}</span>
        <span className="text-xs text-ink-2">
          {endpoint ? `${t.endpointInherit} · ${endpoint}` : t.endpointMissing}
        </span>
      </div>

      {/* 覆盖率 */}
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-xs text-ink-3">{t.coverage}</span>
        <span className="text-xs text-ink-2" data-testid="embedding-coverage">
          {running && lastProgress
            ? t.running(progress.done, progress.total)
            : !coverageLoaded
              ? "…"
              : coverage.total === 0
                ? t.coverageEmpty
                : `${t.coverageValue(coverage.indexed, coverage.total)} · ${pct}%`}
        </span>
      </div>

      {/* 进度条（仅运行中显示；纯色块，不用渐变） */}
      {running && lastProgress ? (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-subtle">
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }}
          />
        </div>
      ) : null}

      {/* 反馈区 */}
      {error ? (
        <p className="mt-3 rounded-md border border-state-failed/30 bg-state-failed/10 px-3 py-2 text-xs text-state-failed">
          {error}
        </p>
      ) : !running && progress.failed > 0 ? (
        <p className="mt-3 text-xs text-state-weak">{t.failedPartial(progress.failed)}</p>
      ) : !running && progress.total > 0 && progress.failed === 0 ? (
        <p className="mt-3 text-xs text-state-mastered">{t.doneAll}</p>
      ) : null}

      {/* 操作区 */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={() => run(false)}
          disabled={disabled}
          title={blockedReason ?? undefined}
          data-testid="index-rebuild"
        >
          {t.rebuild}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => run(true)}
          disabled={disabled}
          title={blockedReason ?? undefined}
          data-testid="index-fill-missing"
        >
          {t.onlyMissing}
        </Button>
        {blockedReason ? (
          <span className="text-xs text-ink-3">{blockedReason}</span>
        ) : null}
      </div>

      {!desktop ? <p className="mt-2 text-xs text-ink-3">{t.previewHint}</p> : null}
    </Card>
  );
}
