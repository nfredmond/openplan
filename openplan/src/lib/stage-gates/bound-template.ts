/**
 * Which stage-gate template a surface may render a board under — resolved from
 * a workspace row and the error its read returned, in ONE place.
 *
 * WHY THIS IS SHARED RATHER THAN INLINE. Three surfaces need the same two
 * answers before they can show a gate board: the template this workspace is
 * BOUND to, and — when there is none — the sentence saying why not. The report
 * detail page and the assistant's project context each computed both inline,
 * with the same four-way ternary and the same wording, which is exactly the
 * shape this repo has shipped wrong before: a capability living inside one of
 * its callers gets reimplemented slightly differently by the next one, and the
 * two disagree about what "could not be established" means to a reader.
 *
 * WHAT IT REFUSES TO DO. It never falls back to the registry's default
 * template. A board rendered under a template nobody bound is wrong in a way
 * no reader can see: the workspace's own recorded decisions match none of that
 * template's gate ids, so a real gate history renders as "no decision
 * recorded" on every gate. `templateId: null` is the honest answer, and every
 * caller must handle it — by reporting the board unavailable (the pages) or by
 * refusing the write (the packet generator).
 *
 * THE TWO FAILURES ARE DIFFERENT FACTS and stay separate: a workspace row that
 * could not be READ, and a row naming a template this deployment does not
 * REGISTER. The first is an outage; the second is a binding a person has to
 * repair. Collapsing them would send a planner to fix the wrong thing.
 */

import {
  resolveWorkspaceStageGateBinding,
  type StageGateTemplateResolveOptions,
} from "@/lib/stage-gates/template-loader";

export type BoundStageGateTemplate = {
  /** The bound template's id, or null when no board may be rendered at all. */
  templateId: string | null;
  /**
   * Why there is no bound template, phrased for a planner and naming which of
   * the two failures happened. Null exactly when `templateId` is set.
   */
  unavailableReason: string | null;
  /**
   * Set only when the workspace names a template this deployment does not
   * register — the id it names, so a refusal can quote it back and a rebind
   * can be offered against it.
   */
  unregisteredTemplateId: string | null;
};

/**
 * @param workspaceRow the row read with `STAGE_GATE_BINDING_WORKSPACE_COLUMNS`
 * @param readError the error that read returned, or null — passing it is what
 *   separates "could not be read" from "read fine, nothing bound"; without it
 *   a failed read arrives as a null row and is indistinguishable from a
 *   workspace that has genuinely stated nothing.
 */
export function resolveBoundStageGateTemplate(
  workspaceRow: unknown,
  readError?: { message?: string | null } | null,
  options?: Omit<StageGateTemplateResolveOptions, "jurisdiction">
): BoundStageGateTemplate {
  if (readError) {
    return {
      templateId: null,
      unavailableReason: `the workspace row that names the bound stage-gate template could not be read: ${
        readError.message?.trim() || "no message reported"
      }`,
      unregisteredTemplateId: null,
    };
  }

  const resolution = resolveWorkspaceStageGateBinding(workspaceRow, options);

  if (resolution.kind === "resolved") {
    return {
      templateId: resolution.binding.templateId,
      unavailableReason: null,
      unregisteredTemplateId: null,
    };
  }

  if (resolution.kind === "unknown_template") {
    return {
      templateId: null,
      unavailableReason: `this workspace is bound to stage-gate template "${resolution.requestedTemplateId}", which this deployment does not register`,
      unregisteredTemplateId: resolution.requestedTemplateId,
    };
  }

  return {
    templateId: null,
    unavailableReason: "no stage-gate template is registered in this deployment",
    unregisteredTemplateId: null,
  };
}
