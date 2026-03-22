export const BILLING_INVOICE_STATUSES = [
  "draft",
  "internal_review",
  "submitted",
  "approved_for_payment",
  "paid",
  "rejected",
] as const;

export type BillingInvoiceStatus = (typeof BILLING_INVOICE_STATUSES)[number];

export type BillingInvoiceRecordLike = {
  status?: string | null;
  amount?: number | string | null;
  retention_percent?: number | string | null;
  retention_amount?: number | string | null;
  net_amount?: number | string | null;
  due_date?: string | null;
};

export type BillingInvoiceSummary = {
  totalCount: number;
  draftCount: number;
  submittedCount: number;
  paidCount: number;
  overdueCount: number;
  totalNetAmount: number;
  outstandingNetAmount: number;
  paidNetAmount: number;
  draftNetAmount: number;
};

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

export function parseCurrencyAmount(value: number | string | null | undefined): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

export function computeRetentionAmount(amount: number, retentionPercent: number): number {
  return roundCurrency(Math.max(0, amount) * Math.max(0, retentionPercent) / 100);
}

export function computeNetInvoiceAmount(
  amountInput: number | string | null | undefined,
  retentionAmountInput?: number | string | null,
  retentionPercentInput?: number | string | null
): number {
  const amount = parseCurrencyAmount(amountInput);
  const explicitRetentionAmount = parseCurrencyAmount(retentionAmountInput);

  if (explicitRetentionAmount > 0) {
    return roundCurrency(Math.max(0, amount - explicitRetentionAmount));
  }

  const retentionPercent = parseCurrencyAmount(retentionPercentInput);
  return roundCurrency(Math.max(0, amount - computeRetentionAmount(amount, retentionPercent)));
}

function isOutstandingStatus(status: string): boolean {
  return ["internal_review", "submitted", "approved_for_payment"].includes(status);
}

function isOverdue(status: string, dueDate: string | null | undefined, now: Date): boolean {
  if (!dueDate || status === "paid" || status === "rejected") {
    return false;
  }

  const parsed = new Date(dueDate);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }

  return parsed.getTime() < now.getTime();
}

export function summarizeBillingInvoiceRecords(
  records: BillingInvoiceRecordLike[] | null | undefined,
  nowInput: Date | string = new Date()
): BillingInvoiceSummary {
  const now = nowInput instanceof Date ? nowInput : new Date(nowInput);

  return (records ?? []).reduce<BillingInvoiceSummary>(
    (summary, record) => {
      const status = typeof record.status === "string" ? record.status : "draft";
      const netAmount = computeNetInvoiceAmount(record.amount, record.retention_amount, record.retention_percent);

      summary.totalCount += 1;
      summary.totalNetAmount = roundCurrency(summary.totalNetAmount + netAmount);

      if (status === "draft") {
        summary.draftCount += 1;
        summary.draftNetAmount = roundCurrency(summary.draftNetAmount + netAmount);
      }

      if (status === "paid") {
        summary.paidCount += 1;
        summary.paidNetAmount = roundCurrency(summary.paidNetAmount + netAmount);
      }

      if (isOutstandingStatus(status)) {
        summary.submittedCount += 1;
        summary.outstandingNetAmount = roundCurrency(summary.outstandingNetAmount + netAmount);
      }

      if (isOverdue(status, record.due_date, now)) {
        summary.overdueCount += 1;
      }

      return summary;
    },
    {
      totalCount: 0,
      draftCount: 0,
      submittedCount: 0,
      paidCount: 0,
      overdueCount: 0,
      totalNetAmount: 0,
      outstandingNetAmount: 0,
      paidNetAmount: 0,
      draftNetAmount: 0,
    }
  );
}
