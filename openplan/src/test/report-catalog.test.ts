import { describe, expect, it } from "vitest";
import {
  describeFundingSnapshot,
  describeEvidenceChainSummary,
  getReportNavigationHref,
  getReportPacketActionLabel,
  getReportPacketFreshness,
  getReportPacketPriority,
  getReportPacketWorkStatus,
  getRtpPacketActionButtonLabel,
  getRtpRegistryDominantActionLabel,
  matchesReportFreshnessFilter,
  matchesReportPostureFilter,
  normalizeReportFreshnessFilter,
  normalizeReportPostureFilter,
  parseStoredFundingSnapshot,
  resolveReportPacketSourceUpdatedAt,
} from "@/lib/reports/catalog";

describe("getReportPacketFreshness", () => {
  it("returns no-packet when no artifact exists", () => {
    expect(
      getReportPacketFreshness({
        latestArtifactKind: null,
        generatedAt: null,
        updatedAt: "2026-03-28T20:00:00.000Z",
      })
    ).toMatchObject({ label: "No packet", tone: "warning" });
  });

  it("returns refresh recommended when the report record changed after generation", () => {
    expect(
      getReportPacketFreshness({
        latestArtifactKind: "html",
        generatedAt: "2026-03-28T19:00:00.000Z",
        updatedAt: "2026-03-28T20:00:00.000Z",
      })
    ).toMatchObject({ label: "Refresh recommended", tone: "warning" });
  });

  it("returns packet current when the latest packet is still current", () => {
    expect(
      getReportPacketFreshness({
        latestArtifactKind: "html",
        generatedAt: "2026-03-28T20:00:00.000Z",
        updatedAt: "2026-03-28T20:00:00.000Z",
      })
    ).toMatchObject({ label: "Packet current", tone: "success" });
  });

  it("uses the latest tracked source timestamp for packet freshness checks", () => {
    expect(
      resolveReportPacketSourceUpdatedAt([
        "2026-04-12T10:00:00.000Z",
        "2026-04-14T10:00:00.000Z",
        "not-a-date",
      ])
    ).toBe("2026-04-14T10:00:00.000Z");
  });

  it("returns action labels for each freshness state", () => {
    expect(getReportPacketActionLabel("Refresh recommended")).toMatch(/regenerate the packet/i);
    expect(getReportPacketActionLabel("No packet")).toMatch(/generate the first packet/i);
    expect(getReportPacketActionLabel("Packet current")).toMatch(/release review/i);
  });

  it("derives a normalized packet work status from freshness", () => {
    expect(getReportPacketWorkStatus("No packet")).toMatchObject({
      key: "generate-first",
      label: "Generate first packet",
      tone: "warning",
    });
    expect(getReportPacketWorkStatus("Refresh recommended")).toMatchObject({
      key: "refresh",
      label: "Refresh packet",
      tone: "warning",
    });
    expect(getReportPacketWorkStatus("Packet current")).toMatchObject({
      key: "release-review",
      label: "Release review ready",
      tone: "success",
    });
  });

  it("prioritizes missing packets ahead of stale and current ones", () => {
    expect(getReportPacketPriority("No packet")).toBeLessThan(getReportPacketPriority("Refresh recommended"));
    expect(getReportPacketPriority("Refresh recommended")).toBeLessThan(getReportPacketPriority("Packet current"));
  });

  it("provides consistent RTP packet action labels for touched surfaces", () => {
    expect(getRtpPacketActionButtonLabel({ packetAttention: "missing" })).toBe("Create and generate first packet");
    expect(getRtpPacketActionButtonLabel({ packetAttention: "generate" })).toBe("Generate first packet artifact");
    expect(getRtpPacketActionButtonLabel({ packetAttention: "refresh" })).toBe("Refresh packet artifact");
    expect(getRtpPacketActionButtonLabel({ packetAttention: "reset" })).toBe("Reset layout and regenerate");
    expect(getRtpPacketActionButtonLabel({ packetAttention: "current" })).toBe("Open release review");
  });

  it("provides consistent dominant RTP queue labels", () => {
    expect(getRtpRegistryDominantActionLabel("createPacket")).toBe("Create first RTP packets");
    expect(getRtpRegistryDominantActionLabel("generateFirstArtifact")).toBe("Generate first packet artifacts");
    expect(getRtpRegistryDominantActionLabel("refreshArtifact")).toBe("Refresh stale RTP packets");
    expect(getRtpRegistryDominantActionLabel("resetAndRegenerate")).toBe("Reset and regenerate RTP packets");
  });

  it("formats compact evidence-chain posture for report surfaces", () => {
    expect(
      describeEvidenceChainSummary({
        linkedRunCount: 2,
        scenarioSetLinkCount: 1,
        projectRecordGroupCount: 4,
        totalProjectRecordCount: 6,
        engagementLabel: "Active",
        engagementItemCount: 9,
        engagementReadyForHandoffCount: 4,
        stageGateLabel: "Hold present",
        stageGatePassCount: 1,
        stageGateHoldCount: 1,
        stageGateBlockedGateLabel: "G02 · Agreements, Procurement, and Civil Rights Setup",
      } as Parameters<typeof describeEvidenceChainSummary>[0])
    ).toMatchObject({
      headline: "2 linked runs · 1 scenario set · 6 project records",
      detail: "Active engagement · 4/9 handoff-ready · Hold present governance",
      blockedGateDetail: "Blocked gate: G02 · Agreements, Procurement, and Civil Rights Setup",
    });
  });

  it("includes scenario spine posture when counts are present", () => {
    expect(
      describeEvidenceChainSummary({
        linkedRunCount: 2,
        scenarioSetLinkCount: 1,
        scenarioAssumptionSetCount: 3,
        scenarioDataPackageCount: 2,
        scenarioIndicatorSnapshotCount: 5,
        scenarioSharedSpinePendingCount: 0,
        projectRecordGroupCount: 4,
        totalProjectRecordCount: 6,
        engagementLabel: "Active",
        engagementItemCount: 9,
        engagementReadyForHandoffCount: 4,
        stageGateLabel: "Hold present",
        stageGatePassCount: 1,
        stageGateHoldCount: 1,
        stageGateBlockedGateLabel: null,
      })
    ).toMatchObject({
      headline: "2 linked runs · 1 scenario set · 6 project records",
      detail: "3 assumptions · 2 packages · 5 indicators · Active engagement · 4/9 handoff-ready · Hold present governance",
      blockedGateDetail: null,
    });
  });

  it("routes report links to the most relevant detail section", () => {
    expect(getReportNavigationHref("report-1", "Refresh recommended")).toBe(
      "/reports/report-1#drift-since-generation"
    );
    expect(getReportNavigationHref("report-1", "No packet")).toBe(
      "/reports/report-1#report-controls"
    );
    expect(getReportNavigationHref("report-1", "Packet current")).toBe(
      "/reports/report-1#packet-release-review"
    );
  });

  it("normalizes and applies packet freshness filters", () => {
    expect(normalizeReportFreshnessFilter(undefined)).toBe("all");
    expect(normalizeReportFreshnessFilter("refresh")).toBe("refresh");
    expect(normalizeReportFreshnessFilter("nope")).toBe("all");

    expect(matchesReportFreshnessFilter("all", "Packet current")).toBe(true);
    expect(matchesReportFreshnessFilter("refresh", "Refresh recommended")).toBe(true);
    expect(matchesReportFreshnessFilter("refresh", "No packet")).toBe(false);
    expect(matchesReportFreshnessFilter("missing", "No packet")).toBe(true);
    expect(matchesReportFreshnessFilter("current", "Packet current")).toBe(true);
  });

  it("normalizes and applies evidence posture filters", () => {
    expect(normalizeReportPostureFilter(undefined)).toBe("all");
    expect(normalizeReportPostureFilter("evidence-backed")).toBe("evidence-backed");
    expect(normalizeReportPostureFilter("weird")).toBe("all");

    expect(
      matchesReportPostureFilter("all", {
        hasEvidenceChain: false,
        hasComparisonBacked: false,
        hasBlockedGovernance: false,
      })
    ).toBe(true);
    expect(
      matchesReportPostureFilter("evidence-backed", {
        hasEvidenceChain: true,
        hasComparisonBacked: false,
        hasBlockedGovernance: false,
      })
    ).toBe(true);
    expect(
      matchesReportPostureFilter("evidence-backed", {
        hasEvidenceChain: false,
        hasComparisonBacked: false,
        hasBlockedGovernance: false,
      })
    ).toBe(false);
    expect(
      matchesReportPostureFilter("governance-hold", {
        hasEvidenceChain: true,
        hasComparisonBacked: false,
        hasBlockedGovernance: true,
      })
    ).toBe(true);
    expect(
      matchesReportPostureFilter("no-evidence", {
        hasEvidenceChain: false,
        hasComparisonBacked: false,
        hasBlockedGovernance: false,
      })
    ).toBe(true);
  });

  it("parses and formats stored funding posture snapshots", () => {
    const snapshot = parseStoredFundingSnapshot({
      sourceContext: {
        projectFundingSnapshot: {
          capturedAt: "2026-04-12T20:00:00.000Z",
          latestSourceUpdatedAt: "2026-04-12T19:30:00.000Z",
          projectUpdatedAt: "2026-04-12T19:15:00.000Z",
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
          awardRiskCount: 1,
          awardCount: 2,
          opportunityCount: 3,
          openOpportunityCount: 2,
          pursuedOpportunityCount: 2,
          awardedOpportunityCount: 1,
          closingSoonOpportunityCount: 1,
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
        },
      },
    });

    expect(snapshot).toMatchObject({
      awardCount: 2,
      committedFundingAmount: 650000,
      unfundedAfterLikelyAmount: 50000,
      reimbursementLabel: "Reimbursement in flight",
    });

    expect(describeFundingSnapshot(snapshot)).toMatchObject({
      headline: "2 awards · $650,000 committed · $50,000 uncovered",
      detail: "Partially funded · Gap remains · Reimbursement in flight · 2 pursued opportunities · 1 closing soon · 1 award risk flag",
    });
  });
});
