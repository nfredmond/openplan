import { unreadableLanes, type PageTabDefinition } from "@/lib/ui/page-tabs";

export type RtpCycleTabKey = "overview" | "projects" | "financial" | "document" | "comments";

/** Which of this cycle's reads FAILED, in the page's own vocabulary. */
export type RtpCycleTabReadFlags = {
  overview: { packetReports: boolean; packetArtifacts: boolean };
  projects: { links: boolean };
  financial: { horizonBands: boolean; assumptions: boolean; measures: boolean };
  document: { chapters: boolean };
  comments: { campaigns: boolean; items: boolean };
};

/**
 * THE FIVE TABS OF AN RTP CYCLE, in the order a cycle is actually run: where it
 * stands, what is in it, whether it balances, the document itself, and what the
 * public said.
 *
 * `anchors` carries the ids this cycle's own editors and chapter tools render,
 * so a link to a specific field opens the tab holding it. `unreadable` carries
 * the lanes whose read failed — named out here because the panel that would
 * disclose the failure may be behind a closed tab, and on a fiscally
 * constrained plan an unread lane that renders as an empty one is the exact
 * defect this repo keeps finding.
 */
export function buildRtpCycleTabs(flags: RtpCycleTabReadFlags): PageTabDefinition<RtpCycleTabKey>[] {
  return [
    {
      key: "overview",
      label: "Overview",
      anchorPrefixes: ["rtp-edit-", "rtp-cycle-"],
      unreadable: unreadableLanes([
        ["the board packet records for this cycle", flags.overview.packetReports],
        ["the generated packet artifacts", flags.overview.packetArtifacts],
      ]),
    },
    {
      key: "projects",
      label: "Projects",
      anchors: ["rtp-cycle-project-map-canvas"],
      unreadable: unreadableLanes([
        ["the projects linked to this cycle", flags.projects.links],
      ]),
    },
    {
      key: "financial",
      label: "Financial",
      unreadable: unreadableLanes([
        ["the horizon periods of this plan", flags.financial.horizonBands],
        ["this plan's financial assumptions", flags.financial.assumptions],
        ["this plan's performance measures", flags.financial.measures],
      ]),
    },
    {
      key: "document",
      label: "Document",
      // The draft-assist anchors are PREFIXES, not exact ids: the page renders
      // one assist panel per chapter, so every id it emits carries the
      // chapter's own id (`rtp-chapter-draft-insert-<uuid>`). They were
      // declared here as bare names for a while, which promised a link to an
      // element that could never exist without duplicating an id per chapter.
      // `transcribed-chapter-` used to be declared here and is gone: nothing in
      // the repo renders an id with that prefix, and the transcribed-chapter
      // cards that share the NAME live on `/rtp/<id>/extraction/chapters`, a
      // different route with no tabs. A prefix claiming ids that cannot appear
      // on this page is a promise nothing can keep.
      anchorPrefixes: ["chapter-draft-fiscal-alert-", "rtp-chapter-draft-"],
      unreadable: unreadableLanes([
        ["the chapter sections of this cycle", flags.document.chapters],
      ]),
    },
    {
      key: "comments",
      label: "Comments",
      anchorPrefixes: ["rtp-engagement-"],
      unreadable: unreadableLanes([
        ["the engagement campaigns for this cycle", flags.comments.campaigns],
        ["public comments on this cycle", flags.comments.items],
      ]),
    },
  ];
}
