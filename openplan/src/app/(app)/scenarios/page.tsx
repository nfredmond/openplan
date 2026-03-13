import { ModulePlaceholderPage } from "@/components/module-placeholder-page";

export default function ScenariosPage() {
  return (
    <ModulePlaceholderPage
      eyebrow="Scenarios"
      title="Scenario planning gets its own operating surface"
      description="OpenPlan needs explicit baseline-versus-alternative management for VMT, accessibility, equity, mitigation, and programming rationale."
      bullets={[
        "Scenario registry with baselines, alternatives, assumptions, and revisions",
        "Comparison workbench for VMT, accessibility, equity, and narrative deltas",
        "Mitigation package builder with quantified levers where possible",
        "Plan / CEQA / program linkage showing why each scenario matters",
      ]}
      primaryHref="/explore"
      primaryLabel="Open Analysis Studio"
      secondaryHref="/models"
      secondaryLabel="View Models"
    />
  );
}
