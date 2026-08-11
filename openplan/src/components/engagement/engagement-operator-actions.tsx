import type { ComponentProps } from "react";
import { EngagementCampaignControls } from "@/components/engagement/engagement-campaign-controls";
import { EngagementShareControls } from "@/components/engagement/engagement-share-controls";
import { EngagementItemComposer } from "@/components/engagement/engagement-item-composer";

// Prop shapes are derived from the child components so this section can never
// drift from what they actually accept.
type OperatorActionsProps = {
  campaign: ComponentProps<typeof EngagementCampaignControls>["campaign"] &
    ComponentProps<typeof EngagementShareControls>["campaign"];
  projects: ComponentProps<typeof EngagementCampaignControls>["projects"];
  categories: ComponentProps<typeof EngagementItemComposer>["categories"];
};

/**
 * The campaign console's "Operator Actions" footer: campaign settings, the
 * full public-share management surface (link rotation, embed, exports — the
 * header's compact block anchors down to it), and manual intake.
 *
 * The survey builder and close-the-loop builder used to live here too, at the
 * very bottom of a ~20-section console. They are authoring surfaces a planner
 * needs BEFORE responses exist, so the console now mounts them near the top,
 * above the analysis panels, next to the guided publish flow. Getting a
 * campaign live is the publish flow's job; this footer is where settings are
 * maintained afterwards.
 */
export function EngagementOperatorActions({
  campaign,
  projects,
  categories,
}: OperatorActionsProps) {
  return (
    <div className="mt-12 space-y-6 border-t pt-12">
      <div className="module-section-heading">
        <p className="module-section-label">Operator Actions</p>
        <h2 className="module-section-title">Campaign management and intake</h2>
        <p className="module-section-description">
          Update campaign settings, manage the public share link, or manually compose new intake items.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <EngagementCampaignControls campaign={campaign} projects={projects} />
        <EngagementShareControls campaign={campaign} />
      </div>

      <div className="grid gap-6 xl:grid-cols-1">
        <EngagementItemComposer campaignId={campaign.id} categories={categories} />
      </div>
    </div>
  );
}
