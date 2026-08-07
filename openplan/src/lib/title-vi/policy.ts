/**
 * A workspace's ADOPTED Title VI program record.
 *
 * ================================================ WHY THIS IS NOT A CONSTANT
 *
 * FTA C 4702.1B thresholds are policy an agency adopts, publishes, and is held
 * to. Two transit agencies in the same state legitimately adopt different
 * minority definitions and different disparate-impact thresholds. A hardcoded
 * 50% or ten-percentage-point rule would produce a finding no agency could
 * defend, and no OpenPlan deployment could vary — which is non-negotiable #0 in
 * the one module where getting it wrong has legal consequences.
 *
 * So OpenPlan supplies NO DEFAULT VALUES for any threshold. There is no
 * "typical" starting policy to copy, because a threshold a planner did not
 * choose is a threshold nobody adopted, and the moment it appeared on a
 * published finding it would be indistinguishable from one that was. The
 * absence of a policy is a REFUSAL, never a fallback.
 *
 * ============================================================ THE SHAPE
 *
 * A program is re-adopted, typically every three years, and a finding must stay
 * reproducible against the policy that was current when it was made. So rows
 * are kept and superseded rather than edited: `supersededAt === null` is the
 * current one, and the database holds a partial unique index that makes two
 * current policies for one workspace unstorable.
 */

export type TractDefinitionMethod = "service_area_average" | "fixed_threshold";

export const TRACT_DEFINITION_METHODS: readonly TractDefinitionMethod[] = [
  "service_area_average",
  "fixed_threshold",
] as const;

export interface TitleViPolicy {
  id: string;
  workspaceId: string;

  /** Adoption provenance. A finding cites these, never a bare number. */
  adoptedOn: string;
  adoptedBy: string;
  boardActionReference: string | null;
  documentUrl: string | null;

  minorityDefinitionMethod: TractDefinitionMethod;
  /** Required for `fixed_threshold`, null for `service_area_average`. */
  minorityThresholdPct: number | null;
  lowIncomeDefinitionMethod: TractDefinitionMethod;
  lowIncomeThresholdPct: number | null;

  /**
   * Null means the agency has adopted no threshold, which is real and common.
   * The analysis then reports the measured difference and NAMES IT NOTHING —
   * it does not fall back to a number OpenPlan chose.
   */
  disparateImpactThresholdPct: number | null;
  disproportionateBurdenThresholdPct: number | null;

  /** Measurable against a GTFS feed. */
  standardPeakHeadwayMinutes: number | null;
  standardOffpeakHeadwayMinutes: number | null;
  standardSpanHours: number | null;
  /**
   * Recorded because the Title VI program requires them and an agency needs one
   * place for the document — NOT because OpenPlan measures them. Nothing
   * derives a finding from a free-text note.
   */
  standardOnTimePerformancePct: number | null;
  standardVehicleLoadNote: string | null;
  standardServiceAvailabilityNote: string | null;
  policyAmenityDistributionNote: string | null;
  policyVehicleAssignmentNote: string | null;

  supersededAt: string | null;
}

/** The database row shape, snake_case, as PostgREST returns it. */
export interface TitleViPolicyRow {
  id: string;
  workspace_id: string;
  adopted_on: string;
  adopted_by: string;
  board_action_reference: string | null;
  document_url: string | null;
  minority_definition_method: string;
  minority_threshold_pct: number | string | null;
  low_income_definition_method: string;
  low_income_threshold_pct: number | string | null;
  disparate_impact_threshold_pct: number | string | null;
  disproportionate_burden_threshold_pct: number | string | null;
  standard_peak_headway_minutes: number | null;
  standard_offpeak_headway_minutes: number | null;
  standard_span_hours: number | string | null;
  standard_on_time_performance_pct: number | string | null;
  standard_vehicle_load_note: string | null;
  standard_service_availability_note: string | null;
  policy_amenity_distribution_note: string | null;
  policy_vehicle_assignment_note: string | null;
  superseded_at: string | null;
}

/**
 * THE PROJECTION, as one exported string.
 *
 * A mocked Supabase client returns its canned row whatever columns were asked
 * for, so a column dropped from a `.select()` leaves every test green while the
 * real page renders `undefined`. Naming the projection once and asserting on
 * THIS CONSTANT is the only thing that catches it — see
 * `public-engagement-page.test.tsx`, "asks the database for the columns it
 * renders". Every reader of `title_vi_policies` uses this.
 */
export const TITLE_VI_POLICY_COLUMNS = [
  "id",
  "workspace_id",
  "adopted_on",
  "adopted_by",
  "board_action_reference",
  "document_url",
  "minority_definition_method",
  "minority_threshold_pct",
  "low_income_definition_method",
  "low_income_threshold_pct",
  "disparate_impact_threshold_pct",
  "disproportionate_burden_threshold_pct",
  "standard_peak_headway_minutes",
  "standard_offpeak_headway_minutes",
  "standard_span_hours",
  "standard_on_time_performance_pct",
  "standard_vehicle_load_note",
  "standard_service_availability_note",
  "policy_amenity_distribution_note",
  "policy_vehicle_assignment_note",
  "superseded_at",
].join(", ");

/**
 * NUMERIC comes back from PostgREST as a STRING, not a number.
 *
 * Postgres `numeric` has arbitrary precision, which JSON cannot represent, so
 * the driver preserves it as text.
 *
 * BE PRECISE ABOUT WHAT THAT BREAKS, because the obvious claim is wrong and was
 * written here first: JavaScript's relational operators DO coerce a numeric
 * string, so `Math.abs(-30) > "20.00"` is already true and a single uncoerced
 * threshold would not by itself flip a verdict. What actually breaks is
 * STRING-TO-STRING comparison — `"10.00" > "9.00"` is false, lexicographically —
 * which is what comparing or sorting two thresholds does. Plus the type
 * contract: every consumer is told these are `number | null`, arithmetic on one
 * would concatenate, and a threshold rendered as `"20.00"` in a UI is a
 * different string from `20`.
 *
 * `null` must survive as `null`. `Number(null)` is 0, and a zero
 * disparate-impact threshold fires on every measured difference however small —
 * the loudest possible wrong answer, and the one that looks most like the tool
 * working.
 */
function numeric(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function definitionMethod(value: string): TractDefinitionMethod {
  return value === "fixed_threshold" ? "fixed_threshold" : "service_area_average";
}

export function toTitleViPolicy(row: TitleViPolicyRow): TitleViPolicy {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    adoptedOn: row.adopted_on,
    adoptedBy: row.adopted_by,
    boardActionReference: row.board_action_reference,
    documentUrl: row.document_url,
    minorityDefinitionMethod: definitionMethod(row.minority_definition_method),
    minorityThresholdPct: numeric(row.minority_threshold_pct),
    lowIncomeDefinitionMethod: definitionMethod(row.low_income_definition_method),
    lowIncomeThresholdPct: numeric(row.low_income_threshold_pct),
    disparateImpactThresholdPct: numeric(row.disparate_impact_threshold_pct),
    disproportionateBurdenThresholdPct: numeric(row.disproportionate_burden_threshold_pct),
    standardPeakHeadwayMinutes: row.standard_peak_headway_minutes,
    standardOffpeakHeadwayMinutes: row.standard_offpeak_headway_minutes,
    standardSpanHours: numeric(row.standard_span_hours),
    standardOnTimePerformancePct: numeric(row.standard_on_time_performance_pct),
    standardVehicleLoadNote: row.standard_vehicle_load_note,
    standardServiceAvailabilityNote: row.standard_service_availability_note,
    policyAmenityDistributionNote: row.policy_amenity_distribution_note,
    policyVehicleAssignmentNote: row.policy_vehicle_assignment_note,
    supersededAt: row.superseded_at,
  };
}

/**
 * What is still missing before the analysis can run, in a planner's words.
 *
 * Returned as a list rather than a boolean so the editor can say which field,
 * and so a partly-recorded policy is never silently treated as complete.
 */
export function titleViPolicyGaps(policy: TitleViPolicy | null): string[] {
  if (!policy) {
    return [
      "No adopted Title VI policy is recorded. OpenPlan supplies no default thresholds: they are " +
        "values your agency adopts and publishes.",
    ];
  }

  const gaps: string[] = [];
  if (policy.minorityDefinitionMethod === "fixed_threshold" && policy.minorityThresholdPct === null) {
    gaps.push("A fixed minority threshold is selected but no percentage is recorded.");
  }
  if (policy.lowIncomeDefinitionMethod === "fixed_threshold" && policy.lowIncomeThresholdPct === null) {
    gaps.push("A fixed low-income threshold is selected but no percentage is recorded.");
  }
  if (policy.disparateImpactThresholdPct === null) {
    gaps.push(
      "No disparate-impact threshold is adopted. Service differences will be measured and reported " +
        "as numbers, but nothing will be identified as exceeding a threshold."
    );
  }
  if (policy.disproportionateBurdenThresholdPct === null) {
    gaps.push(
      "No disproportionate-burden threshold is adopted. Low-income service differences will be " +
        "reported as numbers only."
    );
  }
  return gaps;
}
