import { entitlementsForPlan, normalizeWorkspacePlan, type PlanEntitlements, type WorkspacePlan } from "@/lib/billing/limits";

export type WorkspaceBillingSnapshot = {
  plan?: string | null;
  subscription_plan?: string | null;
  subscription_status?: string | null;
};

const ACTIVE_STATUSES = new Set(["active", "trialing", "pilot"]);

export function normalizeSubscriptionStatus(status: string | null | undefined): string {
  return (status ?? "inactive").toLowerCase().trim();
}

export function isWorkspaceSubscriptionActive(snapshot: WorkspaceBillingSnapshot): boolean {
  const normalized = normalizeSubscriptionStatus(snapshot.subscription_status);
  return ACTIVE_STATUSES.has(normalized);
}

export function resolveWorkspacePlan(snapshot: WorkspaceBillingSnapshot): WorkspacePlan {
  return normalizeWorkspacePlan(snapshot.subscription_plan ?? snapshot.plan ?? null);
}

export function resolveWorkspaceEntitlements(snapshot: WorkspaceBillingSnapshot): {
  plan: WorkspacePlan;
  entitlements: PlanEntitlements;
} {
  const plan = resolveWorkspacePlan(snapshot);
  return {
    plan,
    entitlements: entitlementsForPlan(plan),
  };
}

export function subscriptionGateMessage(snapshot: WorkspaceBillingSnapshot): string {
  const status = normalizeSubscriptionStatus(snapshot.subscription_status);

  if (status === "checkout_pending") {
    return "Workspace checkout is still pending. Complete billing checkout to run new analyses.";
  }

  if (status === "canceled" || status === "past_due" || status === "inactive") {
    return "Workspace subscription is not active. Start or resume billing to run analyses.";
  }

  return "Workspace subscription is not active for analysis. Review billing status.";
}
