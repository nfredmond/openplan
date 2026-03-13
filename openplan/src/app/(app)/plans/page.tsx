import { ModulePlaceholderPage } from "@/components/module-placeholder-page";

export default function PlansPage() {
  return (
    <ModulePlaceholderPage
      eyebrow="Plans"
      title="Plan records will become first-class objects"
      description="OpenPlan needs a real planning layer for RTPs, corridor plans, active transportation plans, safety plans, and land-use plans—not just isolated analysis runs."
      bullets={[
        "Plan registry with typology, horizon year, geography, and owning organization",
        "Linked chapters, outreach records, scenarios, and compliance notes",
        "Crosswalks from plans to projects, programs, and funding packages",
        "Reusable templates for ATP, safety, corridor, and regional plan workflows",
      ]}
      primaryHref="/programs"
      primaryLabel="View Programs"
      secondaryHref="/dashboard"
      secondaryLabel="Back to Overview"
    />
  );
}
