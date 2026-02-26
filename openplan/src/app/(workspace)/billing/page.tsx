import Link from "next/link";
import { redirect } from "next/navigation";
import { StatusBadge } from "@/components/ui/status-badge";
import { normalizeSubscriptionStatus } from "@/lib/billing/subscription";
import { createClient } from "@/lib/supabase/server";

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

export default async function BillingPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedParams = (await searchParams) ?? {};
  const checkoutState = typeof resolvedParams.checkout === "string" ? resolvedParams.checkout : null;
  const checkoutPlan = typeof resolvedParams.plan === "string" ? resolvedParams.plan : null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { data: memberships } = await supabase
    .from("workspace_members")
    .select("workspace_id, role, workspaces(name, plan, subscription_plan, subscription_status, billing_updated_at)")
    .eq("user_id", user.id)
    .limit(1);

  const membership = memberships?.[0] as
    | {
        workspace_id: string;
        role: string;
        workspaces:
          | {
              name: string | null;
              plan: string | null;
              subscription_plan: string | null;
              subscription_status: string | null;
              billing_updated_at: string | null;
            }
          | Array<{
              name: string | null;
              plan: string | null;
              subscription_plan: string | null;
              subscription_status: string | null;
              billing_updated_at: string | null;
            }>
          | null;
      }
    | undefined;

  const workspace = Array.isArray(membership?.workspaces)
    ? membership?.workspaces[0] ?? null
    : membership?.workspaces ?? null;

  if (!membership || !workspace) {
    redirect("/explore");
  }

  const workspaceId = membership.workspace_id;
  const status = normalizeSubscriptionStatus(workspace.subscription_status ?? null);
  const plan = workspace.subscription_plan ?? workspace.plan ?? "starter";

  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Billing</p>
        <h1 className="text-3xl font-semibold tracking-tight">{workspace.name ?? "Workspace"} Billing</h1>
        <p className="text-sm text-muted-foreground sm:text-base">
          Manage subscription state for this workspace. Owner/admin role is required to initialize checkout.
        </p>
      </header>

      {checkoutState === "mock" ? (
        <article className="rounded-2xl border border-border/80 bg-card p-4 text-sm text-muted-foreground shadow-[0_10px_24px_rgba(20,33,43,0.06)]">
          Mock checkout completed for plan <span className="font-semibold text-foreground">{titleCase(checkoutPlan)}</span>. Configure
          `OPENPLAN_STRIPE_CHECKOUT_URL_STARTER/PROFESSIONAL` to route to live Stripe links.
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
    </section>
  );
}
