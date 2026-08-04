/**
 * How far a corridor analysis run may be carried into a decision.
 *
 * WHY THIS EXISTS. `/api/analysis` has stamped `decisionUseStatus` onto every run's
 * metrics since the traceability block was added, and until now NOTHING read it —
 * not the results board, not the corridor report, not the assistant. A run
 * therefore carried its own use boundary in the database and presented itself to a
 * planner with no boundary at all. That is the shipped-invisible defect class:
 * the value was computed, persisted, and unreachable.
 *
 * The boundary is the point of the field. A corridor screen built from ACS
 * five-year shares, an OSM stop proxy, a crash adapter that covers some states and
 * not others, and an income/burden equity proxy is a SCREEN. It is legitimate
 * input to a project list, a grant narrative, or a corridor priority conversation.
 * It is not a modeled forecast and it may not stand behind a CEQA determination or
 * an adopted project-level finding. A planner who cannot see that on the run is
 * being invited to over-read it.
 *
 * This module owns the vocabulary and the wording so the card, the report, and any
 * future consumer cannot describe the same status differently — the seam-defect
 * CLAUDE.md warns about, where a shared capability living inside one of its two
 * callers gets reimplemented wrongly by the other.
 *
 * NOT A CLAIM TIER, and deliberately kept away from one. Modeling claim status
 * (`MODELING_CLAIM_STATUSES`) describes whether a model run was validated against
 * observed counts, and only evidence may move it. This describes what KIND of
 * artifact a corridor screen is, which is fixed by the method, not by the data —
 * every corridor screen is concept-level and no input can promote one. There is no
 * promotion path here to guard because there is nothing to promote.
 */

/**
 * The only status a corridor screening run can have. A constant, not a
 * computation: every run of this route uses the same screening method, so a
 * derived value would imply a distinction the method does not support.
 */
export const CORRIDOR_DECISION_USE_STATUS = "concept-level" as const;

export type CorridorDecisionUseStatus = typeof CORRIDOR_DECISION_USE_STATUS;

export type DecisionUseDisclosure = {
  /** Machine value as persisted on the run, or null when the run carries none. */
  status: string | null;
  /** Short label for a badge. */
  label: string;
  /** One sentence a planner can act on. */
  detail: string;
  /** True when the run recorded no status at all — a legacy run, not a failure. */
  notRecorded: boolean;
};

const CONCEPT_LEVEL_DISCLOSURE: DecisionUseDisclosure = {
  status: CORRIDOR_DECISION_USE_STATUS,
  label: "Decision use: concept-level",
  detail:
    "This is a screening-grade corridor result. Use it to compare corridors, shape a project list, " +
    "or support a grant narrative. Do not use it as the technical basis for a CEQA determination, " +
    "an adopted project-level finding, or a design decision without further study.",
  notRecorded: false,
};

const NOT_RECORDED_DISCLOSURE: DecisionUseDisclosure = {
  status: null,
  label: "Decision use: not recorded",
  detail:
    "This run predates the decision-use boundary and did not record one, so its permitted use is " +
    "unknown rather than unrestricted. Re-run the analysis to get a run that states its own boundary.",
  notRecorded: true,
};

/**
 * Read the decision-use boundary off a run's persisted metrics.
 *
 * A run that recorded nothing is reported as NOT RECORDED, never defaulted to
 * concept-level. Silently supplying a boundary a run never carried would be
 * inventing provenance, and "we did not write this down" is the true statement.
 * An unrecognised value is passed through with its own wording for the same
 * reason — it is reported, not normalised away.
 */
export function resolveDecisionUseDisclosure(
  metrics: Record<string, unknown> | null | undefined
): DecisionUseDisclosure {
  const raw = metrics?.decisionUseStatus;

  if (typeof raw !== "string" || raw.trim().length === 0) {
    return NOT_RECORDED_DISCLOSURE;
  }

  if (raw === CORRIDOR_DECISION_USE_STATUS) {
    return CONCEPT_LEVEL_DISCLOSURE;
  }

  return {
    status: raw,
    label: `Decision use: ${raw}`,
    detail:
      `This run recorded a decision-use status ("${raw}") that this version of OpenPlan does not ` +
      "recognise. Treat it as screening-grade until someone who knows the vocabulary says otherwise.",
    notRecorded: false,
  };
}
