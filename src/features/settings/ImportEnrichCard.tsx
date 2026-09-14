/**
 * 设置 · AI 分区 → 「导入后 AI 整理」开关
 * （docs/import-ai-enrich-design-2026-09.md §7.1）。
 *
 * 形态**逐字对齐** `VectorIndexCard` 的「自动索引」开关（同款 Card + Checkbox +
 * data-testid 约定），使两处开关的交互与视觉完全一致。
 *
 * 与自动索引开关的两个差异：
 * - 未配置 AI 时**不禁用**勾选框，只追加一行提示 —— 它是「意图」不是「能力」，
 *   禁用会让用户以为设置项坏了；判定用响应式的 `useAiReady()`。
 * - 写入设置是同步的（zustand `set` + persist），无加载态、无空态、无错误态。
 */
import { Card } from "../../components/primitives";
import { Checkbox } from "../../components/ui/checkbox";
import { useI18n } from "../../i18n";
import { useAiReady } from "../../hooks/useAiReady";
import { useSettingsStore } from "../../stores/useSettingsStore";

export default function ImportEnrichCard() {
  const t = useI18n().m.settings.models.importAssist;
  const aiReady = useAiReady();
  const on = useSettingsStore((s) => s.autoEnrichOnImport);
  const setOn = useSettingsStore((s) => s.setAutoEnrichOnImport);

  return (
    <Card className="mt-4">
      <p className="text-sm font-semibold text-ink-1">{t.title}</p>
      <p className="mt-1 text-xs leading-relaxed text-ink-2">{t.desc}</p>

      <label className="mt-3 flex items-start gap-2">
        <Checkbox
          checked={on !== false}
          onCheckedChange={(v) => setOn(v === true)}
          data-testid="settings-auto-enrich"
        />
        <span>
          <span className="text-xs font-medium text-ink-2">{t.label}</span>
          <span className="block text-xs text-ink-3">{t.hint}</span>
        </span>
      </label>

      {!aiReady ? <p className="mt-2 text-xs text-state-weak">{t.noAi}</p> : null}
    </Card>
  );
}
