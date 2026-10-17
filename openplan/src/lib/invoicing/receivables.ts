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
import {
  compareMoney,
  parseOptionalMoney,
  subtractMoney,
  sumMoney,
  type ExactMoneyAmount,
} from "@/lib/money/optional-amount";
import { calendarDayOf, todayIn, UTC_TIME_ZONE } from "@/lib/time/workspace-calendar";

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
  /** Gross sent/paid subtotals before retention; null means unavailable. */
  billedToDate: ExactMoneyAmount | null;
  /** Gross draft subtotals before retention; null means unavailable. */
  draftedUnbilled: ExactMoneyAmount | null;
  notToExceed: ExactMoneyAmount | null;
  /** A negative result preserves an overrun. Null means absent or unavailable. */
  remaining: ExactMoneyAmount | null;
  isOverNte: boolean | null;
  /** Missing ceilings remain unrecorded; invalid ceilings and unreadable buckets are explicit. */
  unavailable?: Partial<Record<"billedToDate" | "draftedUnbilled" | "notToExceed", "missing" | "invalid">>;
  /** Completeness refers to the caller-visible engagement snapshot, not agreement authority. */
  source?: { state: "complete" | "pending" | "unavailable"; error?: { code?: string; message: string } };
};

export type EngagementNteWarning = {
  basis: "legacy_terms_unassessed";
  billedToDate: ExactMoneyAmount;
  projectedBilledToDate: ExactMoneyAmount;
  notToExceed: ExactMoneyAmount;
  overBy: ExactMoneyAmount;
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
 *
 * `timeZone` is the workspace's IANA zone (`loadWorkspaceCalendar`); "today"
 * is the date there. Without it the day is the UTC day, which turns over at
 * 5 p.m. Pacific.
 */
export function isReceivableOverdue(
  status: string | null | undefined,
  dueDate: string | null | undefined,
  nowInput: Date | string = new Date(),
  timeZone: string = UTC_TIME_ZONE
): boolean {
  if (!isReceivableOutstanding(status) || !dueDate) {
    return false;
  }

  const now = nowInput instanceof Date ? nowInput : new Date(nowInput);
  const days = daysPastDue(dueDate, now, timeZone);
  return days !== null && days >= 1;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whole calendar days from the due date to today in `timeZone`; 0 on the due
 * date itself. A due date stored as an instant counts as the day it falls on
 * in that zone. Null when the due date cannot be read as a day.
 */
function daysPastDue(dueDate: string, now: Date, timeZone: string): number | null {
  const dueDay = calendarDayOf(dueDate, timeZone);
  if (!dueDay) {
    return null;
  }
  // Both are YYYY-MM-DD, read as midnight UTC, so the difference is whole days.
  const dueAt = new Date(dueDay).getTime();
  if (Number.isNaN(dueAt)) {
    return null;
  }
  return Math.round((new Date(todayIn(timeZone, now)).getTime() - dueAt) / DAY_MS);
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
  nowInput: Date | string = new Date(),
  timeZone: string = UTC_TIME_ZONE
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
    const days = invoice.due_date ? daysPastDue(invoice.due_date, now, timeZone) : null;

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
  nowInput: Date | string = new Date(),
  timeZone: string = UTC_TIME_ZONE
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

      if (isReceivableOverdue(status, record.due_date, now, timeZone)) {
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

  const billedAmounts: Array<number | string | null | undefined> = [];
  const draftAmounts: Array<number | string | null | undefined> = [];
  for (const invoice of scoped) {
    const status = typeof invoice.status === "string" ? invoice.status : "draft";
    if (status === "sent" || status === "paid") {
      billedAmounts.push(invoice.subtotal_amount);
    } else if (status === "draft") {
      draftAmounts.push(invoice.subtotal_amount);
    }
  }

  const unavailable: NonNullable<EngagementBilledSummary["unavailable"]> = {};
  // Each bucket stands on its own. An unreadable row cannot become zero or
  // erase another bucket that can still be calculated from its supplied rows.
  function bucketAmount(values: typeof billedAmounts, bucket: "billedToDate" | "draftedUnbilled"): ExactMoneyAmount | null {
    if (values.some((value) => value == null)) {
      unavailable[bucket] = "missing";
      return null;
    }
    try {
      return sumMoney(values);
    } catch {
      unavailable[bucket] = "invalid";
      return null;
    }
  }
  const billedToDate = bucketAmount(billedAmounts, "billedToDate");
  const draftedUnbilled = bucketAmount(draftAmounts, "draftedUnbilled");
  return buildEngagementBilledPosition(engagement, billedToDate, draftedUnbilled, unavailable);
}

/** Compose already-aggregated gross buckets without inventing invoice records. */
export function buildEngagementBilledPosition(
  engagement: InvoicingEngagementLike,
  billedToDate: ExactMoneyAmount | null,
  draftedUnbilled: ExactMoneyAmount | null,
  unavailable: NonNullable<EngagementBilledSummary["unavailable"]> = {}
): EngagementBilledSummary {
  let notToExceed: ExactMoneyAmount | null = null;
  try {
    notToExceed = parseOptionalMoney(engagement.not_to_exceed_amount);
  } catch {
    unavailable.notToExceed = "invalid";
  }
  return {
    billedToDate,
    draftedUnbilled,
    notToExceed,
    remaining: notToExceed !== null && billedToDate !== null ? subtractMoney(notToExceed, billedToDate) : null,
    isOverNte: billedToDate === null || unavailable.notToExceed ? null : notToExceed !== null && compareMoney(billedToDate, notToExceed) > 0,
    ...(Object.keys(unavailable).length ? { unavailable } : {}),
  };
}
