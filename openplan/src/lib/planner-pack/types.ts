/**
 * Planner Pack — shared fact-block and determination types.
 *
 * Ported from clawmodeler (Apache-2.0, same author):
 * `clawmodeler_engine/model.py` `fact_block()` and the dataclasses in
 * `clawmodeler_engine/planner_pack/{ceqa,atp}.py`.
 *
 * A fact block is the unit of grounded evidence: every claim carries a
 * `fact_id`, the claim text, a `method_ref`, and at least one artifact
 * reference, so downstream narrative stays under the citation contract
 * enforced by `grounding.ts` (`[fact:<fact_id>]` tokens must resolve to a
 * known fact block).
 *
 * Field names are snake_case on purpose: these records mirror the CSV/JSON
 * artifacts the Python engine emits, and keeping the wire shape identical is
 * what makes the port provably equivalent.
 */

export type FactArtifactRef = {
  type: string;
  path: string;
};

export type FactBlock = {
  fact_id: string;
  fact_type: string;
  claim_text: string;
  method_ref: string;
  artifact_refs: FactArtifactRef[];
  scenario_id?: string | null;
  project_id?: string;
  source_table?: string;
  source_row?: string;
  created_at?: string;
};

/**
 * Mirrors clawmodeler's `workspace.InsufficientDataError`: the inputs are
 * structurally valid but there is not enough data to produce a
 * determination. Callers should treat this as "run the upstream step
 * first", not as a bug.
 */
export class InsufficientDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InsufficientDataError";
  }
}

// ---------------------------------------------------------------------------
// CEQA §15064.3 VMT screening (ceqa.ts)
// ---------------------------------------------------------------------------

export type CeqaProjectType = "residential" | "employment" | "retail";

export type CeqaReferenceLabel = "regional" | "citywide" | "custom";

/**
 * One row of the engine's `vmt_screening.csv` in record form. Values may be
 * strings (CSV cells) or numbers; `computeCeqaVmt` coerces them.
 */
export type CeqaVmtScreeningRow = {
  scenario_id?: string | number | null;
  population?: string | number | null;
  daily_vmt?: string | number | null;
};

export type CeqaVmtDetermination = "potentially significant" | "less than significant";

export type CeqaVmtScenario = {
  scenario_id: string;
  population: number;
  daily_vmt: number;
  vmt_per_capita: number;
  threshold_vmt_per_capita: number;
  delta_pct: number;
  significant: boolean;
  determination: CeqaVmtDetermination;
  mitigation_required: boolean;
};

export type CeqaVmtResult = {
  project_type: CeqaProjectType;
  reference_label: CeqaReferenceLabel;
  reference_vmt_per_capita: number;
  threshold_pct: number;
  threshold_vmt_per_capita: number;
  scenarios: CeqaVmtScenario[];
  generated_at: string;
};

// ---------------------------------------------------------------------------
// California ATP application packet (atp.ts)
// ---------------------------------------------------------------------------

/** One row of the engine's `project_scores.csv` in record form. */
export type AtpScoreRow = {
  project_id?: string | number | null;
  name?: string | null;
  safety_score?: string | number | null;
  equity_score?: string | number | null;
  climate_score?: string | number | null;
  feasibility_score?: string | number | null;
  total_score?: string | number | null;
  sensitivity_flag?: string | null;
};

/** One row of the Caltrans LAPM exhibit (`lapm_exhibit.csv`), optional enrichment. */
export type AtpLapmRow = {
  project_id?: string | number | null;
  location_note?: string | null;
  description?: string | null;
  project_type?: string | null;
  estimated_cost_usd?: string | number | null;
  schedule_note?: string | null;
};

/** One row of the equity lens (`equity_lens.csv`), optional enrichment. */
export type AtpEquityRow = {
  project_id?: string | number | null;
  overlay_supplied?: string | boolean | null;
  dac_sb535?: string | boolean | null;
  low_income_ab1550?: string | boolean | null;
  tribal_area?: string | boolean | null;
  benefit_category?: string | null;
};

/** One row of the CEQA VMT table (`ceqa_vmt.csv`), optional enrichment. */
export type AtpCeqaRow = {
  scenario_id?: string | number | null;
  determination?: string | null;
};

export type AtpProjectApplication = {
  project_id: string;
  name: string;
  agency: string;
  cycle: string;
  total_score: number;
  safety_score: number;
  equity_score: number;
  climate_score: number;
  feasibility_score: number;
  sensitivity_flag: string;
  location_note: string;
  description: string;
  project_type: string;
  estimated_cost_usd: number | null;
  schedule_note: string;
  ceqa_determination: string;
  dac_sb535: boolean;
  low_income_ab1550: boolean;
  tribal_area: boolean;
  benefit_category: string;
  atp_dac_benefit_eligible: boolean;
  rtp_consistency_note: string;
  readiness_note: string;
};

export type AtpPortfolioSummary = {
  application_count: number;
  dac_application_count: number;
  low_income_application_count: number;
  tribal_application_count: number;
  dac_share: number;
  mean_total_score: number;
};

export type AtpGrantResult = {
  run_id: string;
  agency: string;
  cycle: string;
  applications: AtpProjectApplication[];
  summary: AtpPortfolioSummary | null;
  generated_at: string;
};
