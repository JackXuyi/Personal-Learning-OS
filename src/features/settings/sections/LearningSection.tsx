import { Card } from "../../../components/primitives";
import type { Messages } from "../../../i18n";
import { SectionShell } from "../SectionShell";

export default function LearningSection({ st }: { st: Messages["settings"] }) {
  const sg = st.learning;
  return (
    <SectionShell title={sg.title} desc={sg.desc}>
      <Card>
        <ul className="space-y-2 text-sm text-ink-2">
          {sg.items.map((item, i) => (
            <li key={i} className="flex items-baseline gap-2">
              <span className="h-1 w-1 shrink-0 translate-y-[-2px] rounded-full bg-ink-3" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </Card>
    </SectionShell>
  );
}
