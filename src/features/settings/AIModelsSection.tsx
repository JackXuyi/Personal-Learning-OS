import { useState } from "react";
import { Card } from "../../components/primitives";
import {
  buildActiveProvider,
  useSettingsStore,
} from "../../stores/useSettingsStore";
import { useI18n } from "../../i18n";
import type { ActiveSource } from "../../ai/active";
import { labelOfLocalModel, labelOfProvider } from "../../ai/presets";
import { testConnection } from "../../ai/connection";
import { hasKeyring } from "../../ai/vault";
import BuiltinModelsPanel from "./BuiltinModelsPanel";
import ApiModelsTab from "./ApiModelsTab";

/**
 * 设置 · AI 模型中心（U6b 由 SettingsPage 迁移，作为「AI」分区内容）。
 *
 * 双 Tab:「本地模型」= 应用自己下载运行的 GGUF(按设备匹配,禁用不支持档);
 * 「API 模型」= 预置(千问等开源模型)+ 配置 baseUrl/model/apiKey。
 * 任意一侧选中即成为全局「当前使用模型」并立即写库;引擎经
 * `buildActiveProvider()` 读取,下次进入功能即生效。
 *
 * B 案 token 化:成功 → state-mastered;警告 → state-weak;错误 → state-failed;
 * 强调操作 → accent。无功能回退。
 */

type Tab = "local" | "api";

type Retest =
  | { state: "idle" }
  | { state: "testing" }
  | { state: "ok"; latencyMs: number }
  | { state: "fail"; reason: string; hint: string };

const apiActiveOf = (a: ActiveSource | null) =>
  a && a.source === "api" ? a : null;

function formatTime(ts: number, today: string): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return sameDay ? `${today} ${hm}` : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

export default function AIModelsSection() {
  const saved = useSettingsStore();
  const saveActive = useSettingsStore((s) => s.saveActive);
  const clearActive = useSettingsStore((s) => s.clearActive);
  const { m } = useI18n();
  const s = m.settings.models;

  const [tab, setTab] = useState<Tab>(
    saved.active?.source === "api" ? "api" : "local",
  );
  const [savedFlash, setSavedFlash] = useState(false);
  const [retest, setRetest] = useState<Retest>({ state: "idle" });

  const { active, providerReady } = saved;
  const apiSaved = apiActiveOf(active);

  /** 实时就绪判定:直接问「当前 provider 能否调用」(非缓存 providerReady)。
   *  模型文件被删 / Key 被清 → 这里立即反映为不可用。 */
  const liveReady = active !== null && buildActiveProvider().isConfigured();

  const flash = () => {
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 2500);
  };

  const onLocalActivate = (model: string) => {
    saveActive({ source: "local", model }, { testedOk: true });
    flash();
  };

  const onUseApi = (
    api: Extract<ActiveSource, { source: "api" }>,
    testedOk: boolean,
    latencyMs?: number,
  ) => {
    saveActive(api, { testedOk, latencyMs });
  };

  /** 对「已保存的当前 API 模型」再做一次真实连接测试(不经表单草稿)。 */
  const retestActive = async () => {
    if (active?.source !== "api") return;
    setRetest({ state: "testing" });
    const cfg = {
      kind: active.provider,
      baseUrl: active.baseUrl.trim() || undefined,
      model: active.model.trim() || undefined,
      apiKey: active.apiKey.trim() || undefined,
    };
    const result = await testConnection(cfg);
    if (result.ok) {
      saveActive(active, { testedOk: true, latencyMs: result.latencyMs });
      setRetest({ state: "ok", latencyMs: result.latencyMs });
    } else {
      setRetest({ state: "fail", reason: result.reason, hint: result.hint });
    }
  };

  // ---- Active Banner 文案 ----
  let bannerTitle: string;
  let bannerDesc: string;
  let bannerTone: "ok" | "warn" | "empty" = "warn";
  if (active?.source === "local") {
    bannerTitle = labelOfLocalModel(active.model);
    bannerDesc = providerReady ? s.banner.localReady : s.banner.localNotReady;
    bannerTone = providerReady ? "ok" : "warn";
  } else if (active?.source === "api") {
    bannerTitle = `${labelOfProvider(active.provider)} · ${active.model || s.banner.untitledModel}`;
    bannerDesc = providerReady ? s.banner.apiReady : s.banner.apiNotReady;
    bannerTone = providerReady ? "ok" : "warn";
  } else {
    bannerTitle = s.banner.noneTitle;
    bannerDesc = s.banner.noneDesc;
    bannerTone = "empty";
  }

  const bannerStyle =
    bannerTone === "ok"
      ? "border-state-mastered/25 bg-state-mastered/10"
      : bannerTone === "empty"
        ? "border-line bg-subtle"
        : "border-state-weak/30 bg-state-weak/10";

  return (
    <div>
      <p className="text-sm text-ink-2">{s.pageSubtitle}</p>

      {/* Active Banner */}
      <div className={`mt-4 rounded-xl border px-4 py-3 ${bannerStyle}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink-1">
              {active ? s.banner.activePrefix : ""}
              <span
                className={
                  bannerTone === "ok"
                    ? "text-state-mastered"
                    : bannerTone === "empty"
                      ? "text-ink-3"
                      : "text-state-weak"
                }
              >
                {" "}
                {bannerTitle}
              </span>
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-ink-2">{bannerDesc}</p>
          </div>
          {savedFlash ? <span className="shrink-0 text-sm text-state-mastered">{s.savedOk}</span> : null}
        </div>
      </div>

      <div className="mt-4 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          {/* Tabs */}
          <div className="mb-4 flex gap-1 rounded-lg border border-line bg-subtle p-1">
            {(
              [
                ["local", s.tabLocal],
                ["api", s.tabApi],
              ] as [Tab, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setTab(value)}
                className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  tab === value
                    ? "bg-surface text-accent shadow-sm"
                    : "text-ink-2 hover:text-ink-1"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "local" ? (
            <div>
              <p className="mb-3 text-xs font-medium text-accent">{s.localHint}</p>
              <BuiltinModelsPanel
                activeModel={active?.source === "local" ? active.model : null}
                onActivate={onLocalActivate}
                onClearActive={() => {
                  clearActive();
                  flash();
                }}
              />
            </div>
          ) : (
            <ApiModelsTab saved={apiSaved} onUse={onUseApi} />
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <h3 className="mb-3 text-sm font-semibold text-ink-1">{s.aiStatus}</h3>
            <div className="flex flex-wrap items-center gap-2">
              {active ? (
                providerReady ? (
                  <ReadyPill label={s.savedPassed} ok />
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-state-weak/30 bg-state-weak/10 px-2.5 py-1 text-xs font-medium text-state-weak">
                    <span className="h-1.5 w-1.5 rounded-full bg-state-weak" />
                    {s.savedFailed}
                  </span>
                )
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-subtle px-2.5 py-1 text-xs font-medium text-ink-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-ink-3" />
                  {s.noModel}
                </span>
              )}
              <span className="inline-flex items-center gap-1.5 rounded-full border border-state-mastered/25 bg-state-mastered/10 px-2.5 py-1 text-xs font-medium text-state-mastered">
                <span className="h-1.5 w-1.5 rounded-full bg-state-mastered" />
                {s.heuristicAlways}
              </span>
            </div>

            {/* 运行时实时探活 —— buildActiveProvider 接线:isConfigured 判定当前
                能否真实调用(而非盲信缓存 providerReady),模型文件被删 / Key 被
                清等场景立即反映为不可用。 */}
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
              <span className="text-[11px] font-medium uppercase tracking-wide text-ink-3">
                {s.runtime}
              </span>
              {active === null ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-subtle px-2.5 py-1 text-xs font-medium text-ink-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-ink-3" />
                  {s.runtimeHeuristic}
                </span>
              ) : liveReady ? (
                <ReadyPill label={s.runtimeCallable} ok />
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-state-weak/30 bg-state-weak/10 px-2.5 py-1 text-xs font-medium text-state-weak">
                  <span className="h-1.5 w-1.5 rounded-full bg-state-weak" />
                  {s.runtimeMissingCfg}
                </span>
              )}
              {active?.source === "api" ? (
                <button
                  onClick={() => void retestActive()}
                  disabled={retest.state === "testing"}
                  className="rounded-md border border-line px-2.5 py-1 text-xs text-ink-2 transition hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {retest.state === "testing" ? s.retesting : s.retestConnection}
                </button>
              ) : null}
            </div>
            {retest.state === "ok" ? (
              <p className="mt-2 text-xs text-state-mastered">
                {s.retestOk(retest.latencyMs)}
              </p>
            ) : retest.state === "fail" ? (
              <div className="mt-2 rounded-lg border border-state-failed/25 bg-state-failed/10 px-3 py-2">
                <p className="text-xs font-medium text-state-failed">{retest.reason}</p>
                <p className="mt-0.5 text-[11px] text-state-failed/80">→ {retest.hint}</p>
              </div>
            ) : null}
            {active?.source === "api" && hasKeyring() ? (
              <p className="mt-3 border-t border-line pt-2 text-[11px] leading-relaxed text-ink-2">
                {s.keychainNote}
              </p>
            ) : null}
            <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
              {s.statusLegend}
            </p>
          </Card>

          <Card>
            <h3 className="mb-3 text-sm font-semibold text-ink-1">{s.currentConfig}</h3>
            <dl className="space-y-1 text-sm">
              <KV
                k={s.kv.source}
                v={
                  active?.source === "local"
                    ? s.kv.sourceLocal
                    : active?.source === "api"
                      ? s.kv.sourceApi
                      : s.kv.none
                }
              />
              {active?.source === "local" ? <KV k={s.kv.model} v={labelOfLocalModel(active.model)} /> : null}
              {active?.source === "api" ? (
                <>
                  <KV k={s.kv.provider} v={labelOfProvider(active.provider)} />
                  <KV k={s.kv.model} v={active.model || s.kv.empty} />
                  <KV k="Base URL" v={active.baseUrl || s.kv.empty} />
                  <KV k="API Key" v={active.apiKey ? "••••••••" : s.kv.empty} />
                </>
              ) : null}
              <KV
                k={s.kv.status}
                v={
                  providerReady && saved.testedAt
                    ? s.kv.testedPass(
                        formatTime(saved.testedAt, s.timeToday),
                        saved.lastLatencyMs ?? null,
                      )
                    : s.kv.notTested
                }
              />
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}

function ReadyPill({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
        ok
          ? "border-state-mastered/25 bg-state-mastered/10 text-state-mastered"
          : "border-line bg-subtle text-ink-2"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-state-mastered" : "bg-ink-3"}`} />
      {label}
    </span>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-ink-3">{k}</dt>
      <dd className="truncate text-ink-1">{v}</dd>
    </div>
  );
}
