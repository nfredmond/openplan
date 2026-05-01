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
  intakeUrl?: string;
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
    title: "Starter fit review",
    description: "For teams that need a managed baseline or support lane reviewed before any hosted billing is opened.",
  },
  {
    plan: "professional",
    title: "Professional fit review",
    description: "For workspaces already treating OpenPlan as an active delivery surface across multiple planning threads.",
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

function formatWorkspaceIdSnippet(workspaceId: string): string {
  return workspaceId.slice(0, 8);
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
      const redirectUrl = payload.intakeUrl ?? payload.checkoutUrl;
      if (!response.ok || !redirectUrl) {
        throw new Error(payload.details || payload.error || "Failed to open fit review");
      }

      onCheckoutRedirect(redirectUrl);
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : "Failed to open fit review");
      setPendingPlan(null);
    }
  }

  return (
    <article className="border border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.74),rgba(246,248,244,0.96))] px-5 py-5 shadow-[0_18px_40px_rgba(15,23,42,0.04)] dark:bg-[linear-gradient(180deg,rgba(15,23,32,0.86),rgba(11,18,26,0.96))]">
      <div className="flex flex-col gap-3 border-b border-border/60 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-10 w-10 items-center justify-center border border-[color:var(--pine)]/20 bg-[color:var(--pine)]/10 text-[color:var(--pine)] dark:text-[color:var(--pine-deep)]">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Fit-review safeguards</p>
            <h2 className="text-lg font-semibold tracking-tight text-foreground">Request OpenPlan billing review against the correct workspace</h2>
          </div>
        </div>
        <p className="max-w-sm text-sm text-muted-foreground">
          Direct OpenPlan tier checkout is disabled. These actions preserve the workspace and legacy tier context, then route to fit-review intake.
        </p>
      </div>

      <div className="mt-5 grid gap-px border border-border/60 bg-border/80 md:grid-cols-2 xl:grid-cols-4">
        <div className="bg-background/70 px-4 py-4">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Workspace target</p>
          <p className="mt-2 text-sm font-semibold text-foreground">{workspaceName}</p>
          <p className="mt-1 break-all text-xs text-muted-foreground">{workspaceId}</p>
        </div>
        <div className="bg-background/70 px-4 py-4">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Current plan</p>
          <p className="mt-2 text-sm font-semibold text-foreground">{titleCase(currentPlan)}</p>
          <p className="mt-1 text-xs text-muted-foreground">Status: {titleCase(currentStatus)}</p>
        </div>
        <div className="bg-background/70 px-4 py-4">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Access window</p>
          <p className="mt-2 text-sm font-semibold text-foreground">{formatPeriodEnd(currentPeriodEnd)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {normalizedStatus === "checkout_pending"
              ? "Webhook confirmation still governs final activation."
              : "Shown when Stripe has already reported the current billing period."}
          </p>
        </div>
        <div className="bg-background/70 px-4 py-4">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Authority</p>
          <p className="mt-2 text-sm font-semibold text-foreground">{canStartCheckout ? "Owner/Admin can request review" : "Read-only for member role"}</p>
          <p className="mt-1 text-xs text-muted-foreground">The POST action now returns a fit-review intake URL instead of opening Stripe.</p>
        </div>
      </div>

      <div className="mt-5 border-l-2 border-[color:var(--copper)] bg-[color:var(--copper)]/10 px-4 py-3 text-sm text-foreground">
        <p className="font-semibold tracking-tight">Fit-review context is locked before intake opens</p>
        <p className="mt-1.5">
          Any review started below will include <strong>{workspaceName}</strong> ({formatWorkspaceIdSnippet(workspaceId)}). If this is not the workspace you intend to discuss, switch workspaces before continuing.
        </p>
      </div>

      {!canStartCheckout ? (
        <div className="mt-5 border border-border/60 bg-background/70 px-4 py-4 text-sm text-muted-foreground">
          Members can review billing posture, but owner/admin role is required before OpenPlan will start a workspace-scoped billing fit review.
        </div>
      ) : (
        <div className="mt-5 space-y-3">
          {PLAN_CARDS.map((planCard) => {
            const isCurrentPlan = normalizedPlan === planCard.plan;
            const isPending = pendingPlan === planCard.plan;

            return (
              <div key={planCard.plan} className="grid gap-4 border border-border/60 bg-background/70 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <h3 className="text-base font-semibold tracking-tight text-foreground">{planCard.title}</h3>
                    {isCurrentPlan ? <span className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-[color:var(--pine)]">Current plan</span> : null}
                  </div>
                  <p className="text-sm text-muted-foreground">{planCard.description}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>{runLimitLabel(planCard.plan)}</span>
                    <span>{entitlementsForPlan(planCard.plan).capabilities.exportReports ? "Includes report exports" : "Report exports remain limited"}</span>
                    <span>{normalizedStatus === "checkout_pending" ? "Review can resolve an old pending attempt" : "Workspace context remains explicit"}</span>
                  </div>
                </div>

                <div className="flex items-center lg:justify-end">
                  <Button
                    type="button"
                    variant={isCurrentPlan ? "secondary" : "default"}
                    disabled={pendingPlan !== null}
                    onClick={() => handleCheckout(planCard.plan)}
                    aria-label={`Request ${planCard.title} for ${workspaceName}`}
                    className="min-w-52"
                  >
                    {isPending ? (
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Opening intake…
                      </span>
                    ) : (
                      `Request ${planCard.title}`
                    )}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {error ? (
        <p className="mt-5 border-l-2 border-red-400 bg-red-50/80 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/20 dark:text-red-200" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
}
