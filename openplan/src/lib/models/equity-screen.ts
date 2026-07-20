/**
 * Equity / EJ screening display model, derived from a succeeded AequilibraE run's
 * `equity` KPIs. The worker pulls real ACS low-income / minority / zero-vehicle
 * shares at the run's geography, flags above-typical-disadvantage zones, and
 * compares resident VMT/capita for those zones vs the rest. Screening-grade,
 * relative to the study area — NOT the official CalEnviroScreen / SB 535
 * disadvantaged-community designation.
 */

export type EquityKpiRowLike = {
  kpi_name: string;
  value: number | null;
  unit?: string | null;
  breakdown_json?: Record<string, unknown> | null;
};

export type EquityGroup = {
  zones: number | null;
  population: number | null;
  resident_vmt_per_capita: number | null;
  avg_low_income_share: number | null;
  avg_minority_share: number | null;
  avg_zero_vehicle_share: number | null;
};

export type EquityScreen = {
  geography: string | null;
  focusZoneCount: number | null;
  focusPopulationSharePct: number | null;
  focusVmtPerCapita: number | null;
  restVmtPerCapita: number | null;
  disparityRatio: number | null;
  focus: EquityGroup | null;
  rest: EquityGroup | null;
  provenance: string | null;
};

export const EQUITY_SCREENING_CAVEAT =
  "Screening EJ/Title VI overlay from real ACS low-income, minority, and zero-vehicle shares. Equity-focus zones are above the study-area average on ≥2 of the 3 indicators. Relative to this study area — NOT the official CalEnviroScreen / SB 535 disadvantaged-community designation.";

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function group(raw: unknown): EquityGroup | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  return {
    zones: num(r.zones),
    population: num(r.population),
    resident_vmt_per_capita: num(r.resident_vmt_per_capita),
    avg_low_income_share: num(r.avg_low_income_share),
    avg_minority_share: num(r.avg_minority_share),
    avg_zero_vehicle_share: num(r.avg_zero_vehicle_share),
  };
}

/** Derive the equity display model from a run's KPI rows; null when absent. */
export function deriveEquityScreen(kpis: EquityKpiRowLike[]): EquityScreen | null {
  const byName = new Map(kpis.map((row) => [row.kpi_name, row]));
  const count = byName.get("equity_focus_zone_count");
  if (!count) return null;
  const breakdown = (count.breakdown_json ?? {}) as Record<string, unknown>;
  return {
    geography: typeof breakdown.geography === "string" ? breakdown.geography : null,
    focusZoneCount: num(count.value),
    focusPopulationSharePct: num(byName.get("equity_focus_population_share")?.value),
    focusVmtPerCapita: num(byName.get("equity_focus_vmt_per_capita")?.value),
    restVmtPerCapita: num(byName.get("equity_rest_vmt_per_capita")?.value),
    disparityRatio: num(byName.get("equity_vmt_disparity_ratio")?.value),
    focus: group(breakdown.equity_focus),
    rest: group(breakdown.rest_of_area),
    provenance: typeof breakdown.provenance === "string" ? breakdown.provenance : null,
  };
}

export function formatShare(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}
