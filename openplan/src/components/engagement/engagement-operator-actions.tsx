import type { ComponentProps } from "react";
import { EngagementCampaignControls } from "@/components/engagement/engagement-campaign-controls";
import { EngagementShareControls } from "@/components/engagement/engagement-share-controls";
import { EngagementItemComposer } from "@/components/engagement/engagement-item-composer";
import { EngagementSurveyBuilder } from "@/components/engagement/survey-builder";
import { EngagementCloseLoopBuilder } from "@/components/engagement/close-loop-builder";

// Prop shapes are derived from the child components so this section can never
// drift from what they actually accept.
type OperatorActionsProps = {
  campaign: ComponentProps<typeof EngagementCampaignControls>["campaign"] &
    ComponentProps<typeof EngagementShareControls>["campaign"];
  projects: ComponentProps<typeof EngagementCampaignControls>["projects"];
  categories: ComponentProps<typeof EngagementItemComposer>["categories"];
  surveyQuestions: ComponentProps<typeof EngagementSurveyBuilder>["initialQuestions"];
  closeLoopEntries: ComponentProps<typeof EngagementCloseLoopBuilder>["initialEntries"];
};

/**
 * The campaign console's "Operator Actions" footer: campaign settings, the
 * full public-share controls (the header's compact block anchors down to
 * them), manual intake, the survey builder, and close-the-loop entries.
 * Server-safe layout; the children are the interactive clients.
 */
export function EngagementOperatorActions({
  campaign,
  projects,
  categories,
  surveyQuestions,
  closeLoopEntries,
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

      <div className="grid gap-6 xl:grid-cols-1">
        <EngagementSurveyBuilder campaignId={campaign.id} categories={categories} initialQuestions={surveyQuestions} />
        <EngagementCloseLoopBuilder campaignId={campaign.id} categories={categories} initialEntries={closeLoopEntries} />
      </div>
    </div>
  );
}
