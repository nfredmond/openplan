import { ModulePlaceholderPage } from "@/components/module-placeholder-page";

export default function ProgramsPage() {
  return (
    <ModulePlaceholderPage
      eyebrow="Programs"
      title="Programming cycles belong in the platform core"
      description="RTIP/STIP and other funding cycles should have structured schedules, submission packages, engagement evidence, and plan-to-program traceability."
      bullets={[
        "Program cycle dashboards with key dates and package readiness",
        "Funding package builder with narrative completeness tracking",
        "Community engagement evidence tied directly to programming decisions",
        "Complete Streets and compliance checkpoints inside the cycle workflow",
      ]}
      primaryHref="/plans"
      primaryLabel="Open Plans"
      secondaryHref="/reports"
      secondaryLabel="View Reports"
    />
  );
}
