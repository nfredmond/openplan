import { ModulePlaceholderPage } from "@/components/module-placeholder-page";

export default function AdminPage() {
  return (
    <ModulePlaceholderPage
      eyebrow="Admin"
      title="Administrative controls move into a proper control room"
      description="Workspace settings, members, security posture, audit visibility, AI configuration, and billing controls should live in one cohesive operations surface."
      bullets={[
        "Member / role management with auditable permission changes",
        "Billing, integrations, AI settings, and retention policies in one module",
        "Audit trail review for critical configuration and workflow actions",
        "Org-level governance controls for the full Planning OS",
      ]}
      primaryHref="/billing"
      primaryLabel="Open Billing"
      secondaryHref="/dashboard"
      secondaryLabel="Back to Overview"
    />
  );
}
