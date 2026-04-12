import Link from "next/link";
import { redirect } from "next/navigation";
import { FileSpreadsheet } from "lucide-react";
import { BillingCheckoutLauncher } from "@/components/billing/billing-checkout-launcher";
import { BillingTriageLinkCopy } from "@/components/billing/billing-triage-link-copy";
import { InvoiceFundingAwardLinker } from "@/components/billing/invoice-funding-award-linker";
import { InvoiceRecordComposer } from "@/components/billing/invoice-record-composer";
import { WorkspaceRuntimeCue } from "@/components/operations/workspace-runtime-cue";
import { StatusBadge } from "@/components/ui/status-badge";
import { WorkspaceMembershipRequired } from "@/components/workspaces/workspace-membership-required";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import {
  buildBillingInvoicePriorityQueue,
  filterBillingInvoiceRecordsByLinkage,
  filterBillingInvoiceRecordsByOverdueStatus,
  invoiceNeedsAwardRelink,
  resolveExactBillingInvoiceAwardMatch,
  type BillingInvoiceOverdueFilter,
  type BillingInvoiceLinkageFilter,
  summarizeBillingInvoiceLinkage,
  summarizeBillingInvoiceRecords,
} from "@/lib/billing/invoice-records";
import { resolveBillingSupportState } from "@/lib/billing/support";
import { buildBillingHref, buildBillingInvoiceTriageHref } from "@/lib/billing/triage-links";
import { normalizeSubscriptionStatus } from "@/lib/billing/subscription";
import { loadWorkspaceOperationsSummaryForWorkspace, type WorkspaceOperationsSupabaseLike } from "@/lib/operations/workspace-summary";
import { createClient } from "@/lib/supabase/server";
import {
  CURRENT_WORKSPACE_MEMBERSHIP_SELECT,
  resolveWorkspaceMembershipSelection,
  type WorkspaceMembershipRow,
  unwrapWorkspaceRecord,
} from "@/lib/workspaces/current";

function titleCase(input: string | null | undefined): string {
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

function toneForStatus(status: string): "info" | "success" | "warning" | "danger" | "neutral" {
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

function toneForInvoiceStatus(status: string): "info" | "success" | "warning" | "danger" | "neutral" {
  if (status === "paid") return "success";
  if (status === "submitted" || status === "approved_for_payment") return "info";
  if (status === "internal_review") return "warning";
  if (status === "rejected") return "danger";
  return "neutral";
}

function toneForSupportingDocs(status: string): "info" | "success" | "warning" | "danger" | "neutral" {
  if (status === "accepted") return "success";
  if (status === "complete") return "info";
  if (status === "partial") return "warning";
  return "neutral";
}

function isInvoiceOverdue(status: string, dueDate: string | null | undefined): boolean {
  if (!dueDate || status === "paid" || status === "rejected") {
    return false;
  }

  const parsed = new Date(dueDate);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }

  return parsed.getTime() < Date.now();
}

function billingRowRiskState(invoice: InvoiceRegisterRow): {
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

function formatWorkspaceIdSnippet(workspaceId: string): string {
  return workspaceId.slice(0, 8);
}

function formatCurrency(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function looksLikePendingSchema(message: string | null | undefined): boolean {
  return /relation .* does not exist|could not find the table|schema cache/i.test(message ?? "");
}

function panelClass() {
  return "border border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.74),rgba(246,248,244,0.96))] px-5 py-5 shadow-[0_18px_40px_rgba(15,23,42,0.04)] dark:bg-[linear-gradient(180deg,rgba(15,23,32,0.86),rgba(11,18,26,0.96))]";
}

function insetClass() {
  return "border border-border/60 bg-background/70";
}

function noticeClass(tone: "info" | "success" | "warning") {
  const toneMap = {
    info: "border-sky-300/80 bg-sky-50/80 text-sky-950 dark:border-sky-800/60 dark:bg-sky-950/25 dark:text-sky-100",
    success: "border-emerald-300/80 bg-emerald-50/80 text-emerald-950 dark:border-emerald-700/60 dark:bg-emerald-950/25 dark:text-emerald-100",
    warning: "border-amber-300/80 bg-amber-50/80 text-amber-950 dark:border-amber-700/60 dark:bg-amber-950/25 dark:text-amber-100",
  } as const;

  return `border-l-2 px-4 py-3 text-sm ${toneMap[tone]}`;
}

function billingRowNoticeClass(tone: "info" | "warning" | "danger") {
  const toneMap = {
    info: "border-sky-300/80 bg-sky-50/80 text-sky-950 dark:border-sky-800/60 dark:bg-sky-950/25 dark:text-sky-100",
    warning: "border-amber-300/80 bg-amber-50/80 text-amber-950 dark:border-amber-700/60 dark:bg-amber-950/25 dark:text-amber-100",
    danger: "border-rose-300/80 bg-rose-50/80 text-rose-950 dark:border-rose-700/60 dark:bg-rose-950/25 dark:text-rose-100",
  } as const;

  return `border-l-2 px-4 py-3 text-sm ${toneMap[tone]}`;
}

type FundingAwardListRow = {
  id: string;
  project_id: string | null;
  title: string;
};

type InvoiceRegisterRow = {
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

function normalizeJoin<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function normalizeInvoiceLinkageFilter(value: string | string[] | undefined): BillingInvoiceLinkageFilter {
  return value === "linked" || value === "unlinked" ? value : "all";
}

function normalizeInvoiceOverdueFilter(value: string | string[] | undefined): BillingInvoiceOverdueFilter {
  return value === "overdue" ? value : "all";
}

function normalizeProjectFilterId(value: string | string[] | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function normalizeFocusedInvoiceId(value: string | string[] | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function normalizeRelinkedInvoiceId(value: string | string[] | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedParams = (await searchParams) ?? {};
  const checkoutState = typeof resolvedParams.checkout === "string" ? resolvedParams.checkout : null;
  const checkoutPlan = typeof resolvedParams.plan === "string" ? resolvedParams.plan : null;
  const requestedWorkspaceId = typeof resolvedParams.workspaceId === "string" ? resolvedParams.workspaceId : null;
  const linkageFilter = normalizeInvoiceLinkageFilter(resolvedParams.linkage);
  const overdueFilter = normalizeInvoiceOverdueFilter(resolvedParams.overdue);
  const requestedProjectFilterId = normalizeProjectFilterId(resolvedParams.projectId);
  const requestedFocusedInvoiceId = normalizeFocusedInvoiceId(resolvedParams.focusInvoiceId);
  const requestedRelinkedInvoiceId = normalizeRelinkedInvoiceId(resolvedParams.relinkedInvoiceId);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { data: memberships } = await supabase
    .from("workspace_members")
    .select(CURRENT_WORKSPACE_MEMBERSHIP_SELECT)
    .eq("user_id", user.id);

  const selection = resolveWorkspaceMembershipSelection(memberships as WorkspaceMembershipRow[] | null, {
    requestedWorkspaceId,
    requireExplicitSelectionForMultiWorkspace: true,
  });

  if (!selection.memberships.length) {
    return (
      <WorkspaceMembershipRequired
        moduleLabel="Billing"
        title="Billing needs a provisioned workspace"
        description="Billing state is tied to a real workspace record. You are signed in, but no workspace membership was found for this account, so there is no subscription context to manage yet."
        primaryHref="/projects"
        primaryLabel="Create or open project workspace"
      />
    );
  }

  if (selection.invalidWorkspaceId || selection.requiresExplicitSelection || !selection.membership || !selection.workspace) {
    return (
      <section className="space-y-6">
        <header className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px] xl:items-end">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Billing</p>
            <h1 className="text-3xl font-semibold tracking-tight">Choose a workspace for billing</h1>
            <p className="text-sm text-muted-foreground sm:text-base">
              Billing state is workspace-specific. This account has access to multiple workspaces, so OpenPlan now requires an explicit workspace choice before showing subscription status or starting checkout.
            </p>
          </div>
          <div className={`${insetClass()} px-4 py-4 text-sm text-muted-foreground`}>
            Open the exact billing surface you intend to review. That keeps status review, checkout writes, and later invoice work attached to the correct workspace ledger.
          </div>
        </header>

        {selection.invalidWorkspaceId ? (
          <article className={noticeClass("warning")}>
            The requested billing workspace was not found for this account. Choose one of your accessible workspaces below.
          </article>
        ) : null}

        <article className={panelClass()}>
          <div className="border-b border-border/60 pb-4">
            <h2 className="text-lg font-semibold tracking-tight">Available workspaces</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Open the exact billing surface you intend to review. This prevents accidental checkout or status review against the wrong workspace.
            </p>
          </div>

          <ul className="mt-4 space-y-3">
            {selection.memberships.map((membershipOption) => {
              const workspaceOption = unwrapWorkspaceRecord(membershipOption.workspaces);
              const optionStatus = normalizeSubscriptionStatus(workspaceOption?.subscription_status ?? null);
              const optionPlan = workspaceOption?.subscription_plan ?? workspaceOption?.plan ?? "starter";

              return (
                <li key={membershipOption.workspace_id} className="grid gap-3 border border-border/60 bg-background/70 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold tracking-tight text-foreground">{workspaceOption?.name ?? "Workspace"}</h3>
                      <StatusBadge tone={toneForStatus(optionStatus)}>{titleCase(optionStatus)}</StatusBadge>
                      <StatusBadge tone="info">Plan: {titleCase(optionPlan)}</StatusBadge>
                    </div>
                    <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                      Workspace ID {formatWorkspaceIdSnippet(membershipOption.workspace_id)} · Role {membershipOption.role}
                    </p>
                  </div>

                  <Link
                    href={`/billing?workspaceId=${membershipOption.workspace_id}`}
                    className="text-sm font-semibold text-foreground transition hover:text-primary"
                  >
                    Open billing
                  </Link>
                </li>
              );
            })}
          </ul>
        </article>
      </section>
    );
  }

  const membership = selection.membership;
  const workspace = selection.workspace;
  const workspaceId = membership.workspace_id;
  const status = normalizeSubscriptionStatus(workspace.subscription_status ?? null);
  const plan = workspace.subscription_plan ?? workspace.plan ?? "starter";
  const canStartCheckout = canAccessWorkspaceAction("billing.checkout", membership.role);
  const canWriteInvoices = canAccessWorkspaceAction("billing.invoices.write", membership.role);

  const { data: billingEvents } = await supabase
    .from("billing_events")
    .select("id, event_type, source, created_at, payload")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(10);

  const { data: workspaceBillingDetail } = await supabase
    .from("workspaces")
    .select("subscription_current_period_end")
    .eq("id", workspaceId)
    .maybeSingle();

  const { data: workspaceProjectsData } = await supabase
    .from("projects")
    .select("id, name, status, delivery_phase")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false });

  const fundingAwardsResult = await supabase
    .from("funding_awards")
    .select("id, project_id, title")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false });

  const invoiceRecordsResult = await supabase
    .from("billing_invoice_records")
    .select(
      "id, project_id, funding_award_id, invoice_number, consultant_name, billing_basis, status, invoice_date, due_date, amount, retention_percent, retention_amount, net_amount, supporting_docs_status, submitted_to, caltrans_posture, notes, created_at, funding_awards(id, title)"
    )
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(20);

  const invoiceRegisterPending = looksLikePendingSchema(invoiceRecordsResult.error?.message);
  const fundingAwardsPending = looksLikePendingSchema(fundingAwardsResult.error?.message);
  const workspaceFundingAwards = fundingAwardsPending ? [] : ((fundingAwardsResult.data ?? []) as FundingAwardListRow[]);
  const invoiceRecords = invoiceRegisterPending
    ? []
    : ((invoiceRecordsResult.data ?? []) as InvoiceRegisterRow[]).map((invoice) => ({
        ...invoice,
        fundingAward: normalizeJoin(invoice.funding_awards),
      }));
  const invoiceSummary = summarizeBillingInvoiceRecords(invoiceRecords);
  const invoiceLinkageSummary = summarizeBillingInvoiceLinkage(invoiceRecords);
  const workspaceProjects = (workspaceProjectsData ?? []) as Array<{
    id: string;
    name: string;
    status: string;
    delivery_phase: string | null;
  }>;
  const projectNameById = new Map(workspaceProjects.map((project) => [project.id, project.name]));
  const activeProjectFilterId = requestedProjectFilterId && projectNameById.has(requestedProjectFilterId) ? requestedProjectFilterId : null;
  const activeProjectFilterName = activeProjectFilterId ? projectNameById.get(activeProjectFilterId) ?? activeProjectFilterId : null;
  const registerScopedInvoiceRecords = activeProjectFilterId
    ? invoiceRecords.filter((invoice) => invoice.project_id === activeProjectFilterId)
    : invoiceRecords;
  const registerScopedInvoiceSummary = summarizeBillingInvoiceRecords(registerScopedInvoiceRecords);
  const registerScopedLinkageSummary = summarizeBillingInvoiceLinkage(registerScopedInvoiceRecords);
  const linkageFilteredInvoiceRecords = filterBillingInvoiceRecordsByLinkage(registerScopedInvoiceRecords, linkageFilter);
  const filteredInvoiceRecords = filterBillingInvoiceRecordsByOverdueStatus(linkageFilteredInvoiceRecords, overdueFilter);
  const linkageScopedInvoiceSummary = summarizeBillingInvoiceRecords(linkageFilteredInvoiceRecords);
  const invoicePriorityQueue = buildBillingInvoicePriorityQueue(registerScopedInvoiceRecords, {
    limit: 3,
    classifyRecord: (record, records) => {
      const exactMatchFundingAward = resolveExactBillingInvoiceAwardMatch(record, records, workspaceFundingAwards);
      if (!exactMatchFundingAward) {
        return null;
      }

      const overdue = isInvoiceOverdue(record.status, record.due_date);
      const status = typeof record.status === "string" ? record.status : "draft";
      const isOutstanding = ["internal_review", "submitted", "approved_for_payment"].includes(status);

      return {
        priorityTier: overdue ? 0.5 : isOutstanding ? 1.5 : 2.5,
        reason: overdue
          ? `Exact award relink is ready now: ${exactMatchFundingAward.title} is the only eligible award on this project, and this overdue invoice is the only active unlinked reimbursement record.`
          : isOutstanding
            ? `Exact award relink is ready now: ${exactMatchFundingAward.title} is the only eligible award on this project, and this invoice is the only active unlinked reimbursement record still in payment flow.`
            : `Exact award relink is ready now: ${exactMatchFundingAward.title} is the only eligible award on this project, and this invoice is the only active unlinked reimbursement record.`,
        isExactRelink: true,
      };
    },
  });
  const exactRelinkCandidateCount = registerScopedInvoiceRecords.filter((invoice) =>
    Boolean(resolveExactBillingInvoiceAwardMatch(invoice, registerScopedInvoiceRecords, workspaceFundingAwards))
  ).length;
  const activeFocusedInvoiceId =
    requestedFocusedInvoiceId && registerScopedInvoiceRecords.some((invoice) => invoice.id === requestedFocusedInvoiceId)
      ? requestedFocusedInvoiceId
      : null;
  const activeRelinkedInvoiceId =
    requestedRelinkedInvoiceId &&
    registerScopedInvoiceRecords.some(
      (invoice) => invoice.id === requestedRelinkedInvoiceId && Boolean(invoice.funding_award_id || normalizeJoin(invoice.funding_awards)?.id)
    )
      ? requestedRelinkedInvoiceId
      : null;
  const focusedInvoiceRecord = activeFocusedInvoiceId
    ? registerScopedInvoiceRecords.find((invoice) => invoice.id === activeFocusedInvoiceId) ?? null
    : null;
  const focusedInvoiceExactMatchFundingAward = focusedInvoiceRecord
    ? resolveExactBillingInvoiceAwardMatch(focusedInvoiceRecord, registerScopedInvoiceRecords, workspaceFundingAwards)
    : null;
  const focusedInvoiceRelinkSaved = Boolean(
    activeRelinkedInvoiceId &&
      activeFocusedInvoiceId &&
      activeRelinkedInvoiceId === activeFocusedInvoiceId &&
      focusedInvoiceRecord?.fundingAward
  );
  const focusedTriageHref = activeFocusedInvoiceId
    ? buildBillingInvoiceTriageHref({
        workspaceId,
        checkoutState,
        checkoutPlan,
        invoiceId: activeFocusedInvoiceId,
        linkage: linkageFilter,
        overdue: overdueFilter,
        projectId: activeProjectFilterId,
      })
    : null;
  const linkageFilterOptions = [
    {
      value: "all" as const,
      label: "All records",
      count: registerScopedInvoiceSummary.totalCount,
      outstandingNetAmount: registerScopedInvoiceSummary.outstandingNetAmount,
      totalNetAmount: registerScopedInvoiceSummary.totalNetAmount,
      overdueCount: registerScopedInvoiceSummary.overdueCount,
      overdueNetAmount: registerScopedInvoiceSummary.overdueNetAmount,
    },
    {
      value: "linked" as const,
      label: "Award-linked",
      count: registerScopedLinkageSummary.linkedCount,
      outstandingNetAmount: registerScopedLinkageSummary.linkedOutstandingNetAmount,
      totalNetAmount: registerScopedLinkageSummary.linkedNetAmount,
      overdueCount: registerScopedLinkageSummary.linkedOverdueCount,
      overdueNetAmount: registerScopedLinkageSummary.linkedOverdueNetAmount,
    },
    {
      value: "unlinked" as const,
      label: "Unlinked",
      count: registerScopedLinkageSummary.unlinkedCount,
      outstandingNetAmount: registerScopedLinkageSummary.unlinkedOutstandingNetAmount,
      totalNetAmount: registerScopedLinkageSummary.unlinkedNetAmount,
      overdueCount: registerScopedLinkageSummary.unlinkedOverdueCount,
      overdueNetAmount: registerScopedLinkageSummary.unlinkedOverdueNetAmount,
    },
  ] satisfies Array<{
    value: BillingInvoiceLinkageFilter;
    label: string;
    count: number;
    outstandingNetAmount: number;
    totalNetAmount: number;
    overdueCount: number;
    overdueNetAmount: number;
  }>;
  const activeLinkageFilterOption = linkageFilterOptions.find((option) => option.value === linkageFilter) ?? linkageFilterOptions[0];
  const overdueFilterOptions = [
    {
      value: "all" as const,
      label: "All due states",
      count: linkageScopedInvoiceSummary.totalCount,
      netAmount: linkageScopedInvoiceSummary.totalNetAmount,
    },
    {
      value: "overdue" as const,
      label: "Overdue only",
      count: linkageScopedInvoiceSummary.overdueCount,
      netAmount: linkageScopedInvoiceSummary.overdueNetAmount,
    },
  ] satisfies Array<{
    value: BillingInvoiceOverdueFilter;
    label: string;
    count: number;
    netAmount: number;
  }>;
  const activeOverdueFilterOption = overdueFilterOptions.find((option) => option.value === overdueFilter) ?? overdueFilterOptions[0];

  const identityReviewEvent = billingEvents?.find((event) => event.event_type === "checkout_identity_review_required");
  const identityReviewPayload =
    identityReviewEvent && typeof identityReviewEvent.payload === "object" && identityReviewEvent.payload !== null
      ? (identityReviewEvent.payload as Record<string, unknown>)
      : null;
  const initiatedByUserEmail =
    identityReviewPayload && typeof identityReviewPayload.initiatedByUserEmail === "string"
      ? identityReviewPayload.initiatedByUserEmail
      : null;
  const purchaserEmail =
    identityReviewPayload && typeof identityReviewPayload.purchaserEmail === "string"
      ? identityReviewPayload.purchaserEmail
      : null;
  const billingSupportState = resolveBillingSupportState({
    status,
    checkoutState,
    billingUpdatedAt: workspace.billing_updated_at ?? null,
    events: (billingEvents ?? []).map((event) => ({
      eventType: event.event_type,
      createdAt: event.created_at,
    })),
  });
  const operationsSummary = await loadWorkspaceOperationsSummaryForWorkspace(
    supabase as unknown as WorkspaceOperationsSupabaseLike,
    workspaceId
  );

  return (
    <section className="space-y-6">
      <header className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px] xl:items-end">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Billing</p>
          <h1 className="text-3xl font-semibold tracking-tight">{workspace.name ?? "Workspace"} Billing</h1>
          <p className="text-sm text-muted-foreground sm:text-base">
            Manage both subscription state and consulting invoice posture for this workspace. Subscription checkout still requires owner/admin role, while invoice register reads are workspace-wide and writes are owner/admin only.
          </p>
        </div>

        <div className={`${insetClass()} grid gap-px bg-border/80`}>
          <div className="bg-background/70 px-4 py-3 text-sm">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Role</p>
            <p className="mt-1 font-semibold text-foreground">{titleCase(membership.role)}</p>
          </div>
          <div className="bg-background/70 px-4 py-3 text-sm">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Workspace ID</p>
            <p className="mt-1 font-semibold text-foreground">{formatWorkspaceIdSnippet(workspaceId)}</p>
          </div>
          <div className="bg-background/70 px-4 py-3 text-sm">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Last billing update</p>
            <p className="mt-1 font-semibold text-foreground">{workspace.billing_updated_at ? new Date(workspace.billing_updated_at).toLocaleString() : "N/A"}</p>
          </div>
        </div>
      </header>

      {selection.hasMultipleMemberships ? (
        <article className={`${insetClass()} px-4 py-4 text-sm text-muted-foreground`}>
          <p className="font-semibold text-foreground">Viewing workspace-specific billing</p>
          <p className="mt-1.5">
            This account has access to multiple workspaces. You are currently viewing billing for <strong>{workspace.name ?? "Workspace"}</strong>, and any checkout launched below will apply only to this workspace target.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/60 pt-3">
            {selection.memberships.map((membershipOption) => {
              const optionWorkspace = unwrapWorkspaceRecord(membershipOption.workspaces);
              const isCurrentWorkspace = membershipOption.workspace_id === workspaceId;
              return (
                <Link
                  key={membershipOption.workspace_id}
                  href={`/billing?workspaceId=${membershipOption.workspace_id}`}
                  className={isCurrentWorkspace ? "text-sm font-semibold text-foreground" : "text-sm font-semibold text-muted-foreground transition hover:text-foreground"}
                  aria-current={isCurrentWorkspace ? "page" : undefined}
                >
                  {optionWorkspace?.name ?? "Workspace"}
                </Link>
              );
            })}
            <span className="text-border">•</span>
            <Link href="/billing" className="text-sm font-semibold text-muted-foreground transition hover:text-foreground">
              Re-open workspace chooser
            </Link>
          </div>
        </article>
      ) : null}

      {checkoutState === "mock" ? (
        <article className={`${insetClass()} px-4 py-4 text-sm text-muted-foreground`}>
          Mock checkout completed for plan <span className="font-semibold text-foreground">{titleCase(checkoutPlan)}</span>. Configure `OPENPLAN_STRIPE_SECRET_KEY` and Stripe price IDs to route to live Checkout Sessions.
        </article>
      ) : null}

      {checkoutState === "success" ? (
        <article className={noticeClass("success")}>
          Stripe checkout returned successfully for plan <strong>{titleCase(checkoutPlan)}</strong>. OpenPlan still relies on webhook processing to finalize workspace access, so confirm the status lane and recent billing events below before treating activation as complete.
        </article>
      ) : null}

      {checkoutState === "cancel" ? (
        <article className={noticeClass("warning")}>
          Stripe checkout was canceled before payment completion for plan <strong>{titleCase(checkoutPlan)}</strong>. The workspace may still show <strong>Checkout Pending</strong> until a new checkout is completed or operations clears the abandoned pending state.
        </article>
      ) : null}

      {status === "checkout_pending" && identityReviewEvent ? (
        <article className={noticeClass("warning")}>
          <p className="font-semibold tracking-tight">Activation is paused for billing identity review.</p>
          <p className="mt-2 text-sm opacity-90">
            OpenPlan detected a purchaser-email mismatch during checkout, so this workspace stayed in <strong>Checkout Pending</strong> instead of auto-activating access.
          </p>
          <ul className="mt-3 space-y-1.5 text-sm opacity-90">
            {initiatedByUserEmail ? <li>Workspace checkout was initiated by: <strong>{initiatedByUserEmail}</strong></li> : null}
            {purchaserEmail ? <li>Stripe checkout completed with: <strong>{purchaserEmail}</strong></li> : null}
            <li>Next step: sign in with the purchaser email used at checkout, or complete a manual ownership review before activation.</li>
          </ul>
        </article>
      ) : null}

      {billingSupportState && !(status === "checkout_pending" && identityReviewEvent) ? (
        <article className={noticeClass(billingSupportState.tone === "warning" ? "warning" : "info")}>
          <p className="font-semibold tracking-tight">{billingSupportState.title}</p>
          <p className="mt-2">{billingSupportState.summary}</p>
          <ul className="mt-3 space-y-1.5">
            {billingSupportState.bullets.map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
        </article>
      ) : null}

      <article className={panelClass()}>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px] xl:items-start">
          <div>
            <div className="flex flex-wrap items-center gap-2 border-b border-border/60 pb-4">
              <StatusBadge tone={toneForStatus(status)}>{titleCase(status)}</StatusBadge>
              <StatusBadge tone="info">Plan: {titleCase(plan)}</StatusBadge>
              <StatusBadge tone="neutral">Role: {titleCase(membership.role)}</StatusBadge>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              Checkout initialization sets billing state to <strong className="text-foreground">Checkout Pending</strong> and records the selected plan on this exact workspace. The consulting invoice register below is separate and is meant for project-delivery operations rather than subscription enforcement.
            </p>
          </div>
          <div className={`${insetClass()} px-4 py-4 text-sm text-muted-foreground`}>
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em]">Operating rule</p>
            <p className="mt-2 text-foreground">
              Subscription state belongs to the workspace ledger. Invoice records belong to delivery operations. Keep the two lanes aligned, but do not conflate them.
            </p>
          </div>
        </div>
      </article>

      <BillingCheckoutLauncher
        workspaceId={workspaceId}
        workspaceName={workspace.name ?? "Workspace"}
        currentPlan={plan}
        currentStatus={status}
        currentPeriodEnd={workspaceBillingDetail?.subscription_current_period_end ?? null}
        canStartCheckout={canStartCheckout}
      />

      <section className="space-y-4">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-end">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Consulting invoices</p>
            <h2 className="text-2xl font-semibold tracking-tight text-foreground">Consulting invoice operations</h2>
            <p className="text-sm text-muted-foreground">
              Subscription checkout stays above as account and billing state. This section is the project-delivery invoice register used by operators for retention, backup posture, and workspace or project linkage.
            </p>
          </div>
          <div className={`${insetClass()} px-4 py-4 text-sm text-muted-foreground`}>
            <p className="font-semibold text-foreground">Current scope</p>
            <p className="mt-1.5">
              OpenPlan supports a workspace or project invoice register with supporting-doc posture, retention, and operator notes. It does <strong>not yet</strong> generate exact CALTRANS or LAPM exhibit packets, reimbursement claim forms, or agency-certified pay apps automatically.
            </p>
          </div>
        </div>

        <WorkspaceRuntimeCue summary={operationsSummary} />
        {operationsSummary.nextCommand?.key === "start-project-reimbursement-packets" ||
        operationsSummary.nextCommand?.key === "advance-project-reimbursement-invoicing" ? (
          <div className={`${insetClass()} flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm`}>
            <div>
              <p className="font-semibold text-foreground">Current workspace reimbursement priority</p>
              <p className="mt-1 text-muted-foreground">{operationsSummary.nextCommand.detail}</p>
            </div>
            <Link href={operationsSummary.nextCommand.href} className="text-sm font-semibold text-foreground transition hover:text-primary">
              Open lead project lane
            </Link>
          </div>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <InvoiceRecordComposer
            workspaceId={workspaceId}
            projects={workspaceProjects.map((project) => ({ id: project.id, name: project.name }))}
            fundingAwards={workspaceFundingAwards.map((award) => ({ id: award.id, title: award.title, projectId: award.project_id }))}
            canWrite={canWriteInvoices}
          />

          <article className={panelClass()}>
            <div className="flex items-start gap-3 border-b border-border/60 pb-4">
              <span className="mt-0.5 flex h-10 w-10 items-center justify-center border border-emerald-300/40 bg-emerald-500/10 text-emerald-700 dark:border-emerald-700/30 dark:text-emerald-300">
                <FileSpreadsheet className="h-5 w-5" />
              </span>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Invoice register</p>
                <h3 className="text-lg font-semibold tracking-tight text-foreground">Register summary</h3>
              </div>
            </div>

            {invoiceRegisterPending ? (
              <div className="mt-4 border-l-2 border-amber-300/80 bg-amber-50/80 px-4 py-3 text-sm text-amber-950 dark:border-amber-700/60 dark:bg-amber-950/25 dark:text-amber-100">
                Invoice register tables are pending in the current database. Apply the Lane C migration before expecting workspace invoice records to render here.
              </div>
            ) : (
              <div className="mt-4 grid gap-px border border-border/60 bg-border/80 sm:grid-cols-2 xl:grid-cols-3">
                <div className="bg-background/70 px-4 py-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Records</p>
                  <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{invoiceSummary.totalCount}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{invoiceSummary.draftCount} draft, {invoiceSummary.submittedCount} in review or payment flow.</p>
                </div>
                <div className="bg-background/70 px-4 py-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Net requested</p>
                  <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{formatCurrency(invoiceSummary.totalNetAmount)}</p>
                  <p className="mt-1 text-sm text-muted-foreground">All non-rejected invoice records in this workspace register.</p>
                </div>
                <div className="bg-background/70 px-4 py-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Outstanding</p>
                  <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{formatCurrency(invoiceSummary.outstandingNetAmount)}</p>
                  <p className="mt-1 text-sm text-muted-foreground">Submitted, internal-review, or approved-for-payment net amount.</p>
                </div>
                <div className="bg-background/70 px-4 py-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Paid</p>
                  <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{formatCurrency(invoiceSummary.paidNetAmount)}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{invoiceSummary.overdueCount} overdue invoice record(s) still need attention.</p>
                </div>
                <div className="bg-background/70 px-4 py-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Award-linked</p>
                  <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{formatCurrency(invoiceLinkageSummary.linkedNetAmount)}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{invoiceLinkageSummary.linkedCount} invoice record(s) are currently part of the funding-award reimbursement chain.</p>
                </div>
                <div className="bg-background/70 px-4 py-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Unlinked to award</p>
                  <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{formatCurrency(invoiceLinkageSummary.unlinkedNetAmount)}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{invoiceLinkageSummary.unlinkedCount} invoice record(s) still sit outside award-backed reimbursement reporting.</p>
                </div>
              </div>
            )}

            {!invoiceRegisterPending && invoiceLinkageSummary.unlinkedCount > 0 ? (
              <div className="mt-4 border-l-2 border-amber-300/80 bg-amber-50/80 px-4 py-3 text-sm text-amber-950 dark:border-amber-700/60 dark:bg-amber-950/25 dark:text-amber-100">
                {invoiceLinkageSummary.unlinkedCount} invoice record{invoiceLinkageSummary.unlinkedCount === 1 ? " is" : "s are"} still unlinked to a funding award, totaling <strong>{formatCurrency(invoiceLinkageSummary.unlinkedNetAmount)}</strong>.
                {invoiceLinkageSummary.unlinkedOverdueCount > 0
                  ? ` ${invoiceLinkageSummary.unlinkedOverdueCount} of those record${invoiceLinkageSummary.unlinkedOverdueCount === 1 ? " is" : "s are"} already overdue, totaling ${formatCurrency(invoiceLinkageSummary.unlinkedOverdueNetAmount)}.`
                  : ""}{" "}
                That means reimbursement posture remains understated until those records are attached to award-backed funding.
              </div>
            ) : null}

            {!invoiceRegisterPending && invoicePriorityQueue.length > 0 ? (
              <div className="mt-4 border border-border/60 bg-background/70 px-4 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 pb-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Priority cleanup queue</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Highest reimbursement-risk records first, ranked by unlinked status, overdue posture, and net amount.
                    </p>
                    {exactRelinkCandidateCount > 0 ? (
                      <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">
                        {exactRelinkCandidateCount} invoice record{exactRelinkCandidateCount === 1 ? " has" : "s have"} an exact award relink ready from this lane.
                      </p>
                    ) : null}
                    {activeProjectFilterName ? (
                      <p className="mt-1 text-xs text-muted-foreground">Currently narrowed to project scope: {activeProjectFilterName}.</p>
                    ) : null}
                  </div>
                  <StatusBadge tone="warning">Top {invoicePriorityQueue.length}</StatusBadge>
                </div>

                <ul className="mt-3 space-y-3">
                  {invoicePriorityQueue.map((entry) => {
                    const invoice = entry.record;
                    const triageHref = buildBillingInvoiceTriageHref({
                      workspaceId,
                      checkoutState,
                      checkoutPlan,
                      invoiceId: invoice.id,
                      linkage: entry.isLinked ? "linked" : "unlinked",
                      overdue: entry.isOverdue ? "overdue" : "all",
                      projectId: invoice.project_id,
                    });
                    return (
                      <li key={invoice.id} className="border border-border/50 bg-background/80 px-3 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-foreground">{invoice.invoice_number}</p>
                          <StatusBadge tone={entry.isLinked ? "neutral" : "warning"}>
                            {entry.isLinked ? "Award-linked" : "Unlinked"}
                          </StatusBadge>
                          {entry.isExactRelink ? <StatusBadge tone="success">Exact relink ready</StatusBadge> : null}
                          {entry.isOverdue ? <StatusBadge tone="danger">Overdue</StatusBadge> : null}
                          {entry.isOutstanding ? <StatusBadge tone="info">Outstanding</StatusBadge> : null}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                          <span>
                            {invoice.project_id ? `Project ${projectNameById.get(invoice.project_id) ?? invoice.project_id}` : "Workspace-level record"}
                            {invoice.due_date ? ` · Due ${invoice.due_date}` : ""}
                          </span>
                          <span className="font-semibold text-foreground">{formatCurrency(entry.netAmount)}</span>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">{entry.reason}</p>
                        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/50 pt-3">
                          <Link href={triageHref} className="openplan-inline-label">
                            {canWriteInvoices ? "Fix now in register" : "Open in register"}
                          </Link>
                          <span className="text-xs text-muted-foreground">
                            Opens the matching linkage and overdue filter state, then jumps to this invoice row.
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </article>
        </div>

        <article className={panelClass()}>
          <div className="space-y-1 border-b border-border/60 pb-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Invoice register</p>
            <h3 className="text-lg font-semibold tracking-tight">Consulting invoice records</h3>
          </div>

          {!invoiceRegisterPending && activeProjectFilterId && activeProjectFilterName ? (
            <div className="mt-4 flex flex-wrap items-center gap-2 border border-border/60 bg-background/70 px-3 py-3 text-sm">
              <StatusBadge tone="info">Project scope</StatusBadge>
              <span className="font-semibold text-foreground">{activeProjectFilterName}</span>
              <span className="text-muted-foreground">
                {registerScopedInvoiceSummary.totalCount} invoice record{registerScopedInvoiceSummary.totalCount === 1 ? "" : "s"} in this narrowed register.
              </span>
              <Link
                href={buildBillingHref({
                  workspaceId,
                  checkoutState,
                  checkoutPlan,
                  linkage: linkageFilter,
                  overdue: overdueFilter,
                  projectId: null,
                  focusedInvoiceId: activeFocusedInvoiceId,
                  relinkedInvoiceId: activeRelinkedInvoiceId,
                })}
                className="openplan-inline-label"
              >
                Show all projects
              </Link>
            </div>
          ) : null}

          {!invoiceRegisterPending && activeFocusedInvoiceId ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 border border-sky-300/70 bg-sky-50/70 px-3 py-3 text-sm text-sky-950 dark:border-sky-800/60 dark:bg-sky-950/25 dark:text-sky-100">
              <StatusBadge tone="info">Focused row</StatusBadge>
              <span>The register is highlighting the invoice you opened from billing triage.</span>
              {focusedInvoiceExactMatchFundingAward ? (
                <span>
                  The only safe funding-award match is ready below and will be preselected as <strong>{focusedInvoiceExactMatchFundingAward.title}</strong>.
                </span>
              ) : null}
              {focusedInvoiceRelinkSaved ? (
                <span>
                  Relink saved. This focused invoice now sits inside the reimbursement chain through <strong>{focusedInvoiceRecord?.fundingAward?.title}</strong>.
                </span>
              ) : null}
              {focusedTriageHref ? <BillingTriageLinkCopy href={focusedTriageHref} /> : null}
              <Link
                href={buildBillingHref({
                  workspaceId,
                  checkoutState,
                  checkoutPlan,
                  linkage: linkageFilter,
                  overdue: overdueFilter,
                  projectId: activeProjectFilterId,
                  focusedInvoiceId: null,
                  relinkedInvoiceId: null,
                })}
                className="openplan-inline-label"
              >
                Clear focus
              </Link>
            </div>
          ) : null}

          {!invoiceRegisterPending ? (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {linkageFilterOptions.map((option) => {
                const active = linkageFilter === option.value;
                return (
                  <Link
                    key={option.value}
                    href={buildBillingHref({
                      workspaceId,
                      checkoutState,
                      checkoutPlan,
                      linkage: option.value,
                      overdue: overdueFilter,
                      projectId: activeProjectFilterId,
                      focusedInvoiceId: activeFocusedInvoiceId,
                      relinkedInvoiceId: activeRelinkedInvoiceId,
                    })}
                    className={active ? "openplan-inline-label" : "openplan-inline-label openplan-inline-label-muted"}
                  >
                    {option.label} · {option.count} · {formatCurrency(option.outstandingNetAmount)} outstanding
                    {option.overdueCount > 0 ? ` · ${option.overdueCount} overdue` : ""}
                  </Link>
                );
              })}
            </div>
          ) : null}

          {!invoiceRegisterPending ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {overdueFilterOptions.map((option) => {
                const active = overdueFilter === option.value;
                return (
                  <Link
                    key={option.value}
                    href={buildBillingHref({
                      workspaceId,
                      checkoutState,
                      checkoutPlan,
                      linkage: linkageFilter,
                      overdue: option.value,
                      projectId: activeProjectFilterId,
                      focusedInvoiceId: activeFocusedInvoiceId,
                      relinkedInvoiceId: activeRelinkedInvoiceId,
                    })}
                    className={active ? "openplan-inline-label" : "openplan-inline-label openplan-inline-label-muted"}
                  >
                    {option.label} · {option.count}
                    {option.value === "overdue" ? ` · ${formatCurrency(option.netAmount)} late` : ""}
                  </Link>
                );
              })}
            </div>
          ) : null}

          {!invoiceRegisterPending ? (
            <p className="mt-3 text-xs text-muted-foreground">
              {linkageFilter === "all"
                ? `${activeProjectFilterName ? `${activeProjectFilterName} register scope currently tracks` : `Workspace invoice register currently tracks`} ${formatCurrency(registerScopedInvoiceSummary.totalNetAmount)} net requested, with ${formatCurrency(registerScopedInvoiceSummary.outstandingNetAmount)} still in review or payment flow.`
                : linkageFilter === "linked"
                  ? `Award-linked records currently account for ${formatCurrency(registerScopedLinkageSummary.linkedNetAmount)} net requested, with ${formatCurrency(registerScopedLinkageSummary.linkedOutstandingNetAmount)} still outstanding inside the reimbursement chain.`
                  : `Unlinked records currently account for ${formatCurrency(registerScopedLinkageSummary.unlinkedNetAmount)} net requested, with ${formatCurrency(registerScopedLinkageSummary.unlinkedOutstandingNetAmount)} still outstanding outside the reimbursement chain.`}
              {activeLinkageFilterOption.overdueCount > 0
                ? ` ${activeLinkageFilterOption.overdueCount} overdue record${activeLinkageFilterOption.overdueCount === 1 ? " is" : "s are"} already late, totaling ${formatCurrency(activeLinkageFilterOption.overdueNetAmount)}.`
                : ""}
              {overdueFilter === "overdue"
                ? ` Register view is currently narrowed to overdue invoices only, showing ${activeOverdueFilterOption.count} late record${activeOverdueFilterOption.count === 1 ? "" : "s"} totaling ${formatCurrency(activeOverdueFilterOption.netAmount)}.`
                : ""}
            </p>
          ) : null}

          {invoiceRegisterPending ? (
            <p className="mt-4 text-sm text-muted-foreground">Apply the Lane C migration to enable invoice register visibility for this workspace.</p>
          ) : filteredInvoiceRecords.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              {overdueFilter === "overdue"
                ? linkageFilter === "linked"
                  ? "No overdue award-linked invoice records are visible in this workspace right now."
                  : linkageFilter === "unlinked"
                    ? "No overdue unlinked invoice records are visible in this workspace right now."
                    : "No overdue invoice records are visible in this workspace right now."
                : linkageFilter === "linked"
                  ? "No award-linked invoice records are visible in this workspace yet."
                  : linkageFilter === "unlinked"
                    ? "No unlinked invoice records are visible in this workspace right now."
                    : "No invoice records recorded yet for this workspace."}
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {filteredInvoiceRecords.map((invoice) => {
                const riskState = billingRowRiskState(invoice);
                const isFocusedRow = activeFocusedInvoiceId === invoice.id;
                const isJustRelinkedRow = activeRelinkedInvoiceId === invoice.id;
                const exactMatchFundingAward = resolveExactBillingInvoiceAwardMatch(invoice, registerScopedInvoiceRecords, workspaceFundingAwards);
                const rowTriageHref = riskState.title
                  ? buildBillingInvoiceTriageHref({
                      workspaceId,
                      checkoutState,
                      checkoutPlan,
                      invoiceId: invoice.id,
                      linkage: invoice.funding_award_id ? "linked" : "unlinked",
                      overdue: isInvoiceOverdue(invoice.status, invoice.due_date) ? "overdue" : "all",
                      projectId: invoice.project_id,
                    })
                  : null;

                return (
                  <li
                    id={`invoice-record-${invoice.id}`}
                    key={invoice.id}
                    className={`scroll-mt-24 border px-4 py-4 ${riskState.rowClassName} ${isFocusedRow ? "ring-2 ring-sky-400/80 ring-offset-2 ring-offset-background shadow-[0_0_0_1px_rgba(56,189,248,0.15)]" : ""}`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone={toneForInvoiceStatus(invoice.status)}>{titleCase(invoice.status)}</StatusBadge>
                      <StatusBadge tone="info">{titleCase(invoice.billing_basis)}</StatusBadge>
                      <StatusBadge tone={toneForSupportingDocs(invoice.supporting_docs_status)}>{titleCase(invoice.supporting_docs_status)}</StatusBadge>
                      {invoice.fundingAward ? <StatusBadge tone="neutral">Award {invoice.fundingAward.title}</StatusBadge> : null}
                      {isFocusedRow ? <StatusBadge tone="info">Focused from triage</StatusBadge> : null}
                      {isJustRelinkedRow ? <StatusBadge tone="success">Relink just saved</StatusBadge> : null}
                      {exactMatchFundingAward ? <StatusBadge tone="success">Exact match ready</StatusBadge> : null}
                      {!invoice.fundingAward && invoiceNeedsAwardRelink(invoice.status, invoice.funding_award_id) ? (
                        <StatusBadge tone={riskState.tone === "danger" ? "danger" : "warning"}>Needs relink</StatusBadge>
                      ) : null}
                      {riskState.title ? <StatusBadge tone={riskState.tone ?? "neutral"}>{riskState.title}</StatusBadge> : null}
                      <p className="text-[0.72rem] uppercase tracking-[0.08em] text-muted-foreground">
                        {invoice.created_at ? new Date(invoice.created_at).toLocaleString() : "N/A"}
                      </p>
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
                      <div>
                        <p className="text-sm font-semibold text-foreground">{invoice.invoice_number}</p>
                        <p className="text-xs text-muted-foreground">
                          {invoice.project_id ? `Project ${projectNameById.get(invoice.project_id) ?? invoice.project_id}` : "Workspace-level record"}
                          {invoice.submitted_to ? ` · ${invoice.submitted_to}` : ""}
                        </p>
                      </div>
                      <div className="text-left md:text-right">
                        <p className="text-sm font-semibold text-foreground">{formatCurrency(Number(invoice.net_amount ?? 0))}</p>
                        <p className="text-xs text-muted-foreground">
                          Gross {formatCurrency(Number(invoice.amount ?? 0))}
                          {Number(invoice.retention_amount ?? 0) > 0 ? ` · Retention ${formatCurrency(Number(invoice.retention_amount ?? 0))}` : ""}
                        </p>
                      </div>
                    </div>

                    {riskState.title && riskState.detail ? (
                      <div className={`mt-3 ${billingRowNoticeClass(riskState.tone ?? "info")}`}>
                        <p className="font-semibold tracking-tight">{riskState.title}</p>
                        <p className="mt-1">{riskState.detail}</p>
                      </div>
                    ) : null}

                    {exactMatchFundingAward ? (
                      <div className="mt-3 border-l-2 border-emerald-300/80 bg-emerald-50/80 px-4 py-3 text-sm text-emerald-950 dark:border-emerald-700/60 dark:bg-emerald-950/25 dark:text-emerald-100">
                        <p className="font-semibold tracking-tight">Exact award relink is ready</p>
                        <p className="mt-1">
                          This invoice is the only active unlinked reimbursement record on its project, and {exactMatchFundingAward.title} is the only available funding award for that same project.
                        </p>
                      </div>
                    ) : null}

                    {isJustRelinkedRow && invoice.fundingAward ? (
                      <div className="mt-3 border-l-2 border-emerald-300/80 bg-emerald-50/80 px-4 py-3 text-sm text-emerald-950 dark:border-emerald-700/60 dark:bg-emerald-950/25 dark:text-emerald-100">
                        <p className="font-semibold tracking-tight">Relink saved in this register view</p>
                        <p className="mt-1">This invoice now contributes to reimbursement posture through {invoice.fundingAward.title}.</p>
                      </div>
                    ) : null}

                    <p className="mt-3 text-xs text-muted-foreground">
                      {invoice.notes || `CALTRANS posture: ${titleCase(invoice.caltrans_posture)}.`}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-border/50 pt-3 text-xs text-muted-foreground">
                      {invoice.invoice_date ? <span>Invoice date {invoice.invoice_date}</span> : null}
                      {invoice.due_date ? <span>Due {invoice.due_date}</span> : null}
                      {invoice.consultant_name ? <span>Consultant {invoice.consultant_name}</span> : null}
                      {invoice.fundingAward ? <span>Funding award {invoice.fundingAward.title}</span> : null}
                    </div>

                    {rowTriageHref ? (
                      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/50 pt-3">
                        <Link href={rowTriageHref} className="openplan-inline-label">
                          Open triage view
                        </Link>
                        <BillingTriageLinkCopy href={rowTriageHref} />
                        <span className="text-xs text-muted-foreground">
                          Copies a shareable billing triage link for this exact invoice, including project scope, filters, and row anchor.
                        </span>
                      </div>
                    ) : null}

                    <InvoiceFundingAwardLinker
                      invoiceId={invoice.id}
                      workspaceId={workspaceId}
                      projectId={invoice.project_id}
                      isFocusedRow={isFocusedRow}
                      currentFundingAwardId={invoice.funding_award_id}
                      exactMatchFundingAwardId={exactMatchFundingAward?.id ?? null}
                      autoSelectExactMatch={isFocusedRow}
                      fundingAwards={workspaceFundingAwards.map((award) => ({
                        id: award.id,
                        title: award.title,
                        projectId: award.project_id,
                      }))}
                      canWrite={canWriteInvoices}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </article>
      </section>

      <article className={panelClass()}>
        <div className="border-b border-border/60 pb-4">
          <h2 className="text-lg font-semibold tracking-tight">Recent Billing Events</h2>
        </div>

        {!billingEvents || billingEvents.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No billing events recorded yet for this workspace.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {billingEvents.map((event) => (
              <li key={event.id} className="border border-border/60 bg-background/70 px-4 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone="neutral">{titleCase(event.event_type)}</StatusBadge>
                  <StatusBadge tone="info">{titleCase(event.source)}</StatusBadge>
                  <p className="text-[0.72rem] uppercase tracking-[0.08em] text-muted-foreground">
                    {event.created_at ? new Date(event.created_at).toLocaleString() : "N/A"}
                  </p>
                </div>
                <p className="mt-3 break-all text-xs text-muted-foreground">{event.payload ? JSON.stringify(event.payload) : "{}"}</p>
              </li>
            ))}
          </ul>
        )}
      </article>
    </section>
  );
}
