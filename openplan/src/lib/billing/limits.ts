export type WorkspacePlan = "pilot" | "starter" | "professional" | "enterprise" | "unknown";

export type PlanEntitlements = {
  monthlyRunLimit: number | null;
  capabilities: {
    analysis: boolean;
    exportReports: boolean;
  };
};

const PLAN_ENTITLEMENTS: Record<WorkspacePlan, PlanEntitlements> = {
  pilot: {
    monthlyRunLimit: 150,
    capabilities: { analysis: true, exportReports: false },
  },
  starter: {
    monthlyRunLimit: 100,
    capabilities: { analysis: true, exportReports: true },
  },
  professional: {
    monthlyRunLimit: 500,
    capabilities: { analysis: true, exportReports: true },
  },
  enterprise: {
    monthlyRunLimit: null,
    capabilities: { analysis: true, exportReports: true },
  },
  unknown: {
    monthlyRunLimit: 100,
    capabilities: { analysis: true, exportReports: false },
  },
};

export function normalizeWorkspacePlan(value: string | null | undefined): WorkspacePlan {
  const normalized = (value ?? "").toLowerCase().trim();

  if (normalized === "pilot") return "pilot";
  if (normalized === "starter") return "starter";
  if (normalized === "professional" || normalized === "pro") return "professional";
  if (normalized === "enterprise") return "enterprise";
  return "unknown";
}

export function entitlementsForPlan(plan: WorkspacePlan): PlanEntitlements {
  return PLAN_ENTITLEMENTS[plan];
}

export function monthlyRunLimitForPlan(plan: WorkspacePlan): number | null {
  return entitlementsForPlan(plan).monthlyRunLimit;
}

export function runLimitMessage(plan: WorkspacePlan, usedRuns: number, limit: number): string {
  const planLabel = plan === "unknown" ? "current" : plan;
  return `Monthly analysis run limit reached for the ${planLabel} plan (${usedRuns}/${limit}).`;
}
