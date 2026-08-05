/**
 * What an operator needs to see BEFORE re-binding a workspace to a different
 * stage-gate template — and what such a rebind does and does not touch.
 *
 * WHY THIS EXISTS
 *   `listStageGateTemplates()` shipped in `template-loader.ts` described as "the
 *   source for a jurisdiction picker" and then had no caller for months: there
 *   was no picker. Meanwhile `describeStageGateBinding()` was already telling
 *   planners, in the product, to "Rebind this workspace to the template
 *   registered for US-OH" — an instruction naming an action no surface offered.
 *   This module is the read side of that missing surface; it does not write.
 *
 * THE ONE FACT A REBIND MUST NOT OBSCURE
 *   `stage_gate_decisions` rows are keyed by `gate_id`, and
 *   `buildProjectStageGateSummary` renders a board by walking the BOUND
 *   template's `gate_order` and looking each gate's latest decision up by that
 *   id. So re-binding never edits, re-maps, or deletes a decision — a stage-gate
 *   decision is a signed verdict a funder relies on and nothing here may rewrite
 *   one. What it does do is change which decisions are VISIBLE: a decision
 *   recorded against a gate the new template does not define stays exactly as
 *   recorded in the database and stops appearing on any project board while that
 *   template is bound. That is a disclosure, not a side effect to be discovered,
 *   so `gatesLeaving` names those gates explicitly and the operator confirms
 *   against the list.
 *
 * WHAT IS DELIBERATELY NOT COMPUTED HERE
 *   How many decisions have actually been recorded against the departing gates.
 *   That needs a per-workspace query over `stage_gate_decisions`, and a windowed
 *   count would be a floor presented as a total. The structural statement above
 *   is exact, needs no read, and cannot go stale; a later change that wants the
 *   count should read it deliberately and label it as a count.
 */

import {
  describeStageGateBinding,
  listStageGateTemplates,
  resolveWorkspaceStageGateBinding,
  type StageGateBindingDisclosure,
  type StageGateTemplateBinding,
} from "@/lib/stage-gates/template-loader";
import {
  stageGateTemplateRegistry,
  type StageGateJurisdictionQuery,
  type StageGateTemplateRegistry,
} from "@/lib/stage-gates/template-registry";
import {
  HOME_GEOGRAPHY_SCOPE_COLUMNS,
  parseWorkspaceHomeGeography,
  resolveJurisdiction,
} from "@/lib/workspaces/home-geography";

/**
 * The projection any surface must ask for before resolving a stage-gate
 * binding. Retyping it is how this goes wrong, so it is stated once.
 *
 * TWO COLUMNS ARE EASY TO LOSE AND BOTH CHANGE THE ANSWER.
 *
 *   `stage_gate_template_id` is the binding OF RECORD. Without it the
 *   reconciliation falls back to geography alone, and a workspace deliberately
 *   bound to another jurisdiction's pack renders as if it had never chosen.
 *
 *   `home_subdivision_code` is NOT in `HOME_GEOGRAPHY_SCOPE_COLUMNS` — that set
 *   is deliberately narrowed for map-layer routes, which need a place ref and
 *   not a state. Resolving a binding without it makes every California workspace
 *   look like a country-level "US" one, so the registry finds no subdivision pack
 *   and the panel announces "OpenPlan has no template for US yet" to an agency
 *   whose pack is sitting right there. The decisions route already selects it for
 *   exactly this reason.
 */
export const STAGE_GATE_BINDING_WORKSPACE_COLUMNS = `stage_gate_template_id, home_subdivision_code, ${HOME_GEOGRAPHY_SCOPE_COLUMNS}`;

export type StageGateGateRef = {
  gateId: string;
  name: string;
};

export type StageGateRebindOption = {
  templateId: string;
  templateName: string;
  templateVersion: string;
  jurisdictionLabel: string;
  /** The template's own description of itself, when the artifact carries one. */
  templateDescription?: string;
  /**
   * The template's own scope disclosures — what it does NOT cover — when the
   * artifact carries them. Rendered wherever a planner picks, because the
   * limits are part of what is being picked.
   */
  scopeNotes?: readonly string[];
  /** The template applied when nothing has chosen one. Shown, never hidden. */
  isInterimDefault: boolean;
  /**
   * True when the registry says this pack covers the workspace's own stated
   * jurisdiction. This is the recommendation signal — it is derived from the
   * registry's `findByJurisdiction`, never from a hardcoded place.
   */
  coversWorkspaceJurisdiction: boolean;
  /**
   * Gates the workspace's CURRENT template defines that this one does not.
   * Decisions recorded against them stay in the database untouched and stop
   * rendering on project boards.
   *
   * `null` — not `[]` — when the currently bound template is not registered in
   * this deployment, because then what would leave the board CANNOT BE
   * DETERMINED. "Could not be determined" and "nothing leaves" are different
   * facts and must not be collapsed.
   */
  gatesLeaving: readonly StageGateGateRef[] | null;
  /** Gates this template defines that the current one does not. */
  gatesArriving: readonly StageGateGateRef[] | null;
};

export type StageGateRebindChoices =
  | {
      kind: "bound";
      binding: StageGateTemplateBinding;
      /** The sentence the planner must be shown about the CURRENT binding. */
      disclosure: StageGateBindingDisclosure;
      currentGateCount: number;
      /** Every registered template EXCEPT the one already bound. */
      options: readonly StageGateRebindOption[];
      registeredTemplateCount: number;
    }
  | {
      /**
       * The workspace names a template this deployment does not register. Its
       * boards cannot render at all, so rebinding is the repair — and every
       * registered template is offered, with the departing-gate list marked
       * undeterminable rather than empty.
       */
      kind: "unknown_template";
      boundTemplateId: string;
      options: readonly StageGateRebindOption[];
      registeredTemplateCount: number;
    }
  | {
      /** No template registered at all: there is nothing to bind to. */
      kind: "no_template_registered";
    }
  | {
      /**
       * The workspace row could not be READ, so which template is bound is
       * unknown.
       *
       * This is not the same fact as "nothing is bound", and collapsing the two
       * is the exact defect this repo keeps shipping. A null row resolves
       * through `resolveWorkspaceStageGateBinding` to the interim default with
       * the reason `no_workspace_jurisdiction`, whose disclosure reads "This
       * workspace has not stated where it works" and asks the planner to set a
       * home geography they may already have set. A broken query cannot make
       * that claim.
       *
       * It also disables the picker deliberately, and that is not
       * over-restriction: every gate list in the review step is a DIFF against
       * the currently bound template, so with the current binding unknown there
       * is no effect to state, and the route refuses the write for the same
       * reason (it re-reads the binding and returns 500 rather than applying a
       * change nobody could have reviewed). Offering a control whose stated
       * effect is fabricated would be worse than saying the read failed.
       */
      kind: "unreadable";
      /**
       * The database's own reason, or null when the caller had none. The
       * dashboard is an internal page, so an operator may see it; a public
       * surface reusing this must show only THAT the read failed.
       */
      readErrorMessage: string | null;
    };

function gateRefs(
  registry: StageGateTemplateRegistry,
  templateId: string
): readonly StageGateGateRef[] | null {
  const entry = registry.get(templateId);
  if (!entry) return null;
  return entry.document.gate_order
    .map((gateId) => entry.document.gates.find((gate) => gate.gate_id === gateId))
    .filter((gate): gate is NonNullable<typeof gate> => Boolean(gate))
    .map((gate) => ({ gateId: gate.gate_id, name: gate.name }));
}

function difference(
  from: readonly StageGateGateRef[] | null,
  against: readonly StageGateGateRef[] | null
): readonly StageGateGateRef[] | null {
  if (!from || !against) return null;
  const present = new Set(against.map((gate) => gate.gateId));
  return from.filter((gate) => !present.has(gate.gateId));
}

/**
 * Which templates this workspace could be bound to, and what each change would
 * mean, resolved from the workspace ROW so the answer reconciles the stored
 * template id against the workspace's own geography exactly as every other
 * reader does.
 *
 * The registry is a parameter for the same reason it is one on
 * `listStageGateTemplates`: a second jurisdiction pack must arrive as a
 * registration, never as an edit here.
 */
export function buildStageGateRebindChoices(
  workspaceRow: unknown,
  options?: {
    registry?: StageGateTemplateRegistry;
    /**
     * The error the caller's own read returned, if it returned one. Passing it
     * is what separates "could not be read" from "not recorded" — without it a
     * failed read arrives here as a null row and is indistinguishable from a
     * workspace that has genuinely stated nothing.
     */
    readError?: { message?: string | null } | null;
  }
): StageGateRebindChoices {
  const registry = options?.registry ?? stageGateTemplateRegistry;

  if (options?.readError) {
    // Reported BEFORE the registry is consulted: which templates exist is a
    // fact about the deployment, but which one is BOUND is a fact about this
    // workspace, and that is the one that could not be established.
    return {
      kind: "unreadable",
      readErrorMessage:
        typeof options.readError.message === "string" && options.readError.message.trim()
          ? options.readError.message
          : null,
    };
  }

  const descriptors = listStageGateTemplates(registry);

  if (descriptors.length === 0) {
    return { kind: "no_template_registered" };
  }

  const resolution = resolveWorkspaceStageGateBinding(workspaceRow, { registry });
  const jurisdiction: StageGateJurisdictionQuery | null = resolveJurisdiction(
    parseWorkspaceHomeGeography(workspaceRow)
  );

  const covering = jurisdiction ? registry.findByJurisdiction(jurisdiction) : { kind: "no_template" as const };
  const coveringIds = new Set<string>(
    covering.kind === "matched"
      ? [covering.entry.descriptor.templateId]
      : covering.kind === "ambiguous"
        ? covering.entries.map((entry) => entry.descriptor.templateId)
        : []
  );

  const boundTemplateId =
    resolution.kind === "resolved"
      ? resolution.binding.templateId
      : resolution.kind === "unknown_template"
        ? resolution.requestedTemplateId
        : null;

  // `null` when the bound template is not registered — every diff below then
  // reports "undeterminable" rather than a confident empty list.
  const currentGates = boundTemplateId ? gateRefs(registry, boundTemplateId) : null;

  const rebindOptions: StageGateRebindOption[] = descriptors
    .filter((descriptor) => descriptor.templateId !== boundTemplateId)
    .map((descriptor) => {
      const targetGates = gateRefs(registry, descriptor.templateId);
      return {
        templateId: descriptor.templateId,
        templateName: descriptor.templateName,
        templateVersion: descriptor.templateVersion,
        jurisdictionLabel: descriptor.jurisdiction.label,
        ...(descriptor.templateDescription
          ? { templateDescription: descriptor.templateDescription }
          : {}),
        ...(descriptor.scopeNotes && descriptor.scopeNotes.length > 0
          ? { scopeNotes: descriptor.scopeNotes }
          : {}),
        isInterimDefault: descriptor.isInterimDefault,
        coversWorkspaceJurisdiction: coveringIds.has(descriptor.templateId),
        gatesLeaving: difference(currentGates, targetGates),
        gatesArriving: difference(targetGates, currentGates),
      };
    })
    // A pack authored for this workspace's own jurisdiction is the one it most
    // likely wants; the order is a presentation aid, and every option stays
    // listed either way.
    .sort((a, b) => Number(b.coversWorkspaceJurisdiction) - Number(a.coversWorkspaceJurisdiction));

  if (resolution.kind === "unknown_template") {
    return {
      kind: "unknown_template",
      boundTemplateId: resolution.requestedTemplateId,
      options: rebindOptions,
      registeredTemplateCount: descriptors.length,
    };
  }

  if (resolution.kind === "no_default_template") {
    // Reachable when the registry has templates but declares no interim default
    // and the workspace matched none of them. There is something to bind to, so
    // this is not `no_template_registered`; it is an unbound workspace.
    return {
      kind: "unknown_template",
      boundTemplateId: "",
      options: rebindOptions,
      registeredTemplateCount: descriptors.length,
    };
  }

  return {
    kind: "bound",
    binding: resolution.binding,
    disclosure: describeStageGateBinding(resolution.binding),
    currentGateCount: currentGates?.length ?? 0,
    options: rebindOptions,
    registeredTemplateCount: descriptors.length,
  };
}

/**
 * The sentence every rebind confirmation carries, in one place so the panel and
 * any future surface state the same guarantee. It is a statement about the
 * database, and it is true because nothing in the rebind path touches
 * `stage_gate_decisions`.
 */
export const STAGE_GATE_REBIND_DECISION_INVARIANT =
  "Recorded gate decisions are never edited, re-mapped, or deleted by a rebind. Each one stays exactly as it was signed. A decision recorded against a gate the new template does not define stays in the record but stops appearing on project gate boards while that template is bound.";
