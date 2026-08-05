import { describe, expect, it } from "vitest";
import {
  BUILT_IN_STAGE_GATE_TEMPLATE_REGISTRATIONS,
  stageGateTemplateRegistry,
} from "@/lib/stage-gates/template-registry";

/**
 * Every registered stage-gate template must be internally coherent, walked from
 * the registry itself so a newly registered pack is covered the day it lands.
 *
 * WHY EACH RULE EXISTS — none is stylistic:
 *
 *   - `gate_order` and `gates` agreeing in BOTH directions: `gate_order` is
 *     what the board walks and `gates` is what a decision is validated against
 *     (gate-vocabulary.ts). A gate listed in one but not the other is either a
 *     board slot that can never render or a recordable decision no board shows.
 *   - sequence matching gate_order position: two orderings that disagree let
 *     two surfaces present the same project's gates in different orders.
 *   - evidence ids unique within a template: `stage_gate_decisions` evidence
 *     references and the report artifact custody address evidence BY ID; a
 *     duplicated id makes two requirements indistinguishable in the record.
 *   - every gate carrying at least one required evidence entry: a gate with
 *     nothing required would pass under ALL_REQUIRED_EVIDENCE_APPROVED with no
 *     evidence at all — a rubber stamp wearing a gate's name.
 *   - `decision_model` (when the artifact declares one) naming PASS and HOLD:
 *     those are the two verdicts the decisions API records; a template whose
 *     model omitted one would describe a process the product cannot execute.
 *
 * The decision_model check reads the RAW registration artifacts, because
 * `normalizeArtifact` deliberately carries only the fields the runtime uses and
 * decision_model is not among them.
 */
describe("every registered stage-gate template is internally coherent", () => {
  const descriptors = stageGateTemplateRegistry.list();

  it("has at least one registered template to check", () => {
    expect(descriptors.length).toBeGreaterThan(0);
  });

  for (const descriptor of descriptors) {
    describe(`${descriptor.templateId}`, () => {
      const entry = stageGateTemplateRegistry.get(descriptor.templateId);
      if (!entry) throw new Error(`listed template ${descriptor.templateId} did not resolve`);
      const { document } = entry;

      it("lists exactly the gates it defines, in both directions, with no duplicates", () => {
        const orderIds = document.gate_order;
        const gateIds = document.gates.map((gate) => gate.gate_id);

        expect(new Set(orderIds).size).toBe(orderIds.length);
        expect(new Set(gateIds).size).toBe(gateIds.length);
        // Same membership both ways — a set-equality assertion would pass on
        // reordered duplicates, so the duplicate checks above come first.
        expect([...orderIds].sort()).toEqual([...gateIds].sort());
      });

      it("declares each gate's sequence as its position in gate_order", () => {
        for (const [index, gateId] of document.gate_order.entries()) {
          const gate = document.gates.find((candidate) => candidate.gate_id === gateId);
          expect(gate, `gate ${gateId} missing from gates`).toBeDefined();
          expect(
            gate?.sequence,
            `gate ${gateId} sequence disagrees with its gate_order position`
          ).toBe(index + 1);
        }
      });

      it("uses each evidence id exactly once across the whole template", () => {
        const evidenceIds = document.gates.flatMap((gate) =>
          (gate.required_evidence ?? []).map((evidence) => evidence.evidence_id)
        );
        const duplicates = evidenceIds.filter((id, index) => evidenceIds.indexOf(id) !== index);
        expect(duplicates).toEqual([]);
      });

      it("requires at least one piece of evidence at every gate", () => {
        for (const gate of document.gates) {
          const required = (gate.required_evidence ?? []).filter(
            (evidence) => evidence.required === true
          );
          expect(
            required.length,
            `gate ${gate.gate_id} has no required evidence — it would pass with nothing`
          ).toBeGreaterThan(0);
        }
      });

      it("declares PASS and HOLD when it declares a decision model at all", () => {
        const registration = BUILT_IN_STAGE_GATE_TEMPLATE_REGISTRATIONS.find((candidate) => {
          const artifact = candidate.artifact as Record<string, unknown> | null;
          return artifact?.template_id === descriptor.templateId;
        });
        expect(
          registration,
          `registered template ${descriptor.templateId} has no built-in registration to read decision_model from`
        ).toBeDefined();

        const decisionModel = (registration?.artifact as Record<string, unknown>)
          .decision_model as { decision_states?: unknown } | undefined;
        if (decisionModel === undefined) return; // genuinely optional

        expect(Array.isArray(decisionModel.decision_states)).toBe(true);
        expect(decisionModel.decision_states).toContain("PASS");
        expect(decisionModel.decision_states).toContain("HOLD");
      });
    });
  }
});
