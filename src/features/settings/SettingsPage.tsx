import { useState } from "react";
import { Card, SectionTitle } from "../../components/primitives";
import { PageContainer } from "../../components/layout/AppShell";
import {
  buildActiveProvider,
  useSettingsStore,
} from "../../stores/useSettingsStore";
import { useLangStore } from "../../stores/useLangStore";
import { useI18n } from "../../i18n";
import type { ActiveSource } from "../../ai/active";
import { labelOfLocalModel, labelOfProvider } from "../../ai/presets";
import { testConnection } from "../../ai/connection";
import { hasKeyring } from "../../ai/vault";
import BuiltinModelsPanel from "./BuiltinModelsPanel";
import ApiModelsTab from "./ApiModelsTab";

/**
 * 设置 · AI 模型中心(Q1/Q2/Q3,见 docs/ai-model-center-plan-2026-09.md)。
 *
 * 双 Tab:「本地模型」= 应用自己下载运行的 GGUF(按设备匹配,禁用不支持档);
 * 「API 模型」= 预置(千问等开源模型)+ 配置 baseUrl/model/apiKey。
 * 任意一侧选中即成为全局「当前使用模型」并立即写库;引擎经
 * `buildActiveProvider()` 读取,下次进入功能即生效。
 */

type Tab = "local" | "api";

type Retest =
  | { state: "idle" }
  | { state: "testing" }
  | { state: "ok"; latencyMs: number }
  | { state: "fail"; reason: string; hint: string };

const apiActiveOf = (a: ActiveSource | null) =>
  a && a.source === "api" ? a : null;

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return sameDay ? `今天 ${hm}` : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

export default function SettingsPage() {
  const saved = useSettingsStore();
  const saveActive = useSettingsStore((s) => s.saveActive);
  const clearActive = useSettingsStore((s) => s.clearActive);
  const langMode = useLangStore((s) => s.mode);
  const setLangMode = useLangStore((s) => s.setMode);
  const { lang, m } = useI18n();

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
    bannerDesc = providerReady
      ? "本地模型 · 已就绪 · 数据不出本机,离线可用;知识抽取 / 测评出题判分等 AI 任务将由它完成"
      : "本地模型 · 未就绪(需先在「本地模型」页下载并设为当前)";
    bannerTone = providerReady ? "ok" : "warn";
  } else if (active?.source === "api") {
    bannerTitle = `${labelOfProvider(active.provider)} · ${active.model || "(未填模型)"}`;
    bannerDesc = providerReady
      ? "API 模型 · 已连接,云端推理;知识抽取 / 测评出题判分等 AI 任务将由它完成"
      : "API 模型 · 尚未测试通过(建议先「测试连接」再使用)";
    bannerTone = providerReady ? "ok" : "warn";
  } else {
    bannerTitle = "未选择任何模型";
    bannerDesc =
      "学习功能将以离线启发式运行。下载一个本地模型,或配置一个 API 模型,即可解锁完整 AI 能力。";
    bannerTone = "empty";
  }

  const bannerStyle =
    bannerTone === "ok"
      ? "border-emerald-200 bg-emerald-50/50"
      : bannerTone === "empty"
        ? "border-slate-200 bg-slate-50"
        : "border-amber-200 bg-amber-50/50";

  return (
    <PageContainer>
      <SectionTitle
        title="设置 · AI 模型中心"
        subtitle="选择「当前使用模型」：知识抽取 / 测评出题判分 / 答疑与学习进度总结都由它完成。"
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          {/* Active Banner */}
          <div className={`mb-4 rounded-xl border px-4 py-3 ${bannerStyle}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800">
                  {active ? "当前使用:" : ""}
                  <span
                    className={
                      bannerTone === "ok"
                        ? "text-emerald-700"
                        : bannerTone === "empty"
                          ? "text-slate-500"
                          : "text-amber-700"
                    }
                  >
                    {" "}
                    {bannerTitle}
                  </span>
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{bannerDesc}</p>
              </div>
              {savedFlash ? <span className="shrink-0 text-sm text-emerald-600">已保存 ✓</span> : null}
            </div>
          </div>

          {/* Tabs */}
          <div className="mb-4 flex gap-1 rounded-lg border border-slate-200 bg-slate-100/60 p-1">
            {(
              [
                ["local", "本地模型(下载运行)"],
                ["api", "API 模型(请求)"],
              ] as [Tab, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setTab(value)}
                className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  tab === value
                    ? "bg-white text-indigo-700 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "local" ? (
            <div>
              <p className="mb-3 text-xs font-medium text-indigo-700">
                下载并激活一个本地模型 —— 默认档 Qwen3.5-4B(约 2.5 GB);点选「设为当前」即生效,无需保存。
              </p>
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
            <h3 className="mb-3 text-sm font-semibold text-slate-700">
              {m.settings.lang.title}
            </h3>
            <div className="flex gap-1 rounded-lg border border-slate-200 bg-slate-100/60 p-1">
              {(
                [
                  ["auto", m.settings.lang.auto],
                  ["zh", m.settings.lang.zh],
                  ["en", m.settings.lang.en],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setLangMode(value)}
                  className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    langMode === value
                      ? "bg-white text-indigo-700 shadow-sm"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
              {langMode === "auto"
                ? `${m.settings.lang.autoHint} ${m.settings.lang.current(lang)}`
                : m.settings.lang.current(lang)}
            </p>
          </Card>

          <Card>
            <h3 className="mb-3 text-sm font-semibold text-slate-700">AI 状态</h3>
            <div className="flex flex-wrap items-center gap-2">
              {active ? (
                providerReady ? (
                  <ReadyPill label="保存时已通过测试" ok />
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                    保存时未通过测试
                  </span>
                )
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">
                  <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                  未选择模型
                </span>
              )}
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                离线启发式引擎始终可用
              </span>
            </div>

            {/* 运行时实时探活 —— buildActiveProvider 接线:isConfigured 判定当前
                能否真实调用(而非盲信缓存 providerReady),模型文件被删 / Key 被
                清等场景立即反映为不可用。 */}
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
              <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                运行时
              </span>
              {active === null ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">
                  <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                  引擎走离线启发式
                </span>
              ) : liveReady ? (
                <ReadyPill label="当前模型可调用" ok />
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                  缺关键配置(模型文件 / Key / 地址)
                </span>
              )}
              {active?.source === "api" ? (
                <button
                  onClick={() => void retestActive()}
                  disabled={retest.state === "testing"}
                  className="rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {retest.state === "testing" ? "测试中…" : "重新测试连接"}
                </button>
              ) : null}
            </div>
            {retest.state === "ok" ? (
              <p className="mt-2 text-xs text-emerald-600">
                重新测试通过 · 延迟 {retest.latencyMs}ms
              </p>
            ) : retest.state === "fail" ? (
              <div className="mt-2 rounded-lg border border-red-200 bg-red-50/60 px-3 py-2">
                <p className="text-xs font-medium text-red-700">{retest.reason}</p>
                <p className="mt-0.5 text-[11px] text-red-600/90">→ {retest.hint}</p>
              </div>
            ) : null}
            {active?.source === "api" && hasKeyring() ? (
              <p className="mt-3 border-t border-slate-100 pt-2 text-[11px] leading-relaxed text-slate-500">
                API Key 已存入系统钥匙串(Keychain),不在本机明文保存;由应用读写,设置页仅显示掩码。
              </p>
            ) : null}
            <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
              「保存时已通过测试」记录上次保存结果;「运行时」实时判定当前能否调用。未就绪时引擎自动以本地启发式逻辑降级运行(不崩溃)。
            </p>
          </Card>

          <Card>
            <h3 className="mb-3 text-sm font-semibold text-slate-700">当前配置</h3>
            <dl className="space-y-1 text-sm">
              <KV
                k="来源"
                v={
                  active?.source === "local"
                    ? "本地模型"
                    : active?.source === "api"
                      ? "API 模型"
                      : "（未选择）"
                }
              />
              {active?.source === "local" ? <KV k="模型" v={labelOfLocalModel(active.model)} /> : null}
              {active?.source === "api" ? (
                <>
                  <KV k="供应商" v={labelOfProvider(active.provider)} />
                  <KV k="模型" v={active.model || "（空）"} />
                  <KV k="Base URL" v={active.baseUrl || "（空）"} />
                  <KV k="API Key" v={active.apiKey ? "••••••••" : "（空）"} />
                </>
              ) : null}
              <KV
                k="状态"
                v={
                  providerReady && saved.testedAt
                    ? `测试通过 · ${formatTime(saved.testedAt)}${
                        saved.lastLatencyMs ? ` · ${saved.lastLatencyMs}ms` : ""
                      }`
                    : "未通过测试 / 尚未就绪"
                }
              />
            </dl>
          </Card>
        </div>
      </div>
    </PageContainer>
  );
}

function ReadyPill({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
        ok
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-slate-200 bg-slate-50 text-slate-600"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald-500" : "bg-slate-400"}`} />
      {label}
    </span>
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
