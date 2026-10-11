import type { PageTabDefinition } from "@/lib/ui/page-tabs";

export type GrantsTabKey = "opportunities" | "gaps" | "awards";

/**
 * THE THREE PARTS OF THE GRANTS PAGE (October 10, 2026 overhaul). The page
 * stacked thirteen sections in one scroll of about 9,200 words. A planner
 * comes here for one of three jobs: find and decide on opportunities, close a
 * project's funding gap, or turn an award into money claimed back. Each tab
 * claims the anchors its sections render, so every existing `/grants#…` link
 * opens the tab that holds its target (`PageTabAnchorRouter`).
 */
export const GRANTS_TABS: readonly PageTabDefinition<GrantsTabKey>[] = [
  {
    key: "opportunities",
    label: "Opportunities",
    anchors: [
      "grants-program-catalog",
      "grants-program-coverage-disclosure",
      "grants-gov-live",
      "grants-gov-agency-filter",
      "grants-gov-eligibility-filter",
      "grants-gov-empty",
      "grants-gov-error",
      "grants-gov-load",
      "grants-gov-offline",
      "application-workspace",
      "application-init",
      "application-sections",
      "application-attachments",
      "application-export",
      "narrative-draft-panel",
      "narrative-grounding-line",
      "never-ai-note",
      "section-draft-panel",
      "export-refusal",
      "export-result",
      "finalize-refusal",
    ],
    anchorPrefixes: [
      "funding-opportunity-",
      "funding-decision-",
      "funding-expected-award-",
      "funding-fit-notes-",
      "funding-readiness-notes-",
      "application-section-",
      "application-attachment-",
    ],
  },
  {
    key: "gaps",
    label: "Funding gaps",
    anchors: [
      "grants-gap-resolution-lane",
      "grants-funding-need-editor",
      "grants-opportunity-creator",
      "funding-opportunity-creator-open",
      "funding-opportunity-saved",
      "grants-bca-screening",
      "grants-benefit-cost",
    ],
    anchorPrefixes: ["bca-"],
  },
  {
    key: "awards",
    label: "Awards and reimbursement",
    anchors: [
      "grants-award-conversion-lane",
      "grants-award-conversion-composer",
      "grants-awards-reimbursement",
      "grants-reimbursement-composer",
      "grants-reimbursement-triage",
    ],
    anchorPrefixes: [
      "award-opportunity-",
      "award-stack-",
      "invoice-record-",
      "closeout-note-",
      "reopen-reason-",
      "reopen-status-",
    ],
  },
];

/**
 * The tab a request opens on when it names none: a focused invoice is
 * reimbursement work and a focused project with a funding need is gap work;
 * everything else starts at the opportunities.
 */
export function defaultGrantsTab(focus: {
  invoiceId: string | null;
  fundingNeedProjectFocused: boolean;
  awardConversionFocused: boolean;
}): GrantsTabKey {
  if (focus.invoiceId || focus.awardConversionFocused) return "awards";
  if (focus.fundingNeedProjectFocused) return "gaps";
  return "opportunities";
}
