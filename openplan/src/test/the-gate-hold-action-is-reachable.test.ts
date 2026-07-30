import { describe, expect, it } from "vitest";
import { buildAssistantOperations } from "@/lib/assistant/operations";
import {
  buildProjectStageGateSummary,
  type ProjectStageGateSummary,
  type StageGateDecisionRow,
} from "@/lib/stage-gates/summary";
import type { ProjectAssistantContext } from "@/lib/assistant/context";
import type { AssistantQuickLink } from "@/lib/assistant/catalog";

/**
 * REACHABILITY, not just registration — and measured against a board the product
 * can actually produce.
 *
 * The recurring defect in this codebase is a complete, tested, correct
 * capability that no planner can get to. A registered action with no
 * `quickLink({ executeAction })` call site is one shape of that. A quick link
 * whose CONDITION no real state satisfies is a worse shape, because it looks
 * reachable and every test of it passes.
 *
 * This file had exactly that defect. Its fixture hand-built a gate that was
 * `not_started` AND carried `missingArtifacts`, and `buildProjectStageGateSummary`
 * cannot produce that: `missingArtifacts` is copied off the latest DECISION row,
 * and `not_started` means there is no decision row. The quick link could never
 * render for anyone, and this test said it could.
 *
 * So the summary is now BUILT, never described. Every case below starts from the
 * real builder and a real decision log, so a condition no board satisfies fails
 * here instead of shipping.
 */

const PROJECT_ID = "project-1";

function summaryFor(
  decisions: StageGateDecisionRow[],
  options?: { decisionsUnavailable?: { reason: string } }
): ProjectStageGateSummary {
  return buildProjectStageGateSummary(decisions, {
    projectId: PROJECT_ID,
    decisionsUnavailable: options?.decisionsUnavailable ?? null,
  });
}

function decisionRow(gateId: string, decision: "PASS" | "HOLD", missing: string[] = []): StageGateDecisionRow {
  return {
    id: `decision-${gateId}-${decision}`,
    project_id: PROJECT_ID,
    gate_id: gateId,
    decision,
    rationale: "Recorded by a person.",
    missing_artifacts: missing,
    decided_at: "2026-07-30T12:00:00.000Z",
  } as unknown as StageGateDecisionRow;
}

function projectContext(stageGateSummary: ProjectStageGateSummary): ProjectAssistantContext {
  return {
    kind: "project",
    workspace: { id: "workspace-1", name: "Test Workspace", role: "owner" },
    project: {
      id: PROJECT_ID,
      name: "Test Project",
      summary: null,
      status: "active",
      planType: "corridor_study",
      deliveryPhase: "scoping",
      updatedAt: "2026-07-30T18:00:00.000Z",
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
    stageGateSummary,
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
  } as unknown as ProjectAssistantContext;
}

function holdLink(summary: ProjectStageGateSummary): AssistantQuickLink | undefined {
  return buildAssistantOperations(projectContext(summary)).find(
    (link) => link.executeAction?.kind === "record_stage_gate_hold"
  );
}

describe("the gate-hold offer is reachable from the project copilot", () => {
  it("appears for the board a project with an empty, readable decision log actually has", () => {
    // The only board that satisfies every other clause. If the offer is absent
    // here, it is absent for every planner: this IS the state the copilot is for.
    const summary = summaryFor([]);
    expect(summary.decisionsRead.readable).toBe(true);
    expect(summary.blockedGate).toBeNull();
    expect(summary.nextGate?.workflowState).toBe("not_started");

    const link = holdLink(summary);
    expect(link, "no quick link offers record_stage_gate_hold on a real undecided board").toBeDefined();
    expect(link?.approval).toBe("approval_required");

    const action = link?.executeAction as Extract<
      NonNullable<AssistantQuickLink["executeAction"]>,
      { kind: "record_stage_gate_hold" }
    >;
    expect(action.workspaceId).toBe("workspace-1");
    expect(action.projectId).toBe(PROJECT_ID);
    expect(action.gateId).toBe(summary.nextGate?.gateId);

    // What the hold names comes from the TEMPLATE's required evidence, which is
    // knowable with no decision recorded — not from `missingArtifacts`, which is
    // empty on exactly the gates this offer is for.
    expect(summary.nextGate?.missingArtifacts).toEqual([]);
    expect(action.missingArtifacts).toEqual(summary.nextGate?.requiredEvidenceIds);
    expect(action.missingArtifacts?.length).toBeGreaterThan(0);
    for (const evidenceId of action.missingArtifacts ?? []) {
      expect(action.rationale).toContain(evidenceId);
    }
    expect(action.rationale).toContain(summary.nextGate?.name as string);

    // Nothing in the payload can express a PASS.
    expect(Object.keys(action)).not.toContain("decision");
  });

  it("stays away when the decision log could not be read", () => {
    // `nextGate` is derived from the template as well as the log, so it survives
    // an unreadable log. Offering a hold there would be the agent recording a
    // verdict about a gate whose real state it could not see.
    const summary = summaryFor([], { decisionsUnavailable: { reason: "permission denied" } });
    expect(summary.nextGate).not.toBeNull();
    expect(holdLink(summary)).toBeUndefined();
  });

  it("stays away when a gate is already on hold", () => {
    const first = summaryFor([]).gates[0];
    const summary = summaryFor([decisionRow(first.gateId, "HOLD", ["G01_E01"])]);
    expect(summary.blockedGate).not.toBeNull();
    expect(holdLink(summary)).toBeUndefined();
  });

  it("stays away when every gate already has a recorded pass", () => {
    const gates = summaryFor([]).gates;
    const summary = summaryFor(gates.map((gate) => decisionRow(gate.gateId, "PASS")));
    expect(summary.nextGate).toBeNull();
    expect(holdLink(summary)).toBeUndefined();
  });
});

describe("the summary field this offer keys on", () => {
  it("distinguishes what a decider wrote down from what the template requires", () => {
    // The distinction that made the previous condition unsatisfiable. If these
    // ever collapse into one field, the offer's condition needs re-deriving.
    const undecided = summaryFor([]).gates[0];
    expect(undecided.missingArtifacts).toEqual([]);
    expect(undecided.requiredEvidenceIds.length).toBeGreaterThan(0);
    expect(undecided.requiredEvidenceIds).toHaveLength(undecided.requiredEvidenceCount);
  });
});
