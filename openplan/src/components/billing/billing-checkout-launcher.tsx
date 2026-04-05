"use client";

import { useMemo, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { entitlementsForPlan, type WorkspacePlan } from "@/lib/billing/limits";
import { normalizeSubscriptionStatus } from "@/lib/billing/subscription";

type CheckoutPlan = Extract<WorkspacePlan, "starter" | "professional">;

type BillingCheckoutLauncherProps = {
  workspaceId: string;
  workspaceName: string;
  currentPlan: string;
  currentStatus: string;
  currentPeriodEnd?: string | null;
  canStartCheckout: boolean;
  onCheckoutRedirect?: (url: string) => void;
};

type CheckoutLaunchResponse = {
  checkoutUrl?: string;
  error?: string;
  details?: string;
};

type PlanCard = {
  plan: CheckoutPlan;
  title: string;
  description: string;
};

const PLAN_CARDS: PlanCard[] = [
  {
    plan: "starter",
    title: "Starter",
    description: "Good fit for supervised pilot teams that need a supportable paid baseline without overcommitting the workspace.",
  },
  {
    plan: "professional",
    title: "Professional",
    description: "Higher run capacity for workspaces already using OpenPlan as an active delivery surface across multiple project threads.",
  },
];

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

function formatPeriodEnd(value: string | null | undefined): string {
  if (!value) {
    return "No renewal window recorded yet";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "No renewal window recorded yet";
  }

  return parsed.toLocaleString();
}

export function redirectToCheckout(url: string) {
  window.location.assign(url);
}

function runLimitLabel(plan: CheckoutPlan): string {
  const entitlements = entitlementsForPlan(plan);
  return entitlements.monthlyRunLimit === null
    ? "Unlimited monthly analysis runs"
    : `${entitlements.monthlyRunLimit.toLocaleString("en-US")} monthly analysis runs`;
}

export function BillingCheckoutLauncher({
  workspaceId,
  workspaceName,
  currentPlan,
  currentStatus,
  currentPeriodEnd,
  canStartCheckout,
  onCheckoutRedirect = redirectToCheckout,
}: BillingCheckoutLauncherProps) {
  const [error, setError] = useState<string | null>(null);
  const [pendingPlan, setPendingPlan] = useState<CheckoutPlan | null>(null);

  const normalizedStatus = useMemo(() => normalizeSubscriptionStatus(currentStatus), [currentStatus]);
  const normalizedPlan = useMemo(() => currentPlan.trim().toLowerCase(), [currentPlan]);

  async function handleCheckout(plan: CheckoutPlan) {
    setError(null);
    setPendingPlan(plan);

    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ workspaceId, plan }),
      });

      const payload = (await response.json().catch(() => ({}))) as CheckoutLaunchResponse;
      if (!response.ok || !payload.checkoutUrl) {
        throw new Error(payload.details || payload.error || "Failed to initialize checkout");
      }

      onCheckoutRedirect(payload.checkoutUrl);
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : "Failed to initialize checkout");
      setPendingPlan(null);
    }
  }

  return (
    <article className="rounded-2xl border border-border/80 bg-card p-5 shadow-[0_10px_24px_rgba(20,33,43,0.06)] space-y-4">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-500/10 text-sky-700 dark:text-sky-300">
          <ShieldCheck className="h-5 w-5" />
        </span>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Checkout safeguards</p>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">Launch paid billing against the correct workspace</h2>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Workspace target</p>
          <p className="mt-2 text-sm font-semibold text-foreground">{workspaceName}</p>
          <p className="mt-1 text-xs text-muted-foreground break-all">{workspaceId}</p>
        </div>
        <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Current plan</p>
          <p className="mt-2 text-sm font-semibold text-foreground">{titleCase(currentPlan)}</p>
          <p className="mt-1 text-xs text-muted-foreground">Status: {titleCase(currentStatus)}</p>
        </div>
        <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Access window</p>
          <p className="mt-2 text-sm font-semibold text-foreground">{formatPeriodEnd(currentPeriodEnd)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {normalizedStatus === "checkout_pending"
              ? "Webhook confirmation still governs final activation."
              : "Shown when Stripe has already reported the current billing period."}
          </p>
        </div>
        <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Authority</p>
          <p className="mt-2 text-sm font-semibold text-foreground">{canStartCheckout ? "Owner/Admin can start checkout" : "Read-only for member role"}</p>
          <p className="mt-1 text-xs text-muted-foreground">OpenPlan now starts checkout only from an explicit POST action instead of a prefetchable link.</p>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        OpenPlan sends you to Stripe only after an explicit button press for this exact workspace. Returning from Stripe is not treated as activation by itself; the workspace remains trustworthy only after webhook status and billing events confirm the result.
      </p>

      {!canStartCheckout ? (
        <div className="rounded-2xl border border-border/70 bg-background/80 p-4 text-sm text-muted-foreground">
          Members can review billing posture, but owner/admin role is required before OpenPlan will launch Stripe checkout for this workspace.
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {PLAN_CARDS.map((planCard) => {
            const isCurrentPlan = normalizedPlan === planCard.plan;
            const isPending = pendingPlan === planCard.plan;

            return (
              <div key={planCard.plan} className="rounded-2xl border border-border/70 bg-background/80 p-4 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-semibold tracking-tight text-foreground">{planCard.title}</h3>
                  {isCurrentPlan ? (
                    <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-primary">
                      Current plan
                    </span>
                  ) : null}
                </div>
                <p className="text-sm text-muted-foreground">{planCard.description}</p>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  <li>{runLimitLabel(planCard.plan)}</li>
                  <li>{entitlementsForPlan(planCard.plan).capabilities.exportReports ? "Includes report exports" : "Report exports stay limited on this tier"}</li>
                  <li>{normalizedStatus === "checkout_pending" ? "A new checkout can replace an abandoned pending attempt." : "Workspace targeting remains explicit throughout checkout."}</li>
                </ul>
                <Button type="button" variant={isCurrentPlan ? "secondary" : "default"} disabled={pendingPlan !== null} onClick={() => handleCheckout(planCard.plan)}>
                  {isPending ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Opening Stripe…
                    </span>
                  ) : (
                    `Start ${planCard.title} checkout`
                  )}
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {error ? (
        <p className="rounded-2xl border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
}
