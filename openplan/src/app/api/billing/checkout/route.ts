import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createStripeCheckoutSession } from "@/lib/billing/checkout";
import { logBillingEvent } from "@/lib/billing/events";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";

const billingCheckoutSchema = z.object({
  workspaceId: z.string().uuid(),
  plan: z.enum(["starter", "professional"]),
});

type Plan = z.infer<typeof billingCheckoutSchema>["plan"];

async function authorizeWorkspaceOwner(workspaceId: string, userId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data || !["owner", "admin"].includes((data.role ?? "").toLowerCase())) {
    return null;
  }

  return data;
}

async function getWorkspaceBillingContext(workspaceId: string): Promise<{ stripeCustomerId?: string | null }> {
  const serviceSupabase = createServiceRoleClient();
  const { data, error } = await serviceSupabase
    .from("workspaces")
    .select("stripe_customer_id")
    .eq("id", workspaceId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return {
    stripeCustomerId: data?.stripe_customer_id ?? null,
  };
}

async function markCheckoutPending(workspaceId: string, plan: Plan) {
  const serviceSupabase = createServiceRoleClient();
  const { error } = await serviceSupabase
    .from("workspaces")
    .update({
      plan,
      subscription_plan: plan,
      subscription_status: "checkout_pending",
      billing_updated_at: new Date().toISOString(),
    })
    .eq("id", workspaceId);

  if (error) {
    throw new Error(error.message);
  }
}

async function handleCheckout(workspaceId: string, plan: Plan, request: NextRequest) {
  const audit = createApiAuditLogger("billing.checkout", request);
  const startedAt = Date.now();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    audit.warn("unauthorized", { workspaceId, plan });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let authorized;
  try {
    authorized = await authorizeWorkspaceOwner(workspaceId, user.id);
  } catch (error) {
    audit.error("membership_lookup_failed", {
      workspaceId,
      userId: user.id,
      message: error instanceof Error ? error.message : "unknown",
    });

    return NextResponse.json({ error: "Failed to verify workspace access" }, { status: 500 });
  }

  if (!authorized) {
    audit.warn("forbidden", { workspaceId, userId: user.id, plan });
    return NextResponse.json({ error: "Owner/admin access is required" }, { status: 403 });
  }

  let billingContext: { stripeCustomerId?: string | null };
  try {
    billingContext = await getWorkspaceBillingContext(workspaceId);
  } catch (error) {
    audit.error("workspace_billing_context_failed", {
      workspaceId,
      userId: user.id,
      plan,
      message: error instanceof Error ? error.message : "unknown",
    });

    return NextResponse.json({ error: "Failed to initialize checkout" }, { status: 500 });
  }

  let checkoutSession: { id: string; url: string };
  try {
    checkoutSession = await createStripeCheckoutSession({
      workspaceId,
      plan,
      initiatedByUserId: user.id,
      initiatedByUserEmail: user.email,
      existingStripeCustomerId: billingContext.stripeCustomerId,
      origin: request.nextUrl.origin,
    });
  } catch (error) {
    audit.error("stripe_checkout_session_failed", {
      workspaceId,
      userId: user.id,
      plan,
      message: error instanceof Error ? error.message : "unknown",
    });

    return NextResponse.json({ error: "Failed to initialize checkout" }, { status: 500 });
  }

  try {
    await markCheckoutPending(workspaceId, plan);
  } catch (error) {
    audit.error("workspace_billing_update_failed", {
      workspaceId,
      userId: user.id,
      plan,
      message: error instanceof Error ? error.message : "unknown",
    });

    return NextResponse.json({ error: "Failed to initialize checkout" }, { status: 500 });
  }

  try {
    await logBillingEvent({
      workspaceId,
      eventType: "checkout_initialized",
      source: "stripe_checkout_session",
      payload: {
        plan,
        mode: "stripe_checkout_session",
        userId: user.id,
        sessionId: checkoutSession.id,
      },
    });
  } catch (eventError) {
    audit.warn("billing_event_log_failed", {
      workspaceId,
      plan,
      mode: "stripe_checkout_session",
      message: eventError instanceof Error ? eventError.message : "unknown",
    });
  }

  audit.info("checkout_initialized", {
    workspaceId,
    userId: user.id,
    plan,
    mode: "stripe_checkout_session",
    sessionId: checkoutSession.id,
    durationMs: Date.now() - startedAt,
  });

  return NextResponse.json(
    {
      checkoutUrl: checkoutSession.url,
      mode: "stripe_checkout_session",
      workspaceId,
      plan,
    },
    { status: 200 }
  );
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = billingCheckoutSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid billing checkout payload" }, { status: 400 });
  }

  return handleCheckout(parsed.data.workspaceId, parsed.data.plan, request);
}

export async function GET(request: NextRequest) {
  const parsed = billingCheckoutSchema.safeParse({
    workspaceId: request.nextUrl.searchParams.get("workspaceId"),
    plan: request.nextUrl.searchParams.get("plan"),
  });

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid checkout query params" }, { status: 400 });
  }

  const response = await handleCheckout(parsed.data.workspaceId, parsed.data.plan, request);
  if (response.status !== 200) {
    return response;
  }

  const payload = (await response.json()) as { checkoutUrl: string };
  return NextResponse.redirect(payload.checkoutUrl, { status: 302 });
}
