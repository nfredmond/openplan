import { ModulePlaceholderPage } from "@/components/module-placeholder-page";

export default function ModelsPage() {
  return (
    <ModulePlaceholderPage
      eyebrow="Models"
      title="Managed model runs will sit above the analysis layer"
      description="The long-term product requires containerized, reproducible model orchestration for chained activity modeling, scenario runs, calibration, and outputs."
      bullets={[
        "Managed run queue for ABM / travel-demand runs with versioned configs",
        "Inputs warehouse for land use, networks, policies, and scenario knobs",
        "Calibration and QA status for each model run",
        "Output catalog for trips, tours, VMT summaries, and accessibility products",
      ]}
      primaryHref="/data-hub"
      primaryLabel="Open Data Hub"
      secondaryHref="/dashboard"
      secondaryLabel="Back to Overview"
    />
  );
}
