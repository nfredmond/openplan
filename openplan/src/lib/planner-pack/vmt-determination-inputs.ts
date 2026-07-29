/**
 * What is allowed to support a persisted VMT significance determination.
 *
 * WHY THESE RULES ARE HERE AND NOT AT THE CALL SITES. A significance
 * determination is the one determination-shaped output OpenPlan produces, and it
 * is produced twice: once in the browser, where a planner reads it, and once on
 * the server, where it is recomputed and stored. When those two disagree about
 * what may feed a determination, the failure is not a 4xx — it is a planner
 * looking at a number the product will not keep. That already happened: the
 * panel offered a calibrated determination from any row named
 * `resident_vmt_per_capita_calibrated`, while the server additionally required
 * the row to be run-level and positive, so a geometry-scoped calibrated slice
 * rendered a calibrated determination that the save then refused with 422. The
 * refusal was honest and the screen was not.
 *
 * So the selection rule lives in ONE place that both sides call, rather than in
 * two places kept in step by discipline.
 *
 * The same module holds the rule for which RUN may produce a determination at
 * all, because it answers the same question about a different input. Enforcement
 * of that one is server-side (`vmt-significance/route.ts`): the model-run list
 * also hides the panel for an ineligible run, but a hidden panel is a courtesy,
 * not a gate — the route is what makes a determination impossible to store.
 */

import { getManagedRunModeDefinition } from "@/lib/models/run-modes";
import type { CeqaVmtKpiRowLike } from "@/lib/models/ceqa-vmt-screen";

/**
 * The KPI name carrying the opt-in calibrated resident VMT per capita.
 *
 * Deliberately NOT a member of `CEQA_*_KPI_NAMES`: keeping it out of those sets
 * is what makes the calibrated figure opt-in rather than something the screen
 * picks up on its own. `20260721000002` states the same rule from the database
 * side — "a calibrated run publishes its VMT under distinct KPI names, so the
 * screen keeps using the uncalibrated screening VMT unless a calibrated result
 * is explicitly promoted".
 */
export const CALIBRATED_RESIDENT_VMT_PER_CAPITA_KPI = "resident_vmt_per_capita_calibrated";

/**
 * The held-out (never-fit) count-validation error published by a calibrated run.
 * A disclosure that travels next to a calibrated determination, not an input to
 * it.
 */
export const CALIBRATED_HOLDOUT_APE_KPI = "validation_median_ape_calibrated";

export type CalibratedVmtPerCapitaInput = {
  kpiName: string;
  vmtPerCapita: number;
};

/**
 * The run-level calibrated VMT per capita, or null when this run has none that
 * could support a determination.
 *
 * Three conditions, and each one is load-bearing:
 *
 *   - the exact KPI name, because the calibrated figure is opt-in by namespace;
 *   - NO `geometry_ref`, because a geometry-scoped row is a slice of the run
 *     (one corridor, one zone group) and not the study area's per-capita total —
 *     the same rule `findRunLevelKpi` applies to every screening KPI;
 *   - a finite value above zero, because a VMT per capita of 0 or NaN is a
 *     broken row, and a determination computed from it would be arithmetic
 *     performed on a defect.
 */
export function selectCalibratedVmtPerCapita(
  kpis: readonly CeqaVmtKpiRowLike[]
): CalibratedVmtPerCapitaInput | null {
  const row = kpis.find(
    (kpi) =>
      kpi.kpi_name === CALIBRATED_RESIDENT_VMT_PER_CAPITA_KPI &&
      !kpi.geometry_ref &&
      typeof kpi.value === "number" &&
      Number.isFinite(kpi.value) &&
      kpi.value > 0
  );
  return row ? { kpiName: row.kpi_name, vmtPerCapita: row.value as number } : null;
}

/**
 * The run-level held-out median APE from a calibrated run, or null.
 *
 * Run-level for the same reason as the VMT itself: a corridor's calibration fit
 * rendered under "Count-validated in this study area" would describe the study
 * area using one slice of it. Zero is NOT excluded here — unlike a VMT figure, a
 * 0% median error is a meaningful (if improbable) calibration result rather than
 * a broken row.
 */
export function selectCalibratedHoldoutApe(kpis: readonly CeqaVmtKpiRowLike[]): number | null {
  const row = kpis.find(
    (kpi) =>
      kpi.kpi_name === CALIBRATED_HOLDOUT_APE_KPI &&
      !kpi.geometry_ref &&
      typeof kpi.value === "number" &&
      Number.isFinite(kpi.value)
  );
  return row ? (row.value as number) : null;
}

/**
 * The engines whose stored KPIs may support a significance determination.
 *
 * A LIST, NOT A DEFAULT: an engine is eligible because someone decided its VMT
 * can carry a determination, never because it happens to publish a KPI with a
 * matching name. Today that is the AequilibraE screening lane alone, and every
 * other lane is excluded for a stated reason:
 *
 *   - `sketch_abm` publishes VMT from a synthetic population over distance-based
 *     skims; the repo's own record documents that figure running far below the
 *     CARB reference, which is exactly how a false "less than significant" gets
 *     issued;
 *   - `ite_trip_generation` publishes a RATE-based VMT under deliberately
 *     disjoint KPI names (`project_daily_vmt_screen`), so the KPI-namespace
 *     firewall already keeps it out — this list says the same thing at the run
 *     level rather than relying on a name mismatch;
 *   - `behavioral_demand` reaches preflight only, so its outputs are input
 *     validation, not travel;
 *   - `deterministic_corridor_v1` produces a corridor scorecard, not a study-area
 *     VMT aggregate.
 *
 * Adding an engine here is a claim that its VMT can be cited in a regulatory
 * significance finding. It is not a configuration knob.
 */
export const VMT_DETERMINATION_ELIGIBLE_ENGINE_KEYS: readonly string[] = ["aequilibrae"];

/** The subject run's own state, as the determination record preserves it. */
export type VmtDeterminationSubjectRun = {
  status: string | null;
  engineKey: string | null;
};

/**
 * Why a run may not produce a determination — or that it may.
 *
 * The two refusals are KEPT APART on purpose. "This run has not succeeded" is a
 * state that may change: the planner waits, or relaunches, and the same run can
 * become eligible. "This engine cannot support a determination" never changes:
 * no amount of waiting makes a sketch model's VMT citable. A planner acts
 * differently on each, so collapsing them into one "not eligible" would be a
 * true sentence that withholds the fact they need.
 */
export type VmtDeterminationRunEligibility =
  | { ok: true }
  | { ok: false; kind: "engine_not_supported" | "run_not_succeeded"; reason: string };

function engineLabel(engineKey: string): string {
  const definition = getManagedRunModeDefinition(engineKey);
  return definition.key === engineKey ? `${definition.engineLabel} (${engineKey})` : engineKey;
}

/**
 * Whether this run may produce a stored significance determination.
 *
 * The ENGINE is checked first. When a run is both the wrong engine and
 * unfinished, the engine is the fact worth reporting: it tells the planner the
 * run will never become eligible, whereas "it has not succeeded yet" invites a
 * wait that cannot help.
 */
export function resolveVmtDeterminationRunEligibility(
  run: VmtDeterminationSubjectRun
): VmtDeterminationRunEligibility {
  const eligible = VMT_DETERMINATION_ELIGIBLE_ENGINE_KEYS.map(engineLabel).join(", ");

  if (!run.engineKey) {
    return {
      ok: false,
      kind: "engine_not_supported",
      reason:
        "No engine is recorded for this run, so OpenPlan cannot establish that the model behind these " +
        `KPIs is one whose VMT may carry a significance determination. Determinations are computed only from ${eligible}. ` +
        "Nothing was saved, because a determination that cannot name the model it came from is not citable.",
    };
  }

  if (!VMT_DETERMINATION_ELIGIBLE_ENGINE_KEYS.includes(run.engineKey)) {
    return {
      ok: false,
      kind: "engine_not_supported",
      reason:
        `This run was produced by ${engineLabel(run.engineKey)}, whose output is not accepted as the basis for a ` +
        `VMT significance determination. Determinations are computed only from ${eligible}. This will not change by ` +
        "re-running: it is a limit on what that engine's VMT may be claimed to be, not a temporary state of this run.",
    };
  }

  if (run.status !== "succeeded") {
    return {
      ok: false,
      kind: "run_not_succeeded",
      reason:
        `This run's status is ${run.status ? `"${run.status}"` : "not recorded"}, not "succeeded", so its stored KPIs are ` +
        "partial or abandoned rather than the run's final result. A stored determination is permanent and citable, " +
        "so OpenPlan will not compute one from a run that has not finished successfully. Nothing was saved. If the " +
        "run is still going, screen it again once it succeeds.",
    };
  }

  return { ok: true };
}
