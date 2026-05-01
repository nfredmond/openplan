export type LegacyOpenPlanTier = "starter" | "professional" | "agency";

export type LegacyOpenPlanTierReference = {
  productId: "openplan";
  tier: LegacyOpenPlanTier;
  reference: string;
  prelaunch: boolean;
};

export const LEGACY_OPENPLAN_TIER_REFERENCES: Record<string, LegacyOpenPlanTierReference> = {
  starter: { productId: "openplan", tier: "starter", reference: "starter", prelaunch: false },
  professional: {
    productId: "openplan",
    tier: "professional",
    reference: "professional",
    prelaunch: false,
  },
  agency: { productId: "openplan", tier: "agency", reference: "agency", prelaunch: false },
  "openplan-starter": {
    productId: "openplan",
    tier: "starter",
    reference: "openplan-starter",
    prelaunch: false,
  },
  "openplan-professional": {
    productId: "openplan",
    tier: "professional",
    reference: "openplan-professional",
    prelaunch: false,
  },
  "openplan-agency": {
    productId: "openplan",
    tier: "agency",
    reference: "openplan-agency",
    prelaunch: false,
  },
  "starter-prelaunch": {
    productId: "openplan",
    tier: "starter",
    reference: "starter-prelaunch",
    prelaunch: true,
  },
  "professional-prelaunch": {
    productId: "openplan",
    tier: "professional",
    reference: "professional-prelaunch",
    prelaunch: true,
  },
  "agency-prelaunch": {
    productId: "openplan",
    tier: "agency",
    reference: "agency-prelaunch",
    prelaunch: true,
  },
  "openplan-starter-prelaunch": {
    productId: "openplan",
    tier: "starter",
    reference: "openplan-starter-prelaunch",
    prelaunch: true,
  },
  "openplan-professional-prelaunch": {
    productId: "openplan",
    tier: "professional",
    reference: "openplan-professional-prelaunch",
    prelaunch: true,
  },
  "openplan-agency-prelaunch": {
    productId: "openplan",
    tier: "agency",
    reference: "openplan-agency-prelaunch",
    prelaunch: true,
  },
};

const QUERY_TOKEN_PATTERN = /[^a-z0-9_-]/gi;

export function normalizeOpenPlanTierReference(value: string | null | undefined): string | null {
  const normalized = value
    ?.trim()
    .toLowerCase()
    .replace(QUERY_TOKEN_PATTERN, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return normalized || null;
}

export function resolveLegacyOpenPlanTierReference(
  value: string | null | undefined,
): LegacyOpenPlanTierReference | null {
  const normalized = normalizeOpenPlanTierReference(value);
  return normalized ? LEGACY_OPENPLAN_TIER_REFERENCES[normalized] ?? null : null;
}

export function legacyTierToBillingPlan(tier: LegacyOpenPlanTier | null | undefined) {
  if (tier === "starter" || tier === "professional") {
    return tier;
  }

  if (tier === "agency") {
    return "enterprise";
  }

  return undefined;
}

export function buildOpenPlanFitReviewPath({
  tier,
  workspaceId,
  source = "billing-checkout",
}: {
  tier?: string | null;
  workspaceId?: string | null;
  source?: string;
} = {}) {
  const params = new URLSearchParams({
    product: "openplan",
    checkout: "disabled",
    checkoutDisabled: "1",
    legacyCheckout: "1",
    source,
  });

  const normalizedTier = normalizeOpenPlanTierReference(tier);
  if (normalizedTier) params.set("tier", normalizedTier);
  if (workspaceId?.trim()) params.set("workspaceId", workspaceId.trim());

  return `/contact/openplan-fit?${params.toString()}`;
}
