import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";

const billingCheckoutSchema = z.object({
  workspaceId: z.string().uuid(),
  plan: z.enum(["starter", "professional"]),
});

type Plan = z.infer<typeof billingCheckoutSchema>["plan"];

function getCheckoutUrl(plan: Plan, origin: string): { url: string; mode: "payment_link" | "mock" } {
  const starter = process.env.OPENPLAN_STRIPE_CHECKOUT_URL_STARTER?.trim();
  const professional = process.env.OPENPLAN_STRIPE_CHECKOUT_URL_PROFESSIONAL?.trim();

  const configured = plan === "starter" ? starter : professional;
  if (configured) {
    return { url: configured, mode: "payment_link" };
  }

  return {
    url: `${origin}/dashboard/billing?checkout=mock&plan=${plan}`,
    mode: "mock",
  };
}

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

  const checkout = getCheckoutUrl(plan, request.nextUrl.origin);

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

  audit.info("checkout_initialized", {
    workspaceId,
    userId: user.id,
    plan,
    mode: checkout.mode,
    durationMs: Date.now() - startedAt,
  });

  return NextResponse.json(
    {
      checkoutUrl: checkout.url,
      mode: checkout.mode,
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
