import { Card, SectionTitle } from "../../components/primitives";
import { PageContainer } from "../../components/layout/AppShell";
import { FoundationRow, StatusPill } from "../scaffold";
import { useSettingsStore } from "../../stores/useSettingsStore";
import type { ProviderKind } from "../../ai";

const KINDS: { value: ProviderKind; label: string }[] = [
  { value: "ollama", label: "Ollama (local)" },
  { value: "llama.cpp", label: "llama.cpp (local)" },
  { value: "lmstudio", label: "LM Studio (local)" },
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "gemini", label: "Gemini" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "custom", label: "Custom (OpenAI-compatible)" },
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
        title="Settings"
        subtitle="AI provider configuration — used by the assessment & knowledge engines"
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h3 className="mb-1 text-sm font-semibold text-slate-700">AI Provider</h3>
          <p className="mb-4 text-xs text-slate-500">
            Engines degrade gracefully without a provider — heuristics run fully offline.
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
            <Field label={local ? "Base URL (local server)" : "Base URL"}>
              <input
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="http://localhost:11434/v1"
                spellCheck={false}
              />
            </Field>
            <Field label="Model">
              <input
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="qwen2.5:7b"
                spellCheck={false}
              />
            </Field>
            {!local ? (
              <Field label="API key">
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
            Settings are UI-only at Phase 0 — persistence lands with the local storage adapter.
          </p>
        </Card>

        <div className="space-y-4">
          <Card>
            <h3 className="mb-3 text-sm font-semibold text-slate-700">Provider status</h3>
            <FoundationRow>
              <StatusPill label={local ? "Local (no key required)" : "Remote"} ok={local} />
              <StatusPill label="Heuristic fallback ready" ok />
            </FoundationRow>
            <p className="mt-3 text-xs leading-relaxed text-slate-500">
              {local
                ? "Point the base URL at your local OpenAI-compatible server. Knowledge extraction and assessment generation will use it once implemented."
                : "Supply the API key above. The OpenAI-compatible wire protocol is shared across providers."}
            </p>
          </Card>

          <Card>
            <h3 className="mb-3 text-sm font-semibold text-slate-700">Current config</h3>
            <dl className="space-y-1 text-sm">
              <KV k="kind" v={kind} />
              <KV k="baseUrl" v={baseUrl} />
              <KV k="model" v={model} />
              <KV k="apiKey" v={apiKey ? "••••••••" : "(empty)"} />
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
