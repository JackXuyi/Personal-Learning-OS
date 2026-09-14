/**
 * 「我声明的」画像表单卡（F1 · D6-A）—— /learner 页内联，不新增路由。
 *
 * 形态对齐 `features/goals/GoalFormPage.tsx` 的表单语言（`text-xs font-medium
 * text-ink-2` label + `Select` / `Input` / `Textarea`），摘要态与编辑态共用一个
 * `Card`，避免页面出现两套视觉。
 *
 * 边界：本组件只做**采集 + 调用**。校验在 `profile-service.toProfile`（纯函数、
 * 可单测），落库走 `useLoopStore.saveProfile`（唯一写路径，连带 refresh）。
 * 文案全部走 `useI18n`。
 */
import { useState } from "react";
import { Card, Section } from "../../components/primitives";
import { Button } from "../../components/ui/button";
import { ConfirmDialog } from "../../components/ui/confirm-dialog";
import { Input } from "../../components/ui/input";
import { Select } from "../../components/ui/select";
import { Textarea } from "../../components/ui/textarea";
import type { LearnerProfile, StudyDepth, StudyStyle } from "../../domain";
import { LEARNER_LEVELS, PROFILE_LIMITS } from "../../domain";
import { ProfileError, toProfile } from "./profile-service";
import { useLoopStore } from "../../stores/useLoopStore";
import { useI18n } from "../../i18n";

/** 分钟 → 小时显示值（去掉多余的 .0）。 */
function hoursOf(minutes: number | undefined): string {
  if (minutes === undefined) return "";
  const h = minutes / 60;
  return Number.isInteger(h) ? String(h) : h.toFixed(1);
}

type ErrorKey = "invalidLevel" | "weeklyInvalid" | "saveFailed";

export default function LearnerProfileCard({
  profile,
  onOpenResume,
}: {
  profile: LearnerProfile | undefined;
  onOpenResume: () => void;
}) {
  const { m } = useI18n();
  const t = m.learner.profile;
  const saveProfile = useLoopStore((s) => s.saveProfile);

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<ErrorKey | undefined>();
  const [clearOpen, setClearOpen] = useState(false);

  // 表单草稿（进入编辑态时从 profile 快照一次；用户改动不回写 profile）。
  const [level, setLevel] = useState<string>(profile?.level ?? "");
  const [weeklyHours, setWeeklyHours] = useState<string>(hoursOf(profile?.weeklyMinutes));
  const [depth, setDepth] = useState<StudyDepth>(profile?.preferences.depth ?? "depth");
  const [style, setStyle] = useState<StudyStyle>(profile?.preferences.style ?? "reading");
  const [background, setBackground] = useState<string>(profile?.background ?? "");

  const startEdit = () => {
    setLevel(profile?.level ?? "");
    setWeeklyHours(hoursOf(profile?.weeklyMinutes));
    setDepth(profile?.preferences.depth ?? "depth");
    setStyle(profile?.preferences.style ?? "reading");
    setBackground(profile?.background ?? "");
    setErr(undefined);
    setSaved(false);
    setEditing(true);
  };

  const onSave = async () => {
    setErr(undefined);
    // 每周预算：空 → 未声明；非数字或越界 → 就地拦下（不让 normalize 静默丢弃）。
    let weeklyMinutes: number | undefined;
    const trimmed = weeklyHours.trim();
    if (trimmed.length > 0) {
      const h = Number(trimmed);
      if (!Number.isFinite(h) || h < 0.5 || h > 168) {
        setErr("weeklyInvalid");
        return;
      }
      weeklyMinutes = Math.round(h * 60);
    }
    // 手改过背景摘要 → 来源改回 manual（否则保留「由简历整理」标注）。
    const bg = background.trim();
    const source: "manual" | "resume" =
      profile?.backgroundSource === "resume" && bg === (profile.background ?? "") ? "resume" : "manual";

    setSaving(true);
    try {
      const next = toProfile({
        level,
        ...(weeklyMinutes !== undefined ? { weeklyMinutes } : {}),
        depth,
        style,
        background: bg,
        backgroundSource: source,
      });
      await saveProfile(next, m);
      setEditing(false);
      setSaved(true);
    } catch (e) {
      setErr(e instanceof ProfileError && e.kind === "invalid-level" ? "invalidLevel" : "saveFailed");
    } finally {
      setSaving(false);
    }
  };

  const onClear = async () => {
    setClearOpen(false);
    setSaving(true);
    try {
      await saveProfile(undefined, m);
      setEditing(false);
      setSaved(false);
    } catch {
      setErr("saveFailed");
    } finally {
      setSaving(false);
    }
  };

  const levelOptions = LEARNER_LEVELS.map((v) => ({ value: v, label: t.level[v] }));
  const depthOptions: { value: string; label: string }[] = [
    { value: "breadth", label: t.depth.breadth },
    { value: "depth", label: t.depth.depth },
  ];
  const styleOptions: { value: string; label: string }[] = [
    { value: "reading", label: t.style.reading },
    { value: "practice", label: t.style.practice },
    { value: "quiz", label: t.style.quiz },
  ];
  const errText =
    err === "invalidLevel" ? t.invalidLevel : err === "weeklyInvalid" ? t.weeklyInvalid : t.saveFailed;

  return (
    <Card className="mt-5" data-testid="learner-profile-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Section title={m.learner.declaredSection} />
          <p className="mt-1 text-xs leading-relaxed text-ink-2">
            {profile ? t.desc : t.notSet}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {saved && !editing ? <span className="text-xs text-ink-3">{t.saved}</span> : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-lg"
            onClick={onOpenResume}
            data-testid="learner-resume-open"
          >
            {t.resumeCta}
          </Button>
          <Button
            type="button"
            variant={editing ? "outline" : "default"}
            size="sm"
            className="rounded-lg"
            onClick={() => (editing ? setEditing(false) : startEdit())}
          >
            {editing ? t.collapse : profile ? t.edit : t.fillCta}
          </Button>
        </div>
      </div>

      {!editing && profile ? (
        <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <Row label={t.levelLabel} value={t.level[profile.level]} />
          <Row
            label={t.weeklyLabel}
            value={
              profile.weeklyMinutes !== undefined
                ? `${hoursOf(profile.weeklyMinutes)} ${t.weeklyUnit}`
                : "—"
            }
          />
          <Row label={t.depthLabel} value={t.depth[profile.preferences.depth]} />
          <Row label={t.styleLabel} value={t.style[profile.preferences.style]} />
          {profile.background ? (
            <div className="sm:col-span-2">
              <dt className="text-xs font-medium text-ink-3">
                {t.backgroundLabel}
                {profile.backgroundSource === "resume" ? (
                  <span className="ml-2 rounded border border-line bg-subtle px-1.5 py-0.5 text-[10px] text-ink-3">
                    {t.backgroundFromResume}
                  </span>
                ) : null}
              </dt>
              <dd className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink-1">
                {profile.background}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {editing ? (
        <div className="mt-4 space-y-4">
          <Field label={t.levelLabel}>
            <Select
              value={level}
              onValueChange={setLevel}
              options={levelOptions}
              ariaLabel={t.levelLabel}
            />
          </Field>

          <Field label={t.weeklyLabel}>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                inputMode="decimal"
                step="0.5"
                min={0.5}
                max={168}
                value={weeklyHours}
                onChange={(e) => setWeeklyHours(e.target.value)}
                className="w-28"
                aria-label={t.weeklyLabel}
                data-testid="learner-profile-weekly"
              />
              <span className="text-xs text-ink-2">{t.weeklyUnit}</span>
            </div>
            <p className="mt-1 text-[11px] text-ink-3">{t.weeklyHint}</p>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t.depthLabel}>
              <Select
                value={depth}
                onValueChange={(v) => setDepth(v as StudyDepth)}
                options={depthOptions}
                ariaLabel={t.depthLabel}
              />
            </Field>
            <Field label={t.styleLabel}>
              <Select
                value={style}
                onValueChange={(v) => setStyle(v as StudyStyle)}
                options={styleOptions}
                ariaLabel={t.styleLabel}
              />
            </Field>
          </div>

          <Field label={t.backgroundLabel}>
            <Textarea
              value={background}
              onChange={(e) => setBackground(e.target.value)}
              placeholder={t.backgroundPlaceholder}
              maxLength={PROFILE_LIMITS.backgroundChars}
              className="min-h-20 resize-none"
              aria-label={t.backgroundLabel}
            />
            <p className="mt-1 text-right text-[11px] tabular-nums text-ink-3">
              {t.backgroundCount(background.length, PROFILE_LIMITS.backgroundChars)}
            </p>
          </Field>

          {err ? <p className="text-xs text-state-failed">{errText}</p> : null}

          <div className="flex items-center justify-between gap-3">
            {profile ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="rounded-lg text-state-failed"
                onClick={() => setClearOpen(true)}
                data-testid="learner-profile-clear"
              >
                {t.clear}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-lg"
                onClick={() => setEditing(false)}
              >
                {t.cancel}
              </Button>
              <Button
                type="button"
                size="sm"
                className="rounded-lg"
                loading={saving}
                onClick={() => void onSave()}
                data-testid="learner-profile-save"
              >
                {saving ? t.saving : t.save}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        title={t.clearConfirmTitle}
        description={t.clearConfirmDesc}
        confirmLabel={t.clear}
        cancelLabel={t.cancel}
        destructive
        onConfirm={() => void onClear()}
      />
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-ink-3">{label}</dt>
      <dd className="text-sm text-ink-1">{value}</dd>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-ink-2">{label}</p>
      {children}
    </div>
  );
}
