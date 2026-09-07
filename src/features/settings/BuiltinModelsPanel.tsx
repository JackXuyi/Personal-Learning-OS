/**
 * 本地模型 Tab(设置 → AI 模型中心)。
 *
 * 能力:列出可下载模型(Qwen3.5 0.8B–9B)、设备匹配(Q1:本机不支持的档位
 * 灰态禁用,不可下载/不可启用)、下载(双镜像 + 进度)、取消、删除、整卡点选激活。
 * 模型下载/推理均发生在桌面端 Rust 侧(llama-helper);纯浏览器预览时提示。
 *
 * 组件契约:
 * - `activeModel`:当前使用模型名(来自已保存 store.active);null=未选择。
 * - `onActivate(model)`:点选已就绪卡 → 调用方写库生效(免二次保存)。
 * - `onClearActive()`:删除的正是当前使用模型时,调用方回退到「未配置」。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  DOWNLOAD_PROGRESS_EVENT,
  isBuiltinAvailable,
  llmCancelDownload,
  llmDelete,
  llmDownload,
  llmListModels,
  llmStatus,
  type LlmDeviceInfo,
  type LlmDownloadProgress,
  type LlmModelInfo,
} from "../../ai/builtin";

function formatSize(bytes: number): string {
  const gb = bytes / 1_000_000_000;
  return gb >= 1 ? `约 ${gb.toFixed(1)} GB` : `约 ${Math.round(bytes / 1_000_000)} MB`;
}

/** 设备禁用原因 → 卡内说明(带具体数值)。 */
function unsupportedReason(
  m: LlmModelInfo,
  device: LlmDeviceInfo | null,
): string {
  switch (m.supported?.reason) {
    case "unsupported_platform":
      return `本地模型需 macOS Apple Silicon 桌面端(当前 ${device?.os ?? "?"}/${
        device?.arch ?? "?"
      })`;
    case "ram_below_min":
      return `本机 ${device?.ram_gb ?? "?"}GB 内存,运行 ${m.name} 需 ≥${
        m.min_ram_gb ?? "?"
      }GB`;
    default:
      return "当前设备不支持运行该模型";
  }
}

const STATUS_LABEL: Record<LlmModelInfo["status"], string> = {
  not_found: "未下载",
  downloading: "下载中",
  ready: "已就绪",
  corrupted: "文件异常",
};

const STATUS_STYLE: Record<
  LlmModelInfo["status"],
  string
> = {
  not_found: "border-slate-200 bg-slate-50 text-slate-500",
  downloading: "border-indigo-200 bg-indigo-50 text-indigo-700",
  ready: "border-emerald-200 bg-emerald-50 text-emerald-700",
  corrupted: "border-red-200 bg-red-50 text-red-700",
};

interface Props {
  /** 当前激活的本地模型名(无则 null)。 */
  activeModel: string | null;
  /** 点选已就绪模型 → 立即写库生效。 */
  onActivate: (model: string) => void;
  /** 删除的正是当前使用模型时回调(用于把 active 清空)。 */
  onClearActive: () => void;
}

export default function BuiltinModelsPanel({
  activeModel,
  onActivate,
  onClearActive,
}: Props) {
  const [models, setModels] = useState<LlmModelInfo[]>([]);
  const [device, setDevice] = useState<LlmDeviceInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const unlistenRef = useRef<UnlistenFn | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await llmListModels();
      setModels(list);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // 订阅下载进度事件
  useEffect(() => {
    if (!isBuiltinAvailable()) return;
    let disposed = false;
    void (async () => {
      const un = await listen<LlmDownloadProgress>(
        DOWNLOAD_PROGRESS_EVENT,
        (event) => {
          if (disposed) return;
          const { model, percent } = event.payload;
          setProgress((prev) => ({ ...prev, [model]: percent }));
          if (percent >= 100) {
            // 完成后清掉进度并刷新磁盘状态
            setProgress((prev) => {
              const next = { ...prev };
              delete next[model];
              return next;
            });
            void refresh();
          }
        },
      );
      if (disposed) {
        un();
      } else {
        unlistenRef.current = un;
      }
    })();
    return () => {
      disposed = true;
      void unlistenRef.current?.();
    };
  }, [refresh]);

  // 首屏加载:模型列表 + 设备信息
  useEffect(() => {
    if (!isBuiltinAvailable()) return;
    void refresh();
    void llmStatus()
      .then((s) => setDevice(s.device ?? null))
      .catch(() => setDevice(null));
  }, [refresh]);

  if (!isBuiltinAvailable()) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-800">
        内置本地模型需在桌面端使用。请运行 <code className="rounded bg-amber-100 px-1">npm run tauri dev</code>{" "}
        或安装包打开应用;当前是纯浏览器预览。
      </div>
    );
  }

  const runDownload = async (name: string) => {
    setBusy(true);
    setError(null);
    try {
      setProgress((p) => ({ ...p, [name]: 0 }));
      await llmDownload(name);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setProgress((p) => {
        const next = { ...p };
        delete next[name];
        return next;
      });
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  const runCancel = async (name: string) => {
    await llmCancelDownload(name);
  };

  const runDelete = async (m: LlmModelInfo) => {
    setError(null);
    try {
      await llmDelete(m.name);
      if (activeModel === m.name) onClearActive();
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const activate = (m: LlmModelInfo) => {
    if (m.status !== "ready" || m.supported?.ok === false) return;
    onActivate(m.name);
  };

  const deviceChip = device
    ? `本机:${device.os === "macos" ? "macOS" : device.os} · ${
        device.arch === "aarch64" ? "Apple Silicon" : device.arch
      } · ${device.ram_gb}GB${device.metal ? " · Metal" : ""}`
    : null;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs leading-relaxed text-slate-500">
          模型由应用下载到本机数据目录(
          <code className="rounded bg-slate-100 px-1">models/llm</code>
          ),下载源:ModelScope 优先、HuggingFace 兜底。
          {deviceChip ? <span className="ml-1 font-medium text-slate-600">{deviceChip}</span> : null}
        </p>
        <button
          onClick={() => void refresh()}
          disabled={busy}
          className="shrink-0 rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
        >
          刷新
        </button>
      </div>

      {error ? (
        <p className="mb-3 rounded-lg border border-red-200 bg-red-50/70 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      ) : null}

      {device ? (
        <p className="mb-3 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs text-slate-500">
          已按本机设备匹配:内存不足 / 平台不支持的模型已禁用(不可下载、不可启用)。
        </p>
      ) : null}

      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
        {models.map((m) => {
          const pct = progress[m.name];
          const isDownloading = pct !== undefined && pct < 100;
          const active = activeModel === m.name;
          // 设备禁用(Q1):不可下载、不可启用
          const blocked = m.supported !== undefined && !m.supported.ok;
          const hasFile = m.status === "ready" || m.status === "corrupted";

          return (
            <li
              key={m.name}
              className={`px-4 py-3 transition-colors ${
                blocked ? "cursor-not-allowed bg-slate-50/70 opacity-60" : ""
              } ${active ? "bg-indigo-50/60" : ""} ${
                !blocked && !isDownloading && m.status === "ready"
                  ? "cursor-pointer hover:bg-slate-50/80"
                  : ""
              }`}
              onClick={() => {
                if (!blocked && m.status === "ready") activate(m);
              }}
            >
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-slate-800">{m.display_name}</p>
                    {active && !blocked ? (
                      <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                        当前使用
                      </span>
                    ) : null}
                    {blocked ? (
                      <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        设备不支持
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-slate-400">
                    {formatSize(m.approx_bytes)} · {m.description}
                  </p>
                  {blocked ? (
                    <p className="mt-0.5 text-xs text-slate-400">
                      ⚠ {unsupportedReason(m, device)}
                    </p>
                  ) : null}
                  {!blocked && m.status === "ready" && !active ? (
                    <p className="mt-0.5 text-[11px] text-indigo-500">点击卡片即切换为当前使用</p>
                  ) : null}
                </div>

                {!blocked && isDownloading ? (
                  <div className="w-28">
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                      <div
                        className="h-full rounded-full bg-indigo-500 transition-all"
                        style={{ width: `${pct ?? 0}%` }}
                      />
                    </div>
                    <p className="mt-1 text-right text-[10px] text-indigo-600">{pct}%</p>
                  </div>
                ) : !blocked ? (
                  <span
                    className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[m.status]}`}
                  >
                    {STATUS_LABEL[m.status]}
                  </span>
                ) : null}

                <div className="flex shrink-0 items-center gap-1.5">
                  {!blocked && (m.status === "not_found" || m.status === "corrupted") ? (
                    <button
                      onClick={() => void runDownload(m.name)}
                      disabled={busy || isDownloading}
                      className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {m.status === "corrupted" ? "重试下载" : "下载"}
                    </button>
                  ) : null}
                  {!blocked && isDownloading ? (
                    <button
                      onClick={() => void runCancel(m.name)}
                      className="rounded-md border border-slate-200 px-3 py-1 text-xs text-slate-600 transition hover:bg-slate-50"
                    >
                      取消
                    </button>
                  ) : null}
                  {!blocked && m.status === "ready" ? (
                    <button
                      onClick={() => activate(m)}
                      disabled={active}
                      className="rounded-md border border-indigo-200 px-3 py-1 text-xs font-medium text-indigo-600 transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      设为当前
                    </button>
                  ) : null}
                  {hasFile ? (
                    <button
                      onClick={() => {
                        if (
                          window.confirm(
                            `删除模型 ${m.display_name}？${
                              activeModel === m.name
                                ? "当前正在使用,删除后将回退到离线启发式。"
                                : "需要时可重新下载。"
                            }`,
                          )
                        ) {
                          void runDelete(m);
                        }
                      }}
                      className="rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-500 transition hover:bg-red-50 hover:text-red-600"
                    >
                      删除
                    </button>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-[11px] text-slate-400">
        首次下载设备推荐档约 2.5 GB(Qwen3.5-4B),视网速需要几分钟;下载在后台进行,可随时取消。
      </p>
    </div>
  );
}
