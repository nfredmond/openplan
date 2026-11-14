/**
 * The approved staff review of a campaign's comments, as evidence an export
 * can cite.
 *
 * A workspace without an AI key can still state a community-input finding:
 * staff save a source set, sort it into themes in a review, and approve the
 * current revision. `staff-review-finding-server.ts` finds that review
 * through the staff-scoped readers the campaign page uses, which verify every
 * retained byte; this module reduces it to counts and theme labels. Code
 * counts; no language model is called.
 *
 * Exports often travel past staff, so the finding carries less than the
 * review: theme labels, counts and staff sentiment only. Review titles, notes,
 * group summaries and comment words stay in the internal review files.
 */

import { formatSavedDate } from "@/lib/grants/bca-evidence";

export const STAFF_REVIEW_FINDING_CAVEAT =
  "A staff review sorts the public input that was submitted into themes. It is not a statistically representative survey, a vote, or a legal-sufficiency finding.";

export type ApprovedStaffReviewFinding = {
  reviewId: string;
  revisionNo: number;
  approvedAt: string;
  sourceId: string;
  sourceCapturedAt: string;
  /** Comment review states the saved source set took in. */
  selectionStatuses: string[];
  includesComments: boolean;
  includesSurveys: boolean;
  commentCount: number;
  surveyAnswerCount: number;
  assignedCount: number;
  unassignedCount: number;
  themes: Array<{ label: string; recordCount: number; sentiment: string }>;
};

export type StaffReviewRead =
  | { status: "approved"; finding: ApprovedStaffReviewFinding; unverifiedReviewCount: number }
  | { status: "none"; checkedReviewCount: number; limitReached: boolean }
  | { status: "unreadable"; reason: string };

function sentimentText(sentiment: string): string {
  return sentiment === "not_assessed" ? "staff sentiment not assessed" : `staff sentiment ${sentiment}`;
}

function inputNoun(finding: ApprovedStaffReviewFinding): string {
  if (finding.includesComments && finding.includesSurveys) return "comment(s) and survey answer(s)";
  return finding.includesSurveys ? "survey answer(s)" : "comment(s)";
}

const THEME_LIMIT = 8;

/**
 * The finding as sentences, each naming the approved staff review as its
 * source. Aggregate only: no comment words and no staff notes.
 */
export function buildStaffReviewFindingClaims(finding: ApprovedStaffReviewFinding, campaignTitle: string): string[] {
  const total = finding.commentCount + finding.surveyAnswerCount;
  const noun = inputNoun(finding);
  const claims = [
    `An approved staff review (revision ${finding.revisionNo}, approved ${formatSavedDate(finding.approvedAt)}) sorts ${total} ${noun} from "${campaignTitle}" into ${finding.themes.length} theme(s); ${finding.unassignedCount} are not assigned to a theme. ${STAFF_REVIEW_FINDING_CAVEAT}`,
  ];
  if (finding.themes.length > 0) {
    const listed = finding.themes.slice(0, THEME_LIMIT)
      .map((theme) => `"${theme.label}" (${theme.recordCount}, ${sentimentText(theme.sentiment)})`)
      .join(", ");
    const more = finding.themes.length > THEME_LIMIT ? `, and ${finding.themes.length - THEME_LIMIT} more` : "";
    claims.push(`Themes in that staff review, with the number of ${noun} in each: ${listed}${more}.`);
  }
  claims.push(
    `The review covers a source set saved ${formatSavedDate(finding.sourceCapturedAt)} that took in ${noun} with review state ${finding.selectionStatuses.join(", ")}.`
  );
  return claims;
}
