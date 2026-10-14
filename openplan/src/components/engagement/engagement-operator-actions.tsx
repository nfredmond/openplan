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
  timeZone?: ComponentProps<typeof EngagementShareControls>["timeZone"];
  calendar?: ComponentProps<typeof EngagementCampaignControls>["calendar"];
};

/**
 * The campaign settings at the end of the Setup tab's Advanced group: campaign
 * metadata and the map area, the full public-share management surface (link
 * rotation, embed, exports; the header's compact block anchors down to it),
 * and adding a comment by hand.
 *
 * The survey builder and the report-back builder used to live here too, at the
 * very bottom of a ~20-section console. The survey builder now sits in "Before
 * publishing" and the report-back builder on Responses. Getting a campaign
 * live is the publish flow's job; this is where settings are maintained
 * afterwards.
 */
export function EngagementOperatorActions({
  campaign,
  projects,
  categories,
  timeZone,
  calendar,
}: OperatorActionsProps) {
  return (
    <div className="space-y-6">
      <div className="module-section-heading">
        <h2 className="module-section-title">Settings and public access</h2>
        <p className="module-section-description">
          Change the title, status, project or public link, or add a comment by hand.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <EngagementCampaignControls campaign={campaign} projects={projects} calendar={calendar} />
        <EngagementShareControls campaign={campaign} timeZone={timeZone} />
      </div>

      <div className="grid gap-6 xl:grid-cols-1">
        <EngagementItemComposer campaignId={campaign.id} categories={categories} />
      </div>
    </div>
  );
}
