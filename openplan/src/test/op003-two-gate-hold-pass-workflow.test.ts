import { describe, expect, it } from "vitest";
import caStageGatesTemplate from "@/lib/stage-gates/templates/ca_stage_gates_v0.1.json";

type Decision = "PASS" | "HOLD";

type EvidenceState = "missing" | "uploaded" | "approved" | "rejected";

type GateEvidence = {
  evidence_id: string;
  required?: boolean;
};

type GateDefinition = {
  gate_id: string;
  required_evidence: GateEvidence[];
};

type StageGateTemplate = {
  decision_model: {
    decision_states: Decision[];
    advance_rule: string;
  };
  gate_order: string[];
  gates: GateDefinition[];
};

type GateDecisionResult = {
  decision: Decision;
  missingEvidence: string[];
};

const template = caStageGatesTemplate as StageGateTemplate;

function evaluateGate(gateId: string, evidenceStateById: Record<string, EvidenceState>): GateDecisionResult {
  const gate = template.gates.find((item) => item.gate_id === gateId);
  if (!gate) {
    throw new Error(`Unknown gate: ${gateId}`);
  }

  const missingEvidence = gate.required_evidence
    .filter((item) => item.required !== false)
    .filter((item) => evidenceStateById[item.evidence_id] !== "approved")
    .map((item) => item.evidence_id);

  return {
    decision: missingEvidence.length === 0 ? "PASS" : "HOLD",
    missingEvidence,
  };
}

function approveAllRequiredEvidence(gateId: string, evidenceStateById: Record<string, EvidenceState>) {
  const gate = template.gates.find((item) => item.gate_id === gateId);
  if (!gate) {
    throw new Error(`Unknown gate: ${gateId}`);
  }

  for (const evidence of gate.required_evidence) {
    if (evidence.required === false) {
      continue;
    }
    evidenceStateById[evidence.evidence_id] = "approved";
  }
}

describe("OP-003 stage-gate workflow proof: two-gate HOLD -> PASS", () => {
  it("forces HOLD on missing evidence, then transitions each gate to PASS after approval", () => {
    expect(template.decision_model.decision_states).toEqual(expect.arrayContaining(["PASS", "HOLD"]));
    expect(template.decision_model.advance_rule).toBe("ALL_REQUIRED_EVIDENCE_APPROVED");

    const [gateOneId, gateTwoId] = template.gate_order;
    expect(gateOneId).toBeDefined();
    expect(gateTwoId).toBeDefined();

    const evidenceStateById: Record<string, EvidenceState> = {};

    const gateOneHold = evaluateGate(gateOneId, evidenceStateById);
    expect(gateOneHold.decision).toBe("HOLD");
    expect(gateOneHold.missingEvidence.length).toBeGreaterThan(0);

    approveAllRequiredEvidence(gateOneId, evidenceStateById);

    const gateOnePass = evaluateGate(gateOneId, evidenceStateById);
    expect(gateOnePass).toEqual({
      decision: "PASS",
      missingEvidence: [],
    });

    const gateTwoHold = evaluateGate(gateTwoId, evidenceStateById);
    expect(gateTwoHold.decision).toBe("HOLD");
    expect(gateTwoHold.missingEvidence.length).toBeGreaterThan(0);

    approveAllRequiredEvidence(gateTwoId, evidenceStateById);

    const gateTwoPass = evaluateGate(gateTwoId, evidenceStateById);
    expect(gateTwoPass).toEqual({
      decision: "PASS",
      missingEvidence: [],
    });
  });
});
