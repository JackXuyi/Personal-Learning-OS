/**
 * API 模型 Tab(设置 → AI 模型中心)。
 *
 * 交互(2026-09-07 UI 简化迭代):顶部为**预置供应商下拉**(千问 / DeepSeek /
 * OpenAI / 智谱 GLM / Kimi / 自定义兼容),选中即自动带入默认 Base URL 与建议
 * 模型;下方表单可改 baseUrl / 模型 / API Key,经「测试连接」后「使用该模型」。
 *
 * 已移除的入口:「本地服务(自建端点 · 免 Key)」与「规划中」分组不再展示。
 * 历史存档(如旧版迁移来的 `provider: ollama` 等端点型)若不在预置列表,
 * 以「自定义(OpenAI 兼容)」身份保留原 baseUrl/model/apiKey,配置不丢失。
 */
import { useState } from "react";
import type { ActiveSource } from "../../ai/active";
import type { ProviderKind } from "../../ai";
import {
  API_PROVIDER_PRESETS,
  type ProviderPreset,
} from "../../ai/presets";
import { testConnection } from "../../ai/connection";
import { hasKeyring } from "../../ai/vault";
import { useI18n } from "../../i18n";
import { Select } from "../../components/ui/select";

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

/** 预置下拉的合法 provider 集合(全部 available)。 */
const AVAILABLE_PRESETS = API_PROVIDER_PRESETS;

/**
 * 历史存档归一:若 saved 的 provider 仍在本期预置列表 → 原样回填;
 * 若为已移除的端点型(如 ollama / llama.cpp)且带有效端点 → 以 custom
 * 身份保留配置;否则(空配置 / 不可用厂商)回落默认 qwen。
 */
function initialDraft(saved: Props["saved"]): ApiDraft {
  if (saved) {
    const inList = AVAILABLE_PRESETS.some((p) => p.provider === saved.provider);
    if (inList) {
      return {
        provider: saved.provider,
        baseUrl: saved.baseUrl,
        model: saved.model,
        apiKey: saved.apiKey,
      };
    }
    if (saved.baseUrl.trim()) {
      return {
        provider: "custom",
        baseUrl: saved.baseUrl,
        model: saved.model,
        apiKey: saved.apiKey,
      };
    }
  }
  const qwen = AVAILABLE_PRESETS[0]; // 千问(默认示例)
  return { provider: qwen.provider, baseUrl: qwen.baseUrl, model: qwen.model, apiKey: "" };
}

export default function ApiModelsTab({ saved, onUse }: Props) {
  const { m } = useI18n();
  const mod = m.settings.models;
  const s = mod.api;
  const [draft, setDraft] = useState<ApiDraft>(() => initialDraft(saved));
  const [test, setTest] = useState<TestStatus>({ state: "idle" });
  const [savedFlash, setSavedFlash] = useState(false);

  const preset = AVAILABLE_PRESETS.find((p) => p.provider === draft.provider);
  const isSaved = saved?.provider === draft.provider;
  const cloudLike = Boolean(preset?.keyRequired);

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
    if (!valid || !preset) return;
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

  return (
    <div className="space-y-5">
      {/* 预置供应商下拉:选中即带入默认端点与建议模型 */}
      <Field label={s.presetProvider}>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            ariaLabel={s.presetProvider}
            value={draft.provider}
            onValueChange={(v) => {
              const p = AVAILABLE_PRESETS.find((x) => x.provider === v);
              if (p) pickPreset(p);
            }}
            options={AVAILABLE_PRESETS.map((p) => ({
              value: p.provider,
              label: p.note ? `${p.label} — ${p.note}` : p.label,
            }))}
            className="w-full max-w-sm"
          />
          {isSaved ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700">
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
              {mod.currentUse}
            </span>
          ) : null}
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
          {s.presetHint}
        </p>
      </Field>

      {/* 配置表单 */}
      <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/40 p-4">
        <p className="text-xs font-medium text-slate-600">
          {preset ? s.configTitle(preset.label) : s.configPlain}{" "}
          <span className="font-normal text-slate-400">{s.configNote}</span>
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
        <Field label={s.modelLabel}>
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
            {test.state === "testing" ? s.testing : s.testConnection}
          </button>
          <button
            onClick={runUse}
            disabled={!valid}
            className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {s.useModel}
          </button>
          {savedFlash ? <span className="text-sm text-emerald-600">{mod.savedOk}</span> : null}
          {!valid ? (
            <span className="text-xs text-slate-400">
              {cloudLike ? s.validHintCloud : s.validHint}
            </span>
          ) : null}
        </div>
      </div>

      <TestResultArea test={test} />

      <p className="text-[11px] leading-relaxed text-slate-400">
        {hasKeyring() ? s.keychainNote : s.localStorageNote}
        {s.testNote}
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
  const { m } = useI18n();
  const s = m.settings.models.api;
  if (test.state === "idle") {
    return null;
  }
  if (test.state === "testing") {
    return (
      <p className="flex items-center gap-2 text-sm text-slate-500">
        <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
        {s.testRunning}
      </p>
    );
  }
  if (test.state === "ok") {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2">
        <p className="text-sm font-medium text-emerald-700">
          {s.testOk(test.latencyMs)}
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
