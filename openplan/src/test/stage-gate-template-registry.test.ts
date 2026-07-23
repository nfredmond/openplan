import { describe, expect, it } from "vitest";
import {
  BUILT_IN_STAGE_GATE_TEMPLATE_REGISTRATIONS,
  createStageGateTemplateRegistry,
  stageGateTemplateRegistry,
  type StageGateTemplateRegistration,
} from "@/lib/stage-gates/template-registry";

/**
 * Minimal well-formed artifact for a jurisdiction OpenPlan does not ship, so the
 * registry is exercised with something other than the California pack.
 */
function fixtureArtifact(overrides: Record<string, unknown> = {}) {
  return {
    template_id: "oh_stage_gates_test",
    template_name: "Ohio Test Scaffold",
    version: "1.0.0",
    jurisdiction: "OH",
    gate_order: ["G01_TEST"],
    gates: [
      {
        gate_id: "G01_TEST",
        sequence: 1,
        name: "Test gate",
        required_evidence: [
          { evidence_id: "G01_E01", title: "Test evidence", artifact_type: "document", required: true },
        ],
      },
    ],
    ...overrides,
  };
}

const ohioRegistration: StageGateTemplateRegistration = {
  artifact: fixtureArtifact(),
  jurisdiction: { country: "US", subdivision: "OH", label: "Ohio, United States" },
};

describe("stage-gate template registry", () => {
  it("registers templates for more than one jurisdiction and resolves each by id", () => {
    const registry = createStageGateTemplateRegistry([
      ...BUILT_IN_STAGE_GATE_TEMPLATE_REGISTRATIONS,
      ohioRegistration,
    ]);

    expect(registry.list().map((descriptor) => descriptor.templateId)).toEqual([
      "ca_stage_gates_v0_1",
      "oh_stage_gates_test",
    ]);

    const ohio = registry.get("oh_stage_gates_test");
    expect(ohio?.descriptor.jurisdiction).toEqual({
      country: "US",
      subdivision: "OH",
      label: "Ohio, United States",
    });
    expect(ohio?.document.gate_order).toEqual(["G01_TEST"]);
    expect(ohio?.descriptor.isInterimDefault).toBe(false);
  });

  it("returns null rather than a substitute for an unregistered id", () => {
    expect(stageGateTemplateRegistry.get("not-a-template")).toBeNull();
  });

  it("keeps the shipped California pack registered exactly as authored", () => {
    const california = stageGateTemplateRegistry.get("ca_stage_gates_v0_1");

    expect(california?.descriptor.templateVersion).toBe("0.1.0");
    expect(california?.descriptor.jurisdictionCode).toBe("CA");
    expect(california?.descriptor.jurisdiction.country).toBe("US");
    expect(california?.document.gate_order).toHaveLength(9);
  });

  it("declares exactly one interim default among the built-ins", () => {
    const defaults = stageGateTemplateRegistry
      .list()
      .filter((descriptor) => descriptor.isInterimDefault);

    expect(defaults).toHaveLength(1);
    expect(stageGateTemplateRegistry.defaultTemplateId).toBe(defaults[0]?.templateId);
  });

  it("supports a registry with no default at all", () => {
    const registry = createStageGateTemplateRegistry([ohioRegistration]);

    expect(registry.defaultTemplateId).toBeNull();
  });

  it("rejects two templates claiming the interim default", () => {
    expect(() =>
      createStageGateTemplateRegistry([
        ...BUILT_IN_STAGE_GATE_TEMPLATE_REGISTRATIONS,
        { ...ohioRegistration, isInterimDefault: true },
      ])
    ).toThrow(/interim default/);
  });

  it("rejects duplicate template ids", () => {
    expect(() =>
      createStageGateTemplateRegistry([ohioRegistration, { ...ohioRegistration }])
    ).toThrow("Duplicate stage-gate template registration: oh_stage_gates_test");
  });

  it("rejects a descriptor whose jurisdiction contradicts the artifact", () => {
    expect(() =>
      createStageGateTemplateRegistry([
        {
          artifact: fixtureArtifact(),
          jurisdiction: { country: "US", subdivision: "TX", label: "Texas, United States" },
        },
      ])
    ).toThrow(/declares jurisdiction "OH" but was registered as "TX"/);
  });

  it("rejects artifacts missing required header or gate content", () => {
    expect(() =>
      createStageGateTemplateRegistry([{ ...ohioRegistration, artifact: fixtureArtifact({ version: "" }) }])
    ).toThrow("Stage-gate template artifact missing version");

    expect(() =>
      createStageGateTemplateRegistry([{ ...ohioRegistration, artifact: fixtureArtifact({ gates: [] }) }])
    ).toThrow("Stage-gate template oh_stage_gates_test missing gates");
  });
});
