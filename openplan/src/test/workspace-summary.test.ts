import { describe, expect, it } from "vitest";
import {
  buildWorkspaceOperationsSummary,
  loadWorkspaceOperationsSummaryForWorkspace,
  type WorkspaceOperationsSupabaseLike,
} from "@/lib/operations/workspace-summary";

function createWorkspaceOperationsSupabaseStub(dataByTable: Record<string, unknown[]>) {
  const buildResult = (table: string) => ({ data: (dataByTable[table] as unknown[]) ?? [] });

  const chain = (table: string) => ({
    order: () => ({
      limit: async () => buildResult(table),
    }),
    limit: async () => buildResult(table),
  });

  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => chain(table),
        in: () => chain(table),
      }),
    }),
  } as WorkspaceOperationsSupabaseLike;
}

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
    expect(summary.nextCommand?.title).toBe("Run Grants follow-through on current packets");
    expect(summary.nextCommand?.moduleLabel).toBe("Grants OS");
    expect(summary.nextCommand?.tone).toBe("warning");
    expect(summary.nextCommand?.href).toBe("/grants#grants-gap-resolution-lane");
    expect(summary.nextCommand?.detail).toMatch(/grants os/i);
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
    expect(summary.nextCommand?.moduleLabel).toBe("Grants OS");
  });

  it("prefers latest report artifact timing when loading workspace operations summary", async () => {
    const supabase = createWorkspaceOperationsSupabaseStub({
      projects: [],
      plans: [],
      programs: [],
      reports: [
        {
          id: "report-rtp-3",
          title: "Nevada County RTP packet",
          status: "generated",
          latest_artifact_kind: "html",
          generated_at: null,
          updated_at: "2026-04-12T20:05:00.000Z",
          metadata_json: null,
        },
      ],
      report_artifacts: [
        {
          report_id: "report-rtp-3",
          generated_at: "2026-04-12T20:00:00.000Z",
          metadata_json: {
            sourceContext: {
              rtpCycleUpdatedAt: "2026-04-12T19:55:00.000Z",
              rtpFundingSnapshot: {
                linkedProjectCount: 0,
                gapProjectCount: 0,
                likelyCoveredProjectCount: 0,
                outstandingReimbursementAmount: 0,
                uninvoicedAwardAmount: 0,
              },
            },
          },
        },
      ],
      funding_opportunities: [],
      funding_awards: [],
      billing_invoice_records: [],
      project_submittals: [],
      project_funding_profiles: [],
    });

    const summary = await loadWorkspaceOperationsSummaryForWorkspace(supabase, "workspace-1");

    expect(summary.counts.reportNoPacket).toBe(0);
    expect(summary.counts.reportRefreshRecommended).toBe(0);
    expect(summary.counts.reportPacketCurrent).toBe(1);
    expect(summary.nextCommand?.key).toBe("review-current-report-packets");
  });
});
