import Link from "next/link";
import { redirect } from "next/navigation";
import { StatusBadge } from "@/components/ui/status-badge";
import { WorkspaceMembershipRequired } from "@/components/workspaces/workspace-membership-required";
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

function formatWorkspaceIdSnippet(workspaceId: string): string {
  return workspaceId.slice(0, 8);
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
            Billing state is workspace-specific. This account has access to multiple workspaces, so OpenPlan now requires an explicit workspace
            choice before showing subscription status or starting checkout.
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
                        <h3 className="text-base font-semibold tracking-tight text-foreground">
                          {workspaceOption?.name ?? "Workspace"}
                        </h3>
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

  const { data: billingEvents } = await supabase
    .from("billing_events")
    .select("id, event_type, source, created_at, payload")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(10);

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
          Manage subscription state for this workspace. Owner/admin role is required to initialize checkout.
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
          Mock checkout completed for plan <span className="font-semibold text-foreground">{titleCase(checkoutPlan)}</span>. Configure
          `OPENPLAN_STRIPE_SECRET_KEY` and Stripe price IDs to route to live Checkout Sessions.
        </article>
      ) : null}

      {checkoutState === "success" ? (
        <article className="rounded-2xl border border-emerald-300/70 bg-emerald-50 p-4 text-sm text-emerald-950 shadow-[0_10px_24px_rgba(20,33,43,0.06)] dark:border-emerald-700/60 dark:bg-emerald-950/30 dark:text-emerald-100">
          Stripe checkout returned successfully for plan <strong>{titleCase(checkoutPlan)}</strong>. OpenPlan still relies on webhook processing to
          finalize workspace access, so confirm the status card and recent billing events below before treating activation as complete.
        </article>
      ) : null}

      {checkoutState === "cancel" ? (
        <article className="rounded-2xl border border-amber-300/70 bg-amber-50 p-4 text-sm text-amber-950 shadow-[0_10px_24px_rgba(20,33,43,0.06)] dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-100">
          Stripe checkout was canceled before payment completion for plan <strong>{titleCase(checkoutPlan)}</strong>. The workspace may still show
          <strong> Checkout Pending</strong> until a new checkout is completed or operations clears the abandoned pending state.
        </article>
      ) : null}

      {status === "checkout_pending" && identityReviewEvent ? (
        <article className="rounded-2xl border border-amber-300/70 bg-amber-50 p-4 text-sm text-amber-950 shadow-[0_10px_24px_rgba(20,33,43,0.06)] dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-100">
          <p className="font-semibold tracking-tight">Activation is paused for billing identity review.</p>
          <p className="mt-2 text-sm text-amber-900/90 dark:text-amber-100/90">
            OpenPlan detected a purchaser-email mismatch during checkout, so this workspace stayed in <strong>Checkout Pending</strong>
            instead of auto-activating access.
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
          <p className="text-[0.72rem] uppercase tracking-[0.08em] text-muted-foreground">
            Updated: {workspace.billing_updated_at ? new Date(workspace.billing_updated_at).toLocaleString() : "N/A"}
          </p>
        </div>

        <p className="text-sm text-muted-foreground">
          Checkout initialization sets billing state to <strong className="text-foreground">Checkout Pending</strong> and records selected
          plan on the workspace.
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
                <p className="mt-1 text-xs text-muted-foreground break-all">
                  {event.payload ? JSON.stringify(event.payload) : "{}"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </article>
    </section>
  );
}
