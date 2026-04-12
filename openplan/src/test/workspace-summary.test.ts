import { describe, expect, it } from "vitest";
import { buildWorkspaceOperationsSummary } from "@/lib/operations/workspace-summary";

describe("workspace summary RTP funding review", () => {
  it("counts current RTP packets that still need funding-backed release review", () => {
    const summary = buildWorkspaceOperationsSummary({
      projects: [],
      plans: [],
      programs: [],
      reports: [
        {
          id: "report-rtp-1",
          title: "Nevada County RTP packet",
          status: "generated",
          latestArtifactKind: "html",
          generatedAt: "2026-04-12T20:00:00.000Z",
          updatedAt: "2026-04-12T20:00:00.000Z",
          metadataJson: {
            sourceContext: {
              rtpFundingSnapshot: {
                linkedProjectCount: 2,
                gapProjectCount: 1,
                likelyCoveredProjectCount: 0,
                outstandingReimbursementAmount: 0,
                uninvoicedAwardAmount: 0,
              },
            },
          },
        },
      ],
      fundingOpportunities: [],
      fundingAwards: [],
      fundingInvoices: [],
      projectSubmittals: [],
      projectFundingProfiles: [],
    });

    expect(summary.counts.reportPacketCurrent).toBe(1);
    expect(summary.counts.rtpFundingReviewPackets).toBe(1);
    expect(summary.nextCommand?.key).toBe("review-current-report-packets");
    expect(summary.nextCommand?.tone).toBe("warning");
    expect(summary.nextCommand?.detail).toMatch(/funding follow-up/i);
  });

  it("uses stored RTP source timestamps instead of report.updatedAt when judging packet freshness", () => {
    const summary = buildWorkspaceOperationsSummary({
      projects: [],
      plans: [],
      programs: [],
      reports: [
        {
          id: "report-rtp-2",
          title: "Nevada County RTP packet",
          status: "generated",
          latestArtifactKind: "html",
          generatedAt: "2026-04-12T20:00:00.000Z",
          updatedAt: "2026-04-12T20:05:00.000Z",
          metadataJson: {
            sourceContext: {
              rtpCycleUpdatedAt: "2026-04-12T19:55:00.000Z",
              rtpFundingSnapshot: {
                linkedProjectCount: 1,
                gapProjectCount: 0,
                likelyCoveredProjectCount: 1,
                outstandingReimbursementAmount: 0,
                uninvoicedAwardAmount: 0,
              },
            },
          },
        },
      ],
      fundingOpportunities: [],
      fundingAwards: [],
      fundingInvoices: [],
      projectSubmittals: [],
      projectFundingProfiles: [],
    });

    expect(summary.counts.reportRefreshRecommended).toBe(0);
    expect(summary.counts.reportPacketCurrent).toBe(1);
    expect(summary.counts.rtpFundingReviewPackets).toBe(1);
    expect(summary.nextCommand?.key).toBe("review-current-report-packets");
  });
});
