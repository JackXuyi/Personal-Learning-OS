import { Card } from "../../../components/primitives";
import type { Messages } from "../../../i18n";
import { SectionShell } from "../SectionShell";

export default function ShortcutsSection({ st }: { st: Messages["settings"] }) {
  const sg = st.shortcuts;
  return (
    <SectionShell title={sg.title} desc={sg.desc}>
      <Card>
        <div className="divide-y divide-line">
          {sg.items.map((item, i) => (
            <div key={i} className="flex items-center justify-between gap-4 py-2 first:pt-0 last:pb-0">
              <kbd className="rounded border border-line bg-subtle px-2 py-0.5 font-mono text-xs text-ink-2">
                {item.keys}
              </kbd>
              <span className="text-sm text-ink-2">{item.action}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 border-t border-line pt-2 text-[11px] leading-relaxed text-ink-3">{sg.more}</p>
      </Card>
    </SectionShell>
  );
}
