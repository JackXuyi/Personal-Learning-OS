/**
 * 学习者记忆（`/memory`）—— 一份「系统整理、用户可改」的 markdown 文档。
 * 方案：docs/learner-memory-design-2026-09.md §7.1 / §7.2 / §7.3 / §8.15。
 *
 * 本页守住三个「唯一」：
 * 1. **时间基准唯一**：`now` 在 mount 时取一次，通道 A 派生（`deriveAllFacts`）、
 *    页头「覆盖 N 天」、落库的 `lastMergedAt` 全部用它（跨零点会让同屏两个数字互相矛盾，
 *    与 F2/F3 同口径）。
 * 2. **通道 A 唯一入口**：全仓只有本页调 `refreshMemory`（打开即自动整理）。
 *    理由见方案 §4.4：零外发、零成本，而「只在点击后才更新」会让用户读到一份**过期的
 *    自我描述** —— 它又是 AI 注入的真源，过期即错误。
 * 3. **空态判据**：`派生条目为空 且 文档里没有生效条目` → 只渲一张空态卡，
 *    **不渲染空文档骨架**（TC-UC01-04；对齐 F3「全空只渲一张空态卡」）。
 *    注意判据是「没有生效条目」而不是「文档为空」：文档可能已有骨架，或用户手写过内容 ——
 *    用户的手写内容必须照常渲染出来。
 *
 * ⚠️ AI 通道（通道 B）不在这里：它整个活在 `MemoryAiDialog` 里，且**模型调用阶段零写入**。
 * ⚠️ 本页是**只读派生 + 文档读写**：不写 mastery、不写计划、不碰 F4 的清库口径。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Bar, Card, SegmentedTabs } from "../../components/primitives";
import { buttonVariants } from "../../components/ui/button";
import { PageContainer } from "../../components/layout/AppShell";
import { cn } from "../../lib/utils";
import { useI18n } from "../../i18n";
import type { LearnerProfile } from "../../domain";
import { MEMORY_FACT_MIN_SAMPLES, formatMemoryTimestamp, parseMemoryDoc } from "../../domain";
import { EVIDENCE_LOG_MAX } from "../../storage/memory";
import { storage, useLoopStore } from "../../stores/useLoopStore";
import { buildActiveProvider } from "../../stores/useSettingsStore";
import type { MemorySignals } from "./memory-signals";
import { countChapters, loadMemorySignals } from "./memory-signals";
import type { MergeStats } from "./memory-doc-merge";
import { memoryDiffs } from "./memory-doc-merge";
import { deriveAllFacts, spanDays, studyStyleMismatch } from "./memory-facts";
import { factTextsOf, lastMergedPrefixOf, scaffoldOf } from "./memory-texts";
import type { MemoryErrorKind } from "./memory-service";
import { MemoryError } from "./memory-service";
import { MEMORY_AI_MIN_SAMPLES, prepareAiRun } from "./memory-import";
import {
  isDesktopFileAvailable,
  readMemoryDocFromFile,
  revealMemoryDoc,
  saveMemoryDocToFile,
} from "./desktop-memory-doc";
import MemoryAiDialog from "./MemoryAiDialog";
import MemoryDiffNotice from "./MemoryDiffNotice";
import MemoryDocEditor from "./MemoryDocEditor";
import MemoryDocView from "./MemoryDocView";

type Mode = "view" | "edit";

export default function MemoryPage() {
  const { m } = useI18n();
  /** ⚠️ 时间基准：mount 取一次，向下透传（§4.4）。 */
  const [now] = useState(() => Date.now());

  const memoryDoc = useLoopStore((s) => s.memoryDoc);
  const memoryMeta = useLoopStore((s) => s.memoryMeta);
  const refreshMemory = useLoopStore((s) => s.refreshMemory);
  const saveMemoryDoc = useLoopStore((s) => s.saveMemoryDoc);
  const clearMemory = useLoopStore((s) => s.clearMemory);
  const restoreMemory = useLoopStore((s) => s.restoreMemory);
  const useSystemMemoryVersion = useLoopStore((s) => s.useSystemMemoryVersion);

  const [signals, setSignals] = useState<MemorySignals>();
  const [profile, setProfile] = useState<LearnerProfile>();
  const [stats, setStats] = useState<MergeStats>();
  const [mode, setMode] = useState<Mode>("view");
  const [aiOpen, setAiOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmLoad, setConfirmLoad] = useState(false);
  /** 磁盘镜像的一次性反馈（成功 / 失败都如实说；**不弹 toast**，§7.7）。 */
  const [fileMsg, setFileMsg] = useState<string>();
  const [loaded, setLoaded] = useState(false);
  const [pageErr, setPageErr] = useState<MemoryErrorKind>();
  /** StrictMode 下 effect 会跑两次；不拦的话第二轮整理会报告「本轮没有变化」（报告失真）。 */
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void load();
    // `load` 只依赖 mount 期常量（`now` / i18n 文本用于**新建节**，语言切换不需要重跑）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * 打开页面即自动整理：读信号 → 跑通道 A → 合并 → 落库（**零外发**）。
   *
   * `profile` 直接从 storage 读而不是取 store 的 `profile`：`/memory` 可以不经过
   * 其它页面直达，彼时 store 尚未 `refresh()`，取 store 会得到 `undefined` ——
   * 于是「记录显示 X、声明里写 Y」这条提示会**静默消失**（用户以为系统认可了声明）。
   */
  async function load() {
    try {
      const chapterCount = await countChapters(storage);
      const [s, prof] = await Promise.all([
        loadMemorySignals(storage, chapterCount),
        storage.getProfile(),
      ]);
      setSignals(s);
      setProfile(prof);
      setStats(await refreshMemory(s, refreshOpts()));
    } catch (err) {
      setPageErr(err instanceof MemoryError ? err.kind : "save-failed");
    } finally {
      setLoaded(true);
    }
  }

  function refreshOpts() {
    return {
      now,
      scaffold: scaffoldOf(m),
      lastMergedPrefix: lastMergedPrefixOf(m),
      facts: factTextsOf(m),
    };
  }

  const parsed = useMemo(() => parseMemoryDoc(memoryDoc), [memoryDoc]);
  const facts = useMemo(
    () => (signals ? deriveAllFacts(signals, now, factTextsOf(m)) : []),
    [signals, now, m],
  );
  const diffs = useMemo(() => memoryDiffs(parsed, facts, memoryMeta), [parsed, facts, memoryMeta]);
  const mismatch = useMemo(
    () => (signals ? studyStyleMismatch(signals, profile) : undefined),
    [signals, profile],
  );
  /**
   * AI 备料（与弹窗**同源**：按钮上的「还差 N 条」与实际外发内容不可能漂移）。
   * 它同时给出样本数与门槛 —— 两处若各算一遍，就会出现「按钮可点但一发就报样本不足」。
   */
  const prepared = useMemo(
    () => (signals ? prepareAiRun({ signals, parsed, meta: memoryMeta }) : undefined),
    [signals, parsed, memoryMeta],
  );

  const aiReady = buildActiveProvider().isConfigured();
  /** 磁盘镜像只在桌面端出现（浏览器里没有「在文件管理器中显示」这回事）。 */
  const desktopFile = isDesktopFileAvailable();
  const sampleCount = prepared?.samples.length ?? 0;
  const missing = prepared?.missing ?? MEMORY_AI_MIN_SAMPLES;

  if (!loaded) {
    return (
      <PageContainer>
        <p className="text-sm text-ink-3">{m.memory.loading}</p>
      </PageContainer>
    );
  }

  /* ── 空态（§7.3）：无派生条目且用户没写过 → 只渲一张卡，不渲骨架 ── */
  if (facts.length === 0 && parsed.entries.length === 0) {
    const needs = [
      {
        label: m.memory.needLabelEvidence,
        need: MEMORY_FACT_MIN_SAMPLES["cadence-window"].evidence,
        current: signals?.evidence.length ?? 0,
      },
      { label: m.memory.needLabelSamples, need: MEMORY_AI_MIN_SAMPLES, current: sampleCount },
    ];
    const nothingAtAll = needs.every((n) => n.current === 0);
    return (
      <PageContainer>
        <div data-testid="memory-page">
          <header>
            <h1 className="text-xl font-semibold text-ink-1">{m.memory.title}</h1>
            <p className="mt-0.5 text-sm text-ink-2">{m.memory.subtitle}</p>
          </header>
          {/* `Card` 不接受任意 props（`data-testid` 只能落在包裹层）*/}
          <div data-testid="memory-empty" className="mt-6">
            <Card className="border-dashed">
              <p className="text-lg font-semibold text-ink-1">{m.memory.emptyTitle}</p>
              <p className="mt-1 text-sm text-ink-2">{m.memory.emptyDesc}</p>
              {/* 必须给当前值与目标值：不给「再学一点」这种无量化引导（§7.3）。 */}
              <ul className="mt-4 space-y-3">
                {needs.map((n) => (
                  <li key={n.label} className="space-y-1">
                    <p className="text-xs text-ink-2">
                      {m.memory.emptyNeed(n.label, n.need, n.current)}
                    </p>
                    <Bar value={Math.min(1, n.current / n.need)} />
                  </li>
                ))}
              </ul>
              {/* 完全空白 → 「继续去学」；只差一点 → 「去计划页」（两条口径指向不同心态）。 */}
              <Link
                to="/plan"
                className={cn(buttonVariants({ variant: "default" }), "mt-4 rounded-lg")}
              >
                {nothingAtAll ? m.memory.emptyAction : m.memory.goPlan}
              </Link>
            </Card>
          </div>
        </div>
      </PageContainer>
    );
  }

  /* ── 有内容：查看 / 编辑 + 差异 + 折叠区 + 清空 ── */
  const reportText =
    stats && stats.updated + stats.added + stats.keptMine > 0
      ? m.memory.report(stats.updated, stats.added, stats.keptMine)
      : m.memory.reportNone;
  const notesWithNote = signals ? signals.annotations.filter((a) => a.note.trim()).length : 0;
  const days = signals ? spanDays(signals.evidence) : 0;
  const stale = signals !== undefined && signals.evidence.length >= EVIDENCE_LOG_MAX;

  return (
    <PageContainer>
      <div data-testid="memory-page">
        <header className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-ink-1">{m.memory.title}</h1>
            <p className="mt-0.5 text-sm text-ink-2">{m.memory.subtitle}</p>
          </div>
          {/* 页头动作：AI 归纳（通道 B）。禁用原因必须写在按钮旁边，不能让用户猜。 */}
          <button
            type="button"
            data-testid="memory-ai-open"
            disabled={!aiReady || !prepared?.canRun}
            onClick={() => setAiOpen(true)}
            className={cn(buttonVariants({ variant: "outline" }), "shrink-0")}
          >
            {m.memory.aiOpen}
          </button>
        </header>

        {/* 页头报告：数据量（读到了什么）+ 本轮动作（做了什么）+ 整理时刻。 */}
        <Card className="mt-5 space-y-1.5">
          <p className="text-xs leading-relaxed text-ink-2" data-testid="memory-merge-report">
            {m.memory.dataLine(notesWithNote, signals?.restatements.length ?? 0, signals?.evidence.length ?? 0, days)}
          </p>
          <p className="text-xs text-ink-3">{reportText}</p>
          {memoryMeta.lastMergedAt > 0 ? (
            <p className="text-xs text-ink-3">
              {m.memory.lastMerged(formatMemoryTimestamp(memoryMeta.lastMergedAt))}
            </p>
          ) : null}
          {stale ? <p className="text-xs text-state-weak">{m.memory.staleEvidenceNote}</p> : null}
          {/* D12-A：磁盘镜像（**单向副本**；外部编辑不自动载入，由用户显式「从文件载入」） */}
          {desktopFile ? (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                data-testid="memory-save-file"
                className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                onClick={() => void saveToFile()}
              >
                {m.memory.saveFile}
              </button>
              <button
                type="button"
                data-testid="memory-reveal-file"
                className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
                onClick={() => void revealMemoryDoc()}
              >
                {m.memory.revealFile}
              </button>
              {confirmLoad ? (
                <>
                  <span className="text-xs text-state-failed">{m.memory.loadConfirm}</span>
                  <button
                    type="button"
                    data-testid="memory-load-file-confirm"
                    className={cn(buttonVariants({ variant: "default", size: "sm" }))}
                    onClick={() => {
                      setConfirmLoad(false);
                      void loadFromFile();
                    }}
                  >
                    {m.common.confirm}
                  </button>
                  <button
                    type="button"
                    className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
                    onClick={() => setConfirmLoad(false)}
                  >
                    {m.common.cancel}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  data-testid="memory-load-file"
                  className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
                  onClick={() => setConfirmLoad(true)}
                >
                  {m.memory.loadFile}
                </button>
              )}
              {fileMsg ? <span className="text-xs text-ink-3">{fileMsg}</span> : null}
            </div>
          ) : null}
          {!aiReady ? (
            <p className="text-xs text-ink-3">
              {m.memory.aiDisabledNoAi}{" "}
              <Link to="/settings" className="text-primary hover:underline">
                {m.nav.settings.label} →
              </Link>
            </p>
          ) : !prepared?.canRun ? (
            <p className="text-xs text-ink-3">{m.memory.aiDisabledNoSamples(missing)}</p>
          ) : null}
          {pageErr ? (
            <p className="text-xs text-state-failed">{m.memory.err[pageErr === "invalid-doc" ? "invalidDoc" : "saveFailed"]}</p>
          ) : null}
        </Card>

        {/* 查看 / 编辑切换 + 文档（§7.1 / §7.2） */}
        <div className="mt-5 flex items-center gap-3">
          <SegmentedTabs<Mode>
            value={mode}
            onChange={switchMode}
            testIdPrefix="memory-mode-toggle"
            items={[
              { value: "view", label: m.memory.mode.view },
              { value: "edit", label: m.memory.mode.edit },
            ]}
          />
        </div>
        <Card className="mt-3">
          {mode === "view" ? (
            <MemoryDocView doc={memoryDoc} meta={memoryMeta} />
          ) : (
            <MemoryDocEditor initial={memoryDoc} onSave={onSaveDoc} />
          )}
        </Card>

        {/* 用途说明：常驻（让消费点可见 —— 防「填了没用」的镜像问题：用了但用户不知道）。 */}
        {mode === "view" ? (
          <p className="mt-3 text-xs leading-relaxed text-ink-3">{m.memory.usageNote}</p>
        ) : null}

        {diffs.length > 0 ? (
          <div className="mt-5">
            <MemoryDiffNotice diffs={diffs} onUseSystem={(key, line) => void useSystem(key, line)} />
          </div>
        ) : null}

        {mismatch ? (
          <Card className="mt-5 space-y-1">
            <p className="text-sm leading-relaxed text-ink-1">
              {m.memory.mismatch(
                m.learner.profile.style[mismatch.observed],
                m.learner.profile.style[mismatch.declared],
              )}
            </p>
            <p className="text-xs text-ink-3">
              {m.memory.mismatchAction}{" "}
              <Link to="/learner" className="text-primary hover:underline">
                {m.nav.learner.label} →
              </Link>
            </p>
          </Card>
        ) : null}

        {memoryMeta.dismissed.length > 0 ? (
          <Card className="mt-5 flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-1">
              <p className="text-sm text-ink-2">{m.memory.dismissedFold(memoryMeta.dismissed.length)}</p>
              <p className="text-xs text-ink-3">{m.memory.restoreNote}</p>
            </div>
            <button
              type="button"
              data-testid="memory-restore-dismissed"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "shrink-0")}
              onClick={() => void restoreMemory()}
            >
              {m.memory.restore}
            </button>
          </Card>
        ) : null}

        {/* 清空全部记忆：常驻可见但视觉次要；二次确认（§5.4） */}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          {confirmClear ? (
            <>
              <span className="text-xs text-state-failed">{m.memory.clearConfirm}</span>
              <button
                type="button"
                data-testid="memory-clear-confirm"
                className={cn(buttonVariants({ variant: "default", size: "sm" }))}
                onClick={() => {
                  setConfirmClear(false);
                  void clearAll();
                }}
              >
                {m.common.confirm}
              </button>
              <button
                type="button"
                className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
                onClick={() => setConfirmClear(false)}
              >
                {m.common.cancel}
              </button>
            </>
          ) : (
            <button
              type="button"
              data-testid="memory-clear"
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-state-failed")}
              onClick={() => setConfirmClear(true)}
            >
              {m.memory.clearAll}
            </button>
          )}
        </div>
        <p className="mt-2 text-xs leading-relaxed text-ink-3">{m.memory.clearNote}</p>
      </div>

      {aiOpen && signals ? (
        <MemoryAiDialog
          open
          onClose={() => setAiOpen(false)}
          signals={signals}
          parsed={parsed}
          meta={memoryMeta}
        />
      ) : null}
    </PageContainer>
  );

  /**
   * 切回查看态时补一次整理（§5.2-4）。
   *
   * 用户在编辑态删掉一行，**只有合并器**能把它识别成「用户删掉了」（进 `dismissed`）；
   * 若不等下一次打开页面，用户会以为「删了没用」。这一跑是本地线性扫描，零外发零成本。
   */
  function switchMode(next: Mode) {
    const wasEdit = mode === "edit";
    setMode(next);
    if (next === "view" && wasEdit && signals) void load();
  }

  /** 用户手动编辑：原样落库、**不过合并器**；失败由编辑器就地显示（不弹 toast，§7.7）。 */
  async function onSaveDoc(doc: string) {
    setPageErr(undefined);
    await saveMemoryDoc(doc);
  }

  async function useSystem(key: string, line: string) {
    setPageErr(undefined);
    try {
      await useSystemMemoryVersion(key, line);
    } catch (err) {
      setPageErr(err instanceof MemoryError ? err.kind : "save-failed");
    }
  }

  async function clearAll() {
    setPageErr(undefined);
    try {
      await clearMemory();
    } catch (err) {
      setPageErr(err instanceof MemoryError ? err.kind : "save-failed");
    }
  }

  /**
   * 落盘 + 读盘（D12-A）。
   *
   * ⚠️ 「从文件载入」**必须由用户点**（两次），不做自动载入，理由：真源是 App 内的文档，
   * 自动载入等于让一个外部文件**静默覆盖**用户在 App 里改过的行 —— 那正是本 feature
   * 最核心的承诺（改过的不被覆盖）。载入走 `saveMemoryDoc`（逐字节、不过合并器）。
   */
  async function saveToFile() {
    const path = await saveMemoryDocToFile(memoryDoc);
    setFileMsg(path ? m.memory.fileSaved : m.memory.fileUnavailable);
  }

  async function loadFromFile() {
    const text = await readMemoryDocFromFile();
    if (text === undefined) {
      setFileMsg(m.memory.fileUnavailable);
      return;
    }
    setPageErr(undefined);
    try {
      await saveMemoryDoc(text);
      setFileMsg(m.memory.fileSaved);
    } catch (err) {
      setPageErr(err instanceof MemoryError ? err.kind : "save-failed");
    }
  }
}
