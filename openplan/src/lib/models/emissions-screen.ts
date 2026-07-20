/**
 * Screening GHG (CO2e) display model, derived from a succeeded AequilibraE run's
 * `general` KPIs (`co2e_metric_tons_year`, `co2e_kg_per_capita_day`). The worker
 * computes CO2e = network VMT × an EMFAC-style fleet-average running rate,
 * annualized. This is a SCREENING estimate (a published-rate × VMT product), NOT
 * an EMFAC run of record or a project GHG determination — the panel says so.
 */

export type EmissionsKpiRowLike = {
  kpi_name: string;
  value: number | null;
  unit?: string | null;
  breakdown_json?: Record<string, unknown> | null;
};

export type EmissionsScreen = {
  co2eMetricTonsYear: number | null;
  co2eKgPerCapitaDay: number | null;
  co2eGramsPerMile: number | null;
  analysisYear: number | null;
  provenance: string | null;
};

export const EMISSIONS_SCREENING_CAVEAT =
  "Screening-level GHG estimate: network VMT × an EMFAC-style fleet-average running-CO2e rate, annualized. Uncalibrated to a specific air district or vehicle mix — NOT an EMFAC run of record and NOT a project-level GHG determination.";

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Derive the emissions display model from a run's KPI rows. Returns null when
 * no emissions KPI is present (older runs / no VMT). */
export function deriveEmissionsScreen(kpis: EmissionsKpiRowLike[]): EmissionsScreen | null {
  const byName = new Map(kpis.map((row) => [row.kpi_name, row]));
  const tons = byName.get("co2e_metric_tons_year");
  const perCapita = byName.get("co2e_kg_per_capita_day");
  if (!tons && !perCapita) return null;

  const breakdown = (tons?.breakdown_json ?? perCapita?.breakdown_json ?? {}) as Record<string, unknown>;
  return {
    co2eMetricTonsYear: num(tons?.value),
    co2eKgPerCapitaDay: num(perCapita?.value),
    co2eGramsPerMile: num(breakdown.co2e_g_per_mile),
    analysisYear: num(breakdown.analysis_year),
    provenance: typeof breakdown.provenance === "string" ? breakdown.provenance : null,
  };
}

export function formatMetricTons(value: number | null): string {
  if (value === null) return "—";
  return `${Math.round(value).toLocaleString("en-US")} MT CO₂e/yr`;
}
