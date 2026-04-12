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

export type BillingInvoiceLinkageRecordLike = BillingInvoiceRecordLike & {
  funding_award_id?: string | null;
};

export type BillingInvoiceLinkageFilter = "all" | "linked" | "unlinked";
export type BillingInvoiceOverdueFilter = "all" | "overdue";

export type BillingInvoiceSummary = {
  totalCount: number;
  draftCount: number;
  submittedCount: number;
  paidCount: number;
  overdueCount: number;
  overdueNetAmount: number;
  totalNetAmount: number;
  outstandingNetAmount: number;
  paidNetAmount: number;
  draftNetAmount: number;
};

export type BillingInvoiceLinkageSummary = {
  linkedCount: number;
  unlinkedCount: number;
  linkedNetAmount: number;
  unlinkedNetAmount: number;
  linkedOutstandingNetAmount: number;
  unlinkedOutstandingNetAmount: number;
  linkedPaidNetAmount: number;
  unlinkedPaidNetAmount: number;
  linkedOverdueCount: number;
  unlinkedOverdueCount: number;
  linkedOverdueNetAmount: number;
  unlinkedOverdueNetAmount: number;
};

export type BillingInvoicePriorityQueueEntry<T extends BillingInvoiceLinkageRecordLike> = {
  record: T;
  netAmount: number;
  priorityTier: number;
  reason: string;
  isLinked: boolean;
  isOutstanding: boolean;
  isOverdue: boolean;
  isExactRelink: boolean;
};

export type BillingInvoicePriorityQueueClassifierResult = {
  priorityTier?: number;
  reason?: string;
  isExactRelink?: boolean;
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

export function invoiceNeedsAwardRelink(status: string, fundingAwardId: string | null | undefined) {
  return !fundingAwardId && status !== "paid" && status !== "rejected";
}

export function resolveExactBillingInvoiceAwardMatch<
  TInvoice extends BillingInvoiceLinkageRecordLike & { project_id?: string | null },
  TAward extends { id: string; project_id?: string | null }
>(invoice: TInvoice, invoices: TInvoice[], fundingAwards: TAward[]): TAward | null {
  if (!invoice.project_id || !invoiceNeedsAwardRelink(typeof invoice.status === "string" ? invoice.status : "draft", invoice.funding_award_id)) {
    return null;
  }

  const projectUnlinkedInvoices = invoices.filter(
    (candidate) =>
      candidate.project_id === invoice.project_id &&
      invoiceNeedsAwardRelink(typeof candidate.status === "string" ? candidate.status : "draft", candidate.funding_award_id)
  );
  const projectFundingAwards = fundingAwards.filter((award) => award.project_id === invoice.project_id);

  if (projectUnlinkedInvoices.length !== 1 || projectFundingAwards.length !== 1) {
    return null;
  }

  return projectFundingAwards[0] ?? null;
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
        summary.overdueNetAmount = roundCurrency(summary.overdueNetAmount + netAmount);
      }

      return summary;
    },
    {
      totalCount: 0,
      draftCount: 0,
      submittedCount: 0,
      paidCount: 0,
      overdueCount: 0,
      overdueNetAmount: 0,
      totalNetAmount: 0,
      outstandingNetAmount: 0,
      paidNetAmount: 0,
      draftNetAmount: 0,
    }
  );
}

export function summarizeBillingInvoiceLinkage(
  records: BillingInvoiceLinkageRecordLike[] | null | undefined,
  nowInput: Date | string = new Date()
): BillingInvoiceLinkageSummary {
  const linkedRecords = (records ?? []).filter((record) => Boolean(record.funding_award_id));
  const unlinkedRecords = (records ?? []).filter((record) => !record.funding_award_id);
  const linkedSummary = summarizeBillingInvoiceRecords(linkedRecords, nowInput);
  const unlinkedSummary = summarizeBillingInvoiceRecords(unlinkedRecords, nowInput);

  return {
    linkedCount: linkedSummary.totalCount,
    unlinkedCount: unlinkedSummary.totalCount,
    linkedNetAmount: linkedSummary.totalNetAmount,
    unlinkedNetAmount: unlinkedSummary.totalNetAmount,
    linkedOutstandingNetAmount: linkedSummary.outstandingNetAmount,
    unlinkedOutstandingNetAmount: unlinkedSummary.outstandingNetAmount,
    linkedPaidNetAmount: linkedSummary.paidNetAmount,
    unlinkedPaidNetAmount: unlinkedSummary.paidNetAmount,
    linkedOverdueCount: linkedSummary.overdueCount,
    unlinkedOverdueCount: unlinkedSummary.overdueCount,
    linkedOverdueNetAmount: linkedSummary.overdueNetAmount,
    unlinkedOverdueNetAmount: unlinkedSummary.overdueNetAmount,
  };
}

export function filterBillingInvoiceRecordsByLinkage<T extends BillingInvoiceLinkageRecordLike>(
  records: T[] | null | undefined,
  filter: BillingInvoiceLinkageFilter
): T[] {
  const items = records ?? [];

  if (filter === "linked") {
    return items.filter((record) => Boolean(record.funding_award_id));
  }

  if (filter === "unlinked") {
    return items.filter((record) => !record.funding_award_id);
  }

  return items;
}

export function filterBillingInvoiceRecordsByOverdueStatus<T extends BillingInvoiceRecordLike>(
  records: T[] | null | undefined,
  filter: BillingInvoiceOverdueFilter,
  nowInput: Date | string = new Date()
): T[] {
  const items = records ?? [];

  if (filter !== "overdue") {
    return items;
  }

  const now = nowInput instanceof Date ? nowInput : new Date(nowInput);
  return items.filter((record) => isOverdue(typeof record.status === "string" ? record.status : "draft", record.due_date, now));
}

function priorityTierForRecord(record: BillingInvoiceLinkageRecordLike, now: Date): number {
  const status = typeof record.status === "string" ? record.status : "draft";
  const linked = Boolean(record.funding_award_id);
  const overdue = isOverdue(status, record.due_date, now);
  const outstanding = isOutstandingStatus(status);

  if (!linked && overdue) return 1;
  if (!linked && outstanding) return 2;
  if (!linked) return 3;
  if (linked && overdue) return 4;
  if (linked && outstanding) return 5;
  return 6;
}

function priorityReasonForTier(tier: number): string {
  switch (tier) {
    case 1:
      return "Unlinked and overdue, reimbursement risk is already late.";
    case 2:
      return "Unlinked and still in active payment flow, reimbursement chain is incomplete.";
    case 3:
      return "Unlinked invoice still needs award attachment.";
    case 4:
      return "Award-linked but already overdue, operator follow-up is needed.";
    case 5:
      return "Award-linked and still outstanding in the payment flow.";
    default:
      return "Lower cleanup priority right now.";
  }
}

function parseDateValue(dateInput: string | null | undefined): number {
  if (!dateInput) return Number.POSITIVE_INFINITY;
  const parsed = new Date(dateInput);
  return Number.isNaN(parsed.getTime()) ? Number.POSITIVE_INFINITY : parsed.getTime();
}

export function buildBillingInvoicePriorityQueue<T extends BillingInvoiceLinkageRecordLike>(
  records: T[] | null | undefined,
  options?: {
    now?: Date | string;
    limit?: number;
    classifyRecord?: (record: T, records: T[]) => BillingInvoicePriorityQueueClassifierResult | null | undefined;
  }
): BillingInvoicePriorityQueueEntry<T>[] {
  const items = records ?? [];
  const nowInput = options?.now ?? new Date();
  const now = nowInput instanceof Date ? nowInput : new Date(nowInput);
  const limit = options?.limit ?? 3;

  return items
    .map((record) => {
      const status = typeof record.status === "string" ? record.status : "draft";
      const isLinked = Boolean(record.funding_award_id);
      const isOutstanding = isOutstandingStatus(status);
      const overdue = isOverdue(status, record.due_date, now);
      const netAmount = computeNetInvoiceAmount(record.amount, record.retention_amount, record.retention_percent);
      const basePriorityTier = priorityTierForRecord(record, now);
      const classified = options?.classifyRecord?.(record, items) ?? null;
      const priorityTier = classified?.priorityTier ?? basePriorityTier;

      return {
        record,
        netAmount,
        priorityTier,
        reason: classified?.reason ?? priorityReasonForTier(priorityTier),
        isLinked,
        isOutstanding,
        isOverdue: overdue,
        isExactRelink: classified?.isExactRelink ?? false,
      };
    })
    .sort((left, right) => {
      if (left.priorityTier !== right.priorityTier) {
        return left.priorityTier - right.priorityTier;
      }

      if (left.netAmount !== right.netAmount) {
        return right.netAmount - left.netAmount;
      }

      const dueDateDelta = parseDateValue(left.record.due_date) - parseDateValue(right.record.due_date);
      if (dueDateDelta !== 0) {
        return dueDateDelta;
      }

      return 0;
    })
    .slice(0, Math.max(0, limit));
}
