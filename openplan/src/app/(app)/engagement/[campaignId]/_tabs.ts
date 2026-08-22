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
  crashCorroborationUnreadable: boolean;
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
        "comment-import-preview",
        "translation-language-choice",
        "campaign-control-title",
        "campaign-control-summary",
        "campaign-control-status",
        "campaign-control-type",
        "campaign-control-project",
        "campaign-control-rtp-cycle",
        "campaign-control-rtp-chapter",
      ],
      // `closeloop-broadcast-notice-` is a prefix, not an exact anchor: the
      // close-the-loop builder renders one notice per entry and suffixes each
      // with the entry id. There is deliberately no `survey-` prefix here — the
      // only `survey-*` ids in the repo belong to the PUBLIC form
      // (`public-survey-form.tsx`, served at /engage/<token>), which this
      // console never renders, so claiming them switched a tab and scrolled to
      // nothing.
      anchorPrefixes: ["engagement-category-", "context-layer-", "closeloop-broadcast-notice-"],
      unreadable: unreadableLanes([
        ["this campaign's comment categories", flags.categoriesUnreadable],
        ["the RTP cycle this campaign is attached to", flags.rtpCycleUnreadable],
        ["the RTP chapter this campaign is targeted at", flags.rtpChapterUnreadable],
      ]),
    },
    {
      key: "responses",
      label: "Responses",
      // `comment-import-preview` is NOT here: `<CommentImportPanel>` is
      // rendered inside the Setup panel, so this tab claiming it opened
      // Responses on an element that is not in it.
      anchors: ["email-delivery-panel", "engagement-map-unavailable"],
      anchorPrefixes: ["engagement-item-"],
      unreadable: unreadableLanes([["the comments on this campaign", flags.itemsUnreadable]]),
    },
    {
      key: "analysis",
      label: "Analysis",
      // No `demo-` prefix: the only `demo-*` ids are the self-reported
      // demographic questions on the PUBLIC portal
      // (`public-engagement-portal.tsx`). The console's `DemographicsPanel`
      // reports those answers back and carries no such id, so the claim
      // pointed at an element this page never renders.
      anchors: ["synthesis-flagged-sentences", "crash-corroboration"],
      unreadable: unreadableLanes([
        ["the comments on this campaign", flags.itemsUnreadable],
        ["reported collisions near this campaign's mapped comments", flags.crashCorroborationUnreadable],
      ]),
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
