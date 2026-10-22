/**
 * 设置 · AI 分区 → 「翻译」目标语言 + 整库翻译
 * （docs/learn-ai-translation-design-2026-10.md D1 / D7-A / §14.11）。
 *
 * 形态对齐 `ImportEnrichCard`：同款 Card + 一行说明 + 一行诚实备注。
 *
 * 四个要点：
 * - **落 AI 分区而不是「外观与语言」**：翻译是 AI 行为，未配模型时这一项没有意义；
 *   且不新增分区键 ⇒ 不动 `settings-nav.ts` / 路由 / `settings.sections`。
 * - **目标语言写入是同步的**（zustand `set` + persist）⇒ 无加载态；
 *   沿用 `plos:lang:v1`，不新增 localStorage key。
 * - **整库翻译是长任务**：进度走 `useAiTask("translation:library")`（与全站 AI 任务
 *   同一口径）+ 一处模块级 AbortController —— 后者是为了「切页回来还能点暂停」：
 *   组件卸载会丢掉 ref，但任务还在跑。
 * - **成本预估只在 UI 算**（`LOCAL_CHARS_PER_SEC` 是本机实测值，不是产品承诺）：
 *   写进 domain 会把一次测量固化成契约。
 */
import { useEffect, useState } from "react";
import { Card } from "../../components/primitives";
import { Button } from "../../components/ui/button";
import { Progress } from "../../components/ui/progress";
import { ConfirmDialog } from "../../components/ui/confirm-dialog";
import { Select } from "../../components/ui/select";
import { useI18n } from "../../i18n";
import { useAiReady } from "../../hooks/useAiReady";
import { useAiTask } from "../../stores/useAiTaskStore";
import { useLangStore } from "../../stores/useLangStore";
import { storage } from "../../stores/useLoopStore";
import { buildActiveProvider } from "../../stores/useSettingsStore";
import { useTranslationIndexStore } from "../../stores/useTranslationIndexStore";
import {
  TRANSLATION_TARGETS,
  isTranslationTarget,
  resolveTranslationTarget,
} from "../../domain";
import type { LibraryProgress } from "../learn/translation-library-service";
import { translateLibrary } from "../learn/translation-library-service";

/**
 * 本地模型的翻译吞吐（字符/秒）—— **本机实测值**，用于给用户一个量级感。
 *
 * 取自 2026-10-22 应用日志：682 字 / 24.8s、715 字 / 20.5s ⇒ ≈30 字/秒。
 * 刻意只放在 UI（不进 domain）：换机器 / 换模型就会变，写进领域层会被当契约读。
 */
const LOCAL_CHARS_PER_SEC = 30;

/**
 * 整库任务的取消句柄（**模块级**）。
 *
 * 放模块级而不是 `useRef`：设置页切走再回来时组件已卸载，ref 丢了 ——
 * 而任务仍在跑。那时用户点「暂停」必须能拿到同一个 controller，
 * 否则按钮静默无效（比没有按钮更糟）。
 */
let libraryAbort: AbortController | null = null;

export default function TranslationCard() {
  const { m, lang } = useI18n();
  const t = m.settings.models.translation;
  const aiReady = useAiReady();
  const targetPref = useLangStore((s) => s.translationTarget);
  const setTarget = useLangStore((s) => s.setTranslationTarget);
  /** 已解析的目标语言（与阅读页/服务层同一个解析入口）。 */
  const target = resolveTranslationTarget(targetPref, lang);

  const rows = useTranslationIndexStore((s) => s.rows);
  const doneChapters = [...rows.values()].filter((r) => r.target === target).length;

  /** 整库任务（跨页存活；`running` 即「正在跑」）。 */
  const libTask = useAiTask("translation:library");
  const running = libTask.running;

  /** 可翻译章数与总字数（设置页打开时算一次；用于预估与分母）。 */
  const [stats, setStats] = useState<{ chapters: number; chars: number } | undefined>();
  const [progress, setProgress] = useState<LibraryProgress | undefined>();
  /** 一句结果提示（完成 / 暂停 / 清空），**只显示一次**，下次操作覆盖。 */
  const [notice, setNotice] = useState<string | undefined>();
  const [askClear, setAskClear] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const docs = await storage.listDocuments();
        let chapters = 0;
        let chars = 0;
        for (const doc of docs) {
          const text = doc.textPreview ?? "";
          if (text.length === 0) continue;
          for (const ch of await storage.listChapters(doc.id)) {
            const start = Math.max(0, ch.contentRef.start);
            const end = Math.min(text.length, ch.contentRef.end);
            const len = end - start;
            if (len <= 0) continue;
            chapters += 1;
            chars += len;
          }
        }
        if (alive) setStats({ chapters, chars });
      } catch {
        // 统计失败就不显示预估：宁可少一行信息，也不显示编造的数字。
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  /** 本地模型下的小时数（≥0.1 才显示，避免「约 0.0 小时」这种噪音）。 */
  const estimateHours = stats && stats.chars > 0 ? stats.chars / LOCAL_CHARS_PER_SEC / 3600 : 0;
  const isLocal = buildActiveProvider().kind === "builtin";

  const startLibrary = async () => {
    if (running) return;
    setNotice(undefined);
    const controller = new AbortController();
    libraryAbort = controller;
    try {
      const r = await libTask.run(async (report) =>
        translateLibrary({
          target,
          signal: controller.signal,
          onProgress: (p) => {
            setProgress(p);
            // 任务表的 phase 也带上进度：切到别的页面再回来仍能看到「已翻 12 / 486 章」。
            report(
              t.libraryProgress(p.doneChapters, p.totalChapters),
              p.totalChapters > 0 ? p.doneChapters / p.totalChapters : undefined,
            );
          },
        }),
      );
      setNotice(
        r.cancelled ? t.libraryCancelled : r.translated > 0 ? t.libraryDone(r.translated) : undefined,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      // 重入被拦：不是错误，保持现状（别把「已经在跑了」显示成失败）。
      if (msg === "task-already-running") return;
      // 服务层只产机器令牌（项目红线），文案在这里映射。
      setNotice(msg === "translation:no-ai" ? t.noAi : t.libraryFailed);
    } finally {
      libraryAbort = null;
      setProgress(undefined);
      // 索引以库为准做一次收口（upsert 已在每章完成时做过，这里防漏）。
      void useTranslationIndexStore.getState().refresh();
    }
  };

  const pause = () => {
    libraryAbort?.abort();
  };

  const clearTranslations = async () => {
    setAskClear(false);
    try {
      // 逐份资料删：桌面端每条命令一次事务，比「全库一条 DELETE」更安全地保留
      // 了「资料维度」语义（将来若按资料重翻，也是同一条路径）。
      for (const doc of await storage.listDocuments()) {
        await storage.deleteTranslationsByDocument(doc.id).catch(() => undefined);
      }
      useTranslationIndexStore.getState().clear();
      setNotice(t.cleared);
    } catch {
      // 删不干净时保持索引原状（下次 refresh 会纠正），不谎报已清空。
    }
  };

  const percent =
    progress && progress.totalChapters > 0
      ? Math.round((progress.doneChapters / progress.totalChapters) * 100)
      : 0;

  return (
    <Card className="mt-4">
      <p className="text-sm font-semibold text-ink-1">{t.title}</p>
      <p className="mt-1 text-xs leading-relaxed text-ink-2">{t.desc}</p>

      <div className="mt-3" data-testid="settings-translation-target">
        <Select
          value={targetPref}
          onValueChange={(v) => {
            // 持久化值来自旧版本 / 手改 localStorage 时可能非法 → 白名单过滤，
            // 不把脏值写进 store（否则阅读页会解析出未定义的 TranslationLang）。
            if (isTranslationTarget(v)) setTarget(v);
          }}
          ariaLabel={t.title}
          className="w-56"
          size="sm"
          options={TRANSLATION_TARGETS.map((v) => ({ value: v, label: t.options[v] }))}
        />
      </div>

      {!aiReady ? <p className="mt-2 text-xs text-state-weak">{t.noAi}</p> : null}

      {/* ===== 整库翻译 ===== */}
      <div className="mt-5 border-t border-line pt-4">
        <p className="text-xs font-semibold text-ink-1">{t.libraryTitle}</p>
        <p className="mt-1 text-xs leading-relaxed text-ink-2">{t.libraryDesc}</p>

        {stats && stats.chapters === 0 ? (
          <p className="mt-2 text-xs text-ink-3">{t.libraryEmpty}</p>
        ) : (
          <>
            <p
              className="mt-2 text-xs tabular-nums text-ink-3"
              data-testid="settings-translation-progress"
            >
              {progress
                ? t.libraryProgress(progress.doneChapters, progress.totalChapters)
                : stats
                  ? t.libraryProgress(doneChapters, stats.chapters)
                  : null}
            </p>
            {progress ? (
              <Progress value={percent} className="mt-2" data-testid="settings-translation-bar" />
            ) : null}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={!aiReady || running}
                loading={running}
                data-testid="settings-translation-library"
                onClick={() => void startLibrary()}
              >
                {doneChapters > 0 ? t.libraryResume : t.libraryStart}
              </Button>
              {running ? (
                <Button size="sm" variant="ghost" onClick={pause} data-testid="settings-translation-pause">
                  {t.libraryPause}
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                disabled={running || doneChapters === 0}
                onClick={() => setAskClear(true)}
                data-testid="settings-translation-clear"
              >
                {t.clear}
              </Button>
            </div>

            {running ? <p className="mt-2 text-xs text-ink-3">{t.libraryStopHint}</p> : null}
            {/* 本地模型整库是「数小时」级任务 —— 必须在点之前说清，不能等跑起来才让人后悔 */}
            {isLocal && estimateHours >= 0.1 ? (
              <p className="mt-2 text-xs leading-relaxed text-state-weak">
                {t.libraryEstimate(estimateHours.toFixed(1))}
              </p>
            ) : null}
          </>
        )}

        {notice ? (
          <p className="mt-2 text-xs leading-relaxed text-ink-2" data-testid="settings-translation-notice">
            {notice}
          </p>
        ) : null}
      </div>

      <ConfirmDialog
        open={askClear}
        onOpenChange={setAskClear}
        title={t.clearTitle}
        description={t.clearDesc}
        confirmLabel={t.clearConfirm}
        cancelLabel={t.clearCancel}
        destructive
        onConfirm={() => void clearTranslations()}
      />
    </Card>
  );
}
