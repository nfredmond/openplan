import {
  invoiceNeedsAwardRelink,
  type BillingInvoiceLinkageFilter,
  type BillingInvoiceOverdueFilter,
} from "@/lib/billing/invoice-records";
import { isQuotaExceeded, isQuotaLookupError, type QuotaResult } from "@/lib/billing/quota";
import type { UsageBucketSummary } from "@/lib/billing/usage-events";

export function titleCase(input: string | null | undefined): string {
  if (!input) {
    return "Unknown";
  }

  return input
    .toLowerCase()
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function toneForStatus(status: string): "info" | "success" | "warning" | "danger" | "neutral" {
  if (["active", "trialing", "pilot"].includes(status)) {
    return "success";
  }

  if (["checkout_pending", "past_due"].includes(status)) {
    return "warning";
  }

  if (["canceled", "inactive"].includes(status)) {
    return "danger";
  }

  return "neutral";
}

export function toneForInvoiceStatus(status: string): "info" | "success" | "warning" | "danger" | "neutral" {
  if (status === "paid") return "success";
  if (status === "submitted" || status === "approved_for_payment") return "info";
  if (status === "internal_review") return "warning";
  if (status === "rejected") return "danger";
  return "neutral";
}

export function toneForSupportingDocs(status: string): "info" | "success" | "warning" | "danger" | "neutral" {
  if (status === "accepted") return "success";
  if (status === "complete") return "info";
  if (status === "partial") return "warning";
  return "neutral";
}

export function isInvoiceOverdue(status: string, dueDate: string | null | undefined): boolean {
  if (!dueDate || status === "paid" || status === "rejected") {
    return false;
  }

  const parsed = new Date(dueDate);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }

  return parsed.getTime() < Date.now();
}

export function billingRowRiskState(invoice: InvoiceRegisterRow): {
  tone: "warning" | "danger" | "info" | null;
  title: string | null;
  detail: string | null;
  rowClassName: string;
} {
  const overdue = isInvoiceOverdue(invoice.status, invoice.due_date);
  const needsRelink = invoiceNeedsAwardRelink(invoice.status, invoice.funding_award_id);

  if (needsRelink && overdue) {
    return {
      tone: "danger",
      title: "Needs relink, already overdue",
      detail: "This invoice is still outside the funding-award reimbursement chain and is already late.",
      rowClassName: "border-amber-300/80 bg-amber-50/40 dark:border-amber-700/60 dark:bg-amber-950/15",
    };
  }

  if (needsRelink) {
    return {
      tone: "warning",
      title: "Needs award relink",
      detail: "This invoice is still unlinked to a funding award, so reimbursement posture is understated until it is attached.",
      rowClassName: "border-amber-200/80 bg-amber-50/20 dark:border-amber-800/60 dark:bg-amber-950/10",
    };
  }

  if (overdue) {
    return {
      tone: "info",
      title: "Linked, but overdue",
      detail: "This invoice is already late even though it is attached to the reimbursement chain.",
      rowClassName: "border-sky-200/80 bg-sky-50/20 dark:border-sky-800/60 dark:bg-sky-950/10",
    };
  }

  return {
    tone: null,
    title: null,
    detail: null,
    rowClassName: "border-border/60 bg-background/70",
  };
}

export function formatWorkspaceIdSnippet(workspaceId: string): string {
  return workspaceId.slice(0, 8);
}

export function formatCurrency(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "N/A";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "N/A";
  return parsed.toLocaleString();
}

export function maskExternalId(value: string | null | undefined): string {
  if (!value) return "Not linked";
  const trimmed = value.trim();
  if (trimmed.length <= 12) return trimmed;
  return `${trimmed.slice(0, 7)}...${trimmed.slice(-4)}`;
}

export function looksLikePendingSchema(message: string | null | undefined): boolean {
  return /relation .* does not exist|could not find the table|schema cache/i.test(message ?? "");
}

export function panelClass() {
  return "border border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.74),rgba(246,248,244,0.96))] px-5 py-5 shadow-[0_18px_40px_rgba(15,23,42,0.04)] dark:bg-[linear-gradient(180deg,rgba(15,23,32,0.86),rgba(11,18,26,0.96))]";
}

export function insetClass() {
  return "border border-border/60 bg-background/70";
}

export type QuotaRowDescriptor = {
  label: string;
  helper: string;
  result: QuotaResult;
};

export function quotaRowTone(result: QuotaResult): "info" | "success" | "warning" | "danger" | "neutral" {
  if (isQuotaLookupError(result)) return "warning";
  if (isQuotaExceeded(result)) return "danger";
  if (result.unlimited) return "neutral";
  const { usedRuns, monthlyLimit } = result;
  if (monthlyLimit === null) return "neutral";
  const ratio = monthlyLimit === 0 ? 0 : usedRuns / monthlyLimit;
  if (ratio >= 0.9) return "warning";
  return "success";
}

export function quotaRowStatusText(result: QuotaResult): string {
  if (isQuotaLookupError(result)) return "Quota lookup unavailable";
  if (isQuotaExceeded(result)) return `${result.usedRuns} of ${result.monthlyLimit} used (limit reached)`;
  if (result.unlimited) return "Unlimited on current plan";
  return `${result.usedRuns} of ${result.monthlyLimit} used`;
}

export function usageBucketStatusText(bucket: UsageBucketSummary): string {
  if (bucket.reportedWeight > 0 && bucket.unreportedWeight === 0) {
    return `${bucket.totalWeight} reported`;
  }

  if (bucket.reportedWeight > 0) {
    return `${bucket.unreportedWeight} unreported / ${bucket.totalWeight} total`;
  }

  return `${bucket.totalWeight} unreported`;
}

export function noticeClass(tone: "info" | "success" | "warning") {
  const toneMap = {
    info: "border-sky-300/80 bg-sky-50/80 text-sky-950 dark:border-sky-800/60 dark:bg-sky-950/25 dark:text-sky-100",
    success: "border-emerald-300/80 bg-emerald-50/80 text-emerald-950 dark:border-emerald-700/60 dark:bg-emerald-950/25 dark:text-emerald-100",
    warning: "border-amber-300/80 bg-amber-50/80 text-amber-950 dark:border-amber-700/60 dark:bg-amber-950/25 dark:text-amber-100",
  } as const;

  return `border-l-2 px-4 py-3 text-sm ${toneMap[tone]}`;
}

export function billingRowNoticeClass(tone: "info" | "warning" | "danger") {
  const toneMap = {
    info: "border-sky-300/80 bg-sky-50/80 text-sky-950 dark:border-sky-800/60 dark:bg-sky-950/25 dark:text-sky-100",
    warning: "border-amber-300/80 bg-amber-50/80 text-amber-950 dark:border-amber-700/60 dark:bg-amber-950/25 dark:text-amber-100",
    danger: "border-rose-300/80 bg-rose-50/80 text-rose-950 dark:border-rose-700/60 dark:bg-rose-950/25 dark:text-rose-100",
  } as const;

  return `border-l-2 px-4 py-3 text-sm ${toneMap[tone]}`;
}

export type FundingAwardListRow = {
  id: string;
  project_id: string | null;
  title: string;
};

export type InvoiceRegisterRow = {
  id: string;
  project_id: string | null;
  funding_award_id: string | null;
  invoice_number: string;
  consultant_name: string | null;
  billing_basis: string;
  status: string;
  invoice_date: string | null;
  due_date: string | null;
  amount: number | string | null;
  retention_percent: number | string | null;
  retention_amount: number | string | null;
  net_amount: number | string | null;
  supporting_docs_status: string;
  submitted_to: string | null;
  caltrans_posture: string;
  notes: string | null;
  created_at: string | null;
  funding_awards:
    | {
        id: string;
        title: string;
      }
    | Array<{
        id: string;
        title: string;
      }>
    | null;
};

export function normalizeJoin<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export function normalizeInvoiceLinkageFilter(value: string | string[] | undefined): BillingInvoiceLinkageFilter {
  return value === "linked" || value === "unlinked" ? value : "all";
}

export function normalizeInvoiceOverdueFilter(value: string | string[] | undefined): BillingInvoiceOverdueFilter {
  return value === "overdue" ? value : "all";
}

export function normalizeProjectFilterId(value: string | string[] | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function normalizeFocusedInvoiceId(value: string | string[] | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function normalizeRelinkedInvoiceId(value: string | string[] | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}
