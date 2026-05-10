import { describe, expect, it } from "vitest";
import { resolveDatasetDependentOutputContext } from "@/lib/data-sources/dataset-dependent-output-context";
import { buildReportGenerationReadiness } from "@/lib/reports/generation-readiness";

const readyDataset = resolveDatasetDependentOutputContext({
  status: "ready",
  linkedProjectCount: 1,
  lineageLevel: "complete",
  overlayReady: true,
  thematicReady: true,
  latestRefreshStatus: "succeeded",
});

const fundingSnapshot = {
  capturedAt: "2026-03-28T18:00:00.000Z",
  projectUpdatedAt: "2026-03-28T18:00:00.000Z",
  latestSourceUpdatedAt: "2026-03-28T18:00:00.000Z",
  fundingNeedAmount: 1000000,
  localMatchNeedAmount: 100000,
  committedFundingAmount: 700000,
  committedMatchAmount: 100000,
  likelyFundingAmount: 350000,
  totalPotentialFundingAmount: 1050000,
  remainingFundingGap: 300000,
  remainingMatchGap: 0,
  unfundedAfterLikelyAmount: 0,
  requestedReimbursementAmount: 700000,
  paidReimbursementAmount: 700000,
  outstandingReimbursementAmount: 0,
  draftReimbursementAmount: 0,
  uninvoicedAwardAmount: 0,
  nextObligationAt: "2026-12-31T00:00:00.000Z",
  awardRiskCount: 0,
  awardCount: 1,
  opportunityCount: 1,
  openOpportunityCount: 1,
  pursuedOpportunityCount: 1,
  awardedOpportunityCount: 0,
  closingSoonOpportunityCount: 0,
  reimbursementPacketCount: 0,
  status: "partially_funded" as const,
  label: "Partially funded",
  reason: "Committed awards cover part of the current project funding need, but a gap remains.",
  pipelineStatus: "likely_covered" as const,
  pipelineLabel: "Likely covered",
  pipelineReason: "Committed awards plus actively pursued opportunities now cover the current project funding need, pending award outcomes.",
  reimbursementStatus: "paid" as const,
  reimbursementLabel: "Awarded dollars reimbursed",
  reimbursementReason: "Linked award invoices marked paid now match or exceed the committed award total.",
  hasTargetNeed: true,
  coverageRatio: 0.7,
  pipelineCoverageRatio: 1,
  reimbursementCoverageRatio: 1,
  paidReimbursementCoverageRatio: 1,
};

const comparisonAggregate = {
  comparisonSnapshotCount: 1,
  readyComparisonSnapshotCount: 1,
  indicatorDeltaCount: 3,
  latestComparisonSnapshotUpdatedAt: "2026-03-28T17:42:00.000Z",
  sourceContextSnapshotCount: 1,
  exportReadySnapshotCount: 1,
  caveatSnapshotCount: 1,
  firstPairingLabel: "Protected bike package compared against Existing conditions",
};

describe("report generation readiness", () => {
  it("surfaces source context, funding profile scan, comparison context, and data lineage before generation", () => {
    const readiness = buildReportGenerationReadiness({
      hasGeneratedArtifact: true,
      sourceContext: { linkedRunCount: 1 },
      driftedSourceCount: 1,
      comparisonAggregate,
      fundingSnapshot,
      datasetOutputContexts: [readyDataset],
      now: "2026-04-01T00:00:00.000Z",
    });

    expect(readiness.status).toBe("attention");
    expect(readiness.checks.map((check) => check.id)).toEqual([
      "source_context",
      "comparison_context",
      "funding_profile",
      "data_lineage",
    ]);
    expect(readiness.checks.find((check) => check.id === "source_context")).toMatchObject({
      status: "attention",
      statusLabel: "1 source change",
    });
    expect(readiness.checks.find((check) => check.id === "comparison_context")).toMatchObject({
      status: "ready",
      statusLabel: "1 source-context summary",
    });
    expect(readiness.checks.find((check) => check.id === "funding_profile")?.detail).toContain(
      "Funding target: Likely covered."
    );
    expect(readiness.checks.find((check) => check.id === "data_lineage")).toMatchObject({
      status: "ready",
      statusLabel: "1 output-ready",
    });
    expect(readiness.dataLineageSummary).toMatchObject({
      datasetCount: 1,
      outputReadyCount: 1,
      dependentOutputCount: 4,
    });
  });

  it("blocks generation readiness when a linked dataset output context is blocked", () => {
    const blockedDataset = resolveDatasetDependentOutputContext({
      status: "ready",
      linkedProjectCount: 1,
      lineageLevel: "complete",
      overlayReady: true,
      thematicReady: true,
      latestRefreshStatus: "failed",
    });

    const readiness = buildReportGenerationReadiness({
      hasGeneratedArtifact: false,
      sourceContext: null,
      driftedSourceCount: 0,
      comparisonAggregate: null,
      fundingSnapshot: null,
      datasetOutputContexts: [blockedDataset],
    });

    expect(readiness.status).toBe("blocked");
    expect(readiness.label).toBe("Generation readiness blocked");
    expect(readiness.checks.find((check) => check.id === "data_lineage")).toMatchObject({
      status: "blocked",
      statusLabel: "1 dataset blocked",
    });
    expect(readiness.checks.find((check) => check.id === "source_context")).toMatchObject({
      status: "not_started",
      statusLabel: "First packet needed",
    });
  });
});
