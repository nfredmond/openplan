import Link from "next/link";
import { redirect } from "next/navigation";
import { FileSpreadsheet } from "lucide-react";
import { BillingCheckoutLauncher } from "@/components/billing/billing-checkout-launcher";
import { InvoiceFundingAwardLinker } from "@/components/billing/invoice-funding-award-linker";
import { InvoiceRecordComposer } from "@/components/billing/invoice-record-composer";
import { StatusBadge } from "@/components/ui/status-badge";
import { WorkspaceMembershipRequired } from "@/components/workspaces/workspace-membership-required";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import {
  filterBillingInvoiceRecordsByLinkage,
  type BillingInvoiceLinkageFilter,
  summarizeBillingInvoiceLinkage,
  summarizeBillingInvoiceRecords,
} from "@/lib/billing/invoice-records";
import { resolveBillingSupportState } from "@/lib/billing/support";
import { normalizeSubscriptionStatus } from "@/lib/billing/subscription";
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

function buildBillingHref(params: {
  workspaceId: string | null;
  checkoutState: string | null;
  checkoutPlan: string | null;
  linkage: BillingInvoiceLinkageFilter;
}) {
  const search = new URLSearchParams();
  if (params.workspaceId) search.set("workspaceId", params.workspaceId);
  if (params.checkoutState) search.set("checkout", params.checkoutState);
  if (params.checkoutPlan) search.set("plan", params.checkoutPlan);
  if (params.linkage !== "all") search.set("linkage", params.linkage);
  const query = search.toString();
  return query ? `/billing?${query}` : "/billing";
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
  const filteredInvoiceRecords = filterBillingInvoiceRecordsByLinkage(invoiceRecords, linkageFilter);
  const linkageFilterOptions = [
    {
      value: "all" as const,
      label: "All records",
      count: invoiceSummary.totalCount,
      outstandingNetAmount: invoiceSummary.outstandingNetAmount,
      totalNetAmount: invoiceSummary.totalNetAmount,
      overdueCount: invoiceSummary.overdueCount,
      overdueNetAmount: invoiceSummary.overdueNetAmount,
    },
    {
      value: "linked" as const,
      label: "Award-linked",
      count: invoiceLinkageSummary.linkedCount,
      outstandingNetAmount: invoiceLinkageSummary.linkedOutstandingNetAmount,
      totalNetAmount: invoiceLinkageSummary.linkedNetAmount,
      overdueCount: invoiceLinkageSummary.linkedOverdueCount,
      overdueNetAmount: invoiceLinkageSummary.linkedOverdueNetAmount,
    },
    {
      value: "unlinked" as const,
      label: "Unlinked",
      count: invoiceLinkageSummary.unlinkedCount,
      outstandingNetAmount: invoiceLinkageSummary.unlinkedOutstandingNetAmount,
      totalNetAmount: invoiceLinkageSummary.unlinkedNetAmount,
      overdueCount: invoiceLinkageSummary.unlinkedOverdueCount,
      overdueNetAmount: invoiceLinkageSummary.unlinkedOverdueNetAmount,
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
  const workspaceProjects = (workspaceProjectsData ?? []) as Array<{
    id: string;
    name: string;
    status: string;
    delivery_phase: string | null;
  }>;
  const projectNameById = new Map(workspaceProjects.map((project) => [project.id, project.name]));

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
          </article>
        </div>

        <article className={panelClass()}>
          <div className="space-y-1 border-b border-border/60 pb-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Invoice register</p>
            <h3 className="text-lg font-semibold tracking-tight">Consulting invoice records</h3>
          </div>

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
            <p className="mt-3 text-xs text-muted-foreground">
              {linkageFilter === "all"
                ? `Workspace invoice register currently tracks ${formatCurrency(invoiceSummary.totalNetAmount)} net requested, with ${formatCurrency(invoiceSummary.outstandingNetAmount)} still in review or payment flow.`
                : linkageFilter === "linked"
                  ? `Award-linked records currently account for ${formatCurrency(invoiceLinkageSummary.linkedNetAmount)} net requested, with ${formatCurrency(invoiceLinkageSummary.linkedOutstandingNetAmount)} still outstanding inside the reimbursement chain.`
                  : `Unlinked records currently account for ${formatCurrency(invoiceLinkageSummary.unlinkedNetAmount)} net requested, with ${formatCurrency(invoiceLinkageSummary.unlinkedOutstandingNetAmount)} still outstanding outside the reimbursement chain.`}
              {activeLinkageFilterOption.overdueCount > 0
                ? ` ${activeLinkageFilterOption.overdueCount} overdue record${activeLinkageFilterOption.overdueCount === 1 ? " is" : "s are"} already late, totaling ${formatCurrency(activeLinkageFilterOption.overdueNetAmount)}.`
                : ""}
            </p>
          ) : null}

          {invoiceRegisterPending ? (
            <p className="mt-4 text-sm text-muted-foreground">Apply the Lane C migration to enable invoice register visibility for this workspace.</p>
          ) : filteredInvoiceRecords.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              {linkageFilter === "linked"
                ? "No award-linked invoice records are visible in this workspace yet."
                : linkageFilter === "unlinked"
                  ? "No unlinked invoice records are visible in this workspace right now."
                  : "No invoice records recorded yet for this workspace."}
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {filteredInvoiceRecords.map((invoice) => (
                <li key={invoice.id} className="border border-border/60 bg-background/70 px-4 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={toneForInvoiceStatus(invoice.status)}>{titleCase(invoice.status)}</StatusBadge>
                    <StatusBadge tone="info">{titleCase(invoice.billing_basis)}</StatusBadge>
                    <StatusBadge tone={toneForSupportingDocs(invoice.supporting_docs_status)}>{titleCase(invoice.supporting_docs_status)}</StatusBadge>
                    {invoice.fundingAward ? <StatusBadge tone="neutral">Award {invoice.fundingAward.title}</StatusBadge> : null}
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
                  <p className="mt-3 text-xs text-muted-foreground">
                    {invoice.notes || `CALTRANS posture: ${titleCase(invoice.caltrans_posture)}.`}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-border/50 pt-3 text-xs text-muted-foreground">
                    {invoice.invoice_date ? <span>Invoice date {invoice.invoice_date}</span> : null}
                    {invoice.due_date ? <span>Due {invoice.due_date}</span> : null}
                    {invoice.consultant_name ? <span>Consultant {invoice.consultant_name}</span> : null}
                    {invoice.fundingAward ? <span>Funding award {invoice.fundingAward.title}</span> : null}
                  </div>

                  <InvoiceFundingAwardLinker
                    invoiceId={invoice.id}
                    workspaceId={workspaceId}
                    projectId={invoice.project_id}
                    currentFundingAwardId={invoice.funding_award_id}
                    fundingAwards={workspaceFundingAwards.map((award) => ({
                      id: award.id,
                      title: award.title,
                      projectId: award.project_id,
                    }))}
                    canWrite={canWriteInvoices}
                  />
                </li>
              ))}
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
