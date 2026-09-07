import { useMemo, useState } from "react";
import { Card, SectionTitle } from "../../components/primitives";
import { PageContainer } from "../../components/layout/AppShell";
import {
  testConnection,
  type ConnectionTestResult,
} from "../../ai/connection";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { defaultModelOf, normalizeOpenAiBaseUrl } from "../../ai/openai-compatible";
import type { ProviderConfig, ProviderKind } from "../../ai";

const KINDS: { value: ProviderKind; label: string }[] = [
  { value: "ollama", label: "Ollama（本地）" },
  { value: "llama.cpp", label: "llama.cpp（本地）" },
  { value: "lmstudio", label: "LM Studio（本地）" },
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "gemini", label: "Gemini" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "custom", label: "自定义（OpenAI 兼容）" },
];

const LOCAL_KINDS: ReadonlySet<ProviderKind> = new Set([
  "ollama",
  "llama.cpp",
  "lmstudio",
]);

/** 表单草稿：编辑不落库，点「保存」才生效。 */
interface Draft {
  kind: ProviderKind;
  baseUrl: string;
  model: string;
  apiKey: string;
}

type TestStatus =
  | { state: "idle" }
  | { state: "testing" }
  | { state: "ok"; latencyMs: number }
  | { state: "fail"; reason: string; hint: string };

function defaultsFor(kind: ProviderKind): Pick<Draft, "baseUrl" | "model"> {
  return { baseUrl: normalizeOpenAiBaseUrl(kind), model: defaultModelOf(kind) };
}

function sameConfig(a: Draft, b: Draft): boolean {
  return (
    a.kind === b.kind &&
    a.baseUrl.trim() === b.baseUrl.trim() &&
    a.model.trim() === b.model.trim() &&
    a.apiKey.trim() === b.apiKey.trim()
  );
}

function toProviderConfig(d: Draft): ProviderConfig {
  return {
    kind: d.kind,
    baseUrl: d.baseUrl.trim() || undefined,
    model: d.model.trim() || undefined,
    apiKey: d.apiKey.trim() || undefined,
  };
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return sameDay ? `今天 ${hm}` : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

export default function SettingsPage() {
  const saved = useSettingsStore();
  const save = useSettingsStore((s) => s.save);

  const [draft, setDraft] = useState<Draft>({
    kind: saved.kind,
    baseUrl: saved.baseUrl,
    model: saved.model,
    apiKey: saved.apiKey,
  });
  const [test, setTest] = useState<TestStatus>({ state: "idle" });
  const [savedFlash, setSavedFlash] = useState(false);

  const dirty = useMemo(
    () => !sameConfig(draft, { kind: saved.kind, baseUrl: saved.baseUrl, model: saved.model, apiKey: saved.apiKey }),
    [draft, saved],
  );
  const local = LOCAL_KINDS.has(draft.kind);

  const update =
    (key: keyof Draft) =>
    (value: string) => {
      setDraft((d) => ({ ...d, [key]: value }));
      setTest({ state: "idle" }); // 改过配置，旧测试结果作废
    };

  const pickKind = (kind: ProviderKind) => {
    setDraft((d) => ({ ...d, kind, ...defaultsFor(kind), apiKey: "" }));
    setTest({ state: "idle" });
  };

  const runTest = async () => {
    setTest({ state: "testing" });
    const result: ConnectionTestResult = await testConnection(toProviderConfig(draft));
    if (result.ok) {
      setTest({ state: "ok", latencyMs: result.latencyMs });
    } else {
      setTest({ state: "fail", reason: result.reason, hint: result.hint });
    }
  };

  const runSave = () => {
    save(draft, {
      testedOk: test.state === "ok",
      latencyMs: test.state === "ok" ? test.latencyMs : undefined,
    });
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 2500);
  };

  const ready = saved.providerReady;

  return (
    <PageContainer>
      <SectionTitle
        title="设置 · AI 服务"
        subtitle="配置 Provider 后，知识抽取 / 测评生成等 AI 能力会逐步解锁。"
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h3 className="mb-1 text-sm font-semibold text-slate-700">AI Provider</h3>
          <p className="mb-4 text-xs text-slate-500">
            未配置 Provider 时引擎会优雅降级——启发式逻辑完全离线运行。
            {dirty ? (
              <span className="ml-1 font-medium text-amber-600">有未保存的修改。</span>
            ) : null}
          </p>

          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {KINDS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => pickKind(opt.value)}
                className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                  draft.kind === opt.value
                    ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                    : "border-slate-200 text-slate-600 hover:border-slate-300"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            <Field label={local ? "Base URL（本地服务）" : "Base URL"}>
              <input
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
                value={draft.baseUrl}
                onChange={(e) => update("baseUrl")(e.target.value)}
                placeholder="http://localhost:11434/v1"
                spellCheck={false}
              />
            </Field>
            <Field label="模型">
              <input
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
                value={draft.model}
                onChange={(e) => update("model")(e.target.value)}
                placeholder="qwen2.5:7b"
                spellCheck={false}
              />
            </Field>
            {!local ? (
              <Field label="API Key">
                <input
                  type="password"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
                  value={draft.apiKey}
                  onChange={(e) => update("apiKey")(e.target.value)}
                  placeholder="sk-..."
                  spellCheck={false}
                />
              </Field>
            ) : null}
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              onClick={() => void runTest()}
              disabled={test.state === "testing"}
              className="rounded-lg border border-indigo-200 bg-white px-4 py-2 text-sm font-medium text-indigo-700 transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {test.state === "testing" ? "正在测试…" : "测试连接"}
            </button>
            <button
              onClick={runSave}
              className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-indigo-700"
            >
              保存
            </button>
            {savedFlash ? (
              <span className="text-sm text-emerald-600">已保存 ✓</span>
            ) : null}
          </div>

          <TestResultArea test={test} draftTouched={dirty} />
        </Card>

        <div className="space-y-4">
          <Card>
            <h3 className="mb-3 text-sm font-semibold text-slate-700">Provider 状态</h3>
            <div className="flex flex-wrap items-center gap-2">
              {ready ? (
                <ReadyPill label="就绪 · 测试通过" />
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">
                  <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                  未就绪
                </span>
              )}
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                启发式降级已就绪
              </span>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-slate-500">
              侧边栏「设置」项上的绿点代表：已保存配置通过连接测试。
              保存前建议先测试（不阻断）。
            </p>
          </Card>

          <Card>
            <h3 className="mb-3 text-sm font-semibold text-slate-700">已保存配置</h3>
            <dl className="space-y-1 text-sm">
              <KV k="kind" v={saved.kind} />
              <KV k="baseUrl" v={saved.baseUrl || "（空）"} />
              <KV k="model" v={saved.model || "（空）"} />
              <KV k="apiKey" v={saved.apiKey ? "••••••••" : "（空）"} />
              <KV
                k="状态"
                v={
                  ready && saved.testedAt
                    ? `测试通过 · ${formatTime(saved.testedAt)}${
                        saved.lastLatencyMs ? ` · ${saved.lastLatencyMs}ms` : ""
                      }`
                    : "尚未通过测试"
                }
              />
            </dl>
          </Card>

          <p className="text-xs leading-relaxed text-slate-400">
            API Key 以明文保存在本机 localStorage，仅供本应用调用对应端点。
          </p>
        </div>
      </div>
    </PageContainer>
  );
}

function ReadyPill({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
      {label}
    </span>
  );
}

/** 测试结果区：成功 / 失败两句式（原因 + 怎么办）。 */
function TestResultArea({
  test,
  draftTouched,
}: {
  test: TestStatus;
  draftTouched: boolean;
}) {
  if (test.state === "idle") {
    if (!draftTouched) {
      return (
        <p className="mt-3 text-xs text-slate-400">
          测试连接 = 向当前表单值（未保存也测）发一次最小请求。
        </p>
      );
    }
    return null;
  }
  if (test.state === "testing") {
    return (
      <p className="mt-3 flex items-center gap-2 text-sm text-slate-500">
        <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
        正在测试连接…
      </p>
    );
  }
  if (test.state === "ok") {
    return (
      <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2">
        <p className="text-sm font-medium text-emerald-700">
          ✅ 已连接 · 延迟 {test.latencyMs}ms · 模型在线
        </p>
      </div>
    );
  }
  return (
    <div className="mt-3 rounded-lg border border-red-200 bg-red-50/60 px-3 py-2">
      <p className="text-sm font-medium text-red-700">❌ {test.reason}</p>
      <p className="mt-1 text-xs leading-relaxed text-red-600/90">→ {test.hint}</p>
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

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-400">{k}</dt>
      <dd className="truncate text-slate-700">{v}</dd>
    </div>
  );
}
