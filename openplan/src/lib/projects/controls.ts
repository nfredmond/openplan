import {
  summarizeBillingInvoiceRecords,
  type BillingInvoiceRecordLike,
  type BillingInvoiceSummary,
} from "@/lib/billing/invoice-records";

export type ProjectMilestoneRecordLike = {
  title: string;
  status?: string | null;
  target_date?: string | null;
  actual_date?: string | null;
  phase_code?: string | null;
  milestone_type?: string | null;
};

export type ProjectSubmittalRecordLike = {
  title: string;
  status?: string | null;
  due_date?: string | null;
  submitted_at?: string | null;
  submittal_type?: string | null;
  agency_label?: string | null;
};

export type ProjectControlsSummary = {
  milestoneCount: number;
  completedMilestoneCount: number;
  blockedMilestoneCount: number;
  overdueMilestoneCount: number;
  pendingSubmittalCount: number;
  overdueSubmittalCount: number;
  nextMilestone: ProjectMilestoneRecordLike | null;
  nextSubmittal: ProjectSubmittalRecordLike | null;
  invoiceSummary: BillingInvoiceSummary;
  controlHealth: "stable" | "active" | "attention";
};

function isPast(dateInput: string | null | undefined, now: Date): boolean {
  if (!dateInput) {
    return false;
  }

  const parsed = new Date(dateInput);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }

  return parsed.getTime() < now.getTime();
}

function sortByEarliestDate<T extends { target_date?: string | null; due_date?: string | null }>(records: T[]): T[] {
  return [...records].sort((left, right) => {
    const leftDate = new Date(left.target_date ?? left.due_date ?? "9999-12-31").getTime();
    const rightDate = new Date(right.target_date ?? right.due_date ?? "9999-12-31").getTime();
    return leftDate - rightDate;
  });
}

export function buildProjectControlsSummary(
  milestones: ProjectMilestoneRecordLike[] | null | undefined,
  submittals: ProjectSubmittalRecordLike[] | null | undefined,
  invoices: BillingInvoiceRecordLike[] | null | undefined,
  nowInput: Date | string = new Date()
): ProjectControlsSummary {
  const now = nowInput instanceof Date ? nowInput : new Date(nowInput);
  const milestoneRows = milestones ?? [];
  const submittalRows = submittals ?? [];

  const openMilestones = milestoneRows.filter((item) => item.status !== "complete");
  const pendingSubmittals = submittalRows.filter((item) => item.status !== "accepted");
  const overdueMilestoneCount = openMilestones.filter((item) => isPast(item.target_date, now)).length;
  const overdueSubmittalCount = pendingSubmittals.filter((item) => isPast(item.due_date, now)).length;
  const blockedMilestoneCount = milestoneRows.filter((item) => item.status === "blocked").length;
  const completedMilestoneCount = milestoneRows.filter((item) => item.status === "complete").length;
  const nextMilestone = sortByEarliestDate(
    openMilestones.filter((item) => Boolean(item.target_date)) as Array<ProjectMilestoneRecordLike & { target_date: string }>
  )[0] ?? null;
  const nextSubmittal = sortByEarliestDate(
    pendingSubmittals.filter((item) => Boolean(item.due_date)) as Array<ProjectSubmittalRecordLike & { due_date: string }>
  )[0] ?? null;
  const invoiceSummary = summarizeBillingInvoiceRecords(invoices, now);

  const controlHealth =
    blockedMilestoneCount > 0 || overdueMilestoneCount > 0 || overdueSubmittalCount > 0 || invoiceSummary.overdueCount > 0
      ? "attention"
      : openMilestones.length > 0 || pendingSubmittals.length > 0 || invoiceSummary.outstandingNetAmount > 0
        ? "active"
        : "stable";

  return {
    milestoneCount: milestoneRows.length,
    completedMilestoneCount,
    blockedMilestoneCount,
    overdueMilestoneCount,
    pendingSubmittalCount: pendingSubmittals.length,
    overdueSubmittalCount,
    nextMilestone,
    nextSubmittal,
    invoiceSummary,
    controlHealth,
  };
}
