import Link from "next/link";
import { redirect } from "next/navigation";
import { FileSpreadsheet } from "lucide-react";
import { InvoiceRecordComposer } from "@/components/billing/invoice-record-composer";
import { StatusBadge } from "@/components/ui/status-badge";
import { WorkspaceMembershipRequired } from "@/components/workspaces/workspace-membership-required";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { summarizeBillingInvoiceRecords } from "@/lib/billing/invoice-records";
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

export default async function BillingPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedParams = (await searchParams) ?? {};
  const checkoutState = typeof resolvedParams.checkout === "string" ? resolvedParams.checkout : null;
  const checkoutPlan = typeof resolvedParams.plan === "string" ? resolvedParams.plan : null;
  const requestedWorkspaceId = typeof resolvedParams.workspaceId === "string" ? resolvedParams.workspaceId : null;

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
        <header className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Billing</p>
          <h1 className="text-3xl font-semibold tracking-tight">Choose a workspace for billing</h1>
          <p className="text-sm text-muted-foreground sm:text-base">
            Billing state is workspace-specific. This account has access to multiple workspaces, so OpenPlan now requires an explicit workspace choice before showing subscription status or starting checkout.
          </p>
        </header>

        {selection.invalidWorkspaceId ? (
          <article className="rounded-2xl border border-amber-300/70 bg-amber-50 p-4 text-sm text-amber-950 shadow-[0_10px_24px_rgba(20,33,43,0.06)] dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-100">
            The requested billing workspace was not found for this account. Choose one of your accessible workspaces below.
          </article>
        ) : null}

        <article className="rounded-2xl border border-border/80 bg-card p-5 shadow-[0_10px_24px_rgba(20,33,43,0.06)] space-y-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Available workspaces</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Open the exact billing surface you intend to review. This prevents accidental checkout or status review against the wrong workspace.
            </p>
          </div>

          <ul className="grid gap-3">
            {selection.memberships.map((membershipOption) => {
              const workspaceOption = unwrapWorkspaceRecord(membershipOption.workspaces);
              const optionStatus = normalizeSubscriptionStatus(workspaceOption?.subscription_status ?? null);
              const optionPlan = workspaceOption?.subscription_plan ?? workspaceOption?.plan ?? "starter";

              return (
                <li key={membershipOption.workspace_id} className="rounded-2xl border border-border/70 bg-background p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
                      className="inline-flex rounded-full border border-border px-4 py-2 text-sm font-semibold transition hover:border-primary hover:text-primary"
                    >
                      Open billing
                    </Link>
                  </div>
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
  const canWriteInvoices = canAccessWorkspaceAction("billing.invoices.write", membership.role);

  const { data: billingEvents } = await supabase
    .from("billing_events")
    .select("id, event_type, source, created_at, payload")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(10);

  const { data: workspaceProjectsData } = await supabase
    .from("projects")
    .select("id, name, status, delivery_phase")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false });

  const invoiceRecordsResult = await supabase
    .from("billing_invoice_records")
    .select(
      "id, project_id, invoice_number, consultant_name, billing_basis, status, invoice_date, due_date, amount, retention_percent, retention_amount, net_amount, supporting_docs_status, submitted_to, caltrans_posture, notes, created_at"
    )
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(20);

  const invoiceRegisterPending = looksLikePendingSchema(invoiceRecordsResult.error?.message);
  const invoiceRecords = invoiceRegisterPending ? [] : (invoiceRecordsResult.data ?? []);
  const invoiceSummary = summarizeBillingInvoiceRecords(invoiceRecords);
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

  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Billing</p>
        <h1 className="text-3xl font-semibold tracking-tight">{workspace.name ?? "Workspace"} Billing</h1>
        <p className="text-sm text-muted-foreground sm:text-base">
          Manage both subscription state and consulting invoice posture for this workspace. Subscription checkout still requires owner/admin role; invoice register reads are workspace-wide and writes are owner/admin only.
        </p>
      </header>

      {selection.hasMultipleMemberships ? (
        <article className="rounded-2xl border border-border/80 bg-card p-4 text-sm text-muted-foreground shadow-[0_10px_24px_rgba(20,33,43,0.06)]">
          <p className="font-semibold text-foreground">Viewing workspace-specific billing</p>
          <p className="mt-1">
            This account has access to multiple workspaces. You are currently viewing billing for <strong>{workspace.name ?? "Workspace"}</strong>.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {selection.memberships.map((membershipOption) => {
              const optionWorkspace = unwrapWorkspaceRecord(membershipOption.workspaces);
              const isCurrentWorkspace = membershipOption.workspace_id === workspaceId;
              return (
                <Link
                  key={membershipOption.workspace_id}
                  href={`/billing?workspaceId=${membershipOption.workspace_id}`}
                  className={`inline-flex rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                    isCurrentWorkspace
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-foreground hover:border-primary hover:text-primary"
                  }`}
                  aria-current={isCurrentWorkspace ? "page" : undefined}
                >
                  {optionWorkspace?.name ?? "Workspace"}
                </Link>
              );
            })}
          </div>
        </article>
      ) : null}

      {checkoutState === "mock" ? (
        <article className="rounded-2xl border border-border/80 bg-card p-4 text-sm text-muted-foreground shadow-[0_10px_24px_rgba(20,33,43,0.06)]">
          Mock checkout completed for plan <span className="font-semibold text-foreground">{titleCase(checkoutPlan)}</span>. Configure `OPENPLAN_STRIPE_SECRET_KEY` and Stripe price IDs to route to live Checkout Sessions.
        </article>
      ) : null}

      {checkoutState === "success" ? (
        <article className="rounded-2xl border border-emerald-300/70 bg-emerald-50 p-4 text-sm text-emerald-950 shadow-[0_10px_24px_rgba(20,33,43,0.06)] dark:border-emerald-700/60 dark:bg-emerald-950/30 dark:text-emerald-100">
          Stripe checkout returned successfully for plan <strong>{titleCase(checkoutPlan)}</strong>. OpenPlan still relies on webhook processing to finalize workspace access, so confirm the status card and recent billing events below before treating activation as complete.
        </article>
      ) : null}

      {checkoutState === "cancel" ? (
        <article className="rounded-2xl border border-amber-300/70 bg-amber-50 p-4 text-sm text-amber-950 shadow-[0_10px_24px_rgba(20,33,43,0.06)] dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-100">
          Stripe checkout was canceled before payment completion for plan <strong>{titleCase(checkoutPlan)}</strong>. The workspace may still show <strong>Checkout Pending</strong> until a new checkout is completed or operations clears the abandoned pending state.
        </article>
      ) : null}

      {status === "checkout_pending" && identityReviewEvent ? (
        <article className="rounded-2xl border border-amber-300/70 bg-amber-50 p-4 text-sm text-amber-950 shadow-[0_10px_24px_rgba(20,33,43,0.06)] dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-100">
          <p className="font-semibold tracking-tight">Activation is paused for billing identity review.</p>
          <p className="mt-2 text-sm text-amber-900/90 dark:text-amber-100/90">
            OpenPlan detected a purchaser-email mismatch during checkout, so this workspace stayed in <strong>Checkout Pending</strong> instead of auto-activating access.
          </p>
          <ul className="mt-3 space-y-1.5 text-sm text-amber-900/90 dark:text-amber-100/90">
            {initiatedByUserEmail ? <li>Workspace checkout was initiated by: <strong>{initiatedByUserEmail}</strong></li> : null}
            {purchaserEmail ? <li>Stripe checkout completed with: <strong>{purchaserEmail}</strong></li> : null}
            <li>Next step: sign in with the purchaser email used at checkout, or complete a manual ownership review before activation.</li>
          </ul>
        </article>
      ) : null}

      <article className="rounded-2xl border border-border/80 bg-card p-5 shadow-[0_10px_24px_rgba(20,33,43,0.06)] space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={toneForStatus(status)}>{titleCase(status)}</StatusBadge>
          <StatusBadge tone="info">Plan: {titleCase(plan)}</StatusBadge>
          <StatusBadge tone="neutral">Role: {titleCase(membership.role)}</StatusBadge>
          <p className="text-[0.72rem] uppercase tracking-[0.08em] text-muted-foreground">
            Updated: {workspace.billing_updated_at ? new Date(workspace.billing_updated_at).toLocaleString() : "N/A"}
          </p>
        </div>

        <p className="text-sm text-muted-foreground">
          Checkout initialization sets billing state to <strong className="text-foreground">Checkout Pending</strong> and records selected plan on the workspace. The consulting invoice register below is separate and is meant for project-delivery operations rather than subscription enforcement.
        </p>

        <div className="flex flex-wrap gap-2">
          <Link
            href={`/api/billing/checkout?workspaceId=${workspaceId}&plan=starter`}
            className="inline-flex rounded-full border border-border px-4 py-2 text-sm font-semibold transition hover:border-primary hover:text-primary"
          >
            Start Starter Checkout
          </Link>
          <Link
            href={`/api/billing/checkout?workspaceId=${workspaceId}&plan=professional`}
            className="inline-flex rounded-full border border-border px-4 py-2 text-sm font-semibold transition hover:border-primary hover:text-primary"
          >
            Start Professional Checkout
          </Link>
        </div>
      </article>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <InvoiceRecordComposer workspaceId={workspaceId} projects={workspaceProjects.map((project) => ({ id: project.id, name: project.name }))} canWrite={canWriteInvoices} />

        <article className="rounded-2xl border border-border/80 bg-card p-5 shadow-[0_10px_24px_rgba(20,33,43,0.06)] space-y-4">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
              <FileSpreadsheet className="h-5 w-5" />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Invoice register</p>
              <h2 className="text-lg font-semibold tracking-tight text-foreground">Consulting/project-delivery billing posture</h2>
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            This is intentionally separate from Stripe subscription state. It captures invoice workflow, supporting-doc posture, retention, and project linkage for consulting work. Exact CALTRANS/LAPM exhibit/form IDs and automated claim packets remain deferred in v0.1.
          </p>

          {invoiceRegisterPending ? (
            <div className="rounded-2xl border border-amber-300/70 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-100">
              Invoice register tables are pending in the current database. Apply the Lane C migration before expecting workspace invoice records to render here.
            </div>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Records</p>
                  <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{invoiceSummary.totalCount}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{invoiceSummary.draftCount} draft · {invoiceSummary.submittedCount} in review/payment flow.</p>
                </div>
                <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Net requested</p>
                  <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{formatCurrency(invoiceSummary.totalNetAmount)}</p>
                  <p className="mt-1 text-sm text-muted-foreground">All non-rejected invoice records in this workspace register.</p>
                </div>
                <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Outstanding</p>
                  <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{formatCurrency(invoiceSummary.outstandingNetAmount)}</p>
                  <p className="mt-1 text-sm text-muted-foreground">Submitted, internal-review, or approved-for-payment net amount.</p>
                </div>
                <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Paid</p>
                  <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{formatCurrency(invoiceSummary.paidNetAmount)}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{invoiceSummary.overdueCount} overdue invoice record(s) still need attention.</p>
                </div>
              </div>

              <div className="rounded-2xl border border-border/70 bg-background/80 p-4 text-sm text-muted-foreground">
                <p className="font-semibold text-foreground">Current boundary</p>
                <p className="mt-1">
                  OpenPlan now supports a workspace/project invoice register with supporting-doc posture, retention, and operator notes. It does <strong>not yet</strong> generate exact CALTRANS/LAPM exhibit packets, reimbursement claim forms, or agency-certified pay apps automatically.
                </p>
              </div>
            </>
          )}
        </article>
      </div>

      <article className="rounded-2xl border border-border/80 bg-card p-5 shadow-[0_10px_24px_rgba(20,33,43,0.06)] space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Invoice Register</h2>

        {invoiceRegisterPending ? (
          <p className="text-sm text-muted-foreground">Apply the Lane C migration to enable invoice register visibility for this workspace.</p>
        ) : invoiceRecords.length === 0 ? (
          <p className="text-sm text-muted-foreground">No invoice records recorded yet for this workspace.</p>
        ) : (
          <ul className="space-y-2.5">
            {invoiceRecords.map((invoice) => (
              <li key={invoice.id} className="rounded-xl border border-border/70 bg-background p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone={toneForInvoiceStatus(invoice.status)}>{titleCase(invoice.status)}</StatusBadge>
                  <StatusBadge tone="info">{titleCase(invoice.billing_basis)}</StatusBadge>
                  <StatusBadge tone={toneForSupportingDocs(invoice.supporting_docs_status)}>{titleCase(invoice.supporting_docs_status)}</StatusBadge>
                  <p className="text-[0.72rem] uppercase tracking-[0.08em] text-muted-foreground">
                    {invoice.created_at ? new Date(invoice.created_at).toLocaleString() : "N/A"}
                  </p>
                </div>
                <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{invoice.invoice_number}</p>
                    <p className="text-xs text-muted-foreground">
                      {invoice.project_id ? `Project ${projectNameById.get(invoice.project_id) ?? invoice.project_id}` : "Workspace-level record"}
                      {invoice.submitted_to ? ` · ${invoice.submitted_to}` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-foreground">{formatCurrency(Number(invoice.net_amount ?? 0))}</p>
                    <p className="text-xs text-muted-foreground">
                      Gross {formatCurrency(Number(invoice.amount ?? 0))}
                      {Number(invoice.retention_amount ?? 0) > 0 ? ` · Retention ${formatCurrency(Number(invoice.retention_amount ?? 0))}` : ""}
                    </p>
                  </div>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {invoice.notes || `CALTRANS posture: ${titleCase(invoice.caltrans_posture)}.`}
                </p>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  {invoice.invoice_date ? <span>Invoice date {invoice.invoice_date}</span> : null}
                  {invoice.due_date ? <span>Due {invoice.due_date}</span> : null}
                  {invoice.consultant_name ? <span>Consultant {invoice.consultant_name}</span> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </article>

      <article className="rounded-2xl border border-border/80 bg-card p-5 shadow-[0_10px_24px_rgba(20,33,43,0.06)] space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Recent Billing Events</h2>

        {!billingEvents || billingEvents.length === 0 ? (
          <p className="text-sm text-muted-foreground">No billing events recorded yet for this workspace.</p>
        ) : (
          <ul className="space-y-2.5">
            {billingEvents.map((event) => (
              <li key={event.id} className="rounded-xl border border-border/70 bg-background p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone="neutral">{titleCase(event.event_type)}</StatusBadge>
                  <StatusBadge tone="info">{titleCase(event.source)}</StatusBadge>
                  <p className="text-[0.72rem] uppercase tracking-[0.08em] text-muted-foreground">
                    {event.created_at ? new Date(event.created_at).toLocaleString() : "N/A"}
                  </p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground break-all">{event.payload ? JSON.stringify(event.payload) : "{}"}</p>
              </li>
            ))}
          </ul>
        )}
      </article>
    </section>
  );
}
