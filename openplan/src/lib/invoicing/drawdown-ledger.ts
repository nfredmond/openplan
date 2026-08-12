import {
  CLAIMED_INVOICE_STATUSES,
  computeInvoiceRetentionWithheld,
  computeNetInvoiceAmount,
  isClaimedInvoiceStatus,
  parseCurrencyAmount,
  roundCurrencyAmount,
  type BillingInvoiceRecordLike,
} from "@/lib/invoicing/invoice-records";
import { looksLikePendingSchema } from "@/lib/supabase/pending-schema";

/**
 * THE REIMBURSEMENT DRAWDOWN LEDGER — one place that answers "where does this
 * award stand with its funder", for a grant-reimbursement award of ANY
 * jurisdiction.
 *
 * WHAT THIS IS NOT. It is not OpenPlan billing anyone. The direction of money
 * here is an agency claiming reimbursement FROM its funder; `funding_awards` is
 * the authorization and `billing_invoice_records` are the claims made against
 * it. Nothing in this module prices, charges, or gates anything.
 *
 * WHY IT IS PURE. Every figure below is arithmetic over rows the caller already
 * read through its own client. Mechanical arithmetic that nobody sounded
 * worried about is exactly where this repository's audits keep finding hollow
 * code, so the arithmetic is isolated from I/O where a hand-derived fixture can
 * pin every cent of it and a mutation to any single line changes a number a
 * test names.
 *
 * WHY NOTHING IS STORED. Invoiced-to-date, paid-to-date, retention held and
 * retention still pending are all derivations over rows that already exist. A
 * stored roll-up column is a second answer waiting to disagree with the first —
 * `billing_invoice_records.net_amount` is precisely that mistake already in the
 * schema (a plain column with `DEFAULT 0`, see the note on `grossAmount` below),
 * and this module does not repeat it.
 *
 * THE STATUS PARTITION, stated so it cannot be read two ways:
 *
 *   CLAIMED  = internal_review | submitted | approved_for_payment | paid
 *   EXCLUDED = draft | rejected
 *
 * A draft has not been claimed from the funder; a rejected claim never will be.
 * Both are REPORTED as their own figures and folded into no total, because an
 * unreported amount is not zero — a planner who cannot see the $55,000 the
 * funder rejected cannot act on it.
 *
 * `approved_for_payment` is CLAIMED but not PAID. A funder's approval is a
 * promise, not a deposit; `award-closure.ts` already draws that line for
 * close-out coverage and this module draws it identically, which is why
 * `paidToDate` here is required by test to equal the close-out evaluator's
 * `coverage.paidAmount` over the same rows.
 */

/** The award row, in the shape the ledger needs it. */
export type DrawdownAwardLike = {
  awarded_amount?: number | string | null;
  match_amount?: number | string | null;
  match_posture?: string | null;
};

/**
 * An invoice row, in the shape the ledger needs it.
 *
 * `paid_date` is entered by a human and may be absent on a paid invoice; see
 * `paidWithNoDateCount`. It is deliberately NOT defaulted to the invoice date
 * or to today — either would manufacture a payment date nobody recorded.
 */
export type DrawdownInvoiceLike = BillingInvoiceRecordLike & {
  id?: string | null;
  invoice_number?: string | null;
  invoice_date?: string | null;
  paid_date?: string | null;
};

/**
 * One invoice as the ledger sees it: the three money figures plus the two
 * predicates the aggregates were built from.
 *
 * The worksheet builder is handed these and never raw invoice rows, so it is
 * structurally incapable of doing its own arithmetic — a document that summed
 * its own lines would be a second definition of what this award has claimed.
 */
export type LedgerInvoiceLine = {
  invoiceId: string | null;
  invoiceNumber: string | null;
  status: string;
  invoiceDate: string | null;
  dueDate: string | null;
  paidDate: string | null;
  /**
   * The amount claimed before retention, from `amount`.
   *
   * Never from the stored `net_amount` column. That column is a plain
   * `NUMERIC DEFAULT 0`, not generated: any writer other than the invoicing
   * composer can leave a zero there, and the same invoice would then be worth
   * $0 in one figure and its full value in another. Net is recomputed here
   * from `amount` and the retention fields, every time.
   */
  grossAmount: number;
  retentionWithheld: number;
  netAmount: number;
  isClaimed: boolean;
  isPaid: boolean;
};

export type AwardDrawdownLedger = {
  /**
   * `funding_awards.awarded_amount`, or null when it is 0.
   *
   * The column is `NOT NULL DEFAULT 0`, so a zero cannot be told apart from an
   * award whose amount nobody entered. Reporting "$0 authorized" would state a
   * fact the database does not hold, so the ledger reports null and the surface
   * says "not recorded". Every figure derived from it is null too.
   */
  authorizedAmount: number | null;
  /**
   * `funding_awards.match_amount`, or null when it is 0 — same
   * `NOT NULL DEFAULT 0` problem as the authorized amount. `matchPosture`
   * carries the difference a zero cannot: `not_required` beside a null match is
   * a genuine "none needed", while `partial` beside a null match is "nobody has
   * entered it yet".
   *
   * No match SHARE is computed. "Share of what" has two defensible answers —
   * of the award, or of the total project cost — and the database records
   * neither as the intended denominator.
   */
  matchAmount: number | null;
  matchPosture: string | null;

  /** Σ gross over CLAIMED. What has been asked of the funder, before retention. */
  claimedGrossToDate: number;
  claimedCount: number;

  /** Σ net over `paid`. Must equal the close-out evaluator's `coverage.paidAmount`. */
  paidToDate: number;
  paidCount: number;
  /**
   * How many `paid` invoices carry no `paid_date`.
   *
   * `status = 'paid'` is the fact; a null date means the date is unrecorded.
   * These rows still count in `paidToDate` — the money arrived — but any
   * date-scoped view of this ledger must exclude them and say how many it
   * excluded, rather than quietly treating them as paid on the invoice date.
   */
  paidWithNoDateCount: number;

  /** Σ net over CLAIMED-but-not-paid. Money asked for and not yet received. */
  outstandingClaimed: number;
  outstandingCount: number;

  /**
   * Σ retention over PAID invoices only.
   *
   * Retention is money the funder WITHHELD from a payment. On an unpaid claim
   * nothing has been withheld yet — the retention is merely proposed — so
   * counting it as held would report the agency as owed money nobody has kept
   * back. The proposed amount is reported separately below.
   */
  retentionHeld: number;
  /** Σ retention over CLAIMED-but-not-paid: proposed, not yet withheld. */
  retentionPendingOnUnpaid: number;

  /** Σ net over `draft`. Reported, never folded into a claimed total. */
  draftedNotClaimed: number;
  draftedCount: number;

  /** Σ gross over `rejected`. Reported, never folded into a claimed total. */
  rejectedGross: number;
  rejectedCount: number;

  /**
   * `authorizedAmount − claimedGrossToDate`, DELIBERATELY NOT CLAMPED.
   *
   * A negative value is an over-claim against the authorization, and it is one
   * of the few things in this module a planner must act on immediately. The
   * workspace-level roll-up on /grants clamps its equivalent at zero, which is
   * defensible for a portfolio total that mixes many awards; per award it would
   * hide the overage entirely.
   *
   * Null whenever `authorizedAmount` is null — there is no remainder of an
   * amount nobody recorded.
   */
  remainingAuthorized: number | null;

  lines: LedgerInvoiceLine[];
};

/**
 * The invoice rows, or the reason there are none to show.
 *
 * The ledger takes this rather than an array so a failed read cannot arrive as
 * `[]` and be rendered as a complete ledger of zeros. That is the exact defect
 * class the safety lane just removed from crash counts, and it is worse in
 * money: "you have claimed $0 of $250,000" reads as an urgent, actionable fact
 * and is a database error wearing a number.
 */
export type DrawdownInvoiceRead =
  | { ok: true; invoices: DrawdownInvoiceLike[] }
  | { ok: false; pending: boolean; message: string };

export type AwardDrawdownLedgerResult =
  | { ok: true; ledger: AwardDrawdownLedger }
  | { ok: false; pending: boolean; message: string };

/**
 * Turn a Supabase `{ data, error }` into a `DrawdownInvoiceRead`.
 *
 * Lives here so every caller classifies a read failure the same way and none of
 * them has to remember that an unapplied migration is a setup gap rather than a
 * fault. `pending` is true when the error text is PostgREST telling us a column
 * or table is missing — the caller shows "finish setting up" instead of an
 * error.
 */
export function toDrawdownInvoiceRead(result: {
  data?: DrawdownInvoiceLike[] | null;
  error?: { message?: string | null } | null;
}): DrawdownInvoiceRead {
  if (result.error) {
    const message = result.error.message ?? "Invoice read failed.";
    return { ok: false, pending: looksLikePendingSchema(message), message };
  }

  return { ok: true, invoices: result.data ?? [] };
}

/** The columns a read feeding this ledger must select. */
export const DRAWDOWN_INVOICE_COLUMNS =
  "id, invoice_number, status, amount, retention_percent, retention_amount, invoice_date, due_date, paid_date";

/** Nullable award money: the column cannot tell 0 from "nobody entered it". */
function recordedAwardAmount(value: number | string | null | undefined): number | null {
  const parsed = parseCurrencyAmount(value);
  return parsed === 0 ? null : roundCurrencyAmount(parsed);
}

/**
 * Build the drawdown position for one award from its own invoice rows.
 *
 * Every total is rounded to the cent after each addition, matching
 * `summarizeBillingInvoiceRecords`, so the ledger and the invoice register
 * agree to the cent rather than drifting apart by float residue.
 */
export function buildAwardDrawdownLedger({
  award,
  invoiceRead,
}: {
  award: DrawdownAwardLike | null | undefined;
  invoiceRead: DrawdownInvoiceRead;
}): AwardDrawdownLedgerResult {
  if (!invoiceRead.ok) {
    return { ok: false, pending: invoiceRead.pending, message: invoiceRead.message };
  }

  const authorizedAmount = recordedAwardAmount(award?.awarded_amount);

  const ledger: AwardDrawdownLedger = {
    authorizedAmount,
    matchAmount: recordedAwardAmount(award?.match_amount),
    matchPosture: typeof award?.match_posture === "string" ? award.match_posture : null,
    claimedGrossToDate: 0,
    claimedCount: 0,
    paidToDate: 0,
    paidCount: 0,
    paidWithNoDateCount: 0,
    outstandingClaimed: 0,
    outstandingCount: 0,
    retentionHeld: 0,
    retentionPendingOnUnpaid: 0,
    draftedNotClaimed: 0,
    draftedCount: 0,
    rejectedGross: 0,
    rejectedCount: 0,
    remainingAuthorized: null,
    lines: [],
  };

  for (const invoice of invoiceRead.invoices) {
    const status = typeof invoice.status === "string" ? invoice.status : "draft";
    const grossAmount = parseCurrencyAmount(invoice.amount);
    const retentionWithheld = computeInvoiceRetentionWithheld(
      invoice.amount,
      invoice.retention_amount,
      invoice.retention_percent
    );
    const netAmount = computeNetInvoiceAmount(invoice.amount, invoice.retention_amount, invoice.retention_percent);
    const isPaid = status === "paid";
    const isClaimed = isClaimedInvoiceStatus(status);
    const paidDate = typeof invoice.paid_date === "string" && invoice.paid_date ? invoice.paid_date : null;

    ledger.lines.push({
      invoiceId: typeof invoice.id === "string" ? invoice.id : null,
      invoiceNumber: typeof invoice.invoice_number === "string" ? invoice.invoice_number : null,
      status,
      invoiceDate: typeof invoice.invoice_date === "string" && invoice.invoice_date ? invoice.invoice_date : null,
      dueDate: typeof invoice.due_date === "string" && invoice.due_date ? invoice.due_date : null,
      paidDate,
      grossAmount,
      retentionWithheld,
      netAmount,
      isClaimed,
      isPaid,
    });

    if (isClaimed) {
      ledger.claimedCount += 1;
      ledger.claimedGrossToDate = roundCurrencyAmount(ledger.claimedGrossToDate + grossAmount);
    }

    if (isPaid) {
      ledger.paidCount += 1;
      ledger.paidToDate = roundCurrencyAmount(ledger.paidToDate + netAmount);
      ledger.retentionHeld = roundCurrencyAmount(ledger.retentionHeld + retentionWithheld);
      if (!paidDate) {
        ledger.paidWithNoDateCount += 1;
      }
    } else if (isClaimed) {
      ledger.outstandingCount += 1;
      ledger.outstandingClaimed = roundCurrencyAmount(ledger.outstandingClaimed + netAmount);
      ledger.retentionPendingOnUnpaid = roundCurrencyAmount(
        ledger.retentionPendingOnUnpaid + retentionWithheld
      );
    }

    if (status === "draft") {
      ledger.draftedCount += 1;
      ledger.draftedNotClaimed = roundCurrencyAmount(ledger.draftedNotClaimed + netAmount);
    }

    if (status === "rejected") {
      ledger.rejectedCount += 1;
      ledger.rejectedGross = roundCurrencyAmount(ledger.rejectedGross + grossAmount);
    }
  }

  ledger.remainingAuthorized =
    authorizedAmount === null ? null : roundCurrencyAmount(authorizedAmount - ledger.claimedGrossToDate);

  return { ok: true, ledger };
}

/**
 * The statuses this ledger treats as claimed, re-exported so a surface can
 * label the partition without restating it.
 */
export { CLAIMED_INVOICE_STATUSES };
