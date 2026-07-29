/**
 * Is this gate id one of the gates the bound template actually defines?
 *
 * THE DEFECT THIS EXISTS FOR. Until now the only thing that ever wrote to
 * `stage_gate_decisions` was the report-export route, and it wrote
 * `gate_id: "report_artifact_gate"` — a string that appears in NO registered
 * template's `gate_order`. Every reader passes rows through
 * `buildProjectStageGateSummary`, which matches gate ids against the template,
 * so those rows were silently discarded and the cockpit showed nine gates with
 * no decisions. The board was not empty because nothing had been recorded; it
 * was empty because what had been recorded was off-vocabulary, and nothing on
 * screen could tell the two apart.
 *
 * A gate id is only meaningful inside one template. `G03_ENVIRONMENTAL_CEQA_VMT_METHOD`
 * means something under the California pack and nothing at all under a pack that
 * has not been authored yet. So a write path that accepts a free-text gate id
 * and stores it is a write path that manufactures rows nobody can interpret —
 * which is how this table ended up with a hundred percent of its contents
 * unreadable by every one of its readers.
 *
 * This module is the check that stops it happening again, in the one place both
 * the API and the board can call. It resolves against the registry rather than
 * against a list, so registering a jurisdiction's pack is still a data change.
 */

import {
  stageGateTemplateRegistry,
  type StageGateTemplateDescriptor,
  type StageGateTemplateGate,
  type StageGateTemplateRegistry,
} from "@/lib/stage-gates/template-registry";

export type StageGateVocabularyLookup =
  | {
      kind: "gate";
      templateId: string;
      templateName: string;
      templateVersion: string;
      gate: StageGateTemplateGate;
    }
  | {
      kind: "unknown_template";
      templateId: string;
      available: readonly StageGateTemplateDescriptor[];
    }
  | {
      kind: "off_vocabulary";
      templateId: string;
      gateId: string;
      /** Every gate the template DOES define, in its own order, so a refusal can list them. */
      knownGateIds: readonly string[];
    };

/**
 * Resolve a gate id inside a template.
 *
 * Three outcomes rather than a nullable gate, because the two failures need
 * different words: "this deployment does not register that template" is an
 * operator/binding problem, and "that template has no such gate" is a caller
 * problem whose refusal should list what the template does have.
 *
 * A gate present in `gates` but absent from `gate_order` is NOT a gate. The
 * order is the template's statement of its own sequence; a gate outside it has
 * no place on the board and would render as a decision on a gate nobody can see.
 */
export function lookupStageGateInTemplate(
  templateId: string,
  gateId: string,
  registry: StageGateTemplateRegistry = stageGateTemplateRegistry
): StageGateVocabularyLookup {
  const normalizedTemplateId = templateId.trim();
  const entry = normalizedTemplateId ? registry.get(normalizedTemplateId) : null;

  if (!entry) {
    return {
      kind: "unknown_template",
      templateId: normalizedTemplateId,
      available: registry.list(),
    };
  }

  const template = entry.document;
  const knownGateIds = template.gate_order.filter((orderedGateId) =>
    template.gates.some((gate) => gate.gate_id === orderedGateId)
  );

  const normalizedGateId = gateId.trim();
  const gate = knownGateIds.includes(normalizedGateId)
    ? template.gates.find((candidate) => candidate.gate_id === normalizedGateId)
    : undefined;

  if (!gate) {
    return {
      kind: "off_vocabulary",
      templateId: template.template_id,
      gateId: normalizedGateId,
      knownGateIds,
    };
  }

  return {
    kind: "gate",
    templateId: template.template_id,
    templateName: entry.descriptor.templateName,
    templateVersion: template.version,
    gate,
  };
}

/**
 * The sentence a caller sees when its gate id is not one of the template's.
 *
 * Written here rather than at the route so the API refusal and any future UI
 * refusal say the same thing, and so the reason names the TEMPLATE — a planner
 * who mistypes a gate id and a planner whose workspace is bound to the wrong
 * jurisdiction's pack both land here, and only the template name separates them.
 */
export function describeOffVocabularyGate(lookup: {
  templateId: string;
  gateId: string;
  knownGateIds: readonly string[];
}): string {
  return (
    `"${lookup.gateId}" is not a gate in the ${lookup.templateId} stage-gate template, ` +
    `so a decision recorded against it would never appear on any gate board. ` +
    `That template defines: ${lookup.knownGateIds.join(", ")}.`
  );
}
