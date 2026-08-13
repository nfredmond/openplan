/**
 * THE MEASURE FUND — row shapes, closed vocabularies, and the `.select()`
 * projections every reader of these six tables must use.
 *
 * WHAT A MEASURE FUND IS. Voters pass a local tax and an agency administers the
 * fund: money arrives periodically, an ordinance says how it splits,
 * sub-recipients claim against it, and an oversight committee audits it. This
 * is the FUNDER side of the reimbursement seam already in the product — the
 * mirror of `funding_awards` + `billing_invoice_records`, where the workspace
 * is the one claiming. Same shapes, opposite direction.
 *
 * WHY THE PROJECTIONS LIVE HERE. Supabase clients in this repo are
 * deliberately untyped (`src/lib/knowledge-base/documents.ts:4-6`), so a
 * `.select()` string is not checked against the schema and a column typo
 * surfaces at runtime — as a "pending migration" degrade, because
 * `looksLikePendingSchema` cannot tell a typo from an unapplied migration.
 * One exported constant per table means one place to be wrong, and a test can
 * assert the string itself.
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT DO: arithmetic. Receipts are
 * summarised in `receipts.ts` and the ordinance's split is computed in
 * `allocation.ts`, both pure and both hand-derived in their tests.
 */

/* ------------------------------------------------------------------ *
 * Vocabularies
 * ------------------------------------------------------------------ */

/**
 * The cadence of the ACCOUNTING PERIOD, not of the deposits.
 *
 * `irregular` is not a fallback for laziness — it is what an ordinance that
 * this list does not anticipate honestly is, and forcing such a fund into
 * "quarterly" would make every derived period boundary a fiction.
 */
export const MEASURE_RECEIPT_CADENCES = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "semiannual", label: "Twice a year" },
  { value: "annual", label: "Once a year" },
  { value: "irregular", label: "Irregular — periods are opened by hand" },
] as const;

export type MeasureReceiptCadence = (typeof MEASURE_RECEIPT_CADENCES)[number]["value"];

/**
 * Whether the measure has an end date, has none, or has one nobody entered.
 *
 * Three states for the same reason a receipt has three: an empty date field
 * cannot say "this measure never expires", and inferring that from absence is
 * how a fund page tells an oversight committee something no ordinance says.
 */
export const MEASURE_SUNSET_POSTURES = [
  { value: "dated", label: "Sunsets on a date in the ordinance" },
  { value: "none_in_ordinance", label: "The ordinance sets no sunset" },
  { value: "not_recorded", label: "Not recorded yet" },
] as const;

export type MeasureSunsetPosture = (typeof MEASURE_SUNSET_POSTURES)[number]["value"];

/**
 * A grouping label for a list of recipients — never an eligibility rule.
 *
 * What a recipient may claim comes from the ordinance's own category list in
 * the allocation rule, not from what kind of body it is.
 */
export const MEASURE_RECIPIENT_KINDS = [
  { value: "municipality", label: "City or town" },
  { value: "county", label: "County or equivalent" },
  { value: "special_district", label: "Special district" },
  { value: "transit_operator", label: "Transit operator" },
  { value: "tribal_government", label: "Tribal government" },
  { value: "regional_agency", label: "Regional agency" },
  { value: "nonprofit", label: "Non-profit" },
  { value: "other", label: "Other" },
] as const;

export type MeasureRecipientKind = (typeof MEASURE_RECIPIENT_KINDS)[number]["value"];

/**
 * Where an allocation figure came from.
 *
 * `descriptor` — this lane's allocator derived it from a recorded receipt and a
 * recorded rule version. `manual` — a person entered it because the ordinance
 * does not fit the descriptor's closed vocabulary. A manual figure is never
 * rendered beside a computed one without the distinction, and the database
 * requires it to carry a rationale.
 */
export const MEASURE_COMPUTATION_BASES = [
  { value: "descriptor", label: "Computed from the ordinance rule" },
  { value: "manual", label: "Entered by staff" },
] as const;

export type MeasureComputationBasis = (typeof MEASURE_COMPUTATION_BASES)[number]["value"];

/* ------------------------------------------------------------------ *
 * Row shapes
 *
 * Every money and date field is `number | string | null` on the way in:
 * PostgREST returns NUMERIC as a STRING to preserve precision, and a shape that
 * claimed `number` would be lying about what arrives.
 * ------------------------------------------------------------------ */

export type MeasureFundRecord = {
  id: string;
  workspace_id: string;
  program_id: string;
  ordinance_reference: string | null;
  rate_label: string | null;
  adopted_on: string | null;
  effective_from: string | null;
  sunset_posture: MeasureSunsetPosture | string;
  sunset_on: string | null;
  receipt_cadence: MeasureReceiptCadence | string;
  currency_code: string;
  fiscal_year_note: string | null;
  public_share_enabled: boolean;
  public_share_token: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type MeasureFundPeriodRecord = {
  id?: string | null;
  measure_fund_id?: string | null;
  period_label?: string | null;
  fiscal_year_label?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  forecast_amount?: number | string | null;
  forecast_basis_note?: string | null;
  received_amount?: number | string | null;
  received_on?: string | null;
  receipt_source_note?: string | null;
};

export type MeasureAllocationRuleRecord = {
  id: string;
  measure_fund_id: string;
  rule: unknown;
  effective_from: string;
  adopted_note: string;
  stated_by: string;
  stated_on: string;
};

export type MeasureRecipientRecord = {
  id: string;
  measure_fund_id: string;
  name: string;
  recipient_kind: MeasureRecipientKind | string;
  external_reference: string | null;
  is_active: boolean;
  inactive_note: string | null;
};

export type MeasureRecipientBasisValueRecord = {
  id?: string | null;
  recipient_id: string;
  basis_id: string;
  vintage_label: string;
  basis_value: number | string;
  basis_source_note: string;
  stated_by?: string | null;
  stated_on?: string | null;
};

export type MeasureAllocationRecord = {
  id: string;
  measure_fund_id: string;
  period_id: string;
  category_id: string;
  recipient_id: string | null;
  allocation_rule_id: string | null;
  amount: number | string;
  computation_basis: MeasureComputationBasis | string;
  rationale: string | null;
  stated_by: string | null;
  stated_on: string | null;
};

/* ------------------------------------------------------------------ *
 * Projections — SEAM L1 -> L2/L3
 *
 * Import these. Do not re-spell a column string anywhere else: the claims lane,
 * the in-workspace panel and the public oversight page all read these same
 * tables, and three hand-written projections is three chances to omit the one
 * column a caveat depends on. `public-engagement-page.test.tsx` records what
 * that costs — a missing `.select()` column renders as absent data, not as an
 * error.
 * ------------------------------------------------------------------ */

export const MEASURE_FUND_COLUMNS =
  "id, workspace_id, program_id, ordinance_reference, rate_label, adopted_on, effective_from, " +
  "sunset_posture, sunset_on, receipt_cadence, currency_code, fiscal_year_note, " +
  "public_share_enabled, public_share_token, created_at, updated_at";

/**
 * `forecast_basis_note` and `receipt_source_note` are in the projection on
 * purpose. A forecast with no stated basis and a receipt with no stated source
 * are exactly the figures a surface must caveat, and a column that is not
 * selected cannot be caveated.
 */
export const MEASURE_FUND_PERIOD_COLUMNS =
  "id, measure_fund_id, period_label, fiscal_year_label, period_start, period_end, " +
  "forecast_amount, forecast_basis_note, received_amount, received_on, receipt_source_note, " +
  "recorded_by, recorded_at";

export const MEASURE_ALLOCATION_RULE_COLUMNS =
  "id, measure_fund_id, rule, effective_from, adopted_note, stated_by, stated_on";

export const MEASURE_RECIPIENT_COLUMNS =
  "id, measure_fund_id, name, recipient_kind, external_reference, is_active, inactive_note";

/** `basis_source_note` is never optional in a read: a figure with no source is not usable. */
export const MEASURE_RECIPIENT_BASIS_VALUE_COLUMNS =
  "id, recipient_id, basis_id, vintage_label, basis_value, basis_source_note, stated_by, stated_on";

/**
 * `computation_basis` and `rationale` are in the projection because the rule
 * that a hand-entered figure is never shown as a computed one can only be kept
 * by a surface that can see which it is.
 */
export const MEASURE_ALLOCATION_COLUMNS =
  "id, measure_fund_id, period_id, category_id, recipient_id, allocation_rule_id, amount, " +
  "computation_basis, rationale, stated_by, stated_on";

/**
 * What a period gave up before the categories were cut (20260812000014).
 *
 * `uncapped_amount`, `cap_amount` and `cap_status` are in the projection for
 * the same reason `computation_basis` is in the one above: without them a
 * surface can print what was taken but not that a cap bit, which is the whole
 * sentence an oversight committee is owed. `amount` alone is the figure; the
 * other three are what makes it checkable.
 */
export const MEASURE_OFF_THE_TOP_COLUMNS =
  "id, measure_fund_id, period_id, off_the_top_id, label, amount, uncapped_amount, " +
  "cap_amount, cap_basis, cap_status, allocation_rule_id, stated_by, stated_on";

/**
 * What a period kept back rather than dividing (20260812000019).
 *
 * `basis_kind`, `basis_category_label`, `basis_amount` and `percent` are in the
 * projection for the reason the columns beside them are: without them a surface
 * can print an amount but not what it was held out of or at what rate, and the
 * whole point of the line is that a committee member can check it. `amount`
 * alone is the figure; the rest is what makes it checkable.
 *
 * `basis_category_id` is selected too even though no surface prints it — it is
 * what lets a reader match a reserve to the purpose row it came out of, and a
 * column that is not selected cannot be used later without a second projection.
 */
export const MEASURE_RESERVE_COLUMNS =
  "id, measure_fund_id, period_id, reserve_id, label, basis_kind, basis_category_id, " +
  "basis_category_label, basis_amount, percent, amount, computed_amount, " +
  "allocation_rule_id, stated_by, stated_on";

/* ------------------------------------------------------------------ *
 * Small shared predicates
 * ------------------------------------------------------------------ */

/**
 * The rule version in force on a date: the latest one whose `effective_from` is
 * on or before it.
 *
 * Returns null rather than the earliest rule when every version postdates the
 * date. A period that predates the ordinance reading on file has no rule, and
 * saying so is the only honest answer — applying the oldest available split
 * would attribute money under terms nobody had adopted yet.
 */
export function resolveAllocationRuleInForce<T extends { effective_from: string }>(
  rules: readonly T[],
  onDate: string
): T | null {
  let chosen: T | null = null;
  for (const rule of rules) {
    if (rule.effective_from > onDate) continue;
    if (!chosen || rule.effective_from > chosen.effective_from) chosen = rule;
  }
  return chosen;
}
