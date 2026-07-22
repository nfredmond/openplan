import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";

const paramsSchema = z.object({ rtpCycleId: z.string().uuid() });
const bodySchema = z.object({ enabled: z.boolean() });

function generateShareToken(): string {
  return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "").slice(0, 40);
}

export async function POST(request: NextRequest, context: { params: Promise<{ rtpCycleId: string }> }) {
  const audit = createApiAuditLogger("rtp_cycles.public_share", request);
  const startedAt = Date.now();

  try {
    const routeParams = paramsSchema.safeParse(await context.params);
    if (!routeParams.success) {
      return NextResponse.json({ error: "Invalid cycle id" }, { status: 400 });
    }

    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.smallJson);
    if (!payloadBody.ok) return payloadBody.response;
    const payload = bodySchema.safeParse(payloadBody.data);
    if (!payload.success) {
      return NextResponse.json({ error: "Invalid public-share payload" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: cycle, error: cycleError } = await supabase
      .from("rtp_cycles")
      .select("id, workspace_id, public_share_token")
      .eq("id", routeParams.data.rtpCycleId)
      .single();
    if (cycleError || !cycle) {
      return NextResponse.json({ error: "RTP cycle not found" }, { status: 404 });
    }

    const { data: membership, error: membershipError } = await supabase
      .from("workspace_members")
      .select("workspace_id, role")
      .eq("user_id", user.id)
      .eq("workspace_id", cycle.workspace_id)
      .maybeSingle();
    if (membershipError) {
      audit.error("membership_lookup_failed", { error: membershipError.message });
      return NextResponse.json({ error: "Failed to resolve workspace membership" }, { status: 500 });
    }
    if (!membership || !canAccessWorkspaceAction("plans.write", membership.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const updates: Record<string, unknown> = { public_share_enabled: payload.data.enabled };
    let token = (cycle.public_share_token as string | null) ?? null;
    if (payload.data.enabled && !token) {
      token = generateShareToken();
      updates.public_share_token = token;
    }

    const { error: updateError } = await supabase.from("rtp_cycles").update(updates).eq("id", cycle.id);
    if (updateError) {
      audit.error("update_failed", { error: updateError.message, code: updateError.code ?? null });
      return NextResponse.json({ error: "Failed to update public sharing" }, { status: 500 });
    }

    audit.info("updated", { cycleId: cycle.id, enabled: payload.data.enabled, durationMs: Date.now() - startedAt });
    return NextResponse.json({
      enabled: payload.data.enabled,
      token,
      shareUrl: payload.data.enabled && token ? `/plan/${token}` : null,
    });
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Unexpected error while updating public sharing" }, { status: 500 });
  }
}
