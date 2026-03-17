import { describe, expect, it } from "vitest";
import { buildProjectStageGateSummary } from "@/lib/stage-gates/summary";

describe("buildProjectStageGateSummary", () => {
  it("uses the latest decision per gate and exposes next/blocked workflow cues", () => {
    const summary = buildProjectStageGateSummary([
      {
        gate_id: "G01_INITIATION_AUTHORIZATION",
        decision: "PASS",
        rationale: "Charter and authorization packet complete.",
        decided_at: "2026-03-17T20:00:00.000Z",
        missing_artifacts: [],
      },
      {
        gate_id: "G02_AGREEMENTS_PROCUREMENT_CIVIL_RIGHTS",
        decision: "HOLD",
        rationale: "Civil rights plan is still missing.",
        decided_at: "2026-03-17T21:00:00.000Z",
        missing_artifacts: ["G02_E03"],
      },
      {
        gate_id: "G02_AGREEMENTS_PROCUREMENT_CIVIL_RIGHTS",
        decision: "PASS",
        rationale: "Older decision should be ignored.",
        decided_at: "2026-03-16T21:00:00.000Z",
        missing_artifacts: [],
      },
    ]);

    expect(summary.templateId).toBe("ca_stage_gates_v0_1");
    expect(summary.totalGateCount).toBe(9);
    expect(summary.passCount).toBe(1);
    expect(summary.holdCount).toBe(1);
    expect(summary.notStartedCount).toBe(7);
    expect(summary.blockedGate?.gateId).toBe("G02_AGREEMENTS_PROCUREMENT_CIVIL_RIGHTS");
    expect(summary.blockedGate?.missingArtifacts).toEqual(["G02_E03"]);
    expect(summary.nextGate?.gateId).toBe("G02_AGREEMENTS_PROCUREMENT_CIVIL_RIGHTS");

    const gateTwo = summary.gates.find((gate) => gate.gateId === "G02_AGREEMENTS_PROCUREMENT_CIVIL_RIGHTS");
    expect(gateTwo?.workflowState).toBe("hold");
    expect(gateTwo?.rationale).toBe("Civil rights plan is still missing.");
    expect(gateTwo?.requiredEvidenceCount).toBeGreaterThan(0);
  });

  it("marks untouched gates as not started", () => {
    const summary = buildProjectStageGateSummary([]);

    expect(summary.passCount).toBe(0);
    expect(summary.holdCount).toBe(0);
    expect(summary.notStartedCount).toBe(summary.totalGateCount);
    expect(summary.nextGate?.workflowState).toBe("not_started");
  });
});
