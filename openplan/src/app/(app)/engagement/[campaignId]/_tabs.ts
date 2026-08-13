import { unreadableLanes, type PageTabDefinition } from "@/lib/ui/page-tabs";

export type CampaignTabKey = "setup" | "responses" | "analysis" | "record";

/** Which of this campaign's reads FAILED, in the page's own vocabulary. */
export type CampaignTabReadFlags = {
  categoriesUnreadable: boolean;
  itemsUnreadable: boolean;
  projectUnreadable: boolean;
  reportsUnreadable: boolean;
  reportSectionLinksUnreadable: boolean;
  rtpCycleUnreadable: boolean;
  rtpChapterUnreadable: boolean;
};

/**
 * THE FOUR TABS OF AN ENGAGEMENT CONSOLE.
 *
 * A campaign is worked in two completely different modes, which is why the
 * caller picks the landing tab from the campaign's status rather than fixing
 * one here. Before a campaign is live there is nothing to moderate and every
 * analysis panel is computed over responses that do not exist, so Setup is the
 * only useful landing. Once it is live the daily job is the queue, and opening
 * a moderator on the publish wizard every morning is the console asking them to
 * re-make a decision they already made.
 *
 * `unreadable` names the failed reads out here because the panel that would
 * disclose them may be behind a shut tab — an unopened tab and a broken one
 * must not look the same.
 */
export function buildCampaignTabs(flags: CampaignTabReadFlags): PageTabDefinition<CampaignTabKey>[] {
  return [
    {
      key: "setup",
      label: "Setup",
      anchors: [
        "campaign-publish-flow",
        "publish-flow-description",
        "publish-area-advisory",
        "public-share-controls",
        "public-slug",
        "allow-submissions",
        "demographics-enabled",
        "closeloop-broadcast-notice",
        "translation-language-choice",
        "campaign-control-title",
        "campaign-control-summary",
        "campaign-control-status",
        "campaign-control-type",
        "campaign-control-project",
        "campaign-control-rtp-cycle",
        "campaign-control-rtp-chapter",
      ],
      anchorPrefixes: ["engagement-category-", "context-layer-", "survey-"],
      unreadable: unreadableLanes([
        ["this campaign's comment categories", flags.categoriesUnreadable],
        ["the RTP cycle this campaign is attached to", flags.rtpCycleUnreadable],
        ["the RTP chapter this campaign is targeted at", flags.rtpChapterUnreadable],
      ]),
    },
    {
      key: "responses",
      label: "Responses",
      anchors: ["comment-import-preview", "email-delivery-panel", "engagement-map-unavailable"],
      anchorPrefixes: ["engagement-item-"],
      unreadable: unreadableLanes([["the comments on this campaign", flags.itemsUnreadable]]),
    },
    {
      key: "analysis",
      label: "Analysis",
      anchors: ["synthesis-flagged-sentences"],
      anchorPrefixes: ["demo-"],
      unreadable: unreadableLanes([["the comments on this campaign", flags.itemsUnreadable]]),
    },
    {
      key: "record",
      label: "Record",
      unreadable: unreadableLanes([
        ["the project this campaign is linked to", flags.projectUnreadable],
        ["reports on the linked project", flags.reportsUnreadable],
        ["the report sections those reports cite", flags.reportSectionLinksUnreadable],
      ]),
    },
  ];
}
