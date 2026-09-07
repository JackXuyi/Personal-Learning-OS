/**
 * 内置本地模型管理面板（Settings 内，kind=builtin 时展示）。
 *
 * 能力:列出可用模型(Qwen3.5 0.8B–9B,默认 4B)、下载(双镜像 + 进度事件)、
 * 取消、删除、激活。模型下载/推理均发生在桌面端 Rust 侧(llama-helper);
 * 纯浏览器预览时给出可读提示。
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
  type LlmDownloadProgress,
  type LlmModelInfo,
} from "../../ai/builtin";

function formatSize(bytes: number): string {
  const gb = bytes / 1_000_000_000;
  return gb >= 1 ? `约 ${gb.toFixed(1)} GB` : `约 ${Math.round(bytes / 1_000_000)} MB`;
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
  /** 当前激活的模型名（来自已保存配置）。 */
  selectedModel: string;
  /** 激活变化回调。ready=true 时调用方可将 providerReady 置为已就绪。 */
  onModelChange: (name: string, ready: boolean) => void;
}

export default function BuiltinModelsPanel({ selectedModel, onModelChange }: Props) {
  const [models, setModels] = useState<LlmModelInfo[]>([]);
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

  // 首屏加载
  useEffect(() => {
    if (!isBuiltinAvailable()) return;
    void refresh();
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

  const runDelete = async (name: string) => {
    setError(null);
    try {
      await llmDelete(name);
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const activate = (m: LlmModelInfo) => {
    if (m.status !== "ready") return;
    onModelChange(m.name, true);
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs leading-relaxed text-slate-500">
          模型由应用下载到本机数据目录(<code className="rounded bg-slate-100 px-1">models/llm</code>),
          下载源:ModelScope 优先、HuggingFace 兜底。激活模型后即成为 AI 服务默认 Provider。
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

      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
        {models.map((m) => {
          const pct = progress[m.name];
          const isDownloading = pct !== undefined && pct < 100;
          const active = selectedModel === m.name;
          return (
            <li
              key={m.name}
              className={`flex items-center gap-3 px-4 py-3 ${
                active ? "bg-indigo-50/50" : ""
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-slate-800">{m.display_name}</p>
                  {active ? (
                    <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-600">
                      当前激活
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 truncate text-xs text-slate-400">
                  {formatSize(m.approx_bytes)} · {m.description}
                </p>
              </div>

              {isDownloading ? (
                <div className="w-28">
                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full rounded-full bg-indigo-500 transition-all"
                      style={{ width: `${pct ?? 0}%` }}
                    />
                  </div>
                  <p className="mt-1 text-right text-[10px] text-indigo-600">{pct}%</p>
                </div>
              ) : (
                <span
                  className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[m.status]}`}
                >
                  {STATUS_LABEL[m.status]}
                </span>
              )}

              <div className="flex shrink-0 items-center gap-1.5">
                {m.status === "not_found" || m.status === "corrupted" ? (
                  <button
                    onClick={() => void runDownload(m.name)}
                    disabled={busy || isDownloading}
                    className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-indigo-700 disabled:opacity-50"
                  >
                    下载
                  </button>
                ) : null}
                {isDownloading ? (
                  <button
                    onClick={() => void runCancel(m.name)}
                    className="rounded-md border border-slate-200 px-3 py-1 text-xs text-slate-600 transition hover:bg-slate-50"
                  >
                    取消
                  </button>
                ) : null}
                {m.status === "ready" ? (
                  <>
                    <button
                      onClick={() => activate(m)}
                      disabled={active}
                      className="rounded-md border border-indigo-200 px-3 py-1 text-xs font-medium text-indigo-600 transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      激活
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm(`删除模型 ${m.display_name}？需要时可重新下载。`)) {
                          void runDelete(m.name);
                        }
                      }}
                      className="rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-500 transition hover:bg-red-50 hover:text-red-600"
                    >
                      删除
                    </button>
                  </>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-[11px] text-slate-400">
        首次下载默认档约 2.5 GB(Qwen3.5-4B),视网速需要几分钟;下载在后台进行,可随时取消。
      </p>
    </div>
  );
}
