/**
 * 导入简历弹窗（F1 · D2）—— 三态：来源选择 / 解析中 / 确认写入。
 * （线框见 docs/learner-profile-design-2026-09.md §7.3 / §7.4）
 *
 * 隐私（D2，UI 明示）：
 * - 顶部静态告知：简历会发送到当前配置的 AI 服务；发送前本机掩码结构化标识；
 *   **简历原文不落库**；
 * - AI 建议的档位**默认不勾选**（`weeklyMinutes` / `preferences` 简历推不出来，
 *   也绝不猜测）；
 * - 背景摘要在确认视图里**可编辑**，落库前还会再过一次 `maskPii`。
 *
 * 边界：本组件不落库，只产出「合并后的 LearnerProfile」；写库走
 * `useLoopStore.saveProfile`（唯一写路径）。
 */
import { useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { Textarea } from "../../components/ui/textarea";
import { SegmentedTabs } from "../../components/primitives";
import { Link } from "react-router-dom";
import type { LearnerProfile } from "../../domain";
import { PROFILE_LIMITS } from "../../domain";
import type { ResumeDraft } from "../../ai/resume-pipeline";
import { importResume, ResumeImportError, type ResumeImportErrorKind } from "./resume-import";
import { mergeResumeDraft } from "./profile-service";
import { useAiReady } from "../../hooks/useAiReady";
import { useLoopStore } from "../../stores/useLoopStore";
import { buildActiveProvider } from "../../stores/useSettingsStore";
import { useI18n } from "../../i18n";

type ResumeErrorKey = ResumeImportErrorKind | "needLevel";

export default function ResumeImportDialog({
  open,
  onClose,
  profile,
}: {
  open: boolean;
  onClose: () => void;
  profile: LearnerProfile | undefined;
}) {
  const { m } = useI18n();
  const t = m.learner.resume;
  const aiReady = useAiReady();
  const saveProfile = useLoopStore((s) => s.saveProfile);

  const [tab, setTab] = useState<"file" | "paste">("file");
  const [pasteText, setPasteText] = useState("");
  const [file, setFile] = useState<{ name: string; bytes: ArrayBuffer } | undefined>();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ResumeErrorKey | undefined>();
  const [draft, setDraft] = useState<ResumeDraft | undefined>();
  const [background, setBackground] = useState("");
  const [applyLevel, setApplyLevel] = useState(false);
  const [partial, setPartial] = useState<string | undefined>();

  const reset = () => {
    setTab("file");
    setPasteText("");
    setFile(undefined);
    setBusy(false);
    setErr(undefined);
    setDraft(undefined);
    setBackground("");
    setApplyLevel(false);
    setPartial(undefined);
  };

  const close = () => {
    reset();
    onClose();
  };

  const onPickFile = async (f: File | undefined) => {
    if (!f) return;
    setErr(undefined);
    setFile({ name: f.name, bytes: await f.arrayBuffer() });
  };

  const onParse = async () => {
    setErr(undefined);
    setPartial(undefined);
    setBusy(true);
    try {
      const res = await importResume({
        source:
          tab === "file"
            ? { kind: "file", name: file?.name ?? "", bytes: file?.bytes ?? new ArrayBuffer(0) }
            : { kind: "paste", text: pasteText },
        provider: buildActiveProvider(),
      });
      setDraft(res.draft);
      setBackground(res.draft.background ?? "");
      setApplyLevel(false); // AI 建议档位默认不勾选（D2）
      setPartial(
        res.partialPages ? t.partialPages(res.partialPages.nonEmpty, res.partialPages.total) : undefined,
      );
    } catch (e) {
      setErr(e instanceof ResumeImportError ? e.kind : "ai-failed");
    } finally {
      setBusy(false);
    }
  };

  const onApply = async () => {
    if (!draft) return;
    const merged = mergeResumeDraft(profile, { ...draft, background }, applyLevel);
    if (!merged) {
      setErr("needLevel");
      return;
    }
    setBusy(true);
    try {
      await saveProfile(merged, m);
      close();
    } catch {
      setErr("ai-failed");
    } finally {
      setBusy(false);
    }
  };

  const errText = err ? errTextOf(t, err) : undefined;
  const canParse = aiReady && (tab === "paste" ? pasteText.trim().length > 0 : file !== undefined);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) close();
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold text-ink-1">
            {draft ? t.confirmTitle : t.dialogTitle}
          </DialogTitle>
        </DialogHeader>

        {!draft ? (
          <div className="space-y-3">
            {/* 隐私告知：静态、不可关闭，先于任何输入 */}
            <p className="rounded-md border border-line bg-subtle p-3 text-xs leading-relaxed text-ink-2">
              ⓘ {t.privacyNotice}
            </p>

            <SegmentedTabs
              value={tab}
              onChange={(v) => {
                setTab(v);
                setErr(undefined);
              }}
              items={[
                { value: "file", label: t.tabFile },
                { value: "paste", label: t.tabPaste },
              ]}
              testIdPrefix="resume-tab"
            />

            {tab === "file" ? (
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  void onPickFile(e.dataTransfer.files?.[0]);
                }}
                className="rounded-lg border border-dashed border-line bg-app-bg p-6 text-center"
              >
                <label className="cursor-pointer text-sm text-ink-2">
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    className="hidden"
                    onChange={(e) => void onPickFile(e.target.files?.[0])}
                  />
                  <span className="font-medium text-primary">{t.pickFile}</span>
                  <span className="mt-1 block text-xs text-ink-3">{t.dropHint}</span>
                </label>
                {file ? (
                  <p className="mt-2 truncate text-xs text-ink-2">{file.name}</p>
                ) : null}
              </div>
            ) : (
              <Textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder={t.pastePlaceholder}
                className="min-h-40 resize-none"
                aria-label={t.tabPaste}
              />
            )}

            {!aiReady ? (
              <p className="text-xs text-state-weak">
                {t.noAi}{" "}
                <Link to="/settings" className="font-medium text-primary hover:underline">
                  {t.goSettings}
                </Link>
              </p>
            ) : null}
            {partial ? <p className="text-xs text-ink-3">{partial}</p> : null}
            {errText ? <p className="text-xs text-state-failed">{errText}</p> : null}
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <p className="mb-1 text-xs font-medium text-ink-2">{t.backgroundEditLabel}</p>
              <Textarea
                value={background}
                onChange={(e) => setBackground(e.target.value)}
                maxLength={PROFILE_LIMITS.backgroundChars}
                className="min-h-24"
                aria-label={t.backgroundEditLabel}
              />
              <p className="mt-1 flex items-center justify-between text-[11px] text-ink-3">
                <span>{t.aiCheckHint}</span>
                <span className="tabular-nums">
                  {m.learner.profile.backgroundCount(background.length, PROFILE_LIMITS.backgroundChars)}
                </span>
              </p>
            </div>

            {draft.level ? (
              <label className="flex items-start gap-2 rounded-md border border-line p-3">
                <Checkbox
                  checked={applyLevel}
                  onCheckedChange={(v) => setApplyLevel(v === true)}
                  data-testid="resume-apply-level"
                />
                <span className="text-xs leading-relaxed text-ink-2">
                  <span className="font-medium text-ink-1">
                    {t.levelSuggest(m.learner.profile.level[draft.level])}
                  </span>
                  {draft.levelReason ? (
                    <span className="mt-0.5 block text-ink-3">{t.levelReason(draft.levelReason)}</span>
                  ) : null}
                </span>
              </label>
            ) : null}

            {draft.years !== undefined || draft.education || draft.skills.length > 0 ? (
              <p className="text-xs text-ink-3">
                {t.inspect(
                  draft.years !== undefined ? String(draft.years) : "—",
                  draft.education ?? "—",
                  draft.skills.length > 0 ? draft.skills.join(" / ") : "—",
                )}
              </p>
            ) : null}

            {partial ? <p className="text-xs text-ink-3">{partial}</p> : null}
            <p className="text-xs text-ink-3">ⓘ {t.notInferable}</p>
            {errText ? <p className="text-xs text-state-failed">{errText}</p> : null}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" className="rounded-lg" onClick={close}>
            {draft ? t.discard : m.learner.profile.cancel}
          </Button>
          {draft ? (
            <Button type="button" className="rounded-lg" loading={busy} onClick={() => void onApply()}>
              {t.apply}
            </Button>
          ) : (
            <Button
              type="button"
              className="rounded-lg"
              loading={busy}
              disabled={!canParse}
              onClick={() => void onParse()}
            >
              {busy ? t.parsing : t.parse}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** provider 取用点（与 paper-flow / chapter-qa-service 同源：装配点仍在 settings store）。 */
/** 错误分类文案（`aiFailed` 同时兜底「保存失败」，此处只做映射）。 */
function errTextOf(t: ReturnType<typeof useI18n>["m"]["learner"]["resume"], kind: ResumeErrorKey): string {
  switch (kind) {
    case "no-source":
      return t.err.noSource;
    case "file-too-large":
      return t.err.fileTooLarge;
    case "pdf-too-large":
      return t.err.pdfTooLarge;
    case "pdf-no-text":
      return t.err.pdfNoText;
    case "text-too-long":
      return t.err.textTooLong;
    case "ai-not-configured":
      return t.err.aiNotConfigured;
    case "empty-draft":
      return t.err.emptyDraft;
    case "needLevel":
      return t.err.needLevel;
    default:
      return t.err.aiFailed;
  }
}
