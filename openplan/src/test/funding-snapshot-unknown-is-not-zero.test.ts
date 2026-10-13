import { describe, expect, it } from "vitest";

import { buildFundingPostureDriftItem } from "@/app/(app)/reports/[reportId]/_components/_funding-drift";
import { describeFundingSnapshot, parseStoredFundingSnapshot } from "@/lib/reports/catalog";
import { buildReportGenerationReadiness } from "@/lib/reports/generation-readiness";

// KI-2026-10-12-009: a dollar figure a saved report packet did not record
// must stay distinct from a recorded $0. A missing gap read as $0 says the
// project is fully funded.

const COMPLETE_SNAPSHOT = {
  capturedAt: "2026-04-12T20:00:00.000Z",
  projectUpdatedAt: "2026-04-12T19:15:00.000Z",
  latestSourceUpdatedAt: "2026-04-12T19:30:00.000Z",
  fundingNeedAmount: 1000000,
  localMatchNeedAmount: 100000,
  committedFundingAmount: 650000,
  committedMatchAmount: 50000,
  likelyFundingAmount: 300000,
  totalPotentialFundingAmount: 950000,
  remainingFundingGap: 350000,
  remainingMatchGap: 50000,
  unfundedAfterLikelyAmount: 50000,
  requestedReimbursementAmount: 150000,
  paidReimbursementAmount: 50000,
  outstandingReimbursementAmount: 100000,
  draftReimbursementAmount: 0,
  uninvoicedAwardAmount: 500000,
  nextObligationAt: "2026-05-01T00:00:00.000Z",
  awardRiskCount: 0,
  awardCount: 2,
  opportunityCount: 3,
  openOpportunityCount: 2,
  pursuedOpportunityCount: 2,
  awardedOpportunityCount: 1,
  closingSoonOpportunityCount: 0,
  reimbursementPacketCount: 1,
  status: "partially_funded",
  label: "Partially funded",
  reason: "Committed awards cover part of the need.",
  pipelineStatus: "partially_covered",
  pipelineLabel: "Gap remains",
  pipelineReason: "Likely dollars still leave a gap.",
  reimbursementStatus: "in_review",
  reimbursementLabel: "Reimbursement in flight",
  reimbursementReason: "Linked invoices are under review.",
  hasTargetNeed: true,
  coverageRatio: 0.65,
  pipelineCoverageRatio: 0.95,
  reimbursementCoverageRatio: 0.23,
  paidReimbursementCoverageRatio: 0.08,
};

function storedSnapshot(
  changes: Record<string, unknown>,
  omit: (keyof typeof COMPLETE_SNAPSHOT)[] = []
) {
  const stored: Record<string, unknown> = { ...COMPLETE_SNAPSHOT, ...changes };
  for (const key of omit) delete stored[key];
  const parsed = parseStoredFundingSnapshot({ sourceContext: { projectFundingSnapshot: stored } });
  if (!parsed) throw new Error("fixture did not parse");
  return parsed;
}

function fundingCheck(snapshot: ReturnType<typeof storedSnapshot>) {
  const readiness = buildReportGenerationReadiness({
    hasGeneratedArtifact: true,
    sourceContext: { reportOrigin: "test" },
    driftedSourceCount: 0,
    fundingSnapshot: snapshot,
    now: "2026-04-13T00:00:00.000Z",
  });
  return readiness.checks.find((check) => check.id === "funding_profile");
}

describe("a saved funding snapshot with a missing gap", () => {
  const snapshot = storedSnapshot({}, ["remainingFundingGap", "unfundedAfterLikelyAmount"]);

  it("keeps the gap null instead of $0", () => {
    expect(snapshot.remainingFundingGap).toBeNull();
    expect(snapshot.unfundedAfterLikelyAmount).toBeNull();
  });

  it("does not call the gap covered", () => {
    const digest = describeFundingSnapshot(snapshot);
    expect(digest?.headline).toBe("2 awards · $650,000 committed · Funding gap unknown");
    expect(digest?.headline).not.toContain("Gap covered");
  });
});

describe("a saved funding snapshot with a missing reimbursement figure", () => {
  const snapshot = storedSnapshot({}, ["outstandingReimbursementAmount", "uninvoicedAwardAmount"]);

  it("keeps the figures null instead of $0", () => {
    expect(snapshot.outstandingReimbursementAmount).toBeNull();
    expect(snapshot.uninvoicedAwardAmount).toBeNull();
  });

  it("marks funding readiness as not assessed rather than scanning $0", () => {
    expect(fundingCheck(snapshot)).toMatchObject({
      status: "unknown",
      statusLabel: "Funding figures not recorded",
    });
  });

  it("writes Not recorded in the drift row instead of $0", () => {
    const live = storedSnapshot({});
    const drift = buildFundingPostureDriftItem(snapshot, live);
    expect(drift?.detail).toContain("Uninvoiced awards: Not recorded -> $500,000.");
    expect(drift?.detail).not.toContain("$0 ->");
  });
});

describe("a saved funding snapshot with real zeros", () => {
  const snapshot = storedSnapshot({
    remainingFundingGap: 0,
    unfundedAfterLikelyAmount: 0,
    outstandingReimbursementAmount: 0,
    uninvoicedAwardAmount: 0,
  });

  it("keeps a recorded $0 as 0", () => {
    expect(snapshot.remainingFundingGap).toBe(0);
    expect(snapshot.unfundedAfterLikelyAmount).toBe(0);
    expect(snapshot.uninvoicedAwardAmount).toBe(0);
  });

  it("calls a recorded $0 gap covered and still scans funding readiness", () => {
    expect(describeFundingSnapshot(snapshot)?.headline).toBe(
      "2 awards · $650,000 committed · Gap covered in current pipeline"
    );
    expect(fundingCheck(snapshot)?.status).not.toBe("unknown");
  });

  it("writes a recorded $0 as $0 in the drift row", () => {
    const drift = buildFundingPostureDriftItem(snapshot, storedSnapshot({}));
    expect(drift?.detail).toContain("Uninvoiced awards: $0 -> $500,000.");
  });
});
