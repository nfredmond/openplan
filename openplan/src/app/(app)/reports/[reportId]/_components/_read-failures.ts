import { PACKET_FRESHNESS_LABELS } from "@/lib/reports/packet-labels";
import type { ReadFailureLog, ReadResultLike } from "@/lib/ui/read-failures";
import type { ProjectRecordSnapshotKey } from "./_types";

/**
 * The report detail page's read-failure bookkeeping, kept out of the page body.
 *
 * THE DEFECT ALL OF THIS EXISTS FOR. A server component that destructures only
 * the data half of a Supabase read gets `null` for both "there is nothing here"
 * and "this query failed" — phrased that way on purpose, because writing the
 * discarded-error shape out literally here would make this comment match the
 * ratchet guard that scans for it, and a guard defeated by its own docs is a
 * mistake this repo has already made once. The report
 * detail page loads roughly twenty side reads and then COMPARES most of them
 * against a frozen packet snapshot, so a failed read does not merely go blank —
 * it becomes a verdict. An unread deliverables table publishes
 * "Deliverables: 12 -> 0"; an unread artifact list publishes "No packet —
 * generate the first packet". Those sentences go into a document an agency
 * sends to a funder.
 *
 * The rule these all encode is the narrow one: a read that failed may not be
 * rendered as an answer. Render what loaded, withhold the comparisons whose live
 * side is unknown, and disclose the rest by name.
 *
 * Split into its own module for a mundane reason worth recording: the page is
 * at its `max-lines` ceiling, and honesty plumbing is the wrong thing to
 * compress. It is a sibling of `_helpers.ts` / `_types.ts` by the same
 * convention.
 */

/** Two lines, so the second read is registered even when the first also failed. */
function checkAll(reads: ReadFailureLog, entries: Array<[string, ReadResultLike]>): boolean {
  return entries.map(([label, result]) => reads.check(label, result)).some(Boolean);
}

/**
 * Registers the page's first batch of side reads.
 *
 * Returns a flag per read whose EMPTY value the page would otherwise publish as
 * a comparison verdict. Disclosure alone is not enough for these: the banner
 * says the chapter list could not be read, and four inches below it the drift
 * table still says "Linked projects: generated with 42, current source is 0",
 * because `(rows ?? []).length` cannot tell an outage from an empty cycle. The
 * count has to be withheld as unknown, not merely annotated.
 */
export function registerReportDetailReads(
  reads: ReadFailureLog,
  results: {
    project: ReadResultLike;
    rtpCycle: ReadResultLike;
    workspace: ReadResultLike;
    sections: ReadResultLike;
    artifacts: ReadResultLike;
    rtpChapters: ReadResultLike;
    rtpProjectLinks: ReadResultLike;
    rtpCampaigns: ReadResultLike;
  }
): {
  artifactsUnreadable: boolean;
  sectionsUnreadable: boolean;
  rtpChaptersUnreadable: boolean;
  rtpProjectLinksUnreadable: boolean;
  rtpCampaignsUnreadable: boolean;
} {
  checkAll(reads, [
    ["the project this report was created for", results.project],
    ["the RTP cycle this packet reports on", results.rtpCycle],
    ["the workspace this report belongs to", results.workspace],
  ]);
  const sectionsUnreadable = reads.check("this report's sections", results.sections);
  const artifactsUnreadable = reads.check("this report's generated packets", results.artifacts);
  const rtpChaptersUnreadable = reads.check("the chapters of this RTP cycle", results.rtpChapters);
  const rtpProjectLinksUnreadable = reads.check(
    "the projects linked to this RTP cycle",
    results.rtpProjectLinks
  );
  const rtpCampaignsUnreadable = reads.check(
    "the engagement campaigns on this RTP cycle",
    results.rtpCampaigns
  );

  return {
    artifactsUnreadable,
    sectionsUnreadable,
    rtpChaptersUnreadable,
    rtpProjectLinksUnreadable,
    rtpCampaignsUnreadable,
  };
}

/**
 * Registers the four reads behind an RTP packet's LIVE funding posture and
 * reports whether any failed.
 *
 * These are the fiscal side of an RTP packet — awards, opportunities, funding
 * profiles and reimbursement invoices across every project in the cycle — and
 * `buildPortfolioFundingSnapshot` cannot tell "this read returned nothing"
 * from "this cycle has no awards". A single failed read therefore produces a
 * fully-formed live snapshot describing a cycle with no committed money, which
 * the packet then publishes as drift against the generated one: "current source
 * is unfunded with 12 gap projects". Fiscal constraint is the part of an RTP a
 * funder relies on most, so the live side is withheld as unknown instead.
 */
export function checkRtpFundingReads(
  reads: ReadFailureLog,
  results: {
    profiles: ReadResultLike;
    awards: ReadResultLike;
    opportunities: ReadResultLike;
    invoices: ReadResultLike;
  }
): boolean {
  return checkAll(reads, [
    ["the funding needs of the projects in this RTP cycle", results.profiles],
    ["the funding awards on the projects in this RTP cycle", results.awards],
    ["the funding opportunities on the projects in this RTP cycle", results.opportunities],
    ["the reimbursement invoices on the projects in this RTP cycle", results.invoices],
  ]);
}

/**
 * Which project-record types could not be read LIVE, so the drift comparison can
 * skip them. Their snapshot counts are known; their live counts are not, and
 * zero-because-unknown compared against a snapshot reads as records deleted.
 */
export function collectProjectRecordReadFailures(
  reads: ReadFailureLog,
  results: Record<ProjectRecordSnapshotKey, ReadResultLike>
): Set<ProjectRecordSnapshotKey> {
  const failures = new Set<ProjectRecordSnapshotKey>();
  for (const key of Object.keys(results) as ProjectRecordSnapshotKey[]) {
    if (reads.check(`this project's live ${key}`, results[key])) {
      failures.add(key);
    }
  }
  return failures;
}

/** Names what a partial project-records comparison did NOT cover. */
export function describeUncoveredProjectRecords(
  failures: ReadonlySet<ProjectRecordSnapshotKey>
): string | null {
  if (failures.size === 0) {
    return null;
  }

  return `This comparison did not cover ${[...failures].join(
    ", "
  )}: the live records could not be read, which is an unchecked source and not a finding that they changed.`;
}

/**
 * Registers the live scenario-spine reads and reports whether any failed.
 *
 * `pending` is passed in because a spine migration this deployment has not run
 * is a CLASSIFIED failure with a truer thing to say than "could not be read" —
 * classify first, collect what is left.
 */
export function checkLiveScenarioSpineReads(
  reads: ReadFailureLog,
  pending: boolean,
  results: {
    sets: ReadResultLike;
    assumptionSets: ReadResultLike;
    dataPackages: ReadResultLike;
    indicatorSnapshots: ReadResultLike;
    comparisonSnapshots: ReadResultLike;
  }
): boolean {
  if (pending) {
    return false;
  }

  return checkAll(reads, [
    ["the live scenario sets this packet cites", results.sets],
    ["live scenario assumption sets", results.assumptionSets],
    ["live scenario data packages", results.dataPackages],
    ["live scenario indicator snapshots", results.indicatorSnapshots],
    ["live scenario comparison snapshots", results.comparisonSnapshots],
  ]);
}

/**
 * The packet-freshness verdict when the artifact list could not be read.
 *
 * Neither "No packet" nor "Packet current" is sayable here. The first tells a
 * planner to generate a packet that may already exist; the second certifies this
 * packet against a snapshot that was never read. "Refresh recommended" is a
 * RECOMMENDATION rather than a claim that anything moved, which is why an
 * unchecked source lands on it — the same reasoning the unreadable stage-gate
 * log already uses.
 */
export const PACKET_FRESHNESS_WHEN_ARTIFACTS_UNREADABLE = {
  label: PACKET_FRESHNESS_LABELS.REFRESH_RECOMMENDED,
  tone: "warning" as const,
  detail:
    "This report's generated packets could not be read, so neither the latest packet nor its freshness could be established. That is an unchecked source, not a finding that no packet exists and not a finding that this one is current.",
};
