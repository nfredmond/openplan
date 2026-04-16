import { describe, expect, it } from "vitest";
import { buildAssistantPreview, buildAssistantResponse } from "@/lib/assistant/respond";
import type {
  ProgramAssistantContext,
  ProjectAssistantContext,
  RunAssistantContext,
  WorkspaceAssistantContext,
} from "@/lib/assistant/context";

function buildProjectContextWithOverdue(overdueDecisionCount: number): ProjectAssistantContext {
  return {
    kind: "project",
    workspace: {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Nevada County Vision Zero",
      plan: "pilot",
      role: "member",
    },
    project: {
      id: "22222222-2222-4222-8222-222222222222",
      name: "SR-49 Safety Program",
      summary: "Countywide multimodal safety package.",
      status: "active",
      planType: "safety_plan",
      deliveryPhase: "analysis",
      updatedAt: "2026-03-21T17:00:00.000Z",
    },
    counts: {
      deliverables: 0,
      risks: 0,
      issues: 0,
      decisions: 0,
      meetings: 0,
      linkedDatasets: 0,
      overlayReadyDatasets: 0,
      recentRuns: 0,
    },
    fundingSummary: {
      opportunityCount: 2,
      openCount: 2,
      closingSoonCount: 1,
      overdueDecisionCount,
      pursueCount: 0,
      awardCount: 0,
      awardRecordCount: 0,
      fundingNeedAmount: null,
      gapAmount: null,
      requestedReimbursementAmount: null,
      uninvoicedAwardAmount: null,
      reimbursementStatus: null,
      reimbursementPacketCount: 0,
      exactInvoiceAwardRelink: null,
      leadOpportunity: {
        id: "opp-overdue",
        title: "ATP Cycle 8",
        status: "open",
        decisionState: "monitor",
        closesAt: null,
        decisionDueAt: "2026-03-01T12:00:00.000Z",
      },
      leadAwardOpportunity: null,
    },
    stageGateSummary: {
      gates: [],
      passCount: 0,
      holdCount: 0,
      notStartedCount: 0,
      blockedGate: null,
      nextGate: null,
    },
    linkedDatasets: [],
    recentRuns: [],
    reportSummary: {
      linkedReportCount: 0,
      evidenceBackedCount: 0,
      comparisonBackedCount: 0,
      noPacketCount: 0,
      refreshRecommendedCount: 0,
      recommendedReport: null,
    },
  };
}

function buildProgramContextWithOverdue(overdueDecisionCount: number): ProgramAssistantContext {
  return {
    kind: "program",
    workspace: {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Nevada County Vision Zero",
      plan: "pilot",
      role: "owner",
    },
    project: {
      id: "project-linked",
      name: "Linked Project",
    },
    program: {
      id: "program-1",
      title: "2027 RTIP Package",
      summary: null,
      status: "assembling",
      programType: "rtip",
      cycleName: "2027 RTIP",
      sponsorAgency: null,
      updatedAt: "2026-04-11T18:00:00.000Z",
    },
    readiness: {
      label: "Incomplete",
      ready: false,
      missingCheckCount: 1,
    } as unknown as ProgramAssistantContext["readiness"],
    workflow: {
      label: "Assembling",
    } as unknown as ProgramAssistantContext["workflow"],
    linkageCounts: {
      plans: 0,
      reports: 0,
      engagementCampaigns: 0,
      relatedProjects: 1,
    },
    fundingSummary: {
      opportunityCount: 2,
      openCount: 2,
      closingSoonCount: 1,
      overdueDecisionCount,
      pursueCount: 0,
      awardCount: 0,
      awardRecordCount: 0,
      fundingNeedAmount: null,
      gapAmount: null,
      requestedReimbursementAmount: null,
      uninvoicedAwardAmount: null,
      reimbursementStatus: null,
      reimbursementPacketCount: 0,
      exactInvoiceAwardRelink: null,
      leadOpportunity: {
        id: "opp-program-overdue",
        title: "RAISE 2026",
        status: "open",
        decisionState: "monitor",
        closesAt: null,
        decisionDueAt: "2026-03-04T12:00:00.000Z",
      },
      leadAwardOpportunity: null,
    },
    packetSummary: {
      linkedReportCount: 0,
      attentionCount: 0,
      noPacketCount: 0,
      refreshRecommendedCount: 0,
      recommendedReport: null,
    },
    operationsSummary: {
      posture: "active",
      headline: "Funding posture",
      detail: "Funding work is active.",
      counts: {
        projects: 1,
        activeProjects: 1,
        plans: 0,
        plansNeedingSetup: 0,
        programs: 1,
        activePrograms: 1,
        reports: 0,
        reportRefreshRecommended: 0,
        reportNoPacket: 0,
        reportPacketCurrent: 0,
        rtpFundingReviewPackets: 0,
        comparisonBackedReports: 0,
        fundingOpportunities: 2,
        openFundingOpportunities: 2,
        closingSoonFundingOpportunities: 1,
        projectFundingNeedAnchorProjects: 0,
        projectFundingSourcingProjects: 0,
        projectFundingDecisionProjects: 0,
        projectFundingAwardRecordProjects: 0,
        projectFundingReimbursementStartProjects: 0,
        projectFundingReimbursementActiveProjects: 0,
        projectFundingGapProjects: 0,
        queueDepth: 0,
      },
      nextCommand: null,
      commandQueue: [],
    } as unknown as ProgramAssistantContext["operationsSummary"],
  };
}

describe("assistant response builders", () => {
  it("builds project blocker responses from project control context", () => {
    const context: ProjectAssistantContext = {
      kind: "project",
      workspace: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Nevada County Vision Zero",
        plan: "pilot",
        role: "member",
      },
      project: {
        id: "22222222-2222-4222-8222-222222222222",
        name: "SR-49 Safety Program",
        summary: "Countywide multimodal safety package.",
        status: "active",
        planType: "safety_plan",
        deliveryPhase: "analysis",
        updatedAt: "2026-03-21T17:00:00.000Z",
      },
      counts: {
        deliverables: 3,
        risks: 2,
        issues: 1,
        decisions: 4,
        meetings: 2,
        linkedDatasets: 2,
        overlayReadyDatasets: 1,
        recentRuns: 2,
      },
      fundingSummary: {
        opportunityCount: 0,
        openCount: 0,
        closingSoonCount: 0,
        overdueDecisionCount: 0,
        pursueCount: 0,
        awardCount: 0,
        awardRecordCount: 0,
        fundingNeedAmount: null,
        gapAmount: null,
        requestedReimbursementAmount: null,
        uninvoicedAwardAmount: null,
        reimbursementStatus: null,
        reimbursementPacketCount: 0,
        exactInvoiceAwardRelink: null,
        leadOpportunity: null,
        leadAwardOpportunity: null,
      },
      stageGateSummary: {
        gates: [],
        passCount: 1,
        holdCount: 1,
        notStartedCount: 3,
        blockedGate: {
          gateId: "G03",
          name: "Environmental readiness",
          sequence: 3,
          workflowState: "hold",
          decisionLabel: "Hold",
          rationale: "CEQA memo still missing.",
          decidedAt: "2026-03-20T12:00:00.000Z",
          requiredEvidenceCount: 2,
          missingArtifacts: ["CEQA memo"],
          lapmMappings: [],
          ceqaVmtMappings: [],
          outreachMappings: [],
          stipRtipMappings: [],
          evidencePreview: [],
        },
        nextGate: {
          gateId: "G03",
          name: "Environmental readiness",
          sequence: 3,
          requiredEvidenceCount: 2,
        },
      },
      linkedDatasets: [],
      recentRuns: [],
      reportSummary: {
        linkedReportCount: 0,
        evidenceBackedCount: 0,
        comparisonBackedCount: 0,
        noPacketCount: 0,
        refreshRecommendedCount: 0,
        recommendedReport: null,
      },
    };

    const preview = buildAssistantPreview(context);
    const response = buildAssistantResponse(context, "project-blockers");

    expect(preview.title).toBe("SR-49 Safety Program");
    expect(response.title).toContain("Current blockers");
    expect(response.summary).toContain("Environmental readiness");
    expect(response.findings.join(" ")).toContain("CEQA memo");
  });

  it("builds run comparison responses from active and baseline run metrics", () => {
    const context: RunAssistantContext = {
      kind: "run",
      workspace: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Nevada County Vision Zero",
        plan: "pilot",
        role: "member",
      },
      run: {
        id: "33333333-3333-4333-8333-333333333333",
        title: "Protected bike lane concept",
        summary: "Safety and access improved.",
        createdAt: "2026-03-21T15:00:00.000Z",
        queryText: "Evaluate protected bike lane concept.",
        metrics: {
          overallScore: 67,
          accessibilityScore: 63,
          safetyScore: 72,
          equityScore: 59,
          confidence: "medium",
        },
      },
      baselineRun: {
        id: "44444444-4444-4444-8444-444444444444",
        title: "Existing conditions",
        createdAt: "2026-03-20T15:00:00.000Z",
        metrics: {
          overallScore: 54,
          accessibilityScore: 56,
          safetyScore: 61,
          equityScore: 55,
        },
      },
    };

    const response = buildAssistantResponse(context, "run-compare");

    expect(response.title).toContain("Run comparison");
    expect(response.summary).toContain("+13");
    expect(response.findings.join(" ")).toContain("Current run confidence");
    expect(response.evidence.join(" ")).toContain("Baseline run");
  });

  it("builds workspace responses that keep RTP funding-backed release review visible", () => {
    const context: WorkspaceAssistantContext = {
      kind: "workspace",
      workspace: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Nevada County Vision Zero",
        plan: "pilot",
        role: "owner",
      },
      recentProject: {
        id: "22222222-2222-4222-8222-222222222222",
        name: "SR-49 Safety Program",
        status: "active",
        planType: "regional_transportation_plan",
        deliveryPhase: "review",
        updatedAt: "2026-04-12T18:00:00.000Z",
      },
      recentRuns: [],
      currentRun: null,
      baselineRun: null,
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
          projectFundingNeedAnchorProjects: 0,
          projectFundingSourcingProjects: 0,
          projectFundingDecisionProjects: 0,
          projectFundingAwardRecordProjects: 0,
          projectFundingReimbursementStartProjects: 0,
          projectFundingReimbursementActiveProjects: 0,
          projectFundingGapProjects: 0,
          queueDepth: 1,
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

    const preview = buildAssistantPreview(context);
    const response = buildAssistantResponse(context, "workspace-overview");

    expect(preview.summary).toContain("Grants OS follow-through");
    expect(preview.facts.join(" ")).toContain("RTP grants follow-through");
    expect(preview.operatorCue?.title).toBe("Open RTP grants follow-through");
    expect(preview.operatorCue?.detail).toContain("Grants OS follow-through");
    expect(response.summary).toContain("Grants OS follow-through");
    expect(response.findings.join(" ")).toContain("Open RTP grants follow-through");
    expect(response.nextSteps.join(" ")).toContain("/grants#grants-gap-resolution-lane");
  });

  it("uses grant modeling detail in workspace funding responses when funding decisions lead the queue", () => {
    const context: WorkspaceAssistantContext = {
      kind: "workspace",
      workspace: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Nevada County Vision Zero",
        plan: "pilot",
        role: "owner",
      },
      recentProject: {
        id: "22222222-2222-4222-8222-222222222222",
        name: "Modeled Project",
        status: "active",
        planType: "regional_transportation_plan",
        deliveryPhase: "analysis",
        updatedAt: "2026-04-15T12:00:00.000Z",
      },
      recentRuns: [],
      currentRun: null,
      baselineRun: null,
      operationsSummary: {
        posture: "attention",
        headline: "Advance project funding decisions",
        detail: "ATP Cycle 8 is the first grant decision to advance for Modeled Project. Modeling posture: Appears decision-ready.",
        counts: {
          projects: 1,
          activeProjects: 1,
          plans: 0,
          plansNeedingSetup: 0,
          programs: 0,
          activePrograms: 0,
          reports: 0,
          reportRefreshRecommended: 0,
          reportNoPacket: 0,
          reportPacketCurrent: 0,
          rtpFundingReviewPackets: 0,
          comparisonBackedReports: 0,
          fundingOpportunities: 1,
          openFundingOpportunities: 1,
          closingSoonFundingOpportunities: 0,
          projectFundingNeedAnchorProjects: 0,
          projectFundingSourcingProjects: 0,
          projectFundingDecisionProjects: 1,
          projectFundingAwardRecordProjects: 0,
          projectFundingReimbursementStartProjects: 0,
          projectFundingReimbursementActiveProjects: 0,
          projectFundingGapProjects: 0,
          queueDepth: 1,
        },
        grantModelingSummary: {
          breakdown: { decisionReady: 1, refreshRecommended: 0, thin: 0, noVisibleSupport: 0 },
          breakdownSummary: "1 opportunity-linked project: 1 appears decision-ready, 0 refresh recommended, 0 appears thin, 0 without visible support.",
          operatorDetail: "Within grant decision work, opportunity-linked projects with modeling support that appears decision-ready rise ahead.",
          leadDecisionDetail: "ATP Cycle 8 for Modeled Project is rising because modeling posture appears decision-ready. Recommended next move: Advance to pursue now.",
        },
        nextCommand: {
          key: "advance-project-funding-decisions",
          title: "Advance project funding decisions",
          detail: "ATP Cycle 8 is the first grant decision to advance for Modeled Project.",
          href: "/projects/project-modeled#project-funding-opportunities",
          targetProjectId: "project-modeled",
          targetProjectName: "Modeled Project",
          targetOpportunityId: "opp-modeled-1",
          tone: "warning",
          priority: 5,
          badges: [
            { label: "Decision gaps", value: 1 },
            { label: "Modeling", value: "Appears decision-ready" },
          ],
        },
        commandQueue: [
          {
            key: "advance-project-funding-decisions",
            title: "Advance project funding decisions",
            detail: "ATP Cycle 8 is the first grant decision to advance for Modeled Project.",
            href: "/projects/project-modeled#project-funding-opportunities",
            targetProjectId: "project-modeled",
            targetProjectName: "Modeled Project",
            targetOpportunityId: "opp-modeled-1",
            tone: "warning",
            priority: 5,
            badges: [
              { label: "Decision gaps", value: 1 },
              { label: "Modeling", value: "Appears decision-ready" },
            ],
          },
        ],
        fullCommandQueue: [
          {
            key: "advance-project-funding-decisions",
            title: "Advance project funding decisions",
            detail: "ATP Cycle 8 is the first grant decision to advance for Modeled Project.",
            href: "/projects/project-modeled#project-funding-opportunities",
            targetProjectId: "project-modeled",
            targetProjectName: "Modeled Project",
            targetOpportunityId: "opp-modeled-1",
            tone: "warning",
            priority: 5,
            badges: [
              { label: "Decision gaps", value: 1 },
              { label: "Modeling", value: "Appears decision-ready" },
            ],
          },
        ],
      },
    };

    const preview = buildAssistantPreview(context);
    const overview = buildAssistantResponse(context, "workspace-overview");
    const response = buildAssistantResponse(context, "workspace-funding");

    expect(preview.summary).toContain("lead grant decision cue: ATP Cycle 8 for Modeled Project is rising because modeling posture appears decision-ready");
    expect(preview.facts.join(" ")).toContain("Command queue: Advance project funding decisions. ATP Cycle 8 for Modeled Project is rising because modeling posture appears decision-ready.");
    expect(preview.operatorCue?.detail).toContain("ATP Cycle 8 for Modeled Project is rising because modeling posture appears decision-ready");
    expect(overview.summary).toContain("Lead grant decision cue: ATP Cycle 8 for Modeled Project is rising because modeling posture appears decision-ready");
    expect(overview.findings.join(" ")).toContain("Next command: Advance project funding decisions. ATP Cycle 8 for Modeled Project is rising because modeling posture appears decision-ready.");
    expect(response.summary).toContain("ATP Cycle 8 for Modeled Project is rising because modeling posture appears decision-ready");
    expect(response.findings.join(" ")).toContain("Lead grant decision cue");
    expect(response.findings.join(" ")).toContain("Advance to pursue now");
    expect(response.nextSteps.join(" ")).toContain("use this lead grant cue before treating the stack as a real funding pipeline");
    expect(response.nextSteps.join(" ")).toContain("/grants?focusOpportunityId=opp-modeled-1#funding-opportunity-opp-modeled-1");
  });

  it("prioritizes overdue funding decisions in project preview operator cue", () => {
    const context = buildProjectContextWithOverdue(2);

    const preview = buildAssistantPreview(context);

    expect(preview.operatorCue?.title).toBe("2 overdue funding decisions need a pursue or skip call");
    expect(preview.operatorCue?.detail).toContain("outrank newer closing-soon timing");
    expect(preview.facts.join(" ")).toContain(
      "2 monitored funding decisions have lapsed the recorded decision deadline"
    );
  });

  it("keeps overdue funding decisions singular in project preview when only one is lapsed", () => {
    const context = buildProjectContextWithOverdue(1);

    const preview = buildAssistantPreview(context);

    expect(preview.operatorCue?.title).toBe("1 overdue funding decision needs a pursue or skip call");
    expect(preview.facts.join(" ")).toContain(
      "1 monitored funding decision has lapsed the recorded decision deadline"
    );
  });

  it("leads the project funding response summary with overdue decisions ahead of closing-soon count", () => {
    const context = buildProjectContextWithOverdue(1);

    const response = buildAssistantResponse(context, "project-funding");

    expect(response.summary).toContain(
      "1 monitored funding decision has already lapsed the recorded decision deadline"
    );
    expect(response.findings.join(" ")).toContain(
      "1 monitored funding decision has lapsed the recorded decision deadline"
    );
    expect(response.nextSteps[0]).toContain(
      "resolve the lapsed monitor decision as pursue or skip"
    );
    expect(response.evidence.join(" ")).toContain("Overdue monitor decisions: 1");
  });

  it("falls back to closing-soon narration when no project funding decisions are overdue", () => {
    const context = buildProjectContextWithOverdue(0);

    const preview = buildAssistantPreview(context);
    const response = buildAssistantResponse(context, "project-funding");

    expect(preview.operatorCue?.title).toBe("1 funding deadline need attention");
    expect(response.summary).not.toContain("already lapsed");
    expect(response.findings.join(" ")).toContain(
      "No monitored funding decision has lapsed the recorded decision deadline on this project."
    );
    expect(response.evidence.join(" ")).toContain("Overdue monitor decisions: 0");
  });

  it("prioritizes overdue funding decisions in program funding response", () => {
    const context = buildProgramContextWithOverdue(2);

    const preview = buildAssistantPreview(context);
    const response = buildAssistantResponse(context, "program-funding");

    expect(preview.facts.join(" ")).toContain(
      "2 monitored funding decisions have lapsed the recorded decision deadline"
    );
    expect(response.summary).toContain(
      "2 monitored funding decisions have already lapsed the recorded decision deadline"
    );
    expect(response.findings.join(" ")).toContain(
      "2 monitored funding decisions have lapsed the recorded decision deadline"
    );
    expect(response.nextSteps[0]).toContain(
      "resolve the lapsed monitor decision as pursue or skip"
    );
    expect(response.nextSteps[0]).toContain("/programs/program-1#program-funding-opportunities");
    expect(response.evidence.join(" ")).toContain("Overdue monitor decisions: 2");
  });
});
