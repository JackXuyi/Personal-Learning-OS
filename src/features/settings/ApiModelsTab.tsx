/**
 * API 模型 Tab(设置 → AI 模型中心)。
 *
 * 预置(决策 Q3,以千问等开源模型为主):千问 / DeepSeek / OpenAI / 智谱 GLM /
 * Kimi / 自定义兼容(OpenAI 协议) —— 点选即带入默认端点与建议模型;
 * Anthropic / Gemini 为「规划中」禁用组(适配器未实现);
 * Ollama / llama.cpp / LM Studio 归「本地服务」分组(外部自跑端点,免 Key)。
 *
 * 流程:选预置 → 填 API Key(云端必填)/ 改模型名 → 测试连接(两句式结果)→ 使用。
 */
import { useState } from "react";
import type { ActiveSource } from "../../ai/active";
import type { ProviderKind } from "../../ai";
import {
  API_PROVIDER_PRESETS,
  LOCAL_ENDPOINT_PRESETS,
  PLANNED_PROVIDERS,
  type ProviderPreset,
} from "../../ai/presets";
import { testConnection } from "../../ai/connection";

/** API 侧草稿(provider 必选,其余为表单值)。 */
export interface ApiDraft {
  provider: Exclude<ProviderKind, "builtin">;
  baseUrl: string;
  model: string;
  apiKey: string;
}

type TestStatus =
  | { state: "idle" }
  | { state: "testing" }
  | { state: "ok"; latencyMs: number }
  | { state: "fail"; reason: string; hint: string };

interface Props {
  /** 已保存的 API 侧当前使用模型(用于回填表单 + 高亮)。 */
  saved: Extract<ActiveSource, { source: "api" }> | null;
  /** 保存并启用(写库由父组件完成,meta 带测试结果)。 */
  onUse: (
    active: Extract<ActiveSource, { source: "api" }>,
    testedOk: boolean,
    latencyMs?: number,
  ) => void;
}

function initialDraft(saved: Props["saved"]): ApiDraft {
  if (saved) {
    return {
      provider: saved.provider,
      baseUrl: saved.baseUrl,
      model: saved.model,
      apiKey: saved.apiKey,
    };
  }
  const qwen = API_PROVIDER_PRESETS[0]; // 千问(默认示例)
  return { provider: qwen.provider, baseUrl: qwen.baseUrl, model: qwen.model, apiKey: "" };
}

export default function ApiModelsTab({ saved, onUse }: Props) {
  const [draft, setDraft] = useState<ApiDraft>(() => initialDraft(saved));
  const [test, setTest] = useState<TestStatus>({ state: "idle" });
  const [savedFlash, setSavedFlash] = useState(false);

  const preset = [...API_PROVIDER_PRESETS, ...PLANNED_PROVIDERS, ...LOCAL_ENDPOINT_PRESETS].find(
    (p) => p.provider === draft.provider,
  );
  const cloudLike = Boolean(preset && preset.keyRequired);

  const pickPreset = (p: ProviderPreset) => {
    // 切 provider 时带入预置端点与建议模型;API Key 仅在回切到原保存的
    // provider 时保留,避免误带他家的 Key。
    const keepKey = saved?.provider === p.provider ? saved.apiKey : "";
    setDraft({ provider: p.provider, baseUrl: p.baseUrl, model: p.model, apiKey: keepKey });
    setTest({ state: "idle" });
  };

  const update =
    (key: "baseUrl" | "model" | "apiKey") => (value: string) => {
      setDraft((d) => ({ ...d, [key]: value }));
      setTest({ state: "idle" });
    };

  const toConfig = () => ({
    kind: draft.provider,
    baseUrl: draft.baseUrl.trim() || undefined,
    model: draft.model.trim() || undefined,
    apiKey: draft.apiKey.trim() || undefined,
  });

  const runTest = async () => {
    setTest({ state: "testing" });
    const result = await testConnection(toConfig());
    if (result.ok) {
      setTest({ state: "ok", latencyMs: result.latencyMs });
    } else {
      setTest({ state: "fail", reason: result.reason, hint: result.hint });
    }
  };

  const valid =
    draft.baseUrl.trim().length > 0 &&
    draft.model.trim().length > 0 &&
    (!cloudLike || draft.apiKey.trim().length > 0);

  const runUse = () => {
    if (!valid || !preset?.available) return;
    onUse(
      {
        source: "api",
        provider: draft.provider,
        baseUrl: draft.baseUrl.trim(),
        model: draft.model.trim(),
        apiKey: draft.apiKey.trim(),
      },
      test.state === "ok",
      test.state === "ok" ? test.latencyMs : undefined,
    );
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 2500);
  };

  const PresetChips = ({
    items,
    disabledHint,
  }: {
    items: ProviderPreset[];
    disabledHint?: string;
  }) => (
    <div className="flex flex-wrap gap-2">
      {items.map((p) => {
        const selected = draft.provider === p.provider;
        const isSaved = saved?.provider === p.provider;
        return (
          <button
            key={p.provider}
            disabled={!p.available}
            title={!p.available ? disabledHint ?? p.note : p.note}
            onClick={() => pickPreset(p)}
            className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
              !p.available
                ? "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400"
                : selected
                  ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                  : "border-slate-200 text-slate-600 hover:border-slate-300"
            }`}
          >
            <span className="block">{p.label}</span>
            {isSaved && p.available ? (
              <span className="block text-[10px] font-medium text-indigo-500">当前使用</span>
            ) : null}
            {!p.available ? (
              <span className="block text-[10px] text-slate-400">规划中</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="space-y-5">
      <div>
        <p className="mb-2 text-xs font-medium text-slate-500">
          预置供应商(OpenAI 兼容 · 开源模型为主,点选带入默认配置)
        </p>
        <PresetChips items={API_PROVIDER_PRESETS} />
      </div>

      <div>
        <p className="mb-2 text-xs font-medium text-slate-400">本地服务(自建端点 · 免 Key)</p>
        <PresetChips items={LOCAL_ENDPOINT_PRESETS} />
      </div>

      <div>
        <p className="mb-2 text-xs font-medium text-slate-400">
          规划中(非 OpenAI 传输格式,适配器未实现)
        </p>
        <PresetChips items={PLANNED_PROVIDERS} disabledHint="该厂商适配器尚未实现,暂不可用" />
      </div>

      <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/40 p-4">
        <p className="text-xs font-medium text-slate-600">
          {preset
            ? `配置:${preset.label}`
            : "配置"}{" "}
          <span className="font-normal text-slate-400">(Base URL / 模型名均可改)</span>
        </p>
        <Field label="Base URL">
          <input
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400"
            value={draft.baseUrl}
            onChange={(e) => update("baseUrl")(e.target.value)}
            placeholder="https://…/v1"
            spellCheck={false}
          />
        </Field>
        <Field label="模型">
          <input
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400"
            value={draft.model}
            onChange={(e) => update("model")(e.target.value)}
            placeholder="qwen-plus"
            spellCheck={false}
          />
        </Field>
        {cloudLike ? (
          <Field label="API Key">
            <input
              type="password"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400"
              value={draft.apiKey}
              onChange={(e) => update("apiKey")(e.target.value)}
              placeholder="sk-..."
              spellCheck={false}
            />
          </Field>
        ) : null}

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            onClick={() => void runTest()}
            disabled={test.state === "testing" || !draft.baseUrl.trim()}
            className="rounded-lg border border-indigo-200 bg-white px-4 py-2 text-sm font-medium text-indigo-700 transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {test.state === "testing" ? "正在测试…" : "测试连接"}
          </button>
          <button
            onClick={runUse}
            disabled={!valid}
            className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            使用该模型
          </button>
          {savedFlash ? <span className="text-sm text-emerald-600">已保存 ✓</span> : null}
          {!valid ? (
            <span className="text-xs text-slate-400">
              {cloudLike ? "云端模型需填 API Key;Base URL 与模型名必填。" : "Base URL 与模型名必填。"}
            </span>
          ) : null}
        </div>
      </div>

      <TestResultArea test={test} />

      <p className="text-[11px] leading-relaxed text-slate-400">
        API Key 以明文保存在本机 localStorage,仅供本应用调用对应端点。
        「测试连接」向当前表单值(未保存也测)发一次最小请求。
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function TestResultArea({ test }: { test: TestStatus }) {
  if (test.state === "idle") {
    return null;
  }
  if (test.state === "testing") {
    return (
      <p className="flex items-center gap-2 text-sm text-slate-500">
        <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
        正在测试连接…
      </p>
    );
  }
  if (test.state === "ok") {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2">
        <p className="text-sm font-medium text-emerald-700">
          ✅ 已连接 · 延迟 {test.latencyMs}ms · 模型在线
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-red-200 bg-red-50/60 px-3 py-2">
      <p className="text-sm font-medium text-red-700">❌ {test.reason}</p>
      <p className="mt-1 text-xs leading-relaxed text-red-600/90">→ {test.hint}</p>
    </div>
  );
}
