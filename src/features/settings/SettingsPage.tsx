import { Card, SectionTitle } from "../../components/primitives";
import { PageContainer } from "../../components/layout/AppShell";
import { FoundationRow, StatusPill } from "../scaffold";
import { useSettingsStore } from "../../stores/useSettingsStore";
import type { ProviderKind } from "../../ai";

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

export default function SettingsPage() {
  const {
    kind,
    baseUrl,
    model,
    apiKey,
    setKind,
    setBaseUrl,
    setModel,
    setApiKey,
  } = useSettingsStore();

  const local = kind === "ollama" || kind === "llama.cpp" || kind === "lmstudio";

  return (
    <PageContainer>
      <SectionTitle
        title="设置"
        subtitle="AI Provider 配置——供测评与知识引擎使用"
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h3 className="mb-1 text-sm font-semibold text-slate-700">AI Provider</h3>
          <p className="mb-4 text-xs text-slate-500">
            未配置 Provider 时引擎会优雅降级——启发式逻辑完全离线运行。
          </p>

          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {KINDS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setKind(opt.value)}
                className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                  kind === opt.value
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
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="http://localhost:11434/v1"
                spellCheck={false}
              />
            </Field>
            <Field label="模型">
              <input
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="qwen2.5:7b"
                spellCheck={false}
              />
            </Field>
            {!local ? (
              <Field label="API Key">
                <input
                  type="password"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-..."
                  spellCheck={false}
                />
              </Field>
            ) : null}
          </div>

          <p className="mt-4 text-xs text-slate-400">
            设置目前仅在 Phase 0 阶段为界面层——持久化将随本地存储适配器落地。
          </p>
        </Card>

        <div className="space-y-4">
          <Card>
            <h3 className="mb-3 text-sm font-semibold text-slate-700">Provider 状态</h3>
            <FoundationRow>
              <StatusPill label={local ? "本地（无需 Key）" : "远程"} ok={local} />
              <StatusPill label="启发式降级已就绪" ok />
            </FoundationRow>
            <p className="mt-3 text-xs leading-relaxed text-slate-500">
              {local
                ? "将 Base URL 指向你本地的 OpenAI 兼容服务。知识抽取与测评生成在实装后将使用它。"
                : "填入上方的 API Key。OpenAI 兼容的通信协议在各 Provider 间通用。"}
            </p>
          </Card>

          <Card>
            <h3 className="mb-3 text-sm font-semibold text-slate-700">当前配置</h3>
            <dl className="space-y-1 text-sm">
              <KV k="kind" v={kind} />
              <KV k="baseUrl" v={baseUrl} />
              <KV k="model" v={model} />
              <KV k="apiKey" v={apiKey ? "••••••••" : "（空）"} />
            </dl>
          </Card>
        </div>
      </div>
    </PageContainer>
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
