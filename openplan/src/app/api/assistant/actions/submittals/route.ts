import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { normalizeWorkspaceRole } from "@/lib/auth/role-matrix";
import { loadSubmittalRecoveryPage } from "@/lib/assistant/project-submittal-recovery";
import { HoldReceiptError } from "@/lib/assistant/stage-gate-hold-receipt";
import { createApiAuditLogger } from "@/lib/observability/audit";

const querySchema = z.object({ approvalId: z.string().uuid().optional(), workspaceId: z.string().uuid(), offset: z.coerce.number().int().min(0).default(0) });
export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("assistant.submittals.recovery", request);
  const query = querySchema.safeParse({ approvalId: request.nextUrl.searchParams.get("approvalId") ?? undefined, workspaceId: request.nextUrl.searchParams.get("workspaceId"), offset: request.nextUrl.searchParams.get("offset") ?? undefined });
  if (!query.success) return NextResponse.json({ error: "Invalid approved submittal query." }, { status: 400 });
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { data: membership, error } = await supabase.from("workspace_members").select("workspace_id, role")
      .eq("workspace_id", query.data.workspaceId).eq("user_id", user.id).maybeSingle();
    if (error) return NextResponse.json({ error: "Workspace access could not be checked." }, { status: 503 });
    if (!membership || !normalizeWorkspaceRole(membership.role)) return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    const result = await loadSubmittalRecoveryPage(createServiceRoleClient(), user.id, query.data.workspaceId, query.data.offset, query.data.approvalId);
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof HoldReceiptError) return NextResponse.json({ error: error.message }, { status: error.status });
    audit.error("submittal_recovery_read_failed", { workspaceId: query.data.workspaceId, error });
    return NextResponse.json({ error: "Approved submittal recovery could not be read." }, { status: 503 });
  }
}
