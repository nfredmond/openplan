import { describe, expect, it } from "vitest";
import { buildAssistantPreview, buildAssistantResponse } from "@/lib/assistant/respond";
import type { RtpAssistantContext } from "@/lib/assistant/context";

function buildRtpCycleContext(): RtpAssistantContext {
  return {
    kind: "rtp_cycle",
    workspace: {
      id: "workspace-1",
      name: "Test Workspace",
      plan: "pilot",
      role: "owner",
    },
    defaultModelingCountyRunId: null,
    rtpCycle: {
      id: "rtp-1",
      title: "Nevada County RTP 2050",
      summary: "Countywide RTP update.",
      status: "draft",
      geographyLabel: "Nevada County",
      horizonStartYear: 2025,
      horizonEndYear: 2050,
      adoptionTargetDate: "2026-10-01",
      publicReviewOpenAt: null,
      publicReviewCloseAt: null,
      updatedAt: "2026-04-14T06:30:00.000Z",
    },
    readiness: {
      label: "In progress",
      reason: "Add a public review open/close window before treating the cycle as review-ready.",
      tone: "warning",
      ready: false,
      readyCheckCount: 3,
      totalCheckCount: 4,
      missingCheckLabels: ["Public review window"],
      nextSteps: ["Add a public review open/close window before treating the cycle as review-ready."],
      checks: [],
    },
    workflow: {
      label: "Setup still needed",
      detail: "Add a public review open/close window before treating the cycle as review-ready.",
      tone: "warning",
      actionItems: ["Add a public review open/close window before treating the cycle as review-ready."],
    },
    counts: {
      chapters: 4,
      readyForReviewChapters: 2,
      completeChapters: 1,
      linkedProjects: 3,
      engagementCampaigns: 1,
      packetReports: 1,
    },
    packetSummary: {
      linkedReportCount: 1,
      noPacketCount: 0,
      refreshRecommendedCount: 0,
      recommendedReport: {
        id: "report-rtp-1",
        title: "Board packet",
        packetFreshness: {
          label: "Packet current",
          tone: "success",
          detail: "The latest packet is current with the saved report record.",
        },
      },
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

describe("assistant RTP cycle grants follow-through", () => {
  it("aligns RTP cycle preview copy to Grants OS when funding review is routed there", () => {
    const preview = buildAssistantPreview(buildRtpCycleContext());

    expect(preview.facts.join(" ")).toContain("Grants OS follow-through");
    expect(preview.operatorCue?.title).toBe("Open RTP grants follow-through");
    expect(preview.operatorCue?.detail).toContain("Grants OS follow-through");
  });

  it("aligns RTP cycle response copy to Grants OS when release review is grants-routed", () => {
    const response = buildAssistantResponse(buildRtpCycleContext(), "rtp-packet-release");

    expect(response.summary).toContain("Grants OS follow-through");
    expect(response.findings.join(" ")).toContain("Grants OS follow-through is still open");
    expect(response.nextSteps.join(" ")).toContain("Resolve the Grants OS follow-through");
  });
});
