import { describe, expect, it } from "vitest";

import {
  ASSISTANT_CHAT_CONTEXT_MAX_CHARS,
  ASSISTANT_CHAT_CONTEXT_TRUNCATION_MARKER,
  buildAssistantChatContextLines,
  buildAssistantChatSystemPrompt,
} from "@/lib/assistant/chat-context";
import type {
  ProjectAssistantContext,
  RtpAssistantContext,
  RunAssistantContext,
  WorkspaceAssistantContext,
} from "@/lib/assistant/context";

function buildOperationsSummary(
  overrides?: Partial<WorkspaceAssistantContext["operationsSummary"]["counts"]>
): WorkspaceAssistantContext["operationsSummary"] {
  return {
    posture: "attention",
    headline: "Two funding decisions are overdue.",
    detail: "Workspace pressure is concentrated in the funding queue.",
    counts: {
      projects: 4,
      activeProjects: 3,
      plans: 2,
      plansNeedingSetup: 1,
      programs: 1,
      activePrograms: 1,
      reports: 5,
      reportRefreshRecommended: 2,
      reportNoPacket: 1,
      reportPacketCurrent: 2,
      rtpFundingReviewPackets: 1,
      comparisonBackedReports: 2,
      fundingOpportunities: 6,
      openFundingOpportunities: 3,
      closingSoonFundingOpportunities: 1,
      overdueDecisionFundingOpportunities: 2,
      projectFundingNeedAnchorProjects: 1,
      projectFundingSourcingProjects: 1,
      projectFundingDecisionProjects: 1,
      projectFundingAwardRecordProjects: 0,
      projectFundingReimbursementStartProjects: 0,
      projectFundingReimbursementActiveProjects: 0,
      projectFundingGapProjects: 2,
      queueDepth: 7,
      aerialMissions: 0,
      aerialActiveMissions: 0,
      aerialReadyPackages: 0,
      ...overrides,
    },
    nextCommand: {
      key: "funding-decision",
      title: "Record the SS4A pursue decision",
      detail: "The decision window closes this week.",
      href: "/funding",
      tone: "warning",
      priority: 1,
      badges: [],
    } as unknown as WorkspaceAssistantContext["operationsSummary"]["nextCommand"],
    commandQueue: [],
    fullCommandQueue: [],
  };
}

function buildWorkspaceContext(): WorkspaceAssistantContext {
  return {
    kind: "workspace",
    workspace: { id: "ws-1", name: "Foothill COG", plan: "pro", role: "admin" },
    recentProject: {
      id: "proj-1",
      name: "Elm Corridor Study",
      status: "active",
      planType: "corridor_plan",
      deliveryPhase: "discovery",
      updatedAt: "2026-07-01T12:00:00.000Z",
    },
    recentRuns: [
      { id: "run-1", title: "Elm St corridor scan", createdAt: "2026-07-02T08:00:00.000Z" },
      { id: "run-2", title: "Downtown transit access", createdAt: "2026-06-28T08:00:00.000Z" },
    ],
    currentRun: null,
    baselineRun: null,
    operationsSummary: buildOperationsSummary(),
  };
}

function buildProjectContext(): ProjectAssistantContext {
  return {
    kind: "project",
    workspace: { id: "ws-1", name: "Foothill COG", plan: "pro", role: "member" },
    project: {
      id: "proj-1",
      name: "Elm Corridor Study",
      summary: "Multimodal corridor safety and access study.",
      status: "active",
      planType: "corridor_plan",
      deliveryPhase: "analysis",
      updatedAt: "2026-07-10T12:00:00.000Z",
    },
    counts: {
      deliverables: 4,
      risks: 2,
      issues: 1,
      decisions: 3,
      meetings: 5,
      linkedDatasets: 6,
      overlayReadyDatasets: 4,
      recentRuns: 2,
    },
    fundingSummary: {
      opportunityCount: 5,
      openCount: 3,
      closingSoonCount: 1,
      overdueDecisionCount: 1,
      pursueCount: 2,
      awardCount: 1,
      awardRecordCount: 1,
      fundingNeedAmount: 2400000,
      gapAmount: 800000,
      requestedReimbursementAmount: null,
      uninvoicedAwardAmount: 150000,
      reimbursementStatus: "sourcing",
      reimbursementPacketCount: 0,
      exactInvoiceAwardRelink: null,
      leadOpportunity: {
        id: "opp-1",
        title: "SS4A Implementation Grant",
        status: "open",
        decisionState: "pursue",
        closesAt: "2026-08-15T00:00:00.000Z",
        decisionDueAt: null,
      },
      leadOverdueOpportunity: {
        id: "opp-2",
        title: "ATP Cycle 7",
        status: "open",
        decisionState: null,
        closesAt: null,
        decisionDueAt: "2026-07-01T00:00:00.000Z",
      },
      leadClosingOpportunity: null,
      leadAwardOpportunity: null,
    },
    stageGateSummary: null as unknown as ProjectAssistantContext["stageGateSummary"],
    linkedDatasets: [],
    recentRuns: [
      {
        id: "run-1",
        title: "Elm St corridor scan",
        createdAt: "2026-07-02T08:00:00.000Z",
        summaryText: "Moderate density, limited transit access.",
      },
    ],
    reportSummary: {
      linkedReportCount: 3,
      evidenceBackedCount: 2,
      comparisonBackedCount: 1,
      noPacketCount: 1,
      refreshRecommendedCount: 1,
      recommendedReport: null,
    },
  };
}

function buildRtpCycleContext(): RtpAssistantContext {
  return {
    kind: "rtp_cycle",
    workspace: { id: "ws-1", name: "Foothill COG", plan: "pro", role: "admin" },
    defaultModelingCountyRunId: null,
    rtpCycle: {
      id: "cycle-1",
      title: "2026 RTP Update",
      summary: null,
      status: "public_review",
      geographyLabel: "Tri-county region",
      horizonStartYear: 2026,
      horizonEndYear: 2046,
      adoptionTargetDate: "2026-12-01T00:00:00.000Z",
      publicReviewOpenAt: null,
      publicReviewCloseAt: null,
      updatedAt: "2026-07-05T00:00:00.000Z",
    },
    readiness: null as unknown as RtpAssistantContext["readiness"],
    workflow: null as unknown as RtpAssistantContext["workflow"],
    counts: {
      chapters: 8,
      readyForReviewChapters: 5,
      completeChapters: 2,
      linkedProjects: 12,
      engagementCampaigns: 2,
      packetReports: 3,
    },
    packetSummary: {
      linkedReportCount: 3,
      noPacketCount: 0,
      refreshRecommendedCount: 1,
      recommendedReport: null,
    },
    operationsSummary: buildOperationsSummary(),
  };
}

function buildRunContext(): RunAssistantContext {
  return {
    kind: "run",
    workspace: { id: "ws-1", name: "Foothill COG", plan: "pro", role: "member" },
    run: {
      id: "run-1",
      title: "Elm St corridor scan",
      summary: "Screening-grade corridor scan.",
      createdAt: "2026-07-02T08:00:00.000Z",
      queryText: "Elm Street between 1st and 9th",
      metrics: { population: 5000, jobs: 1200, crashes: 14 },
    },
    baselineRun: {
      id: "run-0",
      title: "Baseline corridor scan",
      createdAt: "2026-06-01T08:00:00.000Z",
      metrics: { population: 4800, jobs: 1100 },
    },
  };
}

describe("buildAssistantChatContextLines", () => {
  it("serializes workspace context with surface, workspace, and operations posture lines", () => {
    const lines = buildAssistantChatContextLines(buildWorkspaceContext());
    const joined = lines.join("\n");

    expect(lines[0]).toBe("Current surface: workspace");
    expect(joined).toContain("Workspace: Foothill COG · plan tier pro · your role admin");
    expect(joined).toContain('Most recent project: "Elm Corridor Study"');
    expect(joined).toContain("Operations posture: attention — Two funding decisions are overdue.");
    expect(joined).toContain("Funding queue: 6 opportunities (3 open, 1 closing soon, 2 overdue decisions)");
    expect(joined).toContain("Command queue depth: 7");
    expect(joined).toContain("Next queued command: Record the SS4A pursue decision");
  });

  it("serializes project context with counts and funding posture, including currency amounts", () => {
    const lines = buildAssistantChatContextLines(buildProjectContext());
    const joined = lines.join("\n");

    expect(lines[0]).toBe("Current surface: project");
    expect(joined).toContain('Project: "Elm Corridor Study" — status active, type corridor_plan, phase analysis');
    expect(joined).toContain("Project counts: 4 deliverables · 2 risks · 1 issues · 3 decisions · 5 meetings");
    expect(joined).toContain(
      "Funding posture: 5 opportunities (3 open, 1 closing soon, 1 overdue decisions, 2 marked pursue) · 1 award records"
    );
    expect(joined).toContain("need $2,400,000");
    expect(joined).toContain("gap $800,000");
    expect(joined).toContain('Lead funding opportunity: "SS4A Implementation Grant" (status open, decision pursue, closes 2026-08-15)');
    expect(joined).toContain('Overdue decision: "ATP Cycle 7"');
    expect(joined).toContain("Report posture: 3 linked reports (2 evidence-backed, 1 without packets, 1 refresh recommended)");
  });

  it("serializes RTP cycle context with horizon and packet posture", () => {
    const lines = buildAssistantChatContextLines(buildRtpCycleContext());
    const joined = lines.join("\n");

    expect(lines[0]).toBe("Current surface: rtp cycle");
    expect(joined).toContain('RTP cycle: "2026 RTP Update" — status public_review, horizon 2026–2046');
    expect(joined).toContain("adoption target 2026-12-01");
    expect(joined).toContain("Cycle counts: 8 chapters (5 ready for review, 2 complete) · 12 linked projects");
    expect(joined).toContain("Packet posture: 3 linked reports · 0 without packets · 1 refresh recommended");
  });

  it("serializes run context with compact metrics JSON and the baseline run", () => {
    const lines = buildAssistantChatContextLines(buildRunContext());
    const joined = lines.join("\n");

    expect(joined).toContain('Analysis run: "Elm St corridor scan" (created 2026-07-02)');
    expect(joined).toContain("query: Elm Street between 1st and 9th");
    expect(joined).toContain('Run metrics: {"population":5000,"jobs":1200,"crashes":14}');
    expect(joined).toContain('Baseline run: "Baseline corridor scan" — metrics {"population":4800,"jobs":1100}');
  });

  it("truncates oversized run metrics instead of dumping them", () => {
    const context = buildRunContext();
    context.run.metrics = { blob: "x".repeat(5000) };

    const lines = buildAssistantChatContextLines(context);
    const metricsLine = lines.find((line) => line.startsWith("Run metrics:"));

    expect(metricsLine).toBeDefined();
    expect(metricsLine!.length).toBeLessThan(1000);
    expect(metricsLine).toContain("…");
  });
});

describe("buildAssistantChatSystemPrompt", () => {
  it("includes grounding, no-invention, screening-grade, and no-action-execution rules", () => {
    const prompt = buildAssistantChatSystemPrompt(buildWorkspaceContext());

    expect(prompt).toContain("copilot for city and regional transportation planners");
    expect(prompt).toContain("Never invent workspace data.");
    expect(prompt).toContain("screening-grade");
    expect(prompt).toContain("You cannot execute actions from chat.");
    expect(prompt).toContain("WORKSPACE CONTEXT (RLS-scoped, current surface):");
  });

  it("embeds the serialized context lines as bullet entries", () => {
    const prompt = buildAssistantChatSystemPrompt(buildProjectContext());

    expect(prompt).toContain("- Current surface: project");
    expect(prompt).toContain('- Project: "Elm Corridor Study"');
  });

  it("caps the context portion and appends a truncation marker when over budget", () => {
    const context = buildProjectContext();
    context.project.summary = "A ".repeat(600);

    const prompt = buildAssistantChatSystemPrompt(context, { maxContextChars: 300 });
    const contextPortion = prompt.split("WORKSPACE CONTEXT (RLS-scoped, current surface):")[1];

    expect(prompt).toContain(ASSISTANT_CHAT_CONTEXT_TRUNCATION_MARKER);
    expect(contextPortion.length).toBeLessThan(300 + ASSISTANT_CHAT_CONTEXT_TRUNCATION_MARKER.length + 100);
    // Instructions always survive truncation.
    expect(prompt).toContain("Never invent workspace data.");
  });

  it("keeps the default prompt within the configured budget for a dense context", () => {
    const prompt = buildAssistantChatSystemPrompt(buildProjectContext());
    const contextPortion = prompt.split("WORKSPACE CONTEXT (RLS-scoped, current surface):")[1];

    expect(contextPortion.length).toBeLessThanOrEqual(ASSISTANT_CHAT_CONTEXT_MAX_CHARS + ASSISTANT_CHAT_CONTEXT_TRUNCATION_MARKER.length + 100);
    expect(prompt).not.toContain(ASSISTANT_CHAT_CONTEXT_TRUNCATION_MARKER);
  });
});
