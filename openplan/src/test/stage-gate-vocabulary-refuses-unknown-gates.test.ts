import { describe, expect, it } from "vitest";
import {
  describeOffVocabularyGate,
  lookupStageGateInTemplate,
} from "@/lib/stage-gates/gate-vocabulary";
import { createStageGateTemplateRegistry } from "@/lib/stage-gates/template-registry";

/**
 * The check that stops the decision log filling with rows nobody can read.
 *
 * Every row this table held before 20260728000011 carried
 * `gate_id: "report_artifact_gate"` — a value in no template's gate order — so
 * the nine-gate cockpit read as "nothing decided" while the log was full. The
 * board was not empty; what was in it was off-vocabulary.
 */
describe("a gate id is only accepted inside the template that defines it", () => {
  const CA_TEMPLATE_ID = "ca_stage_gates_v0_1";

  it("resolves a real gate together with the template it came from", () => {
    const lookup = lookupStageGateInTemplate(CA_TEMPLATE_ID, "G01_INITIATION_AUTHORIZATION");

    expect(lookup.kind).toBe("gate");
    if (lookup.kind !== "gate") return;
    expect(lookup.gate.sequence).toBe(1);
    expect(lookup.templateId).toBe(CA_TEMPLATE_ID);
    expect(lookup.templateVersion).toBeTruthy();
  });

  it("rejects the gate id the report-export path used to write", () => {
    const lookup = lookupStageGateInTemplate(CA_TEMPLATE_ID, "report_artifact_gate");

    expect(lookup.kind).toBe("off_vocabulary");
    if (lookup.kind !== "off_vocabulary") return;
    expect(lookup.knownGateIds).toContain("G09_COMPLETION_MAINTENANCE_AUDIT");
    expect(describeOffVocabularyGate(lookup)).toContain("would never appear on any gate board");
  });

  it("reports an unregistered template as its own outcome, never as a missing gate", () => {
    // The two failures need different words: one is a binding/deployment
    // problem, the other is a caller problem whose refusal can list the gates.
    const lookup = lookupStageGateInTemplate("oh_stage_gates_v1", "G01_INITIATION_AUTHORIZATION");

    expect(lookup.kind).toBe("unknown_template");
  });

  it("does not accept a gate the template defines but leaves out of its order", () => {
    // gate_order is the template's statement of its own sequence. A gate outside
    // it has no row on the board, so a decision against it would be invisible.
    const registry = createStageGateTemplateRegistry([
      {
        artifact: {
          template_id: "test_pack_v1",
          template_name: "Test pack",
          version: "1.0.0",
          jurisdiction: "ZZ",
          gate_order: ["T01"],
          gates: [
            { gate_id: "T01", sequence: 1, name: "First" },
            { gate_id: "T99", sequence: 99, name: "Orphaned, not in gate_order" },
          ],
        },
        jurisdiction: { country: "ZZ", label: "Test country" },
      },
    ]);

    expect(lookupStageGateInTemplate("test_pack_v1", "T01", registry).kind).toBe("gate");
    expect(lookupStageGateInTemplate("test_pack_v1", "T99", registry).kind).toBe("off_vocabulary");
  });

  it("never substitutes another jurisdiction's template for an unresolvable one", () => {
    // The registry's own doctrine, re-asserted at this seam: an unresolved
    // template is an answer the caller must handle, not a reason to fall back.
    const empty = createStageGateTemplateRegistry([]);
    const lookup = lookupStageGateInTemplate("ca_stage_gates_v0_1", "G01_INITIATION_AUTHORIZATION", empty);

    expect(lookup.kind).toBe("unknown_template");
  });
});
