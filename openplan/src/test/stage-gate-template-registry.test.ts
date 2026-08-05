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
      "us_federal_aid_stage_gates_v0_1",
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
    // No longer the interim default — CA workspaces reach it by subdivision
    // match; the nationwide federal-aid floor carries the default now.
    expect(california?.descriptor.isInterimDefault).toBe(false);
    // Caltrans-specific declaration survives the default flip.
    expect(california?.descriptor.lapmFormIdsStatus).toBe("deferred_to_v0_2");
  });

  it("registers the US federal-aid floor exactly as authored, with its scope disclosures", () => {
    const federal = stageGateTemplateRegistry.get("us_federal_aid_stage_gates_v0_1");

    expect(federal?.descriptor.templateVersion).toBe("0.1.0");
    expect(federal?.descriptor.jurisdictionCode).toBe("US");
    expect(federal?.descriptor.jurisdiction).toEqual({
      country: "US",
      label: "United States — federal-aid floor",
    });
    expect(federal?.document.gate_order).toHaveLength(8);
    // A nationwide template must not declare the status of a California form
    // set — that mistake is the reason lapmFormIdsStatus lives per-template.
    expect(federal?.descriptor.lapmFormIdsStatus).toBeUndefined();
    // The artifact's self-description and scope disclosures ride the descriptor
    // so every picker surface can render them.
    expect(federal?.descriptor.templateDescription).toContain("2 CFR 200");
    expect(federal?.descriptor.scopeNotes).toHaveLength(3);
  });

  it("declares exactly one interim default among the built-ins — the nationwide floor", () => {
    const defaults = stageGateTemplateRegistry
      .list()
      .filter((descriptor) => descriptor.isInterimDefault);

    expect(defaults).toHaveLength(1);
    expect(stageGateTemplateRegistry.defaultTemplateId).toBe(defaults[0]?.templateId);
    // Pinned: a workspace that has stated nothing gets the gates true anywhere
    // in the US, never one state's manual.
    expect(stageGateTemplateRegistry.defaultTemplateId).toBe("us_federal_aid_stage_gates_v0_1");
  });

  it("resolves jurisdiction queries at the most specific registered tier", () => {
    // A subdivision with its own pack wins over the nationwide floor.
    const california = stageGateTemplateRegistry.findByJurisdiction({
      country: "US",
      subdivision: "CA",
    });
    expect(california.kind).toBe("matched");
    if (california.kind === "matched") {
      expect(california.entry.descriptor.templateId).toBe("ca_stage_gates_v0_1");
    }

    // A subdivision with no pack of its own is covered by the nationwide floor
    // — a real match, not a fallback, because the floor is true there.
    const texas = stageGateTemplateRegistry.findByJurisdiction({
      country: "US",
      subdivision: "TX",
    });
    expect(texas.kind).toBe("matched");
    if (texas.kind === "matched") {
      expect(texas.entry.descriptor.templateId).toBe("us_federal_aid_stage_gates_v0_1");
    }

    // Country-only: still the nationwide floor.
    const countryOnly = stageGateTemplateRegistry.findByJurisdiction({ country: "US" });
    expect(countryOnly.kind).toBe("matched");
    if (countryOnly.kind === "matched") {
      expect(countryOnly.entry.descriptor.templateId).toBe("us_federal_aid_stage_gates_v0_1");
    }

    // Another country: no template, stated as such — never a substitution.
    expect(stageGateTemplateRegistry.findByJurisdiction({ country: "NZ" }).kind).toBe(
      "no_template"
    );
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

  it("rejects malformed self-description or scope disclosures rather than dropping them", () => {
    // Both fields are optional — but a template that TRIED to carry an honesty
    // disclosure and failed must not register looking as if it never had one.
    expect(() =>
      createStageGateTemplateRegistry([
        { ...ohioRegistration, artifact: fixtureArtifact({ description: 42 }) },
      ])
    ).toThrow("Stage-gate template oh_stage_gates_test description must be a string");

    expect(() =>
      createStageGateTemplateRegistry([
        { ...ohioRegistration, artifact: fixtureArtifact({ scope_notes: "one note, not a list" }) },
      ])
    ).toThrow("Stage-gate template oh_stage_gates_test scope_notes must be an array of strings");

    expect(() =>
      createStageGateTemplateRegistry([
        { ...ohioRegistration, artifact: fixtureArtifact({ scope_notes: ["fine", 7] }) },
      ])
    ).toThrow("Stage-gate template oh_stage_gates_test scope_notes must be an array of strings");
  });
});
