import {
  summarizeBillingInvoiceRecords,
  type BillingInvoiceRecordLike,
  type BillingInvoiceSummary,
} from "@/lib/billing/invoice-records";
import type { StatusTone } from "@/lib/ui/status";

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

export type ProjectInvoiceControlRecordLike = BillingInvoiceRecordLike & {
  invoice_number?: string | null;
  submitted_to?: string | null;
};

export type ProjectControlDeadlineItem = {
  kind: "milestone" | "submittal" | "invoice";
  title: string;
  deadlineAt: string;
  label: string;
  detail: string;
  tone: StatusTone;
  isOverdue: boolean;
  targetId: string;
};

const PROJECT_CONTROL_TARGET_IDS = {
  milestone: "project-milestones",
  submittal: "project-submittals",
  invoice: "project-invoices",
} as const;

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
  deadlineSummary: {
    totalCount: number;
    overdueCount: number;
    upcomingCount: number;
    nextDeadline: ProjectControlDeadlineItem | null;
    items: ProjectControlDeadlineItem[];
  };
  recommendedNextAction: {
    label: string;
    detail: string;
    tone: StatusTone;
    targetId: string;
  };
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

function sortDeadlineItems(items: ProjectControlDeadlineItem[]): ProjectControlDeadlineItem[] {
  return [...items].sort((left, right) => {
    if (left.isOverdue !== right.isOverdue) {
      return left.isOverdue ? -1 : 1;
    }

    return new Date(left.deadlineAt).getTime() - new Date(right.deadlineAt).getTime();
  });
}

export function buildProjectControlsSummary(
  milestones: ProjectMilestoneRecordLike[] | null | undefined,
  submittals: ProjectSubmittalRecordLike[] | null | undefined,
  invoices: ProjectInvoiceControlRecordLike[] | null | undefined,
  nowInput: Date | string = new Date()
): ProjectControlsSummary {
  const now = nowInput instanceof Date ? nowInput : new Date(nowInput);
  const milestoneRows = milestones ?? [];
  const submittalRows = submittals ?? [];
  const invoiceRows = invoices ?? [];

  const openMilestones = milestoneRows.filter((item) => item.status !== "complete");
  const pendingSubmittals = submittalRows.filter((item) => item.status !== "accepted");
  const activeInvoices = invoiceRows.filter((item) => !["paid", "rejected"].includes(item.status ?? "draft"));
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
  const deadlineItems = sortDeadlineItems([
    ...openMilestones
      .filter((item): item is ProjectMilestoneRecordLike & { target_date: string } => Boolean(item.target_date))
      .map((item) => ({
        kind: "milestone" as const,
        title: item.title,
        deadlineAt: item.target_date,
        label: isPast(item.target_date, now) ? "Milestone overdue" : "Milestone due",
        detail: `${item.phase_code ? `${item.phase_code} phase` : "Project phase"} checkpoint is scheduled for ${item.target_date}.`,
        tone: isPast(item.target_date, now) ? ("danger" as const) : ("info" as const),
        isOverdue: isPast(item.target_date, now),
        targetId: PROJECT_CONTROL_TARGET_IDS.milestone,
      })),
    ...pendingSubmittals
      .filter((item): item is ProjectSubmittalRecordLike & { due_date: string } => Boolean(item.due_date))
      .map((item) => ({
        kind: "submittal" as const,
        title: item.title,
        deadlineAt: item.due_date,
        label: isPast(item.due_date, now) ? "Submittal overdue" : "Submittal due",
        detail: `${item.submittal_type ? `${item.submittal_type} packet` : "Project packet"} ${item.agency_label ? `for ${item.agency_label}` : ""} is due ${item.due_date}.`.trim(),
        tone: isPast(item.due_date, now) ? ("danger" as const) : ("warning" as const),
        isOverdue: isPast(item.due_date, now),
        targetId: PROJECT_CONTROL_TARGET_IDS.submittal,
      })),
    ...activeInvoices
      .filter((item): item is ProjectInvoiceControlRecordLike & { due_date: string } => Boolean(item.due_date))
      .map((item) => ({
        kind: "invoice" as const,
        title: item.invoice_number ? `Invoice ${item.invoice_number}` : "Invoice record",
        deadlineAt: item.due_date,
        label: isPast(item.due_date, now) ? "Invoice overdue" : "Invoice due",
        detail: `${item.submitted_to ? `Submitted to ${item.submitted_to}` : "Invoice review/payment lane"} is tracking a due date of ${item.due_date}.`,
        tone: isPast(item.due_date, now) ? ("danger" as const) : ("warning" as const),
        isOverdue: isPast(item.due_date, now),
        targetId: PROJECT_CONTROL_TARGET_IDS.invoice,
      })),
  ]);
  const deadlineSummary = {
    totalCount: deadlineItems.length,
    overdueCount: deadlineItems.filter((item) => item.isOverdue).length,
    upcomingCount: deadlineItems.filter((item) => !item.isOverdue).length,
    nextDeadline: deadlineItems[0] ?? null,
    items: deadlineItems.slice(0, 4),
  };

  const controlHealth =
    blockedMilestoneCount > 0 || overdueMilestoneCount > 0 || overdueSubmittalCount > 0 || invoiceSummary.overdueCount > 0
      ? "attention"
      : openMilestones.length > 0 || pendingSubmittals.length > 0 || invoiceSummary.outstandingNetAmount > 0
        ? "active"
        : "stable";

  const recommendedNextAction =
    blockedMilestoneCount > 0
      ? {
          label: "Resolve blocked milestone",
          detail: `${blockedMilestoneCount} milestone${blockedMilestoneCount === 1 ? " is" : "s are"} blocked. Clear the blocker before pushing invoicing or delivery posture forward.`,
          tone: "danger" as const,
          targetId: PROJECT_CONTROL_TARGET_IDS.milestone,
        }
      : overdueSubmittalCount > 0
        ? {
            label: "Recover overdue submittal",
            detail: `${overdueSubmittalCount} submittal${overdueSubmittalCount === 1 ? " is" : "s are"} overdue for review or agency response. Reconfirm the next packet owner and due date.`,
            tone: "danger" as const,
            targetId: PROJECT_CONTROL_TARGET_IDS.submittal,
          }
        : overdueMilestoneCount > 0
          ? {
              label: "Recover overdue milestone",
              detail: `${overdueMilestoneCount} milestone${overdueMilestoneCount === 1 ? " is" : "s are"} behind target date. Rebaseline the next checkpoint and owner.`,
              tone: "warning" as const,
              targetId: PROJECT_CONTROL_TARGET_IDS.milestone,
            }
          : invoiceSummary.overdueCount > 0
            ? {
                label: "Resolve overdue invoice posture",
                detail: `${invoiceSummary.overdueCount} invoice${invoiceSummary.overdueCount === 1 ? " is" : "s are"} overdue. Confirm supporting docs and payment status before advancing closeout claims.`,
                tone: "warning" as const,
                targetId: PROJECT_CONTROL_TARGET_IDS.invoice,
              }
            : nextSubmittal
              ? {
                  label: "Prepare next submittal",
                  detail: `${nextSubmittal.title} is the next visible packet in the queue. Keep the review cadence explicit before it turns into a hidden hold.`,
                  tone: "info" as const,
                  targetId: PROJECT_CONTROL_TARGET_IDS.submittal,
                }
              : nextMilestone
                ? {
                    label: "Advance next milestone",
                    detail: `${nextMilestone.title} is the next project checkpoint. Confirm scope, owner, and evidence needed to hit the target date.`,
                    tone: "info" as const,
                    targetId: PROJECT_CONTROL_TARGET_IDS.milestone,
                  }
                : invoiceSummary.draftCount > 0
                  ? {
                      label: "Move draft invoice into review",
                      detail: `${invoiceSummary.draftCount} invoice draft${invoiceSummary.draftCount === 1 ? " is" : "s are"} parked in setup. Decide whether they should stay draft or move into the formal review/payment lane.`,
                      tone: "neutral" as const,
                      targetId: PROJECT_CONTROL_TARGET_IDS.invoice,
                    }
                  : {
                      label: "Establish the next control checkpoint",
                      detail: "Add the next milestone, submittal, or invoice record so this project has an explicit operator-controlled next step instead of implied status.",
                      tone: "neutral" as const,
                      targetId: PROJECT_CONTROL_TARGET_IDS.milestone,
                    };

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
    deadlineSummary,
    recommendedNextAction,
  };
}
