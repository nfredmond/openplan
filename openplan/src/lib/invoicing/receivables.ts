/**
 * Receivable invoicing — pure helpers for the consultant/agency workspace
 * billing ITS OWN clients (accounts receivable). The mirror direction of
 * invoice-records.ts, which handles the agency invoicing its funder for
 * reimbursement (accounts payable to the workspace).
 *
 * One retention math serves both directions: this module delegates to the
 * existing computeRetentionAmount/computeNetInvoiceAmount exports rather than
 * re-deriving them.
 *
 * Conventions shared with invoice-records.ts: record-like tolerant types
 * (snake_case, number|string|null), exported constants, no I/O.
 */

import {
  computeNetInvoiceAmount,
  computeRetentionAmount,
  parseCurrencyAmount,
} from "./invoice-records";

export const CLIENT_INVOICE_STATUSES = ["draft", "sent", "paid", "void"] as const;

export type ClientInvoiceStatus = (typeof CLIENT_INVOICE_STATUSES)[number];

export type ClientInvoiceRecordLike = {
  id?: string | null;
  status?: string | null;
  engagement_id?: string | null;
  subtotal_amount?: number | string | null;
  retention_percent?: number | string | null;
  retention_amount?: number | string | null;
  total_amount?: number | string | null;
  due_date?: string | null;
};

export type ClientInvoiceLineItemLike = {
  quantity?: number | string | null;
  unit_amount?: number | string | null;
  amount?: number | string | null;
};

export type InvoicingEngagementLike = {
  id?: string | null;
  not_to_exceed_amount?: number | string | null;
};

export type ClientInvoiceTotals = {
  subtotalAmount: number;
  retentionPercent: number;
  retentionAmount: number;
  totalAmount: number;
};

export type ReceivableAgingBucket =
  | "current"
  | "days_1_30"
  | "days_31_60"
  | "days_61_90"
  | "days_over_90";

export const RECEIVABLE_AGING_BUCKETS: readonly ReceivableAgingBucket[] = [
  "current",
  "days_1_30",
  "days_31_60",
  "days_61_90",
  "days_over_90",
] as const;

export type ReceivableAgingBucketSummary = {
  count: number;
  amount: number;
};

export type ReceivableAgingSummary = {
  buckets: Record<ReceivableAgingBucket, ReceivableAgingBucketSummary>;
  /**
   * Outstanding (sent) invoices with no due date. They cannot be aged without
   * guessing, so they land here explicitly instead of in a bucket.
   */
  undatedCount: number;
  undatedAmount: number;
};

/** Headline shape mirrors BillingInvoiceSummary in invoice-records.ts. */
export type ClientInvoiceReceivableSummary = {
  totalCount: number;
  draftCount: number;
  sentCount: number;
  paidCount: number;
  voidCount: number;
  overdueCount: number;
  overdueAmount: number;
  /** Sum of invoice totals excluding void invoices — a voided invoice has no receivable value. */
  totalAmount: number;
  outstandingAmount: number;
  paidAmount: number;
  draftAmount: number;
};

export type EngagementBilledSummary = {
  /** Sum of sent + paid invoice totals. Void is excluded; draft is not yet billed. */
  billedToDate: number;
  /** Sum of draft invoice totals — composed but not yet sent. */
  draftedUnbilled: number;
  notToExceed: number | null;
  /** notToExceed minus billedToDate; null when there is no NTE ceiling. */
  remaining: number | null;
  isOverNte: boolean;
};

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function parseOptionalAmount(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = parseCurrencyAmount(value);
  // parseCurrencyAmount maps unparseable strings to 0; distinguish a real 0.
  if (parsed === 0 && typeof value === "string" && Number.parseFloat(value) !== 0) {
    return null;
  }
  return parsed;
}

/**
 * The amount for one line item. Unit math (quantity × unit_amount) wins
 * whenever both parts are present, so a stale stored amount can never
 * contradict the visible quantity and rate; otherwise the explicit amount
 * stands.
 */
export function computeLineItemAmount(item: ClientInvoiceLineItemLike): number {
  const quantity = parseOptionalAmount(item.quantity);
  const unitAmount = parseOptionalAmount(item.unit_amount);

  if (quantity !== null && unitAmount !== null) {
    return roundCurrency(quantity * unitAmount);
  }

  return roundCurrency(Math.max(0, parseCurrencyAmount(item.amount)));
}

/**
 * Invoice totals from its line items. Retention math is delegated to the
 * invoice-records exports so both invoicing directions share exactly one
 * implementation.
 */
export function summarizeClientInvoiceTotals(
  lineItems: ClientInvoiceLineItemLike[] | null | undefined,
  retentionPercentInput: number | string | null | undefined = 0
): ClientInvoiceTotals {
  const subtotalAmount = roundCurrency(
    (lineItems ?? []).reduce((sum, item) => sum + computeLineItemAmount(item), 0)
  );
  const retentionPercent = Math.min(100, Math.max(0, parseCurrencyAmount(retentionPercentInput)));
  const retentionAmount = computeRetentionAmount(subtotalAmount, retentionPercent);
  const totalAmount = computeNetInvoiceAmount(subtotalAmount, retentionAmount, retentionPercent);

  return { subtotalAmount, retentionPercent, retentionAmount, totalAmount };
}

/**
 * The receivable value of one invoice. Mirrors the line-item rule: derived
 * math wins when its inputs are present — subtotal minus retention (via the
 * shared retention implementation) whenever a subtotal exists, so a stale
 * stored total_amount can never contradict the visible parts.
 *
 * One honesty carve-out, because DB rows ALWAYS carry a subtotal
 * (subtotal_amount is NOT NULL DEFAULT 0 in 20260727000010, so a row read
 * from the database can never reach the missing-subtotal fallback): a ZERO
 * subtotal alongside a NONZERO stored total is the column default on a row
 * whose line items were never rolled up, not a computed value — deriving from
 * it would erase a real receivable, so the stored total stands. A row whose
 * subtotal was genuinely computed to 0 also stores total 0 and still answers 0.
 */
export function receivableInvoiceAmount(record: ClientInvoiceRecordLike): number {
  const subtotal = parseOptionalAmount(record.subtotal_amount);
  const storedTotal = parseOptionalAmount(record.total_amount);
  const subtotalIsColumnDefault = subtotal === 0 && storedTotal !== null && storedTotal !== 0;

  if (subtotal !== null && !subtotalIsColumnDefault) {
    return computeNetInvoiceAmount(subtotal, record.retention_amount, record.retention_percent);
  }

  return storedTotal !== null ? roundCurrency(Math.max(0, storedTotal)) : 0;
}

/** An invoice is outstanding when it has been sent and is neither paid nor void. */
export function isReceivableOutstanding(status: string | null | undefined): boolean {
  return status === "sent";
}

/**
 * Overdue begins the day AFTER the due date — an invoice due today is not yet
 * overdue. Deliberately the same whole-day arithmetic as the aging bucketer
 * (daysPastDue >= 1 ⇔ the days_1_30 and later buckets), so the overdue flag
 * and the aging buckets can never disagree at the boundary.
 */
export function isReceivableOverdue(
  status: string | null | undefined,
  dueDate: string | null | undefined,
  nowInput: Date | string = new Date()
): boolean {
  if (!isReceivableOutstanding(status) || !dueDate) {
    return false;
  }

  const now = nowInput instanceof Date ? nowInput : new Date(nowInput);
  const days = daysPastDue(dueDate, now);
  return days !== null && days >= 1;
}

function daysPastDue(dueDate: string, now: Date): number | null {
  const parsed = new Date(dueDate);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return Math.floor((now.getTime() - parsed.getTime()) / (24 * 60 * 60 * 1000));
}

function agingBucketForDays(days: number): ReceivableAgingBucket {
  if (days <= 0) return "current";
  if (days <= 30) return "days_1_30";
  if (days <= 60) return "days_31_60";
  if (days <= 90) return "days_61_90";
  return "days_over_90";
}

/**
 * Aging applies ONLY to sent invoices — draft is not yet a receivable, paid is
 * settled, void never was one. Sent invoices without a parseable due date are
 * reported in the explicit undated count, never guessed into a bucket.
 */
export function buildReceivableAgingSummary(
  invoices: ClientInvoiceRecordLike[] | null | undefined,
  nowInput: Date | string = new Date()
): ReceivableAgingSummary {
  const now = nowInput instanceof Date ? nowInput : new Date(nowInput);

  const buckets = Object.fromEntries(
    RECEIVABLE_AGING_BUCKETS.map((bucket) => [bucket, { count: 0, amount: 0 }])
  ) as Record<ReceivableAgingBucket, ReceivableAgingBucketSummary>;

  let undatedCount = 0;
  let undatedAmount = 0;

  for (const invoice of invoices ?? []) {
    if (!isReceivableOutstanding(invoice.status)) {
      continue;
    }

    const amount = receivableInvoiceAmount(invoice);
    const days = invoice.due_date ? daysPastDue(invoice.due_date, now) : null;

    if (days === null) {
      undatedCount += 1;
      undatedAmount = roundCurrency(undatedAmount + amount);
      continue;
    }

    const bucket = buckets[agingBucketForDays(days)];
    bucket.count += 1;
    bucket.amount = roundCurrency(bucket.amount + amount);
  }

  return { buckets, undatedCount, undatedAmount };
}

export function summarizeReceivables(
  invoices: ClientInvoiceRecordLike[] | null | undefined,
  nowInput: Date | string = new Date()
): ClientInvoiceReceivableSummary {
  const now = nowInput instanceof Date ? nowInput : new Date(nowInput);

  return (invoices ?? []).reduce<ClientInvoiceReceivableSummary>(
    (summary, record) => {
      const status = typeof record.status === "string" ? record.status : "draft";
      const amount = receivableInvoiceAmount(record);

      summary.totalCount += 1;

      if (status === "void") {
        summary.voidCount += 1;
        return summary;
      }

      summary.totalAmount = roundCurrency(summary.totalAmount + amount);

      if (status === "draft") {
        summary.draftCount += 1;
        summary.draftAmount = roundCurrency(summary.draftAmount + amount);
      }

      if (status === "paid") {
        summary.paidCount += 1;
        summary.paidAmount = roundCurrency(summary.paidAmount + amount);
      }

      if (isReceivableOutstanding(status)) {
        summary.sentCount += 1;
        summary.outstandingAmount = roundCurrency(summary.outstandingAmount + amount);
      }

      if (isReceivableOverdue(status, record.due_date, now)) {
        summary.overdueCount += 1;
        summary.overdueAmount = roundCurrency(summary.overdueAmount + amount);
      }

      return summary;
    },
    {
      totalCount: 0,
      draftCount: 0,
      sentCount: 0,
      paidCount: 0,
      voidCount: 0,
      overdueCount: 0,
      overdueAmount: 0,
      totalAmount: 0,
      outstandingAmount: 0,
      paidAmount: 0,
      draftAmount: 0,
    }
  );
}

/**
 * Billed position of one engagement against its not-to-exceed ceiling.
 * Void invoices are excluded everywhere. Attribution is STRICT: an invoice
 * counts toward the engagement only when invoice.engagement_id ===
 * engagement.id — an unassigned invoice (NULL engagement_id) counts toward
 * no engagement, and an engagement without an id claims nothing. A caller
 * may therefore pass an unfiltered workspace list safely.
 */
export function buildEngagementBilledSummary(
  engagement: InvoicingEngagementLike,
  invoices: ClientInvoiceRecordLike[] | null | undefined
): EngagementBilledSummary {
  const engagementId =
    typeof engagement.id === "string" && engagement.id.length > 0 ? engagement.id : null;
  const scoped = (invoices ?? []).filter(
    (invoice) => engagementId !== null && invoice.engagement_id === engagementId
  );

  let billedToDate = 0;
  let draftedUnbilled = 0;

  for (const invoice of scoped) {
    const status = typeof invoice.status === "string" ? invoice.status : "draft";
    if (status === "void") {
      continue;
    }

    const amount = receivableInvoiceAmount(invoice);
    if (status === "sent" || status === "paid") {
      billedToDate = roundCurrency(billedToDate + amount);
    } else if (status === "draft") {
      draftedUnbilled = roundCurrency(draftedUnbilled + amount);
    }
  }

  const notToExceed = parseOptionalAmount(engagement.not_to_exceed_amount);
  const remaining = notToExceed === null ? null : roundCurrency(notToExceed - billedToDate);

  return {
    billedToDate,
    draftedUnbilled,
    notToExceed,
    remaining,
    isOverNte: notToExceed !== null && billedToDate > notToExceed,
  };
}
