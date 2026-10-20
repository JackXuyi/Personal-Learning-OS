import { Card } from "../../../components/primitives";
import type { Messages } from "../../../i18n";
import { SectionShell } from "../SectionShell";

export default function AboutSection({ st }: { st: Messages["settings"] }) {
  const ag = st.about;
  return (
    <SectionShell title={ag.title}>
      <Card>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-base font-semibold text-ink-1">{ag.name}</p>
            <p className="text-sm text-ink-2">{ag.tagline}</p>
          </div>
          <span className="rounded border border-line bg-subtle px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-3">
            {ag.badge}
          </span>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-ink-2">{ag.desc}</p>
        <p className="mt-3 border-t border-line pt-3 text-[11px] leading-relaxed text-ink-3">
          {ag.repoNote}
        </p>
      </Card>
    </SectionShell>
  );
}
