import { ScaffoldPage } from "../scaffold";

export default function SpacesPage() {
  return (
    <ScaffoldPage
      title="Learning Spaces"
      subtitle="Separate knowledge bases for different domains of your life."
      scope={[
        "Storage layer ready: in-memory + localStorage adapters behind one interface",
        "Domain model supports multiple goals across career / study / personal",
        "SQLite / filesystem backend slot reserved in src/storage",
      ]}
      nextSteps={[
        "Create a Learning Space (name, description, icon)",
        "Import PDF / Markdown / TXT / EPUB into a space",
        "Document parsing + chunking pipeline",
        "List documents with source citations",
      ]}
    />
  );
}
