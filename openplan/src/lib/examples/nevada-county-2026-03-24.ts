/**
 * Nevada County 2026-03-24 screening run — canonical evidence catalog.
 *
 * This module is the single source of truth for the verbatim caveats,
 * validation metrics, screening gate, and facility ranking that both the
 * public `/examples` page and the authed `/county-runs/[id]` surface render.
 * Keeping the strings here prevents the language from drifting between the
 * public transparency view and the operator-facing view.
 *
 * All strings must match the validation artifact at
 * `data/screening-runs/nevada-county-runtime-norenumber-freeze-20260324/
 *  validation/validation_summary.json`.
 *
 * If that artifact is re-validated or superseded, update this module and
 * cross-check both consumers before shipping.
 */

export const NEVADA_COUNTY_RUN_NAME =
  "nevada-county-runtime-norenumber-freeze-20260324";

export const NEVADA_COUNTY_SCREENING_GATE = {
  statusLabel: "internal prototype only",
  reason:
    "At least one core facility has 237.62% absolute percent error, above the 50.00% critical-facility threshold.",
} as const;

export const NEVADA_COUNTY_CAVEATS_VERBATIM: readonly string[] = [
  "screening-grade only",
  "OSM default speeds/capacities",
  "tract fragments are not calibrated TAZs",
  "jobs are estimated from tract-scale demographic proxies",
  "external gateways are inferred from major boundary-crossing roads",
];

export type NevadaCountyValidationMetric = {
  label: string;
  value: string;
  note?: string;
};

export const NEVADA_COUNTY_VALIDATION_METRICS: readonly NevadaCountyValidationMetric[] = [
  { label: "Stations total", value: "5" },
  { label: "Stations matched", value: "5 of 5" },
  { label: "Median APE", value: "27.4%" },
  { label: "Mean APE", value: "68.75%" },
  { label: "Min APE", value: "4.10%" },
  {
    label: "Max APE",
    value: "237.62%",
    note: "Above the 50% critical-facility threshold — disqualifies this run from outward modeling claims.",
  },
  { label: "Spearman ρ (facility ranking)", value: "0.40" },
];

export type NevadaCountyFacilityRankingRow = {
  station: string;
  observed: string;
  modeled: string;
  obsRank: number;
  modRank: number;
};

export const NEVADA_COUNTY_FACILITY_RANKING: readonly NevadaCountyFacilityRankingRow[] = [
  { station: "SR 20 at Jct Rte 49", observed: "45,500", modeled: "73,666", obsRank: 1, modRank: 1 },
  { station: "SR 20 at Brunswick Rd", observed: "35,500", modeled: "30,975", obsRank: 2, modRank: 3 },
  { station: "SR 49 at South Grass Valley", observed: "26,000", modeled: "27,067", obsRank: 3, modRank: 4 },
  { station: "SR 20 at Penn Valley Dr", observed: "17,500", modeled: "12,705", obsRank: 4, modRank: 5 },
  { station: "SR 174 at Brunswick Rd", observed: "10,300", modeled: "34,775", obsRank: 5, modRank: 2 },
];

export const NEVADA_COUNTY_RUN_CONTEXT = {
  runId: NEVADA_COUNTY_RUN_NAME,
  engine: "AequilibraE screening runtime",
  createdAt: "2026-03-24T19:42:28Z",
  countsSource: "Caltrans 2023 priority counts (five-station subset)",
} as const;

export const NEVADA_COUNTY_PROOF_DOC_PATH =
  "docs/ops/2026-04-18-modeling-nevada-county-live-proof.md";

/**
 * Convenience selector: the single validation row to surface when only one
 * headline metric can fit (e.g. authed workspace detail where the full table
 * would be visually heavy).
 */
export function nevadaCountyMaxApeRow(): NevadaCountyValidationMetric {
  const row = NEVADA_COUNTY_VALIDATION_METRICS.find((m) => m.label === "Max APE");
  if (!row) {
    throw new Error(
      "Nevada County evidence catalog is missing the Max APE row — update the validation metric list."
    );
  }
  return row;
}

/**
 * True when the given county-run name corresponds to the validated Nevada
 * County artifact whose full evidence block should be surfaced verbatim.
 */
export function isValidatedNevadaCountyRun(runName: string | null | undefined): boolean {
  return typeof runName === "string" && runName === NEVADA_COUNTY_RUN_NAME;
}
