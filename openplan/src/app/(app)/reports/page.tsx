import { ModulePlaceholderPage } from "@/components/module-placeholder-page";

export default function ReportsPage() {
  return (
    <ModulePlaceholderPage
      eyebrow="Reports"
      title="Reports become a platform-wide output layer"
      description="Instead of report generation belonging only to corridor analysis, this module will collect board packets, grant outputs, outreach summaries, and binder-ready project exports."
      bullets={[
        "Centralized report catalog across projects, campaigns, scenarios, and analysis runs",
        "Binder assembly for project records and compliance artifacts",
        "Grant-ready narrative packets with transparent assumptions and sources",
        "Public engagement summaries and map exports tied to campaign history",
      ]}
      primaryHref="/explore"
      primaryLabel="Generate Analysis Outputs"
      secondaryHref="/projects"
      secondaryLabel="Open Projects"
    />
  );
}
