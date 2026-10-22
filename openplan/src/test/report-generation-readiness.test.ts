import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { render, screen, within } from "@testing-library/react";
import { ReportPacketReview } from "@/app/(app)/reports/[reportId]/_components/report-packet-review";
import { buildGrantDecisionModelingSupport } from "@/lib/grants/modeling-evidence";
import { resolveDatasetDependentOutputContext } from "@/lib/data-sources/dataset-dependent-output-context";
import { buildReportGenerationReadiness, reportGenerationReadinessTone } from "@/lib/reports/generation-readiness";

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

/** Fix the date and make each non-guided check ready, so none can mask the summary. */
function generatedInputs() {
  return { hasGeneratedArtifact: true, sourceContext: { linkedRunCount: 4 }, driftedSourceCount: 0,
    comparisonAggregate, fundingSnapshot, datasetOutputContexts: [readyDataset], now: "2026-04-01T00:00:00.000Z" };
}

describe("report generation readiness", () => {
  it("keeps a missing historical source baseline unknown when all other checks are ready", () => {
    const readiness = buildReportGenerationReadiness({ ...generatedInputs(), unassessedSourceCount: 1 });
    expect(readiness.checks.find((check) => check.id === "source_context")).toMatchObject({
      status: "unknown", statusLabel: "Historical source baseline unassessed" });
    expect(readiness.checks.filter((check) => check.id !== "source_context").every((check) => check.status === "ready")).toBe(true);
    expect(readiness.status).toBe("unknown");
    expect(readiness.label).toBe("Generation readiness unassessed");
    expect(readiness.detail).toContain("3/4 checks ready; 1 need operator attention");
    const changed = buildReportGenerationReadiness({ ...generatedInputs(), unassessedSourceCount: 1, driftedSourceCount: 1 });
    expect(changed.status).toBe("attention");
    expect(changed.checks.find((check) => check.id === "source_context")?.statusLabel).toBe("1 source change");
  });

  it("keeps a checked saved binding distinct from unassessed live evidence", () => {
    const readiness = buildReportGenerationReadiness({ ...generatedInputs(),
      guidedComparison: { selected: true, problem: null } });
    expect(readiness.checks.filter((check) => check.id !== "comparison_context").map((check) => [check.id, check.status]))
      .toEqual([["source_context", "ready"], ["funding_profile", "ready"], ["data_lineage", "ready"]]);
    expect(readiness.checks.find((check) => check.id === "comparison_context")).toMatchObject({
      status: "unknown", statusLabel: "Saved binding checked; live evidence unassessed",
      detail: expect.stringContaining("does not recheck live artifact bytes or custody"),
      nextAction: expect.stringContaining("Save and generation verify the exact files and custody"),
    });
    expect(readiness.status).toBe("unknown");
    expect(reportGenerationReadinessTone(readiness.status)).toBe("neutral");
    expect(readiness.label).toBe("Generation readiness unassessed");
    expect(readiness.detail).toBe("3/4 checks ready; 1 need operator attention before release use. Selected comparison live artifact bytes and custody remain unassessed.");
    expect(readiness.nextAction).toContain("Save and generation verify the exact files and custody");
    expect(readiness.label).not.toBe("Generation readiness reviewed");
    expect(readiness.detail).not.toContain("0 need operator attention");
  });

  it("renders the real packet aggregate as unassessed with neutral badges", () => {
    const generationReadiness = buildReportGenerationReadiness({ ...generatedInputs(),
      guidedComparison: { selected: true, problem: null } });
    render(createElement(ReportPacketReview, {
      report: { rtp_basis_stale: false, rtp_basis_stale_reason: null, rtp_basis_stale_marked_at: null },
      projectId: "project-1", generationReadiness,
      packetFreshness: { label: "Comparison evidence unassessed", tone: "warning",
        detail: "Live artifact bytes and custody are unassessed." },
      grantModelingReadiness: null, grantModelingSupport: buildGrantDecisionModelingSupport(null),
      grantModelingEvidence: null, comparisonDigest: null,
    }));
    const aggregateHeader = screen.getByText("Pre-generation readiness").parentElement!.parentElement!;
    expect(within(aggregateHeader).getByText("Unassessed")).toHaveAttribute("data-tone", "neutral");
    expect(within(aggregateHeader).queryByText("Ready")).not.toBeInTheDocument();
    const badges = screen.getAllByText("Generation readiness unassessed").filter((node) => node.hasAttribute("data-tone"));
    expect(badges).toHaveLength(1);
    expect(badges[0]).toHaveAttribute("data-tone", "neutral");
    expect(screen.getByText(/3\/4 checks ready; 1 need operator attention before release use/)).toBeInTheDocument();
    expect(screen.queryByText("Generation readiness reviewed")).not.toBeInTheDocument();
    expect(screen.queryByText(/0 need operator attention before release use/)).not.toBeInTheDocument();
  });

  it.each([false, true])("preserves an ordinary unselected report with optional unknown lineage %s", (unknownLineage) => {
    const readiness = buildReportGenerationReadiness({ ...generatedInputs(),
      guidedComparison: { selected: false, problem: null }, datasetOutputContexts: unknownLineage ? [] : [readyDataset] });
    expect(readiness.checks.find((check) => check.id === "data_lineage")?.status).toBe(unknownLineage ? "unknown" : "ready");
    expect(readiness.status).toBe("ready");
    expect(reportGenerationReadinessTone(readiness.status)).toBe("success");
    expect(readiness.label).toBe("Generation readiness reviewed");
    expect(readiness.detail).toBe(`${unknownLineage ? 3 : 4}/4 checks ready; 0 need operator attention before release use.`);
    expect(readiness.detail).not.toContain("unassessed");
  });

  it("preserves known source drift ahead of aggregate unassessed evidence", () => {
    const readiness = buildReportGenerationReadiness({ ...generatedInputs(), driftedSourceCount: 1,
      guidedComparison: { selected: true, problem: null } });
    expect(readiness.status).toBe("attention");
    expect(reportGenerationReadinessTone(readiness.status)).toBe("warning");
    expect(readiness.label).toBe("Generation readiness needs review");
    expect(readiness.detail).toBe("2/4 checks ready; 2 need operator attention before release use. Selected comparison live artifact bytes and custody remain unassessed.");
    expect(readiness.nextAction).toContain("Review changed source areas");
    expect(readiness.checks.find((check) => check.id === "comparison_context")?.status).toBe("unknown");
  });

  it("preserves dataset blockers ahead of aggregate unassessed evidence", () => {
    const blockedDataset = resolveDatasetDependentOutputContext({ status: "ready", linkedProjectCount: 1,
      lineageLevel: "complete", overlayReady: true, thematicReady: true, latestRefreshStatus: "failed" });
    const readiness = buildReportGenerationReadiness({ ...generatedInputs(), datasetOutputContexts: [blockedDataset],
      guidedComparison: { selected: true, problem: null } });
    expect(readiness.status).toBe("blocked");
    expect(reportGenerationReadinessTone(readiness.status)).toBe("danger");
    expect(readiness.label).toBe("Generation readiness blocked");
    expect(readiness.detail).toBe("2/4 checks ready; 2 need operator attention before release use. Selected comparison live artifact bytes and custody remain unassessed.");
    expect(readiness.nextAction).toBe(readiness.checks.find((check) => check.id === "data_lineage")?.nextAction);
  });

  it("blocks a corrupt saved binding instead of describing its current evidence as verified", () => {
    const readiness = buildReportGenerationReadiness({ ...generatedInputs(),
      guidedComparison: { selected: false, problem: "Stored digest changed" } });
    expect(readiness.checks.find((check) => check.id === "comparison_context")).toMatchObject({
      status: "blocked", statusLabel: "Saved comparison binding is invalid", detail: "Stored digest changed",
    });
    expect(readiness.status).toBe("blocked");
    expect(reportGenerationReadinessTone(readiness.status)).toBe("danger");
    expect(readiness.label).toBe("Generation readiness blocked");
    expect(readiness.detail).toBe("3/4 checks ready; 1 need operator attention before release use.");
    expect(readiness.nextAction).toContain("Review and save the exact comparison again, or clear the selection");
  });

  it("keeps an invalid binding blocked when selected evidence and known drift coexist", () => {
    const readiness = buildReportGenerationReadiness({ ...generatedInputs(), driftedSourceCount: 1,
      guidedComparison: { selected: true, problem: "Stored digest changed" } });
    expect(readiness.status).toBe("blocked");
    expect(reportGenerationReadinessTone(readiness.status)).toBe("danger");
    expect(readiness.label).toBe("Generation readiness blocked");
    expect(readiness.detail).toBe("2/4 checks ready; 2 need operator attention before release use.");
    expect(readiness.nextAction).toContain("Review and save the exact comparison again, or clear the selection");
    expect(readiness.detail).not.toContain("remain unassessed");
  });

  it("keeps the missing first packet ahead of aggregate unassessed evidence", () => {
    const readiness = buildReportGenerationReadiness({ ...generatedInputs(), hasGeneratedArtifact: false, sourceContext: null,
      guidedComparison: { selected: true, problem: null } });
    expect(readiness.status).toBe("not_started");
    expect(readiness.label).toBe("Generation readiness needs first packet");
    expect(readiness.checks.find((check) => check.id === "comparison_context")?.status).toBe("unknown");
    expect(readiness.nextAction).toBe(readiness.checks.find((check) => check.id === "source_context")?.nextAction);
  });
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
