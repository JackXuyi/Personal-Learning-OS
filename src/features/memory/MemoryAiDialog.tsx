/**
 * AI 归纳弹窗（F9 · §7.4 / §7.5）：三步 —— 隐私告知 → 只读预览 → 结果预览。
 *
 * 三步的**必要性**（R3）：送出去的是一份「跨几十次操作攒出来的」文本，用户不可能记得
 * 里面写过什么（可能夹着真实人名、公司名、客户信息）。所以：
 * ① 告知（条数 + 字数 + 掩码口径**如实**：公司名不掩码，别宣称「已匿名化」）；
 * ② 把**将要发送的原文**摊开给用户看（这一步比 F1 简历导入更严）；
 * ③ 结果**先预览再写入** —— 不点「写进文档」就什么都不改。
 *
 * ⚠️ 与 D3 的关系：第 ③ 步不是「记忆采纳确认」（那个决策已被推翻），而是
 * **外发内容确认** —— 两者性质不同，前者是「要不要这条」、后者是「要不要发出去」。
 *
 * ⚠️ **零写入**：模型调用阶段不碰 storage；只有用户点「写进文档」才走
 * `useLoopStore.applyMemoryAi`（合并器 + 落库）。
 */
import { useMemo, useState } from "react";
import { useI18n } from "../../i18n";
import type { GeneratedEntry, MemoryDocMeta, ParsedMemoryDoc } from "../../domain";
import { buttonVariants } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { buildActiveProvider } from "../../stores/useSettingsStore";
import { useLoopStore } from "../../stores/useLoopStore";
import { MemoryRunError, prepareAiRun, runMemoryAi, type MemoryRunErrorKind } from "./memory-import";
import type { MemorySignals } from "./memory-signals";
import { lastMergedPrefixOf, scaffoldOf } from "./memory-texts";

type Step = "notice" | "payload" | "result";

export default function MemoryAiDialog({
  open,
  onClose,
  signals,
  parsed,
  meta,
}: {
  open: boolean;
  onClose: () => void;
  signals: MemorySignals;
  parsed: ParsedMemoryDoc;
  meta: MemoryDocMeta;
}) {
  const { m } = useI18n();
  const applyMemoryAi = useLoopStore((s) => s.applyMemoryAi);
  const [step, setStep] = useState<Step>("notice");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<MemoryRunErrorKind | undefined>(undefined);
  const [entries, setEntries] = useState<GeneratedEntry[]>([]);
  const [counts, setCounts] = useState({ updated: 0, added: 0, skipped: 0 });

  // 备料（纯本地、不外发）：隐私告知与预览用的是**同一份**数据 → 预览与实发不可能漂移。
  const prepared = useMemo(
    () => (open ? prepareAiRun({ signals, parsed, meta }) : undefined),
    [open, signals, parsed, meta],
  );

  const errText: Record<MemoryRunErrorKind, string> = {
    "ai-not-configured": m.memory.err.aiNotConfigured,
    "not-enough-samples": m.memory.err.notEnoughSamples,
    "ai-failed": m.memory.err.aiFailed,
    "empty-draft": m.memory.err.emptyDraft,
  };

  async function send() {
    if (!prepared) return;
    setBusy(true);
    setErr(undefined);
    try {
      const result = await runMemoryAi({
        provider: buildActiveProvider(),
        samples: prepared.samples,
        behaviorSummary: prepared.behaviorSummary,
        existing: prepared.existing,
        unwanted: prepared.unwanted,
      });
      setEntries(result.entries);
      setCounts({ updated: result.updatedCount, added: result.addedCount, skipped: result.skippedUnwanted });
      setStep("result");
    } catch (e) {
      setErr(e instanceof MemoryRunError ? e.kind : "ai-failed");
    } finally {
      setBusy(false);
    }
  }

  async function write() {
    setBusy(true);
    try {
      await applyMemoryAi(entries, {
        now: Date.now(),
        scaffold: scaffoldOf(m),
        lastMergedPrefix: lastMergedPrefixOf(m),
      });
      onClose();
    } catch {
      setErr("ai-failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="max-w-2xl" data-testid="memory-ai-dialog">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold text-ink-1">
            {step === "notice" ? m.memory.privacyTitle : step === "payload" ? m.memory.payloadTitle : m.memory.resultTitle}
          </DialogTitle>
        </DialogHeader>

        {err ? (
          <p className="rounded-lg border border-line bg-subtle p-2 text-xs text-state-failed" data-testid="memory-ai-error">
            {errText[err]}
          </p>
        ) : null}

        {step === "notice" && prepared ? (
          <div className="space-y-3">
            <p className="text-sm leading-relaxed text-ink-1">
              {m.memory.privacySend(
                prepared.samples.filter((s) => s.kind === "note").length,
                prepared.samples.filter((s) => s.kind === "restatement").length,
                prepared.samples.reduce((n, s) => n + s.text.length, 0),
              )}
            </p>
            <p className="text-xs leading-relaxed text-ink-3">{m.memory.privacyMaskNote}</p>
            <DialogFooter>
              <button type="button" className={buttonVariants({ variant: "ghost", size: "sm" })} onClick={onClose}>
                {m.common.cancel}
              </button>
              <button
                type="button"
                className={buttonVariants({ variant: "outline", size: "sm" })}
                data-testid="memory-ai-view-payload"
                onClick={() => setStep("payload")}
              >
                {m.memory.viewPayload}
              </button>
            </DialogFooter>
          </div>
        ) : null}

        {step === "payload" && prepared ? (
          <div className="space-y-3">
            <p className="text-xs text-ink-3">{m.memory.payloadWarn}</p>
            <pre
              className="max-h-80 overflow-auto rounded-lg border border-line bg-subtle p-3 text-xs leading-relaxed text-ink-2"
              data-testid="memory-ai-payload"
            >
              {[
                prepared.behaviorSummary,
                ...prepared.samples.map((s) => `[${s.id}] ${s.text}`),
                ...prepared.existing.map((e) => `[${e.key}] ${e.text}`),
              ].join("\n")}
            </pre>
            <DialogFooter>
              <button
                type="button"
                className={buttonVariants({ variant: "ghost", size: "sm" })}
                onClick={() => setStep("notice")}
              >
                {m.memory.back}
              </button>
              <button
                type="button"
                className={buttonVariants({ variant: "default", size: "sm" })}
                data-testid="memory-ai-send"
                disabled={busy}
                onClick={() => void send()}
              >
                {busy ? m.memory.aiRunning : m.memory.send}
              </button>
            </DialogFooter>
          </div>
        ) : null}

        {step === "result" ? (
          <div className="space-y-3">
            <p className="text-xs text-ink-3">{m.memory.resultHint}</p>
            {entries.length === 0 ? (
              <p className="text-sm text-ink-2">{m.memory.resultEmpty}</p>
            ) : (
              <>
                <ul className="space-y-1" data-testid="memory-ai-entries">
                  {entries.map((e) => (
                    <li key={e.key} className="text-sm leading-relaxed text-ink-1">
                      · {e.text}
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-ink-3">
                  {[
                    counts.updated > 0 ? m.memory.resultUpdated(counts.updated) : "",
                    counts.added > 0 ? m.memory.resultAdded(counts.added) : "",
                    counts.skipped > 0 ? m.memory.resultSkipped(counts.skipped) : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </>
            )}
            <DialogFooter>
              <button type="button" className={buttonVariants({ variant: "ghost", size: "sm" })} onClick={onClose}>
                {m.common.cancel}
              </button>
              <button
                type="button"
                className={buttonVariants({ variant: "outline", size: "sm" })}
                onClick={() => void send()}
                disabled={busy}
              >
                {m.memory.retry}
              </button>
              <button
                type="button"
                className={buttonVariants({ variant: "default", size: "sm" })}
                data-testid="memory-ai-write"
                disabled={busy || entries.length === 0}
                onClick={() => void write()}
              >
                {m.memory.writeToDoc}
              </button>
            </DialogFooter>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
