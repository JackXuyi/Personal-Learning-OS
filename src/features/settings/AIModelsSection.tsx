import { useState } from "react";
import { Card } from "../../components/primitives";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useI18n } from "../../i18n";
import type { ActiveSource } from "../../ai/active";
import { labelOfLocalModel, labelOfProvider } from "../../ai/presets";
import BuiltinModelsPanel from "./BuiltinModelsPanel";
import ApiModelsTab from "./ApiModelsTab";
import VectorIndexCard from "./VectorIndexCard";

/**
 * 设置 · AI 模型中心（U6b 由 SettingsPage 迁移，作为「AI」分区内容）。
 *
 * 双 Tab:「本地模型」= 应用自己下载运行的 GGUF(按设备匹配,禁用不支持档);
 * 「API 模型」= 预置(千问等开源模型)+ 配置 baseUrl/model/apiKey。
 * 任意一侧选中即成为全局「当前使用模型」并立即写库;引擎经
 * `buildActiveProvider()` 读取,下次进入功能即生效。
 *
 * B 案 token 化:成功 → state-mastered;警告 → state-weak;错误 → state-failed;
 * 强调操作 → primary。无功能回退。
 */

type Tab = "local" | "api";

const apiActiveOf = (a: ActiveSource | null) =>
  a && a.source === "api" ? a : null;

export default function AIModelsSection() {
  const saved = useSettingsStore();
  const saveActive = useSettingsStore((s) => s.saveActive);
  const clearActive = useSettingsStore((s) => s.clearActive);
  const { m } = useI18n();
  const s = m.settings.models;

  const [tab, setTab] = useState<Tab>(
    saved.active?.source === "api" ? "api" : "local",
  );
  const { active, providerReady } = saved;
  const apiSaved = apiActiveOf(active);


  const onLocalActivate = (model: string) => {
    saveActive({ source: "local", model }, { testedOk: true });
  };

  const onUseApi = (
    api: Extract<ActiveSource, { source: "api" }>,
    testedOk: boolean,
    latencyMs?: number,
  ) => {
    saveActive(api, { testedOk, latencyMs });
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


  return (
    <div className="space-y-4">
      <div className="w-full">
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
                    ? "bg-surface text-primary shadow-sm"
                    : "text-ink-2 hover:text-ink-1"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "local" ? (
            <div>
              <p className="mb-3 text-xs font-medium text-primary">{s.localHint}</p>
              <BuiltinModelsPanel
                activeModel={active?.source === "local" ? active.model : null}
                onActivate={onLocalActivate}
                onClearActive={() => {
                  clearActive();
                }}
              />
            </div>
          ) : (
            <ApiModelsTab saved={apiSaved} onUse={onUseApi} />
          )}
        </Card>
      </div>

      {/* 向量索引（RAG 语义检索）：端点/Key 继承「当前使用模型」，模型名单独配置。 */}
      <VectorIndexCard />
    </div>
  );
}

