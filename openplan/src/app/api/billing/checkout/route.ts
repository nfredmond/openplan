import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { buildOpenPlanFitReviewPath, resolveLegacyOpenPlanTierReference } from "@/lib/billing/openplan-fit";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { createClient } from "@/lib/supabase/server";

const billingCheckoutSchema = z
  .object({
    workspaceId: z.string().uuid().optional(),
    plan: z.string().trim().min(1).max(80).optional(),
    tier: z.string().trim().min(1).max(80).optional(),
    product: z.string().trim().min(1).max(80).optional(),
  })
  .refine((value) => value.plan || value.tier || value.product, {
    message: "A product, plan, or tier is required.",
  });

type CheckoutAuditLogger = ReturnType<typeof createApiAuditLogger>;

async function authorizeWorkspaceCheckout(
  workspaceId: string,
  request: NextRequest,
  tier: string | null,
  audit: CheckoutAuditLogger,
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    audit.warn("unauthorized_fit_review_redirect", { workspaceId, tier });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    audit.error("membership_lookup_failed", {
      workspaceId,
      userId: user.id,
      message: error.message,
    });
    return NextResponse.json({ error: "Failed to verify workspace access" }, { status: 500 });
  }

  if (!data || !canAccessWorkspaceAction("billing.checkout", data.role)) {
    audit.warn("forbidden_fit_review_redirect", { workspaceId, userId: user.id, tier });
    return NextResponse.json({ error: "Owner/admin access is required" }, { status: 403 });
  }

  return null;
}

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("billing.checkout", request);
  const body = await request.json().catch(() => null);
  const parsed = billingCheckoutSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid billing checkout payload" }, { status: 400 });
  }

  const requestedTier = parsed.data.tier ?? parsed.data.plan ?? null;
  const legacyOpenPlanTier = resolveLegacyOpenPlanTierReference(requestedTier);
  const product = parsed.data.product?.trim().toLowerCase() ?? (legacyOpenPlanTier ? "openplan" : null);

  if (product && product !== "openplan") {
    audit.warn("unsupported_checkout_product", {
      product,
      workspaceId: parsed.data.workspaceId ?? null,
    });
    return NextResponse.json({ error: "Unsupported checkout product" }, { status: 400 });
  }

  const intakeUrl = buildOpenPlanFitReviewPath({
    tier: legacyOpenPlanTier?.reference ?? requestedTier,
    workspaceId: parsed.data.workspaceId,
  });

  if (parsed.data.workspaceId) {
    const authorizationResponse = await authorizeWorkspaceCheckout(
      parsed.data.workspaceId,
      request,
      requestedTier,
      audit,
    );
    if (authorizationResponse) return authorizationResponse;
  }

  audit.info("openplan_checkout_disabled_redirect", {
    workspaceId: parsed.data.workspaceId ?? null,
    tier: legacyOpenPlanTier?.reference ?? requestedTier,
    product: "openplan",
    mode: "fit_review_redirect",
  });

  return NextResponse.json(
    {
      checkoutUrl: intakeUrl,
      intakeUrl,
      mode: "fit_review_redirect",
      product: "openplan",
      tier: legacyOpenPlanTier?.tier ?? requestedTier,
      checkoutDisabled: true,
      message: "OpenPlan direct checkout is disabled. Continue through fit-review intake.",
    },
    { status: 200 },
  );
}

export async function GET() {
  return NextResponse.json(
    {
      error: "Use POST to initialize billing checkout.",
    },
    {
      status: 405,
      headers: {
        Allow: "POST",
      },
    },
  );
}
