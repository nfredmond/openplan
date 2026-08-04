import { formatCompactDateTime, formatCurrency } from "./_helpers";
import type { DriftItem } from "./_types";

type FundingSnapshotLike = {
  awardCount: number;
  pursuedOpportunityCount: number;
  reimbursementPacketCount: number;
  committedFundingAmount: number;
  unfundedAfterLikelyAmount: number;
  uninvoicedAwardAmount: number;
  label: string;
  pipelineLabel: string;
  reimbursementLabel: string;
  latestSourceUpdatedAt: string | null;
};

/**
 * The funding-posture drift row: what moved between the funding snapshot frozen
 * into the latest packet and the project's live funding record.
 *
 * Lifted verbatim out of the page body when the page hit its `max-lines`
 * ceiling — behavior is unchanged. It is a pure comparison of two already-loaded
 * snapshots, which is exactly the shape that should not have been inline.
 *
 * `null` when either side is absent, and that absence is load-bearing: a report
 * with no stored funding snapshot has nothing to compare, and the caller must
 * not manufacture an "unchanged" verdict from it. The same reasoning is why the
 * caller withholds this row's siblings when their LIVE side could not be read —
 * a comparison whose live half is unknown is not a finding.
 */
export function buildFundingPostureDriftItem(
  storedFundingSnapshot: FundingSnapshotLike | null,
  liveFundingSnapshot: FundingSnapshotLike | null
): DriftItem | null {
  if (!storedFundingSnapshot || !liveFundingSnapshot) {
    return null;
  }

  const fundingCountChanges: string[] = [];
  const fundingValueChanges: string[] = [];
  const fundingLabelChanges: string[] = [];

  if (storedFundingSnapshot.awardCount !== liveFundingSnapshot.awardCount) {
    fundingCountChanges.push(
      `Awards: ${storedFundingSnapshot.awardCount} -> ${liveFundingSnapshot.awardCount}.`
    );
  }
  if (
    storedFundingSnapshot.pursuedOpportunityCount !==
    liveFundingSnapshot.pursuedOpportunityCount
  ) {
    fundingCountChanges.push(
      `Pursued opportunities: ${storedFundingSnapshot.pursuedOpportunityCount} -> ${liveFundingSnapshot.pursuedOpportunityCount}.`
    );
  }
  if (
    storedFundingSnapshot.reimbursementPacketCount !==
    liveFundingSnapshot.reimbursementPacketCount
  ) {
    fundingCountChanges.push(
      `Reimbursement packets: ${storedFundingSnapshot.reimbursementPacketCount} -> ${liveFundingSnapshot.reimbursementPacketCount}.`
    );
  }

  if (
    storedFundingSnapshot.committedFundingAmount !==
    liveFundingSnapshot.committedFundingAmount
  ) {
    fundingValueChanges.push(
      `Committed awards: ${formatCurrency(storedFundingSnapshot.committedFundingAmount)} -> ${formatCurrency(liveFundingSnapshot.committedFundingAmount)}.`
    );
  }
  if (
    storedFundingSnapshot.unfundedAfterLikelyAmount !==
    liveFundingSnapshot.unfundedAfterLikelyAmount
  ) {
    fundingValueChanges.push(
      `Uncovered after likely dollars: ${formatCurrency(storedFundingSnapshot.unfundedAfterLikelyAmount)} -> ${formatCurrency(liveFundingSnapshot.unfundedAfterLikelyAmount)}.`
    );
  }
  if (
    storedFundingSnapshot.uninvoicedAwardAmount !==
    liveFundingSnapshot.uninvoicedAwardAmount
  ) {
    fundingValueChanges.push(
      `Uninvoiced awards: ${formatCurrency(storedFundingSnapshot.uninvoicedAwardAmount)} -> ${formatCurrency(liveFundingSnapshot.uninvoicedAwardAmount)}.`
    );
  }

  if (storedFundingSnapshot.label !== liveFundingSnapshot.label) {
    fundingLabelChanges.push(
      `Funding posture: ${storedFundingSnapshot.label} -> ${liveFundingSnapshot.label}.`
    );
  }
  if (storedFundingSnapshot.pipelineLabel !== liveFundingSnapshot.pipelineLabel) {
    fundingLabelChanges.push(
      `Pipeline posture: ${storedFundingSnapshot.pipelineLabel} -> ${liveFundingSnapshot.pipelineLabel}.`
    );
  }
  if (
    storedFundingSnapshot.reimbursementLabel !==
    liveFundingSnapshot.reimbursementLabel
  ) {
    fundingLabelChanges.push(
      `Reimbursement posture: ${storedFundingSnapshot.reimbursementLabel} -> ${liveFundingSnapshot.reimbursementLabel}.`
    );
  }

  const fundingTimingChanged =
    storedFundingSnapshot.latestSourceUpdatedAt !== liveFundingSnapshot.latestSourceUpdatedAt;

  return {
    key: "funding-posture",
    label: "Funding posture",
    status:
      fundingCountChanges.length > 0
        ? "count changed"
        : fundingValueChanges.length > 0 || fundingLabelChanges.length > 0 || fundingTimingChanged
          ? "updated"
          : "unchanged",
    detail:
      [
        ...fundingCountChanges,
        ...fundingValueChanges,
        ...fundingLabelChanges,
        fundingTimingChanged
          ? `Funding source timing: ${formatCompactDateTime(storedFundingSnapshot.latestSourceUpdatedAt)} -> ${formatCompactDateTime(liveFundingSnapshot.latestSourceUpdatedAt)}.`
          : null,
      ].filter((value): value is string => Boolean(value)).join(" ") ||
      "Funding counts, posture labels, and reimbursement state still match the latest artifact snapshot.",
  };
}
