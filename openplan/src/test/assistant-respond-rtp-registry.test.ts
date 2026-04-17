import { describe, expect, it } from "vitest";
import { buildAssistantPreview, buildAssistantResponse } from "@/lib/assistant/respond";
import type { RtpRegistryAssistantContext } from "@/lib/assistant/context";

function buildRtpRegistryContext(): RtpRegistryAssistantContext {
  return {
    kind: "rtp_registry",
    workspace: {
      id: "workspace-1",
      name: "Test Workspace",
      plan: "pilot",
      role: "owner",
    },
    counts: {
      cycles: 2,
      draftCycles: 1,
      publicReviewCycles: 0,
      adoptedCycles: 1,
      archivedCycles: 0,
      packetReports: 2,
      noPacketCount: 0,
      refreshRecommendedCount: 0,
    },
    recommendedCycle: {
      id: "rtp-1",
      title: "Nevada County RTP 2050",
      status: "draft",
      packetFreshnessLabel: "Packet current",
      packetReportCount: 1,
      updatedAt: "2026-04-14T06:30:00.000Z",
    },
    operationsSummary: {
      posture: "attention",
      headline: "Run release review on current packets",
      detail: "A current RTP packet still carries linked-project funding follow-up.",
      counts: {
        projects: 1,
        activeProjects: 1,
        plans: 0,
        plansNeedingSetup: 0,
        programs: 0,
        activePrograms: 0,
        reports: 1,
        reportRefreshRecommended: 0,
        reportNoPacket: 0,
        reportPacketCurrent: 1,
        rtpFundingReviewPackets: 1,
        comparisonBackedReports: 0,
        fundingOpportunities: 1,
        openFundingOpportunities: 1,
        closingSoonFundingOpportunities: 0,
        overdueDecisionFundingOpportunities: 0,
        projectFundingNeedAnchorProjects: 0,
        projectFundingSourcingProjects: 0,
        projectFundingDecisionProjects: 0,
        projectFundingAwardRecordProjects: 0,
        projectFundingReimbursementStartProjects: 0,
        projectFundingReimbursementActiveProjects: 0,
        projectFundingGapProjects: 0,
        queueDepth: 1,
        aerialMissions: 0,
        aerialActiveMissions: 0,
        aerialReadyPackages: 0,
      },
      nextCommand: {
        key: "review-current-report-packets",
        moduleKey: "grants",
        moduleLabel: "Grants OS",
        title: "Run release review on current packets",
        detail: "1 current RTP packet still carries funding follow-up from linked projects.",
        href: "/grants#grants-gap-resolution-lane",
        tone: "warning",
        priority: 2.5,
        badges: [
          { label: "Current", value: 1 },
          { label: "Funding review", value: 1 },
        ],
      },
      commandQueue: [
        {
          key: "review-current-report-packets",
          moduleKey: "grants",
          moduleLabel: "Grants OS",
          title: "Run release review on current packets",
          detail: "1 current RTP packet still carries funding follow-up from linked projects.",
          href: "/grants#grants-gap-resolution-lane",
          tone: "warning",
          priority: 2.5,
          badges: [
            { label: "Current", value: 1 },
            { label: "Funding review", value: 1 },
          ],
        },
      ],
      fullCommandQueue: [
        {
          key: "review-current-report-packets",
          moduleKey: "grants",
          moduleLabel: "Grants OS",
          title: "Run release review on current packets",
          detail: "1 current RTP packet still carries funding follow-up from linked projects.",
          href: "/grants#grants-gap-resolution-lane",
          tone: "warning",
          priority: 2.5,
          badges: [
            { label: "Current", value: 1 },
            { label: "Funding review", value: 1 },
          ],
        },
      ],
    },
  };
}

describe("assistant RTP registry grants follow-through", () => {
  it("aligns RTP registry preview copy to Grants OS when funding review is routed there", () => {
    const preview = buildAssistantPreview(buildRtpRegistryContext());

    expect(preview.facts.join(" ")).toContain("Open RTP grants follow-through");
    expect(preview.operatorCue?.title).toBe("Open RTP grants follow-through");
    expect(preview.operatorCue?.detail).toContain("Grants OS follow-through");
  });

  it("aligns RTP registry queue responses to Grants OS when release review is grants-routed", () => {
    const response = buildAssistantResponse(buildRtpRegistryContext(), "rtp-registry-packets");

    expect(response.summary).toContain("Grants OS follow-through");
    expect(response.findings.join(" ")).toContain("Open RTP grants follow-through");
    expect(response.nextSteps.join(" ")).toContain("Run the Grants OS follow-through lane");
  });
});
