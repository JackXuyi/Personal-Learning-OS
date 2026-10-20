import { Card } from "../../../components/primitives";
import type { Messages } from "../../../i18n";
import { SectionShell } from "../SectionShell";

export default function AppearanceSection({
  langMode,
  setLangMode,
  lang,
  m,
}: {
  langMode: "auto" | "zh" | "en";
  setLangMode: (v: "auto" | "zh" | "en") => void;
  lang: "zh" | "en";
  m: Messages;
}) {
  const gl = m.settings.lang;
  return (
    <SectionShell title={m.settings.sections.appearance}>
      <Card>
        <h3 className="text-sm font-semibold text-ink-1">{gl.title}</h3>
        <div className="mt-2 flex gap-1 rounded-lg border border-line bg-subtle p-1">
          {(
            [
              ["auto", gl.auto],
              ["zh", gl.zh],
              ["en", gl.en],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setLangMode(value)}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                langMode === value
                  ? "bg-surface text-primary shadow-sm"
                  : "text-ink-2 hover:text-ink-1"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
          {langMode === "auto" ? `${gl.autoHint} ${gl.current(lang)}` : gl.current(lang)}
        </p>
      </Card>
    </SectionShell>
  );
}
