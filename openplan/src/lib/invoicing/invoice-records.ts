export const BILLING_INVOICE_STATUSES = [
  "draft",
  "internal_review",
  "submitted",
  "approved_for_payment",
  "paid",
  "rejected",
] as const;

export type BillingInvoiceStatus = (typeof BILLING_INVOICE_STATUSES)[number];

/**
 * The statuses that mean "this has been claimed from the funder".
 *
 * `draft` has not been sent and `rejected` never will be paid, so neither is a
 * claim against an award's authorization. Everything else — including
 * `approved_for_payment`, which is a promise rather than a deposit — is.
 *
 * Exported because the drawdown ledger and the invoice register must partition
 * the same rows the same way. Two definitions of "claimed" is two answers to
 * how much of an award has been drawn down.
 */
export const CLAIMED_INVOICE_STATUSES = [
  "internal_review",
  "submitted",
  "approved_for_payment",
  "paid",
] as const satisfies readonly BillingInvoiceStatus[];

export function isClaimedInvoiceStatus(status: string): boolean {
  return (CLAIMED_INVOICE_STATUSES as readonly string[]).includes(status);
}

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
  /**
   * EVERY record's net, rejected and draft included.
   *
   * Read the name literally: it is the total of the register, not the total
   * that was requested from a funder. It was captioned "all non-rejected
   * invoice records" on two surfaces while including rejected ones, and fed a
   * "money left to bill" subtraction, so a rejected $55,000 claim silently
   * removed $55,000 from what an agency believed it could still invoice. Use
   * `claimedNetAmount` for any figure that means "asked for and not withdrawn";
   * this one stays as it is so that nothing else silently changes meaning.
   */
  totalNetAmount: number;
  /**
   * Σ net over CLAIMED_INVOICE_STATUSES — what was actually claimed from a
   * funder and has not been rejected. This is the figure "net requested" means.
   */
  claimedNetAmount: number;
  outstandingNetAmount: number;
  paidNetAmount: number;
  draftNetAmount: number;
  /** Reported, never folded in: an unreported amount is not zero. */
  rejectedCount: number;
  rejectedNetAmount: number;
};

export type BillingInvoiceLinkageSummary = {
  linkedCount: number;
  unlinkedCount: number;
  /** Register totals for the linkage census: every record, rejected included. */
  linkedNetAmount: number;
  unlinkedNetAmount: number;
  /**
   * Σ net over CLAIMED, per side of the linkage split. Any sentence that says
   * "requested" or "claimed" must read these; `linkedNetAmount` above counts
   * money the funder refused and is a census figure only.
   */
  linkedClaimedNetAmount: number;
  unlinkedClaimedNetAmount: number;
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

export type FundingAwardSubstantiationReadiness = "substantiated" | "partial" | "none";

export type FundingAwardSubstantiationAwardLike = {
  id?: string | null;
  project_id?: string | null;
};

export type FundingAwardSubstantiationMilestoneLike = {
  funding_award_id?: string | null;
  milestone_type?: string | null;
  status?: string | null;
};

export type FundingAwardSubstantiationSubmittalLike = {
  funding_award_id?: string | null;
  project_id?: string | null;
  submitted_at?: string | null;
};

export type FundingAwardSubstantiationSummary = {
  obligationMilestoneStatus: string | null;
  milestoneCount: number;
  submittalCount: number;
  latestSubmittalAt: string | null;
  readiness: FundingAwardSubstantiationReadiness;
};

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Round to the cent. Exported so every module that accumulates invoice money
 * rounds at the same points and the totals on two surfaces agree exactly.
 */
export const roundCurrencyAmount = roundCurrency;

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

/**
 * How much of this invoice the funder is withholding as retention.
 *
 * The precedence — an explicit `retention_amount` when it is positive, the
 * percentage otherwise — is the one `computeNetInvoiceAmount` has always
 * applied; it is extracted here so the withheld amount and the net amount can
 * never be computed from two different rules. Without it, a ledger reporting
 * "retention held" beside "paid to date" would be doing that arithmetic a
 * second time.
 *
 * Clamped into `[0, max(0, gross)]` so the identity the ledger relies on holds
 * for every row the schema permits (`amount >= 0` and `retention_amount >= 0`
 * are CHECKed independently, so a retention larger than the invoice is
 * storable):
 *
 *     computeNetInvoiceAmount(a, ra, rp) === round2(max(0, a) - computeInvoiceRetentionWithheld(a, ra, rp))
 *
 * A worksheet that printed gross, retention and net from an unclamped
 * retention would show three numbers that do not add up.
 */
export function computeInvoiceRetentionWithheld(
  amountInput: number | string | null | undefined,
  retentionAmountInput?: number | string | null,
  retentionPercentInput?: number | string | null
): number {
  const amount = Math.max(0, parseCurrencyAmount(amountInput));
  const explicitRetentionAmount = parseCurrencyAmount(retentionAmountInput);

  if (explicitRetentionAmount > 0) {
    return roundCurrency(Math.min(explicitRetentionAmount, amount));
  }

  return computeRetentionAmount(amount, parseCurrencyAmount(retentionPercentInput));
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

      if (isClaimedInvoiceStatus(status)) {
        summary.claimedNetAmount = roundCurrency(summary.claimedNetAmount + netAmount);
      }

      if (status === "rejected") {
        summary.rejectedCount += 1;
        summary.rejectedNetAmount = roundCurrency(summary.rejectedNetAmount + netAmount);
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
      claimedNetAmount: 0,
      outstandingNetAmount: 0,
      paidNetAmount: 0,
      draftNetAmount: 0,
      rejectedCount: 0,
      rejectedNetAmount: 0,
    }
  );
}

/**
 * Committed award dollars a workspace or project may still claim.
 *
 * Extracted because it had two definitions in two callers — the grants page and
 * `buildProjectFundingStackSummary` — and BOTH subtracted `totalNetAmount`,
 * which counts claims the funder REFUSED. A rejected $64,000 invoice therefore
 * removed $64,000 from what an agency believed it could still invoice, in the
 * one direction of error that causes an award to lapse unspent. Drafts are
 * excluded for the same reason from the other side: nothing has been asked of
 * anyone yet, so those dollars are still claimable.
 *
 * Clamped at zero deliberately. This is a PORTFOLIO figure spanning many
 * awards, where a negative would be a meaningless mixture; per award,
 * `AwardDrawdownLedger.remainingAuthorized` is unclamped so that an over-claim
 * against a single authorization stays visible.
 */
export function uninvoicedCommittedAwardAmount(
  committedAwardAmount: number,
  summary: Pick<BillingInvoiceSummary, "claimedNetAmount">
): number {
  return Math.max(roundCurrency(committedAwardAmount - summary.claimedNetAmount), 0);
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
    linkedClaimedNetAmount: linkedSummary.claimedNetAmount,
    unlinkedClaimedNetAmount: unlinkedSummary.claimedNetAmount,
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

// project_submittals carries no funding_award_id column in the schema, so submittal
// substantiation is attributed through the award's project; an explicit funding_award_id
// on a submittal record (if a future schema adds the direct link) is authoritative and
// excludes that record from project-level attribution.
export function summarizeAwardSubstantiation({
  awards,
  milestones,
  submittals,
}: {
  awards: FundingAwardSubstantiationAwardLike[] | null | undefined;
  milestones?: FundingAwardSubstantiationMilestoneLike[] | null;
  submittals?: FundingAwardSubstantiationSubmittalLike[] | null;
}): Map<string, FundingAwardSubstantiationSummary> {
  const summaries = new Map<string, FundingAwardSubstantiationSummary>();
  const milestoneRecords = milestones ?? [];
  const submittalRecords = submittals ?? [];

  for (const award of awards ?? []) {
    if (!award.id) {
      continue;
    }

    const awardMilestones = milestoneRecords.filter((milestone) => milestone.funding_award_id === award.id);
    const awardSubmittals = submittalRecords.filter((submittal) =>
      submittal.funding_award_id
        ? submittal.funding_award_id === award.id
        : Boolean(award.project_id) && submittal.project_id === award.project_id
    );

    const obligationMilestone = awardMilestones.find((milestone) => milestone.milestone_type === "obligation") ?? null;

    let latestSubmittalAt: string | null = null;
    let latestSubmittalAtMs = Number.NEGATIVE_INFINITY;
    for (const submittal of awardSubmittals) {
      if (!submittal.submitted_at) {
        continue;
      }
      const submittedAtMs = new Date(submittal.submitted_at).getTime();
      if (Number.isNaN(submittedAtMs) || submittedAtMs <= latestSubmittalAtMs) {
        continue;
      }
      latestSubmittalAt = submittal.submitted_at;
      latestSubmittalAtMs = submittedAtMs;
    }

    const milestoneCount = awardMilestones.length;
    const submittalCount = awardSubmittals.length;
    const readiness: FundingAwardSubstantiationReadiness =
      milestoneCount > 0 && submittalCount > 0
        ? "substantiated"
        : milestoneCount > 0 || submittalCount > 0
          ? "partial"
          : "none";

    summaries.set(award.id, {
      obligationMilestoneStatus: typeof obligationMilestone?.status === "string" ? obligationMilestone.status : null,
      milestoneCount,
      submittalCount,
      latestSubmittalAt,
      readiness,
    });
  }

  return summaries;
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
