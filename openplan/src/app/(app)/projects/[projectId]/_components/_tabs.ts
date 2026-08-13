import { unreadableLanes, type PageTabDefinition } from "@/lib/ui/page-tabs";

export type ProjectTabKey = "overview" | "delivery" | "funding" | "evidence" | "record";

/**
 * Which of this project's reads FAILED — one flag per lane the page already
 * tracks. Booleans rather than the page's `ReadFailureLog`, because these are
 * exactly what the panels themselves branch on, and the tab strip has to agree
 * with the panel it is standing in front of.
 */
export type ProjectTabReadFlags = {
  overview: { reports: boolean; stageGates: boolean };
  delivery: { milestones: boolean; submittals: boolean };
  funding: { profile: boolean; awards: boolean; opportunities: boolean; invoices: boolean };
  evidence: { datasets: boolean; runs: boolean; aerial: boolean };
  record: { risks: boolean; issues: boolean; decisions: boolean; meetings: boolean };
};

/**
 * THE FIVE TABS OF A PROJECT RECORD.
 *
 * Order is the order a project is worked: where it stands, what is owed, what
 * pays for it, what backs it up, what was decided.
 *
 * `anchors` is not decoration. Every deep link the rest of the product already
 * emits at this page — `#project-invoices` from the assistant,
 * `#project-funding-opportunities` from the workspace command board — resolves
 * through it, and `page-tabs-anchor-coverage.test.ts` fails when one of those
 * links names an anchor no tab claims.
 *
 * `unreadable` is the tab strip's half of the read-failure rule: the panel that
 * would disclose a failed read is not on screen while its tab is closed, so the
 * failure is named out here, where a reader of any tab sees it.
 */
export function buildProjectTabs(flags: ProjectTabReadFlags): PageTabDefinition<ProjectTabKey>[] {
  return [
    {
      key: "overview",
      label: "Overview",
      anchors: [
        "project-identity",
        "project-name",
        "project-summary",
        "project-status",
        "project-phase",
        "project-plan-type",
        "project-plan-type-options",
        "project-reporting",
        "project-packet-release-review",
        "project-governance",
        "project-rtp-cycle",
        "project-rtp-role",
        "project-rtp-rationale",
        "project-spine-crosslinks",
        "project-spine-readiness",
      ],
      anchorPrefixes: ["project-report-"],
      unreadable: unreadableLanes([
        ["linked report packets", flags.overview.reports],
        ["stage-gate decisions", flags.overview.stageGates],
      ]),
    },
    {
      key: "delivery",
      label: "Delivery",
      anchors: ["project-milestones", "project-submittals", "project-deliverables"],
      anchorPrefixes: ["project-milestone-", "project-submittal-", "deliverable-", "milestone-"],
      unreadable: unreadableLanes([
        ["milestones", flags.delivery.milestones],
        ["submittals", flags.delivery.submittals],
      ]),
    },
    {
      key: "funding",
      label: "Funding",
      anchors: [
        "project-funding-opportunities",
        "project-funding-profile-notes",
        "project-funding-need-amount",
        "project-local-match-need-amount",
        "project-invoices",
        "project-budget-pace",
      ],
      anchorPrefixes: ["project-invoice-", "funding-award-"],
      unreadable: unreadableLanes([
        ["this project's funding profile", flags.funding.profile],
        ["funding awards", flags.funding.awards],
        ["funding opportunities", flags.funding.opportunities],
        ["invoice records", flags.funding.invoices],
      ]),
    },
    {
      key: "evidence",
      label: "Evidence",
      anchors: [
        "project-map-presence",
        "project-location-latitude",
        "project-location-longitude",
        "project-documents",
      ],
      anchorPrefixes: ["corridor-"],
      unreadable: unreadableLanes([
        ["linked datasets", flags.evidence.datasets],
        ["recent analysis runs", flags.evidence.runs],
        ["aerial missions and evidence packages", flags.evidence.aerial],
      ]),
    },
    {
      key: "record",
      label: "Record",
      anchors: ["project-risks", "project-issues", "project-decisions", "project-meetings"],
      anchorPrefixes: ["risk-", "issue-", "decision-", "meeting-"],
      unreadable: unreadableLanes([
        ["risks", flags.record.risks],
        ["issues", flags.record.issues],
        ["decisions", flags.record.decisions],
        ["meetings", flags.record.meetings],
      ]),
    },
  ];
}
