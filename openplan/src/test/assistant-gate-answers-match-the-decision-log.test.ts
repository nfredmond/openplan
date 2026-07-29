import { describe, expect, it } from "vitest";
import { buildAssistantPreview, buildAssistantResponse } from "@/lib/assistant/respond";
import type { ProjectAssistantContext } from "@/lib/assistant/context";

/**
 * The assistant restates the gate board out loud, so it may not say more about
 * a project than the board knows.
 *
 * TWO WORDS THAT WERE WRONG. It called an undecided gate "not-started", which
 * is a claim about the PROJECT's progress — the work may be well under way with
 * no verdict logged. The board only ever knew whether a DECISION was recorded,
 * which is what `src/lib/stage-gates/summary.ts` says on screen.
 *
 * And it read `blockedGate === null` as "no stage gate is currently on hold".
 * That is true when the log was read and holds no hold, and false when the log
 * did not load at all — which the board now distinguishes and the assistant
 * must not re-collapse.
 */

function buildProjectContext(
  stageGateSummary: Partial<ProjectAssistantContext["stageGateSummary"]>
): ProjectAssistantContext {
  return {
    kind: "project",
    workspace: {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Test workspace",
      role: "member",
    },
    project: {
      id: "22222222-2222-4222-8222-222222222222",
      name: "Corridor safety package",
      summary: "Test project.",
      status: "active",
      planType: "safety_plan",
      deliveryPhase: "analysis",
      updatedAt: "2026-07-28T17:00:00.000Z",
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
      leadOverdueOpportunity: null,
      leadClosingOpportunity: null,
      leadAwardOpportunity: null,
    },
    stageGateSummary: {
      templateId: "template-default",
      templateName: "Test template",
      templateVersion: "1.0",
      jurisdiction: "test",
      jurisdictionLabel: "Test jurisdiction",
      totalGateCount: 9,
      gates: [],
      passCount: 2,
      holdCount: 0,
      notStartedCount: 7,
      unknownCount: 0,
      decisionsRead: { readable: true },
      blockedGate: null,
      nextGate: null,
      ...stageGateSummary,
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
  } as ProjectAssistantContext;
}

describe("the assistant says what the gate log says, and no more", () => {
  it("calls an undecided gate 'no decision recorded' rather than not-started", () => {
    const response = buildAssistantResponse(buildProjectContext({}), "project-blockers");
    const evidence = response.evidence?.join(" ") ?? "";

    expect(evidence).toContain("no decision recorded");
    expect(evidence).toContain("2/0/7");
    // "not started" is a statement about the project's progress; the decision
    // log never made one.
    expect(evidence.toLowerCase()).not.toContain("not-started");
    expect(evidence.toLowerCase()).not.toContain("not started");
  });
});

describe("an unreadable gate log is not answered as a clean gate board", () => {
  const unreadable = {
    passCount: 0,
    holdCount: 0,
    notStartedCount: 0,
    unknownCount: 9,
    decisionsRead: { readable: false as const, reason: 'permission denied for table "stage_gate_decisions"' },
    blockedGate: null,
    nextGate: null,
  };

  it("refuses to report that nothing is on hold", () => {
    const response = buildAssistantResponse(buildProjectContext(unreadable), "project-blockers");
    const spoken = [response.summary, ...response.findings].join(" ");

    expect(spoken).toContain("could not be read");
    expect(spoken).toContain('permission denied for table "stage_gate_decisions"');
    expect(spoken).not.toContain("No stage gate is currently recorded on HOLD.");
    expect(spoken).not.toContain("does not show a formal held stage gate");
    // The same finding list also reported the missing-artifact list as absent,
    // which is another statement about a gate record nothing read.
    expect(spoken).not.toContain("No explicit missing-artifact list is recorded");
  });

  it("still reports an absent missing-artifact list when the log WAS read", () => {
    const response = buildAssistantResponse(buildProjectContext({}), "project-blockers");

    expect(response.findings.join(" ")).toContain(
      "No explicit missing-artifact list is recorded on the current gate surface."
    );
  });

  it("refuses to report zero passes, because zero here means unknown", () => {
    const blockers = buildAssistantResponse(buildProjectContext(unreadable), "project-blockers");
    const brief = buildAssistantResponse(buildProjectContext(unreadable), "project-brief");

    expect(blockers.evidence?.join(" ")).toContain("unknown");
    expect(blockers.evidence?.join(" ")).not.toContain("0/0/0");
    expect(brief.evidence?.join(" ")).toContain("Stage-gate pass count: unknown");
  });

  it("does not put 'No hold gate' on the preview tile", () => {
    const preview = buildAssistantPreview(buildProjectContext(unreadable));
    const blockedGateStat = preview.stats?.find((stat) => stat.label === "Blocked gate");

    expect(blockedGateStat?.value).toBe("Gate log not readable");
  });
});
