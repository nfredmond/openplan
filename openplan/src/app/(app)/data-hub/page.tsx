import { ModulePlaceholderPage } from "@/components/module-placeholder-page";

export default function DataHubPage() {
  return (
    <ModulePlaceholderPage
      eyebrow="Data Hub"
      title="The governed ingestion fabric starts here"
      description="Authoritative connectors, provenance, refresh jobs, licensing, and policy-change monitoring should become visible system components—not hidden helper functions."
      bullets={[
        "Connector registry for Census, LODES, GTFS, crash data, and future sources",
        "Dataset provenance records with URL, cadence, checksum, schema version, and license",
        "Refresh jobs and failure handling visible to operators",
        "Policy monitor lane for bulletin/guidance diffs requiring human review",
      ]}
      primaryHref="/reports"
      primaryLabel="Open Reports"
      secondaryHref="/explore"
      secondaryLabel="Back to Analysis Studio"
    />
  );
}
