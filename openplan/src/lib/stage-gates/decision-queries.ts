/**
 * The read side of the stage-gate cockpit — kept out of the project page so the
 * page stays a composition layer, in the same shape as
 * `src/lib/projects/budget-queries.ts` and `src/lib/aerial/queries.ts`.
 *
 * TWO THINGS THIS SEAM EXISTS TO GET RIGHT, both of which the inline read in the
 * page got wrong:
 *
 *   1. SCOPE. `stage_gate_decisions` gained `project_id` in 20260728000011. The
 *      read it replaced filtered on `workspace_id` alone, so a decision recorded
 *      while looking at one project rendered, identically, on every other
 *      project's board. That read as correct for exactly as long as a workspace
 *      had one project. Every reader of this table that presents a PROJECT'S
 *      board now scopes the same way — this loader, the assistant's project
 *      context, the report detail page and the packet generator — and
 *      `buildProjectStageGateSummary` refuses an unscoped decision set outright
 *      rather than leaving that a convention.
 *
 *   2. READ FAILURE. The page destructured only `data`, so a failed query and an
 *      empty log were the same value — and the board's empty-state copy, written
 *      for the second, stated the first as a compliance finding. The error is
 *      carried through to `decisionsUnavailable` here so the board can say "not
 *      readable" instead of "no decision recorded". See `src/lib/ui/read-failures.ts`
 *      for the general form of this rule.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildProjectStageGateSummary,
  type ProjectStageGateSummary,
  type StageGateDecisionRow,
} from "@/lib/stage-gates/summary";

export type StageGateDecisionQuerySupabaseLike = Pick<SupabaseClient, "from">;

/** Columns the board and the project timeline both read. */
export const PROJECT_STAGE_GATE_DECISION_COLUMNS =
  "id, project_id, gate_id, decision, rationale, decided_at, missing_artifacts";

/**
 * Whether a failed decision read is the pending-migration case.
 *
 * `project_id` arrived in 20260728000011, and code deploys ahead of migrations.
 * In that window the scoped read above fails, which is the right outcome — an
 * unscoped fallback would put another project's verdict on this board — but the
 * caller can then say WHICH migration is missing instead of reporting a generic
 * outage. `src/lib/ui/read-failures.ts` states the rule this follows: classify
 * first, collect what is left.
 *
 * Deliberately narrow. A permission failure or a policy change is NOT this, and
 * must keep reaching the generic "could not be read" path rather than telling an
 * operator to apply a migration that is already applied.
 */
export function looksLikePendingStageGateProjectScope(
  message: string | null | undefined
): boolean {
  return /column .* does not exist|could not find the .* column|schema cache/i.test(message ?? "");
}

/**
 * How many decisions one board reads.
 *
 * The board keeps the LATEST decision per gate, so the window only has to be
 * deep enough to contain one decision for each gate of the bound template plus
 * the history above them. It is per-project now; when the same 200 covered a
 * whole workspace, a busy workspace could push a project's only decisions out of
 * the window and silently revert every gate to "no decision recorded".
 */
const DEFAULT_DECISION_WINDOW = 200;

/**
 * A decision row as this loader reads it. `id` is carried on top of the summary
 * builder's shape because the project timeline keys its entries by it — the
 * builder itself has no use for an id and deliberately does not require one.
 */
export type ProjectStageGateDecisionRow = StageGateDecisionRow & { id: string };

export type ProjectStageGateBoardData = {
  /** Rows as read, for surfaces that need the decisions themselves (the timeline). */
  decisions: ProjectStageGateDecisionRow[];
  summary: ProjectStageGateSummary;
};

export async function loadProjectStageGateBoard(
  supabase: StageGateDecisionQuerySupabaseLike,
  input: {
    workspaceId: string;
    projectId: string;
    /**
     * The template the workspace is BOUND to. REQUIRED: the caller states which
     * template this board renders under, resolved from the workspace row via
     * `resolveWorkspaceStageGateBinding` — the loader does not guess, and there
     * is no registry-default fallback (that fallback is how a second registered
     * template made three surfaces render the default's gate vocabulary over a
     * differently-bound workspace's decisions).
     *
     * `null` is the caller saying "I resolved the binding and it did not
     * resolve" — the workspace names a template this deployment does not
     * register. The loader refuses rather than substituting any other
     * template, because the board it would build is wrong in a way no reader
     * can see. Callers that can degrade should not call the loader in that
     * case; they should report the board unavailable.
     */
    templateId: string | null;
    limit?: number;
  }
): Promise<ProjectStageGateBoardData> {
  const templateId = input.templateId?.trim();
  if (!templateId) {
    throw new Error(
      "Refusing to load a stage-gate board without a bound template: resolve the workspace's " +
        "binding (resolveWorkspaceStageGateBinding) and pass its templateId, or report the board " +
        "unavailable instead of rendering another template's gates."
    );
  }

  const result = await supabase
    .from("stage_gate_decisions")
    .select(PROJECT_STAGE_GATE_DECISION_COLUMNS)
    .eq("workspace_id", input.workspaceId)
    .eq("project_id", input.projectId)
    .order("decided_at", { ascending: false })
    .limit(input.limit ?? DEFAULT_DECISION_WINDOW);

  const decisions = (result.error ? [] : (result.data ?? [])) as ProjectStageGateDecisionRow[];

  return {
    decisions,
    summary: buildProjectStageGateSummary(decisions, {
      templateId,
      projectId: input.projectId,
      decisionsUnavailable: result.error
        ? { reason: result.error.message || "no message reported" }
        : null,
    }),
  };
}
