/**
 * 设置 · 向量索引卡(docs/embedding-default-config-design-2026-09.md §7)。
 *
 * 与 v1 的最大区别:**向量化只走本地模型**(决策 D1)。因此卡片不再出现
 * 「模型名输入框 / 端点继承 / 厂商建议」那一套,而是本地模型卡:
 *
 *   下载并启用(639 MB) → 状态徽标 → 自动索引开关 → 覆盖率 → 重建/补齐
 *
 * 状态与副作用:
 * - 非桌面端(`!isTauri()`)整卡禁用,不发任何 IPC;
 * - 模型未下载 / 文件损坏 → 不启用向量化,导入走纯全文索引;
 * - 下载完成自动启用(写 `embedding` 设置),不需要用户二次点击。
 *
 * 数据流:本卡片 → `ai/builtin` 的 `embed_*` 命令 + `features/learn/index-service`
 * (编排)→ `stores/useIndexStore`(状态)。卡片不直接碰 storage。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Card } from "../../components/primitives";
import { Button } from "../../components/ui/button";
import { ConfirmDialog } from "../../components/ui/confirm-dialog";
import { Checkbox } from "../../components/ui/checkbox";
import {
  EMBED_DOWNLOAD_PROGRESS_EVENT,
  embedCancelDownload,
  embedDelete,
  embedDownload,
  embedListModels,
  llmStatus,
  type LlmDeviceInfo,
  type LlmDownloadProgress,
  type LlmModelInfo,
} from "../../ai/builtin";
import { DEFAULT_EMBEDDING_MODEL, refreshEmbeddingStatus } from "../../ai/embedding";
import { useI18n } from "../../i18n";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { coveragePercent, useIndexStore } from "../../stores/useIndexStore";
import { isAutoIndexCapable, rebuildIndex } from "../learn/index-service";

/** 状态徽标样式:颜色走语义 token,不硬编码 slate/indigo(避免既有漂移扩大)。 */
const STATUS_STYLE: Record<LlmModelInfo["status"], string> = {
  ready: "border-state-mastered/40 bg-state-mastered/10 text-state-mastered",
  downloading: "border-primary/40 bg-primary/10 text-primary",
  not_found: "border-line bg-subtle text-ink-3",
  corrupted: "border-state-failed/40 bg-state-failed/10 text-state-failed",
};

export default function VectorIndexCard() {
  const { m } = useI18n();
  const t = m.settings.embedding;

  const savedModel = useSettingsStore((s) => s.embedding?.model);
  const setEmbeddingModel = useSettingsStore((s) => s.setEmbeddingModel);
  const autoIndexOnImport = useSettingsStore((s) => s.autoIndexOnImport);
  const setAutoIndexOnImport = useSettingsStore((s) => s.setAutoIndexOnImport);

  const running = useIndexStore((s) => s.running);
  const progress = useIndexStore((s) => s.progress);
  const error = useIndexStore((s) => s.error);
  const coverage = useIndexStore((s) => s.coverage);
  const coverageLoaded = useIndexStore((s) => s.coverageLoaded);
  const refreshCoverage = useIndexStore((s) => s.refreshCoverage);

  const [models, setModels] = useState<LlmModelInfo[]>([]);
  const [device, setDevice] = useState<LlmDeviceInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [percent, setPercent] = useState<number | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  const desktop = isTauri();

  const refresh = useCallback(async () => {
    try {
      setModels(await embedListModels());
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
    // 同步一份「就绪态」到 ai/embedding 的状态缓存:6 处入队路径的
    // `isAutoIndexCapable()` 依赖它,必须在这里刷新而不是各自 IPC。
    await refreshEmbeddingStatus();
  }, []);

  // 下载进度事件订阅(与聊天模型下载同一套双镜像进度语义)
  useEffect(() => {
    if (!desktop) return;
    let disposed = false;
    void (async () => {
      const un = await listen<LlmDownloadProgress>(
        EMBED_DOWNLOAD_PROGRESS_EVENT,
        (event) => {
          if (disposed) return;
          const { percent: p } = event.payload;
          setPercent(p);
          if (p >= 100) {
            setPercent(null);
            void refresh();
          }
        },
      );
      if (disposed) un();
      else unlistenRef.current = un;
    })();
    return () => {
      disposed = true;
      void unlistenRef.current?.();
    };
  }, [desktop, refresh]);

  // 首屏:模型清单 + 设备信息(禁用原因要展示具体数值)
  useEffect(() => {
    if (!desktop) return;
    void refresh();
    void llmStatus()
      .then((s) => setDevice(s.device ?? null))
      .catch(() => setDevice(null));
  }, [desktop, refresh]);

  useEffect(() => {
    void refreshCoverage();
  }, [refreshCoverage]);

  // 当前卡片对应的模型:优先用已保存设置里的名字,否则取清单首位。
  const configured = savedModel?.trim() || DEFAULT_EMBEDDING_MODEL;
  const model = models.find((x) => x.name === configured) ?? models[0];

  const status = model?.status ?? "not_found";
  const downloading = status === "downloading" || percent !== null;
  const ready = status === "ready";
  const supported = model?.supported?.ok !== false;

  const unsupportedText = !supported
    ? model?.supported?.reason === "unsupported_platform"
      ? t.unsupportedPlatform(device?.os ?? "?", device?.arch ?? "?")
      : model?.supported?.reason === "ram_below_min"
        ? t.ramBelowMin(`${device?.ram_gb ?? "?"}`, `${model?.min_ram_gb ?? "?"}`)
        : t.unsupportedGeneric
    : null;

  const sizeText = model ? t.sizeMb(model.approx_bytes) : "";

  const runDownload = async () => {
    if (!model) return;
    setBusy(true);
    setLoadError(null);
    setPercent(0);
    try {
      await embedDownload(model.name);
      // 下载完成即自动启用(写设置),不等用户二次点击。
      setEmbeddingModel(model.name);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
      setPercent(null);
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  const runCancel = async () => {
    if (!model) return;
    await embedCancelDownload(model.name);
    setPercent(null);
    void refresh();
  };

  const runDelete = async () => {
    if (!model) return;
    setLoadError(null);
    try {
      await embedDelete(model.name);
      setDeleteOpen(false);
      void refresh();
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  };

  const [indexBusy, setIndexBusy] = useState(false);
  const runIndex = (onlyMissing: boolean) => {
    if (indexBusy || running) return;
    setIndexBusy(true);
    void rebuildIndex({ onlyMissing })
      .catch(() => undefined) // 失败原因已由 store.error 呈现
      .finally(() => setIndexBusy(false));
  };

  const pct = coveragePercent(coverage);
  const lastProgress = progress.total > 0 ? progress : undefined;
  const blocked = !desktop || !ready || !supported;
  const blockedReason = !desktop
    ? t.desktopOnly
    : unsupportedText ?? (!ready ? t.notReady : undefined);

  return (
    <Card className="mt-4">
      <p className="text-sm font-semibold text-ink-1">{t.title}</p>
      <p className="mt-1 text-xs leading-relaxed text-ink-2">{t.desc}</p>

      {/* 本地向量模型卡 */}
      <div className="mt-4 rounded-lg border border-line p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-medium text-ink-1">
                {model?.display_name ?? t.noModel}
              </span>
              <span
                className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_STYLE[status]}`}
                data-testid="embedding-status"
              >
                {downloading
                  ? t.status.downloading(percent ?? 0)
                  : status === "ready"
                    ? t.status.ready
                    : status === "corrupted"
                      ? t.status.corrupted
                      : t.status.notDownloaded}
              </span>
            </div>
            {model ? (
              <p className="mt-1 text-xs text-ink-3">
                {t.spec(model.dim ?? 0, model.context_size)} · {sizeText}
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {downloading ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void runCancel()}
                data-testid="embedding-cancel"
              >
                {t.cancel}
              </Button>
            ) : ready ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setDeleteOpen(true)}
                data-testid="embedding-delete"
              >
                {t.delete}
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => void runDownload()}
                disabled={busy || !supported || !desktop}
                title={unsupportedText ?? undefined}
                data-testid="embedding-download"
              >
                {status === "corrupted" ? t.redownload : t.download(sizeText)}
              </Button>
            )}
          </div>
        </div>

        {/* 下载进度条 */}
        {downloading ? (
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-subtle">
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{ width: `${percent ?? 0}%` }}
            />
          </div>
        ) : null}

        <p className="mt-2 text-xs text-ink-3">{t.localNote}</p>
        {unsupportedText ? (
          <p className="mt-1 text-xs text-state-failed">{unsupportedText}</p>
        ) : null}
      </div>

      {/* 自动索引开关 */}
      <label className="mt-3 flex items-start gap-2">
        <Checkbox
          checked={autoIndexOnImport !== false}
          onCheckedChange={(v) => setAutoIndexOnImport(v === true)}
          data-testid="embedding-auto-index"
        />
        <span>
          <span className="text-xs font-medium text-ink-2">{t.autoIndex}</span>
          <span className="block text-xs text-ink-3">{t.autoIndexHint}</span>
        </span>
      </label>

      {/* 覆盖率 */}
      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2 border-t border-line pt-3">
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

      {/* 索引进度条（仅运行中） */}
      {running && lastProgress ? (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-subtle">
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{
              width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%`,
            }}
          />
        </div>
      ) : null}

      {/* 反馈区：本地错误 / store 错误 / 部分失败 / 全部完成 */}
      {loadError ? (
        <p className="mt-3 rounded-md border border-state-failed/30 bg-state-failed/10 px-3 py-2 text-xs text-state-failed">
          {loadError}
        </p>
      ) : error ? (
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
          onClick={() => runIndex(false)}
          disabled={blocked || running || indexBusy}
          title={blockedReason ?? undefined}
          data-testid="index-rebuild"
        >
          {t.rebuild}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => runIndex(true)}
          disabled={blocked || running || indexBusy}
          title={blockedReason ?? undefined}
          data-testid="index-fill-missing"
        >
          {t.onlyMissing}
        </Button>
        {blockedReason && !unsupportedText ? (
          <span className="text-xs text-ink-3">{blockedReason}</span>
        ) : null}
      </div>

      {!desktop ? (
        <p className="mt-2 text-xs text-ink-3">{t.previewDisabled}</p>
      ) : null}

      {/* 导入后是否会自动入队：与 index-service 同一判定，避免口径漂移 */}
      {desktop && ready && !isAutoIndexCapable() && autoIndexOnImport !== false ? (
        <p className="mt-2 text-xs text-state-weak">{t.notReady}</p>
      ) : null}

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t.deleteTitle}
        description={t.deleteBody(model?.display_name ?? configured)}
        confirmLabel={t.delete}
        cancelLabel={t.cancel}
        destructive
        onConfirm={() => void runDelete()}
      />
    </Card>
  );
}
