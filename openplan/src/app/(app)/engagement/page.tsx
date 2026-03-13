import { ModulePlaceholderPage } from "@/components/module-placeholder-page";

export default function EngagementPage() {
  return (
    <ModulePlaceholderPage
      eyebrow="Engagement"
      title="Social Pinpoint-like public engagement will live here"
      description="This module is the future home of campaign maps, pin-based feedback, moderation queues, sentiment clustering, and outreach reporting."
      bullets={[
        "Campaign builder with map layers, categories, pin drop workflows, and optional uploads",
        "Moderation queue for comments, duplicates, abuse handling, and approval state",
        "Theme extraction, clustering, and public-engagement reporting exports",
        "Traceable linkage from outreach feedback into plans, projects, and programming decisions",
      ]}
      primaryHref="/reports"
      primaryLabel="See Report Surface"
      secondaryHref="/dashboard"
      secondaryLabel="Back to Overview"
    />
  );
}
