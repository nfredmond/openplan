/**
 * CEQA §15064.3 VMT significance screening.
 *
 * Ported from clawmodeler (Apache-2.0, same author):
 * `clawmodeler_engine/planner_pack/ceqa.py`.
 *
 * California Public Resources Code §21099 and CEQA Guidelines §15064.3
 * (revised after SB 743) make vehicle miles traveled (VMT) the preferred
 * metric for transportation-impact significance. This module derives
 * per-capita daily VMT per scenario from `vmt_screening` rows, compares each
 * scenario to an agency-configurable reference VMT per capita, and issues a
 * "less than significant" / "potentially significant" determination.
 *
 * The Governor's Office of Planning and Research (OPR) *Technical Advisory
 * on Evaluating Transportation Impacts in CEQA* (December 2018) recommends
 * 15 percent below the reference baseline (regional or citywide VMT per
 * capita) as the default residential screening threshold. That
 * recommendation is the default here, but agencies can override both the
 * reference and the percentage.
 *
 * Determinations are screening-level and purely arithmetic; nothing in this
 * module calls an LLM. Every determination is mirrored as a
 * `ceqa_vmt_determination` fact block so narrative output stays under the
 * per-sentence citation contract (see `grounding.ts`).
 */

import {
  InsufficientDataError,
  type CeqaProjectType,
  type CeqaReferenceLabel,
  type CeqaVmtResult,
  type CeqaVmtScenario,
  type CeqaVmtScreeningRow,
  type FactBlock,
} from "./types";
import { formatFixedPython, pythonRound, utcNow } from "./utilities";

export const OPR_DEFAULT_THRESHOLD_PCT = 0.15;

export const CEQA_PROJECT_TYPES = ["residential", "employment", "retail"] as const;

export const CEQA_REFERENCE_LABELS = ["regional", "citywide", "custom"] as const;

export const DEFAULT_REFERENCE_VMT_PER_CAPITA = 22.0;

export type ComputeCeqaVmtOptions = {
  referenceVmtPerCapita: number;
  projectType?: CeqaProjectType;
  referenceLabel?: CeqaReferenceLabel;
  thresholdPct?: number;
  /** Override the generated_at stamp (ISO-8601); defaults to now. */
  generatedAt?: string;
};

/**
 * Mirror of Python `float(row.get(field) or 0)`: falsy cells coerce to 0,
 * non-numeric text throws (as CPython `float()` would).
 */
function rowNumber(value: string | number | null | undefined, field: string): number {
  if (value === null || value === undefined || value === "" || value === 0) {
    return 0;
  }
  if (typeof value === "number") {
    return value;
  }
  const text = value.trim();
  const parsed = text === "" ? Number.NaN : Number(text);
  if (Number.isNaN(parsed)) {
    throw new Error(`Non-numeric ${field} value: ${JSON.stringify(value)}`);
  }
  return parsed;
}

/**
 * Compute per-scenario CEQA §15064.3 VMT determinations.
 *
 * `vmtRows` is the engine's `vmt_screening.csv` in record form.
 * `referenceVmtPerCapita` is the regional or citywide reference. The cut
 * line is `reference * (1 - thresholdPct)` and any scenario at or above
 * that line is "potentially significant".
 */
export function computeCeqaVmt(
  vmtRows: CeqaVmtScreeningRow[],
  {
    referenceVmtPerCapita,
    projectType = "residential",
    referenceLabel = "regional",
    thresholdPct = OPR_DEFAULT_THRESHOLD_PCT,
    generatedAt,
  }: ComputeCeqaVmtOptions
): CeqaVmtResult {
  if (!CEQA_PROJECT_TYPES.includes(projectType)) {
    throw new Error(
      `Unknown project_type ${JSON.stringify(projectType)}; expected one of ${CEQA_PROJECT_TYPES.join(", ")}`
    );
  }
  if (!CEQA_REFERENCE_LABELS.includes(referenceLabel)) {
    throw new Error(
      `Unknown reference_label ${JSON.stringify(referenceLabel)}; expected one of ${CEQA_REFERENCE_LABELS.join(", ")}`
    );
  }
  if (!(referenceVmtPerCapita > 0)) {
    throw new Error(`reference_vmt_per_capita must be > 0, got ${referenceVmtPerCapita}`);
  }
  if (!(thresholdPct > 0 && thresholdPct < 1)) {
    throw new Error(`threshold_pct must be a fraction between 0 and 1, got ${thresholdPct}`);
  }
  if (vmtRows.length === 0) {
    throw new InsufficientDataError(
      "vmt_screening rows are empty; run a workflow before computing CEQA VMT."
    );
  }

  const threshold = referenceVmtPerCapita * (1 - thresholdPct);
  const scenarios: CeqaVmtScenario[] = [];
  for (const row of vmtRows) {
    const scenarioId = String(row.scenario_id || "").trim();
    if (!scenarioId) {
      continue;
    }
    const population = rowNumber(row.population, "population");
    const dailyVmt = rowNumber(row.daily_vmt, "daily_vmt");
    if (population <= 0) {
      continue;
    }
    const vmtPerCapita = dailyVmt / population;
    const deltaPct = threshold > 0 ? (vmtPerCapita - threshold) / threshold : 0;
    const significant = vmtPerCapita >= threshold;
    scenarios.push({
      scenario_id: scenarioId,
      population: pythonRound(population, 3),
      daily_vmt: pythonRound(dailyVmt, 3),
      vmt_per_capita: pythonRound(vmtPerCapita, 3),
      threshold_vmt_per_capita: pythonRound(threshold, 3),
      delta_pct: pythonRound(deltaPct, 4),
      significant,
      determination: significant ? "potentially significant" : "less than significant",
      mitigation_required: significant,
    });
  }

  return {
    project_type: projectType,
    reference_label: referenceLabel,
    reference_vmt_per_capita: pythonRound(referenceVmtPerCapita, 3),
    threshold_pct: thresholdPct,
    threshold_vmt_per_capita: pythonRound(threshold, 3),
    scenarios,
    generated_at: generatedAt ?? utcNow(),
  };
}

/** Produce grounded fact blocks for each scenario determination. */
export function ceqaVmtFactBlocks(result: CeqaVmtResult, sourcePath: string): FactBlock[] {
  const blocks: FactBlock[] = [];
  for (const scenario of result.scenarios) {
    const direction = scenario.significant ? "above" : "below";
    const deltaPctDisplay = Math.abs(scenario.delta_pct) * 100;
    const claim =
      `Under CEQA §15064.3, scenario ${scenario.scenario_id} VMT per ` +
      `capita is ${formatFixedPython(scenario.vmt_per_capita, 1)} — ${scenario.determination}, ` +
      `${formatFixedPython(deltaPctDisplay, 1)}% ${direction} the ` +
      `${formatFixedPython(result.threshold_pct * 100, 0)}%-below-` +
      `${result.reference_label} threshold of ` +
      `${formatFixedPython(scenario.threshold_vmt_per_capita, 1)} VMT/capita.`;
    blocks.push({
      fact_id: `ceqa-vmt-${scenario.scenario_id}`,
      fact_type: "ceqa_vmt_determination",
      scenario_id: scenario.scenario_id,
      claim_text: claim,
      method_ref: "planner_pack.ceqa_vmt",
      artifact_refs: [{ path: sourcePath, type: "table" }],
      source_table: sourcePath,
      source_row: `${result.project_type}.${result.reference_label}`,
    });
  }
  return blocks;
}
