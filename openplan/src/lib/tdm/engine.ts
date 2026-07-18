/**
 * TDM combination and VMT/GHG screening math.
 *
 * Clean re-implementation of transitscore-3d's `lib/tdmCalculations.ts`
 * (calculateTDMImpact) and the GHG conversion side of
 * `lib/vmtCalculations.ts`. Harvest defects deliberately not replicated:
 *   - additive percentage summing plus a walk/bike "site context bonus"
 *     that double-counted site context (walk/bike already reduce base VMT
 *     upstream) and inflated the combined total;
 *   - a silent hard cap at 60% — replaced by an explicit review flag the
 *     caller must surface (`exceedsReviewThreshold`);
 *   - two consumers (ScenarioPlanner vs AnalysisWizard) disagreeing on
 *     combination math — this module is the single combiner;
 *   - adding percentages computed on different bases
 *     (ScenarioPlanner.tsx:81) — every percentage here is against the same
 *     base VMT.
 *
 * All functions are pure: no I/O, no mutation, no clock, no randomness.
 */

import { InsufficientDataError } from "@/lib/planner-pack/types";

import { getTdmStrategy, type TdmStrategyCategory } from "./catalog";

/**
 * Combined program reductions above roughly 30% exceed what CAPCOA-style
 * place-type maxima typically support for a single project's TDM program.
 * Rather than silently clamping (the harvest hard-capped at 60%), any
 * combination above this line is flagged via `exceedsReviewThreshold` for
 * planner review — the caller surfaces the flag; nothing is clamped.
 */
export const TDM_COMBINED_REVIEW_THRESHOLD_PCT = 30;

/**
 * Light-duty fleet average screening default, in lbs CO2e per vehicle mile.
 * Supersede with an EMFAC region/year-specific factor for anything beyond
 * early scoping.
 */
export const DEFAULT_CO2E_LBS_PER_VEHICLE_MILE = 0.78;

/** Pounds per metric ton (t), for lbs -> metric tons CO2e conversion. */
export const LBS_PER_METRIC_TON = 2204.62262;

export const TDM_SCREENING_CAVEAT =
  "Screening-level TDM estimate for early scoping — strategy effectiveness varies with context, baseline mode share, and program design. Confirm measure-level values against the CAPCOA Handbook (2021) or project-specific studies before CEQA or grant use.";

/** One selected strategy; UI selection state lives here, never in the catalog. */
export interface TdmSelection {
  key: string;
  /** Optional per-project override of the catalog default, in percentage points (0-100). */
  vmtReductionPctOverride?: number;
}

export interface TdmCombinedStrategy {
  key: string;
  name: string;
  category: TdmStrategyCategory;
  /** The percentage actually used for this strategy (override or catalog default). */
  appliedVmtReductionPct: number;
}

export interface TdmCombinationResult {
  strategies: TdmCombinedStrategy[];
  /** Multiplicatively dampened combined reduction, in percent. */
  combinedVmtReductionPct: number;
  /** Naive additive sum of the applied percentages, reported for transparency only. */
  additiveSumPct: number;
  /** True when the combined reduction exceeds TDM_COMBINED_REVIEW_THRESHOLD_PCT. */
  exceedsReviewThreshold: boolean;
}

/**
 * Mirror of `toNumber` in `src/lib/projects/funding.ts` (Supabase NUMERIC
 * columns arrive as strings), except non-finite input yields null instead
 * of 0 so callers can tell "missing" apart from a real zero.
 */
function toFiniteNumber(value: number | string | null | undefined): number | null {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Combine selected TDM strategies into one program-level VMT reduction.
 *
 * Combination model: multiplicative dampening —
 * `combined = (1 − Π(1 − rᵢ/100)) × 100`. Each strategy removes a fraction
 * of the VMT that survives the strategies before it, which is how
 * independent reductions compose; it also matches how transitscore-3d's own
 * base multimodal reductions combined (lib/vmtCalculations.ts) and avoids
 * the additive-sum inflation of its TDM combiner. The naive additive sum is
 * still reported so UIs can show both.
 *
 * No silent cap: combinations above TDM_COMBINED_REVIEW_THRESHOLD_PCT set
 * `exceedsReviewThreshold` and the caller surfaces it. Unknown keys and
 * out-of-range overrides throw a plain Error (config problem, not missing
 * data). An empty selection is valid and combines to 0%.
 */
export function combineTdmStrategies(selections: TdmSelection[]): TdmCombinationResult {
  const strategies: TdmCombinedStrategy[] = [];
  let additiveSumPct = 0;
  // Π(1 − rᵢ/100): the fraction of base VMT that survives all strategies.
  let survivingVmtFraction = 1;

  for (const selection of selections) {
    const strategy = getTdmStrategy(selection.key);
    if (!strategy) {
      throw new Error(`Unknown TDM strategy key: ${JSON.stringify(selection.key)}`);
    }
    const override = selection.vmtReductionPctOverride;
    if (override !== undefined && !(override >= 0 && override <= 100)) {
      throw new Error(
        `vmtReductionPctOverride for ${JSON.stringify(selection.key)} must be between 0 and 100, got ${override}`
      );
    }
    const appliedVmtReductionPct = override ?? strategy.defaultVmtReductionPct;
    additiveSumPct += appliedVmtReductionPct;
    survivingVmtFraction *= 1 - appliedVmtReductionPct / 100;
    strategies.push({
      key: strategy.key,
      name: strategy.name,
      category: strategy.category,
      appliedVmtReductionPct,
    });
  }

  const combinedVmtReductionPct = (1 - survivingVmtFraction) * 100;
  return {
    strategies,
    combinedVmtReductionPct,
    additiveSumPct,
    exceedsReviewThreshold: combinedVmtReductionPct > TDM_COMBINED_REVIEW_THRESHOLD_PCT,
  };
}

/**
 * Apply a combined TDM reduction to a modeled annual VMT baseline.
 *
 * The base must be supplied (Supabase NUMERIC strings are coerced); this
 * library never estimates a baseline. Missing/blank/non-finite/<= 0 input
 * throws InsufficientDataError — "run the upstream step first", not a bug.
 */
export function applyTdmToAnnualVmt(
  baseAnnualVmt: number | string | null,
  combination: TdmCombinationResult
): { baseAnnualVmt: number; adjustedAnnualVmt: number; annualVmtReduced: number } {
  const base = toFiniteNumber(baseAnnualVmt);
  if (base === null || base <= 0) {
    throw new InsufficientDataError(
      "baseAnnualVmt must be a finite value greater than 0; supply a modeled annual VMT baseline — this library never estimates one."
    );
  }
  const annualVmtReduced = base * (combination.combinedVmtReductionPct / 100);
  return {
    baseAnnualVmt: base,
    adjustedAnnualVmt: base - annualVmtReduced,
    annualVmtReduced,
  };
}

export interface TdmGhgEstimate {
  annualMetricTonsCo2eReduced: number;
  /** The emissions factor actually used (echoed for display/provenance). */
  co2eLbsPerVehicleMile: number;
}

/**
 * Convert an annual VMT reduction into avoided metric tons of CO2e:
 * `t = vmtReduced × lbsPerMile / LBS_PER_METRIC_TON`.
 */
export function estimateGhgFromVmtReduction(
  annualVmtReduced: number,
  options?: { co2eLbsPerVehicleMile?: number }
): TdmGhgEstimate {
  const co2eLbsPerVehicleMile = options?.co2eLbsPerVehicleMile ?? DEFAULT_CO2E_LBS_PER_VEHICLE_MILE;
  return {
    annualMetricTonsCo2eReduced: (annualVmtReduced * co2eLbsPerVehicleMile) / LBS_PER_METRIC_TON,
    co2eLbsPerVehicleMile,
  };
}

/** One plain sentence for UI/memos summarizing a combination result. */
export function summarizeTdmCombination(result: TdmCombinationResult): string {
  const count = result.strategies.length;
  const noun = count === 1 ? "strategy" : "strategies";
  const verb = count === 1 ? "combines" : "combine";
  const head =
    `${count} ${noun} ${verb} to an estimated ` +
    `${result.combinedVmtReductionPct.toFixed(1)}% VMT reduction ` +
    `(additive sum ${result.additiveSumPct.toFixed(1)}%)`;
  if (result.exceedsReviewThreshold) {
    return (
      `${head} — exceeds the ${TDM_COMBINED_REVIEW_THRESHOLD_PCT}% combined-program review ` +
      `threshold; planner review required before relying on this estimate.`
    );
  }
  return `${head}.`;
}
