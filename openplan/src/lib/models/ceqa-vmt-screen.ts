/**
 * CEQA §15064.3 VMT screen — KPI-to-screening-input derivation.
 *
 * Bridges stored `model_run_kpis` rows to the Planner Pack CEQA module
 * (`@/lib/planner-pack/ceqa`). The behavioral-onramp KPI set persisted for
 * county runs today (total_trips, loaded_links, final_gap, zone_count,
 * population_total, jobs_total — see behavioral-onramp-kpis.ts) carries no
 * VMT-family KPI, and model-run KPI registration is free-form, so this
 * module derives screening inputs only when a run-level VMT KPI is actually
 * present. It never estimates VMT from trips or any other proxy: if the KPI
 * set cannot supply VMT, the screen reports exactly why and stops.
 */

import type { CeqaVmtScreeningRow } from "@/lib/planner-pack/types";

/** Minimal KPI row shape shared by county-run and model-run KPI records. */
export type CeqaVmtKpiRowLike = {
  kpi_name: string;
  kpi_label?: string | null;
  value: number | null;
  unit?: string | null;
  geometry_ref?: string | null;
};

/** Run-level per-capita daily VMT KPI names, checked first. */
export const CEQA_VMT_PER_CAPITA_KPI_NAMES: ReadonlySet<string> = new Set([
  "vmt_per_capita",
  "daily_vmt_per_capita",
  "per_capita_vmt",
]);

/** Run-level total daily VMT KPI names (combined with a population KPI). */
export const CEQA_DAILY_VMT_KPI_NAMES: ReadonlySet<string> = new Set([
  "daily_vmt",
  "total_vmt",
  "vmt_total",
  "total_daily_vmt",
  "vmt",
]);

/** Population KPI names (behavioral-onramp persists `population_total`). */
export const CEQA_POPULATION_KPI_NAMES: ReadonlySet<string> = new Set([
  "population_total",
  "population",
  "total_population",
]);

export type CeqaVmtScreeningInputs =
  | {
      status: "per-capita";
      vmtPerCapita: number;
      vmtKpiName: string;
    }
  | {
      status: "total-with-population";
      dailyVmt: number;
      population: number;
      vmtKpiName: string;
      populationKpiName: string;
    }
  | {
      status: "missing-population";
      vmtKpiName: string;
    }
  | {
      status: "no-vmt-kpi";
      availableKpiNames: string[];
    };

function isRunLevel(row: CeqaVmtKpiRowLike): boolean {
  // Geometry-scoped KPIs (e.g. corridor_vmt::corridor-1) are slices, not
  // run totals; the run-level screen must not treat them as such.
  return !row.geometry_ref;
}

function findRunLevelKpi(
  kpis: CeqaVmtKpiRowLike[],
  names: ReadonlySet<string>
): CeqaVmtKpiRowLike | null {
  return (
    kpis.find(
      (row) =>
        isRunLevel(row) &&
        names.has(row.kpi_name) &&
        typeof row.value === "number" &&
        Number.isFinite(row.value) &&
        row.value > 0
    ) ?? null
  );
}

/**
 * Derive CEQA screening inputs from a run's stored KPI rows.
 *
 * Preference order: an explicit per-capita VMT KPI, then a total daily VMT
 * KPI paired with a population KPI. Anything else is reported as
 * unavailable — never estimated.
 */
export function deriveCeqaVmtScreeningInputs(kpis: CeqaVmtKpiRowLike[]): CeqaVmtScreeningInputs {
  const perCapita = findRunLevelKpi(kpis, CEQA_VMT_PER_CAPITA_KPI_NAMES);
  if (perCapita) {
    return {
      status: "per-capita",
      vmtPerCapita: perCapita.value as number,
      vmtKpiName: perCapita.kpi_name,
    };
  }

  const dailyVmt = findRunLevelKpi(kpis, CEQA_DAILY_VMT_KPI_NAMES);
  if (dailyVmt) {
    const population = findRunLevelKpi(kpis, CEQA_POPULATION_KPI_NAMES);
    if (population) {
      return {
        status: "total-with-population",
        dailyVmt: dailyVmt.value as number,
        population: population.value as number,
        vmtKpiName: dailyVmt.kpi_name,
        populationKpiName: population.kpi_name,
      };
    }
    return { status: "missing-population", vmtKpiName: dailyVmt.kpi_name };
  }

  return {
    status: "no-vmt-kpi",
    availableKpiNames: Array.from(new Set(kpis.map((row) => row.kpi_name))),
  };
}

/**
 * Build the single `vmt_screening` row for `computeCeqaVmt`. A per-capita
 * KPI is expressed as daily_vmt over a population of 1 — arithmetically
 * identical (vmt_per_capita = daily_vmt / population) and explicit about
 * the fact that no separate population figure backs it.
 */
export function buildCeqaScreeningRow(
  inputs: Extract<CeqaVmtScreeningInputs, { status: "per-capita" | "total-with-population" }>,
  scenarioId: string
): CeqaVmtScreeningRow {
  if (inputs.status === "per-capita") {
    return { scenario_id: scenarioId, population: 1, daily_vmt: inputs.vmtPerCapita };
  }
  return { scenario_id: scenarioId, population: inputs.population, daily_vmt: inputs.dailyVmt };
}

/**
 * Screening-level caveat, verbatim from the ported memo renderer's Notes
 * section (src/lib/planner-pack/render.ts — "wording that says so must not
 * drift"). Surfaced in the UI so the determination is never presented as a
 * CEQA determination of record.
 */
export const CEQA_SCREENING_CAVEAT =
  "Determinations in this memo are screening-level. A lead agency may adopt a different threshold or a custom methodology with substantial evidence.";

/** Statutory citation line rendered next to every determination. */
export const CEQA_STATUTORY_CITATION =
  "California Public Resources Code §21099; CEQA Guidelines §15064.3 (14 CCR §15064.3); Governor's Office of Planning and Research, Technical Advisory on Evaluating Transportation Impacts in CEQA (December 2018).";

/** Engine-version stamp for memos rendered from the web workbench. */
export const CEQA_MEMO_ENGINE_VERSION = "openplan-planner-pack-ts";
