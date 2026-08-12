import {
  computeInvoiceRetentionWithheld,
  computeNetInvoiceAmount,
  parseCurrencyAmount,
  roundCurrencyAmount,
} from "@/lib/invoicing/invoice-records";
import { looksLikePendingSchema } from "@/lib/supabase/pending-schema";
import type { StatusTone } from "@/lib/ui/status";
import { isNarrativeRule, type MeasureAllocationRule } from "@/lib/measures/allocation";
import type { MeasureFundPeriodRecord } from "@/lib/measures/fund";

/**
 * CLAIMS AGAINST A LOCAL MEASURE FUND — the funder side of the reimbursement
 * seam, and the ledger that answers "where does this recipient stand".
 *
 * ============================================================================
 * THIS MODULE DEFINES NO MONEY FORMULA
 * ============================================================================
 *
 * Every arithmetic primitive below is IMPORTED from
 * `@/lib/invoicing/invoice-records`: `parseCurrencyAmount`,
 * `roundCurrencyAmount`, `computeInvoiceRetentionWithheld`,
 * `computeNetInvoiceAmount`. Not copied, not re-derived, not "adapted".
 *
 * The reason is the whole point of the design memo this lane came from. An
 * agency claiming reimbursement FROM its funder and an agency being claimed
 * against BY its sub-recipients are the same seam pointing in opposite
 * directions, and the moment those two directions compute a net differently —
 * a different rounding point, a different retention precedence — the product
 * holds two answers to "how much is this claim worth". The retention
 * precedence in particular (an explicit amount outranks the percentage) is a
 * rule nobody would think to re-derive identically.
 *
 * `allocation.ts` uses exact BigInt cents instead, and that is not a
 * contradiction: it DIVIDES, so it makes rounding decisions, and it only ever
 * emits at-the-cent values. This module only ADDS figures that are already at
 * the cent, so the invoice register's rule is both correct and the one that
 * matters for agreement.
 *
 * ============================================================================
 * THE STATUS PARTITION, MIRRORED EXACTLY
 * ============================================================================
 *
 *   CLAIMED  = submitted | under_review | approved | paid
 *   EXCLUDED = draft | denied | withdrawn
 *
 * The same partition as `CLAIMED_INVOICE_STATUSES` (invoice-records.ts:23) with
 * this side's vocabulary: a draft has not been asked for, a denied claim never
 * will be paid, and a withdrawn one was taken back. Both excluded groups are
 * REPORTED as their own figures and folded into no total — an unreported amount
 * is not zero, and a planner who cannot see the $22,500 the agency denied
 * cannot act on it.
 *
 * `approved` is CLAIMED but not PAID, for the same reason `approved_for_payment`
 * is on the invoice side: an approval is a promise, not a disbursement.
 *
 * ============================================================================
 * WHAT AN ABSENT ALLOCATION MEANS
 * ============================================================================
 *
 * `remainingAllocated` is null — never `0 − claimed` — when no allocation row
 * exists for that bucket. An allocation absent from the database is not an
 * allocation of nothing: it is a period nobody has allocated yet, or a pooled
 * category that has no per-recipient share by design. Reporting an over-claim
 * against a ceiling nobody set would send an agency chasing a recipient over a
 * number the database never held.
 *
 * Where an allocation IS recorded, `remainingAllocated` is UNCLAMPED, exactly
 * as `AwardDrawdownLedger.remainingAuthorized` is: a negative is an over-claim
 * against the ordinance's own split, and it is the one figure on this page an
 * administrator must act on today.
 *
 * ============================================================================
 * WHY CATEGORY TOTALS AND RECIPIENT BUCKETS ARE BOTH HERE
 * ============================================================================
 *
 * An ordinance that returns a category to source produces one allocation row
 * per recipient; a pooled category produces ONE row with no recipient. Summing
 * both into a per-recipient view would leave a pooled category's ceiling
 * invisible, and summing recipient buckets into a fund total would double-count
 * nothing but would MISS every pooled dollar. So the fund-level allocated and
 * remaining totals are computed over CATEGORY totals (which include both
 * shapes, each counted once), and the recipient buckets carry their own
 * remainder for the recipients that have one. Both are asserted by value in
 * `measure-claim-ledger.test.ts`.
 */

/* ------------------------------------------------------------------ *
 * Vocabulary
 * ------------------------------------------------------------------ */

export const MEASURE_CLAIM_STATUSES = [
  "draft",
  "submitted",
  "under_review",
  "approved",
  "paid",
  "denied",
  "withdrawn",
] as const;

export type MeasureClaimStatus = (typeof MEASURE_CLAIM_STATUSES)[number];

/**
 * Asked for and not refused. SEAM L2 -> L3: the oversight lane imports this
 * rather than defining a second answer to what "under review" counts as.
 */
export const CLAIMED_MEASURE_CLAIM_STATUSES = [
  "submitted",
  "under_review",
  "approved",
  "paid",
] as const satisfies readonly MeasureClaimStatus[];

/** Reported as their own figures, folded into no total. */
export const EXCLUDED_MEASURE_CLAIM_STATUSES = [
  "draft",
  "denied",
  "withdrawn",
] as const satisfies readonly MeasureClaimStatus[];

export function isClaimedMeasureClaimStatus(status: string): boolean {
  return (CLAIMED_MEASURE_CLAIM_STATUSES as readonly string[]).includes(status);
}

/**
 * The statuses that are waiting on the AGENCY rather than on the claimant.
 *
 * SEAM L2 -> L3: the review-reminder sweep reads exactly this list. Defined
 * here beside the partition it is carved out of, because a reminder that
 * disagreed with the ledger about what is outstanding would nag about claims
 * the page shows as settled.
 */
export const MEASURE_CLAIM_AWAITING_DECISION_STATUSES = [
  "submitted",
  "under_review",
] as const satisfies readonly MeasureClaimStatus[];

export function isMeasureClaimAwaitingDecision(status: string): boolean {
  return (MEASURE_CLAIM_AWAITING_DECISION_STATUSES as readonly string[]).includes(status);
}

export type MeasureClaimStatusOption = {
  value: MeasureClaimStatus;
  label: string;
  /** One sentence a reviewer can act on. Staff-facing; resident wording is Lane 3's. */
  description: string;
  /**
   * The shared badge vocabulary, imported rather than restated. A local union
   * would compile here and fail at the `<StatusBadge>` call site — which is how
   * a tone ends up silently falling back to neutral on a money surface.
   */
  tone: StatusTone;
};

export const MEASURE_CLAIM_STATUS_OPTIONS: readonly MeasureClaimStatusOption[] = [
  {
    value: "draft",
    label: "Draft",
    description: "Being prepared. Nothing has been asked of the fund yet.",
    tone: "neutral",
  },
  {
    value: "submitted",
    label: "Submitted",
    description: "The recipient has asked for this money and it is waiting on the agency.",
    tone: "warning",
  },
  {
    value: "under_review",
    label: "Under review",
    description: "Staff are checking the claim and its backup against the ordinance.",
    tone: "warning",
  },
  {
    value: "approved",
    label: "Approved",
    description: "Approved for payment. A promise, not a payment — the money has not left the fund.",
    tone: "success",
  },
  {
    value: "paid",
    label: "Paid",
    description: "Money has left the fund, on the date recorded against the claim.",
    tone: "success",
  },
  {
    value: "denied",
    label: "Denied",
    description: "Refused, with the reason on the record. Never folded into a claimed total.",
    tone: "danger",
  },
  {
    value: "withdrawn",
    label: "Withdrawn",
    description: "Taken back by the recipient. Never folded into a claimed total.",
    tone: "neutral",
  },
];

export function formatMeasureClaimStatusLabel(status: string): string {
  return MEASURE_CLAIM_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
}

/**
 * THE LIFECYCLE, as a table rather than a chain of `if`s.
 *
 * draft -> submitted -> under_review -> approved -> paid, plus denied and
 * withdrawn as exits. Two properties are worth stating because they are
 * decisions rather than omissions:
 *
 *   * `paid` and `denied` are TERMINAL. Un-paying a claim is a refund, which is
 *     a new movement of public money with its own record, not the deletion of
 *     the old one. Un-denying is a fresh claim.
 *   * `submitted -> approved` is permitted without passing through
 *     `under_review`. Small agencies review at the desk; forcing a state change
 *     nobody performs teaches people to click through it.
 */
export const MEASURE_CLAIM_TRANSITIONS: Record<MeasureClaimStatus, readonly MeasureClaimStatus[]> = {
  draft: ["submitted", "withdrawn"],
  submitted: ["under_review", "approved", "denied", "withdrawn"],
  under_review: ["approved", "denied", "withdrawn"],
  approved: ["paid", "denied"],
  paid: [],
  denied: [],
  withdrawn: [],
};

export function isAllowedMeasureClaimTransition(from: string, to: string): boolean {
  const allowed = MEASURE_CLAIM_TRANSITIONS[from as MeasureClaimStatus];
  return Boolean(allowed) && (allowed as readonly string[]).includes(to);
}

/** The states that record a decision author. Mirrors the migration's CHECK. */
export function measureClaimStatusRequiresDecider(status: string): boolean {
  return status === "under_review" || status === "approved" || status === "paid" || status === "denied";
}

export const MEASURE_CLAIM_DOCUMENT_ROLES = [
  { value: "invoice", label: "Invoice or billing detail" },
  { value: "proof_of_payment", label: "Proof of payment" },
  { value: "progress_report", label: "Progress report" },
  { value: "photo", label: "Photograph" },
  { value: "other", label: "Other backup" },
] as const;

export type MeasureClaimDocumentRole = (typeof MEASURE_CLAIM_DOCUMENT_ROLES)[number]["value"];

/* ------------------------------------------------------------------ *
 * Projections — SEAM L1/L2 -> L2/L3
 *
 * Supabase clients here are untyped on purpose, so a `.select()` string is
 * never checked against the schema and a typo surfaces at runtime as a
 * "pending migration" degrade. One constant per table, asserted by value in
 * the tests, is the only thing that makes that safe.
 * ------------------------------------------------------------------ */

export const MEASURE_CLAIM_COLUMNS =
  "id, workspace_id, measure_fund_id, recipient_id, period_id, fiscal_year_label, category_id, " +
  "claim_reference, description, amount, retention_percent, retention_amount, status, submitted_on, " +
  "decided_by, decided_at, decision_note, denial_reason, paid_on, payment_reference, " +
  "created_by, created_at, updated_at";

/**
 * SEAM L2 -> L3. The narrow projection the review-reminder sweep reads.
 *
 * Deliberately NOT the full row: a sweep that runs over every workspace has no
 * business pulling a claim's description or its decision note into a
 * notification job's memory. `submitted_on` is in it because the reminder is
 * about how long a claim has waited, and `fiscal_year_label` because the
 * reminder names the year.
 */
export const MEASURE_CLAIM_SWEEP_COLUMNS =
  "id, workspace_id, measure_fund_id, recipient_id, fiscal_year_label, category_id, amount, status, submitted_on";

export const MEASURE_CLAIM_DOCUMENT_COLUMNS =
  "id, workspace_id, claim_id, kb_document_id, document_role, note, attached_by, attached_at";

export const MEASURE_MOE_COLUMNS =
  "id, workspace_id, measure_fund_id, recipient_id, fiscal_year_label, required_amount, " +
  "reported_amount, basis_note, stated_by, stated_on, updated_at";

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

export type MeasureClaimRecord = {
  id?: string | null;
  measure_fund_id?: string | null;
  recipient_id?: string | null;
  period_id?: string | null;
  fiscal_year_label?: string | null;
  category_id?: string | null;
  claim_reference?: string | null;
  description?: string | null;
  amount?: number | string | null;
  retention_percent?: number | string | null;
  retention_amount?: number | string | null;
  status?: string | null;
  submitted_on?: string | null;
  decided_by?: string | null;
  decided_at?: string | null;
  decision_note?: string | null;
  denial_reason?: string | null;
  paid_on?: string | null;
  payment_reference?: string | null;
};

/**
 * An allocation row, in the shape the LEDGER needs it — not the full
 * `MeasureAllocationRecord`.
 *
 * The `BillingInvoiceRecordLike` convention. A ledger that demanded every
 * column would force a caller reading a narrower projection to fabricate the
 * rest, and a fabricated `computation_basis` is the difference between a
 * hand-entered figure and a computed one.
 */
export type MeasureAllocationLike = {
  period_id?: string | null;
  category_id?: string | null;
  recipient_id?: string | null;
  amount?: number | string | null;
  computation_basis?: string | null;
};

export type MeasureMoeRecord = {
  id?: string | null;
  recipient_id?: string | null;
  fiscal_year_label?: string | null;
  required_amount?: number | string | null;
  reported_amount?: number | string | null;
  basis_note?: string | null;
  stated_on?: string | null;
};

/**
 * The claim rows, or the reason there are none.
 *
 * The `DrawdownInvoiceRead` shape (drawdown-ledger.ts:196), copied for the
 * reason recorded there and reinforced here: a failed read arriving as `[]`
 * renders as "this recipient has claimed $0 of its $583,043 allocation", which
 * reads as an urgent, actionable fact and is a database error wearing a number.
 * A FAILED READ IS NOT AN EMPTY FUND.
 */
export type MeasureClaimRead =
  | { ok: true; claims: MeasureClaimRecord[] }
  | { ok: false; pending: boolean; message: string };

export function toMeasureClaimRead(result: {
  data?: MeasureClaimRecord[] | null;
  error?: { message?: string | null } | null;
}): MeasureClaimRead {
  if (result.error) {
    const message = result.error.message ?? "Measure claim read failed.";
    return { ok: false, pending: looksLikePendingSchema(message), message };
  }

  return { ok: true, claims: result.data ?? [] };
}

/* ------------------------------------------------------------------ *
 * Eligibility — against the measure's OWN categories, never a list in code
 * ------------------------------------------------------------------ */

export type MeasureClaimCategory = { id: string; label: string };

export type MeasureClaimCategoryResolution =
  | {
      ok: true;
      categories: MeasureClaimCategory[];
      /**
       * `ordinance_rule` — read off the descriptor in force.
       * `recorded_allocations` — the measure's rule is narrative text, so the
       * only machine-readable statement of its categories is what a person has
       * actually allocated to. Distinct because a surface must say which.
       */
      source: "ordinance_rule" | "recorded_allocations";
    }
  | { ok: false; reason: "no_categories_recorded"; message: string };

/**
 * What this measure says its money may be claimed for.
 *
 * NOTHING IS HARDCODED. There is no category list in this repository. For a
 * descriptor rule the list is the ordinance's own `categories`; for a narrative
 * rule — an ordinance the descriptor's closed vocabulary cannot express — the
 * list is the distinct `category_id`s a person has already entered by hand into
 * `measure_allocations`. That second path is what keeps an unusual ordinance
 * usable instead of blocked, and it is honest: a category nobody has ever
 * allocated to is a category this system has never been told about.
 *
 * Refuses when there is nothing at all, rather than accepting anything. A
 * measure with no rule and no allocations has not been set up, and letting a
 * claim declare its own category would make the eligibility check decorative.
 */
export function resolveMeasureClaimCategories({
  rule,
  recordedAllocationCategoryIds,
}: {
  rule: MeasureAllocationRule | null;
  recordedAllocationCategoryIds?: readonly string[];
}): MeasureClaimCategoryResolution {
  if (rule && !isNarrativeRule(rule)) {
    return {
      ok: true,
      source: "ordinance_rule",
      categories: rule.categories.map((category) => ({ id: category.id, label: category.label })),
    };
  }

  const recorded = [...new Set((recordedAllocationCategoryIds ?? []).filter((id) => id.trim().length > 0))].sort();
  if (recorded.length > 0) {
    return {
      ok: true,
      source: "recorded_allocations",
      // No label to offer: a hand-entered allocation carries an id and a
      // rationale, not an ordinance's own label. Showing the id is honest;
      // inventing a title-cased label would present a guess as the ordinance's
      // wording.
      categories: recorded.map((id) => ({ id, label: id })),
    };
  }

  return {
    ok: false,
    reason: "no_categories_recorded",
    message:
      "This measure has no categories recorded yet. Record the ordinance's allocation rule, or enter " +
      "this period's allocations by hand if the ordinance does not fit the rule form — a claim has to " +
      "be for something the measure says it pays for.",
  };
}

export type MeasureClaimEligibility =
  | { ok: true; category: MeasureClaimCategory }
  | {
      ok: false;
      reason: "category_not_in_measure" | "recipient_inactive";
      message: string;
      declaredCategoryIds: string[];
    };

/**
 * Whether this recipient may claim in this category under this measure.
 *
 * Both refusals name what is wrong in words a person can act on, and the
 * category refusal lists what the measure DOES declare — a 400 that says
 * "invalid category" and nothing else sends a clerk to read an ordinance PDF to
 * guess at a spelling.
 */
export function checkMeasureClaimEligibility({
  categories,
  categoryId,
  recipient,
}: {
  categories: readonly MeasureClaimCategory[];
  categoryId: string;
  recipient?: { name?: string | null; is_active?: boolean | null } | null;
}): MeasureClaimEligibility {
  const declaredCategoryIds = categories.map((category) => category.id);

  if (recipient && recipient.is_active === false) {
    return {
      ok: false,
      reason: "recipient_inactive",
      message:
        `${recipient.name?.trim() || "This recipient"} is retired and may not file new claims. ` +
        "Its existing claims and allocations stay on the record.",
      declaredCategoryIds,
    };
  }

  const match = categories.find((category) => category.id === categoryId);
  if (!match) {
    return {
      ok: false,
      reason: "category_not_in_measure",
      message:
        `This measure does not have a category called "${categoryId}". It declares: ` +
        `${declaredCategoryIds.join(", ") || "none"}.`,
      declaredCategoryIds,
    };
  }

  return { ok: true, category: match };
}

/* ------------------------------------------------------------------ *
 * The ledger
 * ------------------------------------------------------------------ */

/** One claim as the ledger sees it: three money figures and the two predicates. */
export type MeasureClaimLine = {
  claimId: string | null;
  recipientId: string | null;
  categoryId: string;
  fiscalYearLabel: string;
  claimReference: string | null;
  status: string;
  submittedOn: string | null;
  paidOn: string | null;
  decidedAt: string | null;
  hasDenialReason: boolean;
  /** Before retention, from `amount`. */
  grossAmount: number;
  retentionWithheld: number;
  netAmount: number;
  isClaimed: boolean;
  isPaid: boolean;
};

export type MeasureClaimBucket = {
  recipientId: string;
  categoryId: string;
  fiscalYearLabel: string;
  /** Σ recorded per-recipient allocations for this bucket. NULL means none is recorded. */
  allocatedAmount: number | null;
  claimedGross: number;
  claimedCount: number;
  paidNet: number;
  paidCount: number;
  outstandingNet: number;
  outstandingCount: number;
  /** `allocated − claimedGross`, UNCLAMPED. Null whenever `allocatedAmount` is null. */
  remainingAllocated: number | null;
  /** True only when a ceiling is recorded AND the claims exceed it. */
  isOverClaimed: boolean;
};

export type MeasureClaimCategoryTotal = {
  categoryId: string;
  fiscalYearLabel: string;
  /**
   * Σ every allocation in the category — pooled rows and per-recipient rows
   * alike, each counted once. Null when the category has no allocation at all.
   */
  allocatedAmount: number | null;
  /** True when at least one allocation in this category was entered by hand. */
  hasManualAllocation: boolean;
  claimedGross: number;
  claimedCount: number;
  remainingAllocated: number | null;
  isOverClaimed: boolean;
};

export type MeasureClaimLedger = {
  /** Σ gross over CLAIMED. What sub-recipients have asked the fund for. */
  claimedGrossTotal: number;
  claimedCount: number;
  claimedNetTotal: number;

  /** Σ net over `paid`. Money that has left the fund. */
  paidNetTotal: number;
  paidCount: number;
  /**
   * Paid claims carrying no payment date.
   *
   * `measure_claims_paid_has_a_date` makes this impossible in the database, so
   * it can only ever be zero — which is exactly why it is reported. A non-zero
   * value means the CHECK was removed and this table has inherited the invoice
   * register's defect. The figure costs nothing and would otherwise be
   * invisible.
   */
  paidWithNoDateCount: number;

  outstandingNetTotal: number;
  outstandingCount: number;
  /** Waiting on the agency rather than on the claimant. Drives the review queue. */
  awaitingDecisionCount: number;

  retentionHeld: number;
  retentionPendingOnUnpaid: number;

  /** Reported, folded into no total. */
  draftNetTotal: number;
  draftCount: number;
  deniedGrossTotal: number;
  deniedCount: number;
  withdrawnGrossTotal: number;
  withdrawnCount: number;

  /**
   * Σ allocation over CATEGORY totals — never over recipient buckets, which
   * would miss every pooled dollar. Null when nothing is allocated at all.
   */
  allocatedTotal: number | null;
  /** Σ category remainders, unclamped, over the categories that have a ceiling. */
  remainingAllocatedTotal: number | null;
  /** Categories whose allocation could not be established. Reported, never zero. */
  categoriesWithNoAllocationCount: number;
  /**
   * Allocation rows whose period was not among the periods supplied.
   *
   * A gap in the READ, not in the data. Those rows are excluded from every
   * total above because their fiscal year is unknown, and the count is here so
   * a surface can say the ceiling is incomplete instead of printing a total
   * that quietly dropped them.
   */
  allocationsWithUnknownPeriodCount: number;
  /** True when any allocation in the ledger was entered by hand rather than computed. */
  hasManualAllocation: boolean;

  buckets: MeasureClaimBucket[];
  categoryTotals: MeasureClaimCategoryTotal[];
  overClaimedBuckets: MeasureClaimBucket[];
  lines: MeasureClaimLine[];
};

export type MeasureClaimLedgerResult =
  | { ok: true; ledger: MeasureClaimLedger }
  | { ok: false; pending: boolean; message: string };

/**
 * A composite map key.
 *
 * The separator is written as the ESCAPE `\u0000`, never as a literal NUL byte.
 * An earlier draft embedded the raw character and it made this file `data`
 * rather than text: `grep` refused to search it, and any tool that treats a NUL
 * as end-of-content would have silently truncated it. The escape compiles to
 * exactly the same string.
 *
 * NUL rather than a hyphen or a space because a uuid, an ordinance's category
 * id and an agency's own fiscal-year label are all free-ish text, and a
 * separator any of them could contain would let two different buckets collide
 * into one — which in this module means two recipients' money added together.
 */
const KEY_SEPARATOR = "\u0000";

function bucketKey(recipientId: string, categoryId: string, fiscalYearLabel: string): string {
  return [recipientId, categoryId, fiscalYearLabel].join(KEY_SEPARATOR);
}

function categoryKey(categoryId: string, fiscalYearLabel: string): string {
  return [categoryId, fiscalYearLabel].join(KEY_SEPARATOR);
}

function textOrNull(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/**
 * Build the claim position for one measure fund.
 *
 * `buildAwardDrawdownLedger` with the direction of money reversed, and pure for
 * the same reason: mechanical arithmetic that nobody sounded worried about is
 * where this repository's audits keep finding hollow code, so it is isolated
 * from I/O where a hand-derived fixture can pin every cent and a mutation to any
 * single line changes a number a test names by value.
 *
 * The allocation side arrives as raw rows plus the period rows, and the fiscal
 * year is resolved HERE rather than by the caller. A caller that grouped
 * allocations by year itself would be doing arithmetic-adjacent work outside the
 * module the tests measure — and would have no honest place to report an
 * allocation whose period it could not find.
 */
export function buildMeasureClaimLedger({
  claimRead,
  allocations,
  periods,
}: {
  claimRead: MeasureClaimRead;
  allocations?: readonly MeasureAllocationLike[] | null;
  periods?: readonly MeasureFundPeriodRecord[] | null;
}): MeasureClaimLedgerResult {
  if (!claimRead.ok) {
    return { ok: false, pending: claimRead.pending, message: claimRead.message };
  }

  const fiscalYearByPeriodId = new Map<string, string>();
  for (const period of periods ?? []) {
    const id = textOrNull(period.id);
    const label = textOrNull(period.fiscal_year_label);
    if (id && label) fiscalYearByPeriodId.set(id, label);
  }

  const buckets = new Map<string, MeasureClaimBucket>();
  const categoryTotals = new Map<string, MeasureClaimCategoryTotal>();
  let allocationsWithUnknownPeriodCount = 0;

  const ensureBucket = (recipientId: string, categoryId: string, fiscalYearLabel: string): MeasureClaimBucket => {
    const key = bucketKey(recipientId, categoryId, fiscalYearLabel);
    const existing = buckets.get(key);
    if (existing) return existing;
    const created: MeasureClaimBucket = {
      recipientId,
      categoryId,
      fiscalYearLabel,
      allocatedAmount: null,
      claimedGross: 0,
      claimedCount: 0,
      paidNet: 0,
      paidCount: 0,
      outstandingNet: 0,
      outstandingCount: 0,
      remainingAllocated: null,
      isOverClaimed: false,
    };
    buckets.set(key, created);
    return created;
  };

  const ensureCategoryTotal = (categoryId: string, fiscalYearLabel: string): MeasureClaimCategoryTotal => {
    const key = categoryKey(categoryId, fiscalYearLabel);
    const existing = categoryTotals.get(key);
    if (existing) return existing;
    const created: MeasureClaimCategoryTotal = {
      categoryId,
      fiscalYearLabel,
      allocatedAmount: null,
      hasManualAllocation: false,
      claimedGross: 0,
      claimedCount: 0,
      remainingAllocated: null,
      isOverClaimed: false,
    };
    categoryTotals.set(key, created);
    return created;
  };

  /* THE CEILING ---------------------------------------------------- */
  for (const allocation of allocations ?? []) {
    const categoryId = textOrNull(allocation.category_id);
    const periodId = textOrNull(allocation.period_id);
    if (!categoryId || !periodId) continue;

    const fiscalYearLabel = fiscalYearByPeriodId.get(periodId);
    if (!fiscalYearLabel) {
      // The allocation exists and its year is unknown. Dropping it silently
      // would understate the ceiling, which is the direction that manufactures
      // an over-claim; counting it into the wrong year would be worse.
      allocationsWithUnknownPeriodCount += 1;
      continue;
    }

    const amount = parseCurrencyAmount(allocation.amount);
    const categoryTotal = ensureCategoryTotal(categoryId, fiscalYearLabel);
    categoryTotal.allocatedAmount = roundCurrencyAmount((categoryTotal.allocatedAmount ?? 0) + amount);
    if (allocation.computation_basis === "manual") {
      categoryTotal.hasManualAllocation = true;
    }

    const recipientId = textOrNull(allocation.recipient_id);
    if (recipientId) {
      const bucket = ensureBucket(recipientId, categoryId, fiscalYearLabel);
      bucket.allocatedAmount = roundCurrencyAmount((bucket.allocatedAmount ?? 0) + amount);
    }
  }

  /* THE CLAIMS ----------------------------------------------------- */
  const ledger: MeasureClaimLedger = {
    claimedGrossTotal: 0,
    claimedCount: 0,
    claimedNetTotal: 0,
    paidNetTotal: 0,
    paidCount: 0,
    paidWithNoDateCount: 0,
    outstandingNetTotal: 0,
    outstandingCount: 0,
    awaitingDecisionCount: 0,
    retentionHeld: 0,
    retentionPendingOnUnpaid: 0,
    draftNetTotal: 0,
    draftCount: 0,
    deniedGrossTotal: 0,
    deniedCount: 0,
    withdrawnGrossTotal: 0,
    withdrawnCount: 0,
    allocatedTotal: null,
    remainingAllocatedTotal: null,
    categoriesWithNoAllocationCount: 0,
    allocationsWithUnknownPeriodCount,
    hasManualAllocation: false,
    buckets: [],
    categoryTotals: [],
    overClaimedBuckets: [],
    lines: [],
  };

  for (const claim of claimRead.claims) {
    const status = typeof claim.status === "string" ? claim.status : "draft";
    const categoryId = textOrNull(claim.category_id) ?? "";
    const fiscalYearLabel = textOrNull(claim.fiscal_year_label) ?? "";
    const recipientId = textOrNull(claim.recipient_id);

    const grossAmount = parseCurrencyAmount(claim.amount);
    const retentionWithheld = computeInvoiceRetentionWithheld(
      claim.amount,
      claim.retention_amount,
      claim.retention_percent
    );
    const netAmount = computeNetInvoiceAmount(claim.amount, claim.retention_amount, claim.retention_percent);

    const isPaid = status === "paid";
    const isClaimed = isClaimedMeasureClaimStatus(status);
    const paidOn = textOrNull(claim.paid_on);

    ledger.lines.push({
      claimId: textOrNull(claim.id),
      recipientId,
      categoryId,
      fiscalYearLabel,
      claimReference: textOrNull(claim.claim_reference),
      status,
      submittedOn: textOrNull(claim.submitted_on),
      paidOn,
      decidedAt: textOrNull(claim.decided_at),
      hasDenialReason: Boolean(textOrNull(claim.denial_reason)),
      grossAmount,
      retentionWithheld,
      netAmount,
      isClaimed,
      isPaid,
    });

    if (isClaimed) {
      ledger.claimedCount += 1;
      ledger.claimedGrossTotal = roundCurrencyAmount(ledger.claimedGrossTotal + grossAmount);
      ledger.claimedNetTotal = roundCurrencyAmount(ledger.claimedNetTotal + netAmount);
    }

    if (isPaid) {
      ledger.paidCount += 1;
      ledger.paidNetTotal = roundCurrencyAmount(ledger.paidNetTotal + netAmount);
      ledger.retentionHeld = roundCurrencyAmount(ledger.retentionHeld + retentionWithheld);
      if (!paidOn) {
        ledger.paidWithNoDateCount += 1;
      }
    } else if (isClaimed) {
      ledger.outstandingCount += 1;
      ledger.outstandingNetTotal = roundCurrencyAmount(ledger.outstandingNetTotal + netAmount);
      ledger.retentionPendingOnUnpaid = roundCurrencyAmount(ledger.retentionPendingOnUnpaid + retentionWithheld);
    }

    if (isMeasureClaimAwaitingDecision(status)) {
      ledger.awaitingDecisionCount += 1;
    }

    if (status === "draft") {
      ledger.draftCount += 1;
      ledger.draftNetTotal = roundCurrencyAmount(ledger.draftNetTotal + netAmount);
    }

    if (status === "denied") {
      ledger.deniedCount += 1;
      ledger.deniedGrossTotal = roundCurrencyAmount(ledger.deniedGrossTotal + grossAmount);
    }

    if (status === "withdrawn") {
      ledger.withdrawnCount += 1;
      ledger.withdrawnGrossTotal = roundCurrencyAmount(ledger.withdrawnGrossTotal + grossAmount);
    }

    // Only CLAIMED money consumes a ceiling. A draft has not been asked for and
    // a denied or withdrawn claim never will be paid, so counting either
    // against an allocation would report a recipient as having spent an
    // authorization it still holds — the mistake `uninvoicedCommittedAwardAmount`
    // exists to record on the other side of this seam.
    if (isClaimed) {
      const categoryTotal = ensureCategoryTotal(categoryId, fiscalYearLabel);
      categoryTotal.claimedCount += 1;
      categoryTotal.claimedGross = roundCurrencyAmount(categoryTotal.claimedGross + grossAmount);

      if (recipientId) {
        const bucket = ensureBucket(recipientId, categoryId, fiscalYearLabel);
        bucket.claimedCount += 1;
        bucket.claimedGross = roundCurrencyAmount(bucket.claimedGross + grossAmount);
        if (isPaid) {
          bucket.paidCount += 1;
          bucket.paidNet = roundCurrencyAmount(bucket.paidNet + netAmount);
        } else {
          bucket.outstandingCount += 1;
          bucket.outstandingNet = roundCurrencyAmount(bucket.outstandingNet + netAmount);
        }
      }
    }
  }

  /* THE REMAINDERS ------------------------------------------------- */
  let allocatedTotal: number | null = null;
  let remainingAllocatedTotal: number | null = null;

  for (const categoryTotal of categoryTotals.values()) {
    if (categoryTotal.allocatedAmount === null) {
      ledger.categoriesWithNoAllocationCount += 1;
      continue;
    }
    if (categoryTotal.hasManualAllocation) {
      ledger.hasManualAllocation = true;
    }
    // UNCLAMPED. A negative remainder is an over-claim against the ordinance's
    // own split, and it is the figure an administrator must act on today.
    categoryTotal.remainingAllocated = roundCurrencyAmount(
      categoryTotal.allocatedAmount - categoryTotal.claimedGross
    );
    categoryTotal.isOverClaimed = categoryTotal.remainingAllocated < 0;
    allocatedTotal = roundCurrencyAmount((allocatedTotal ?? 0) + categoryTotal.allocatedAmount);
    remainingAllocatedTotal = roundCurrencyAmount(
      (remainingAllocatedTotal ?? 0) + categoryTotal.remainingAllocated
    );
  }

  for (const bucket of buckets.values()) {
    if (bucket.allocatedAmount === null) continue;
    bucket.remainingAllocated = roundCurrencyAmount(bucket.allocatedAmount - bucket.claimedGross);
    bucket.isOverClaimed = bucket.remainingAllocated < 0;
  }

  ledger.allocatedTotal = allocatedTotal;
  ledger.remainingAllocatedTotal = remainingAllocatedTotal;

  const sortByKey = <T extends { categoryId: string; fiscalYearLabel: string }>(left: T, right: T) =>
    left.fiscalYearLabel.localeCompare(right.fiscalYearLabel) || left.categoryId.localeCompare(right.categoryId);

  ledger.categoryTotals = [...categoryTotals.values()].sort(sortByKey);
  ledger.buckets = [...buckets.values()].sort(
    (left, right) => sortByKey(left, right) || left.recipientId.localeCompare(right.recipientId)
  );
  ledger.overClaimedBuckets = ledger.buckets.filter((bucket) => bucket.isOverClaimed);

  return { ok: true, ledger };
}

/* ------------------------------------------------------------------ *
 * Maintenance of effort
 * ------------------------------------------------------------------ */

export type MeasureMoeStatus = "met" | "shortfall" | "not_determined";

export type MeasureMoeLine = {
  recipientId: string | null;
  fiscalYearLabel: string;
  requiredAmount: number | null;
  reportedAmount: number | null;
  /** `reported − required`, only where BOTH are present. */
  differenceAmount: number | null;
  status: MeasureMoeStatus;
  /** Which side is missing, in a sentence a person can act on. Null when neither is. */
  notDeterminedReason: string | null;
  hasBasisNote: boolean;
};

export type MeasureMoeSummary = {
  recordCount: number;
  comparableCount: number;
  notDeterminedCount: number;
  metCount: number;
  shortfallCount: number;
  /** Σ |difference| over the SHORTFALL records only. A magnitude, never negative. */
  shortfallTotal: number | null;
  /**
   * Σ signed difference over comparable records.
   *
   * NOT a compliance figure and must never be captioned as one: one recipient's
   * surplus does not cover another's shortfall, because maintenance of effort
   * is an obligation of each body separately. It is here so a page can show the
   * size of the comparable set without inviting the netting; `shortfallTotal`
   * and `shortfallCount` are what a reviewer acts on.
   */
  netDifferenceTotal: number | null;
  lines: MeasureMoeLine[];
};

/** An amount, or null when it is absent — never coerced to zero. */
function moeAmount(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && !value.trim()) return null;
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return null;
  return roundCurrencyAmount(parsed);
}

/**
 * Maintenance of effort, with `not_determined` first-class.
 *
 * The `buildRtpFiscalConstraint` posture: a difference is computed only where
 * both figures are present, and absence answers not_determined rather than
 * "met". A missing reported figure treated as zero would report every quiet
 * recipient as having abandoned its local spending entirely; a missing required
 * figure treated as zero would report every one of them as compliant. Both are
 * stories about a public body's finances that the database does not support.
 *
 * There is no stored verdict anywhere for this to disagree with — see the
 * migration header on why `measure_moe_records` has no verdict column.
 */
export function buildMeasureMoeSummary({
  records,
}: {
  records?: readonly MeasureMoeRecord[] | null;
}): MeasureMoeSummary {
  const lines: MeasureMoeLine[] = [];
  let comparableCount = 0;
  let metCount = 0;
  let shortfallCount = 0;
  let shortfallTotal = 0;
  let netDifferenceTotal = 0;

  for (const record of records ?? []) {
    const requiredAmount = moeAmount(record.required_amount);
    const reportedAmount = moeAmount(record.reported_amount);

    let status: MeasureMoeStatus = "not_determined";
    let differenceAmount: number | null = null;
    let notDeterminedReason: string | null = null;

    if (requiredAmount !== null && reportedAmount !== null) {
      differenceAmount = roundCurrencyAmount(reportedAmount - requiredAmount);
      status = differenceAmount < 0 ? "shortfall" : "met";
      comparableCount += 1;
      netDifferenceTotal = roundCurrencyAmount(netDifferenceTotal + differenceAmount);
      if (status === "shortfall") {
        shortfallCount += 1;
        shortfallTotal = roundCurrencyAmount(shortfallTotal + Math.abs(differenceAmount));
      } else {
        metCount += 1;
      }
    } else if (requiredAmount === null && reportedAmount === null) {
      notDeterminedReason = "Neither the required figure nor the reported figure has been recorded.";
    } else if (requiredAmount === null) {
      notDeterminedReason = "The ordinance's required figure has not been recorded for this year.";
    } else {
      notDeterminedReason = "The recipient has not reported its own spending for this year.";
    }

    lines.push({
      recipientId: textOrNull(record.recipient_id),
      fiscalYearLabel: textOrNull(record.fiscal_year_label) ?? "",
      requiredAmount,
      reportedAmount,
      differenceAmount,
      status,
      notDeterminedReason,
      hasBasisNote: Boolean(textOrNull(record.basis_note)),
    });
  }

  return {
    recordCount: lines.length,
    comparableCount,
    notDeterminedCount: lines.length - comparableCount,
    metCount,
    shortfallCount,
    shortfallTotal: shortfallCount > 0 ? shortfallTotal : null,
    netDifferenceTotal: comparableCount > 0 ? netDifferenceTotal : null,
    lines,
  };
}
