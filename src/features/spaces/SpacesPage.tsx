import { ScaffoldPage } from "../scaffold";
import { useI18n } from "../../i18n";

export default function SpacesPage() {
  const { m } = useI18n();
  return (
    <ScaffoldPage
      title={m.spaces.title}
      subtitle={m.spaces.subtitle}
      scope={m.spaces.scope}
      nextSteps={m.spaces.nextSteps}
    />
  );
}
