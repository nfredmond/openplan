import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadProjectAccess } from "@/lib/programs/api";
import { loadAwardClosureHistory } from "@/lib/grants/award-closure-history-server";
import { AWARD_CLOSURE_HISTORY_LIMIT } from "@/lib/grants/award-closure-history";

const awardScopeSchema = z.object({ id: z.string().uuid(), workspace_id: z.string().uuid(), project_id: z.string().uuid() });

export async function GET(request: NextRequest, context: { params: Promise<{ awardId: string }> }) {
  const audit = createApiAuditLogger("funding-awards.closure-history", request);
  const { awardId } = await context.params;
  const unavailable = (event: string) => {
    audit.error(event);
    return NextResponse.json({
      error: `Award transition history unavailable. This read requires every retained receipt, up to ${AWARD_CLOSURE_HISTORY_LIMIT}; no partial history is shown.`,
    }, { status: 503 });
  };
  if (!z.string().uuid().safeParse(awardId).success) {
    audit.warn("validation_failed");
    return NextResponse.json({ error: "Invalid award" }, { status: 400 });
  }
  try {
    const client = await createClient();
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user) {
      audit.warn("authentication_required");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const award = await client.from("funding_awards").select("id, workspace_id, project_id").eq("id", awardId).maybeSingle();
    if (award.error) {
      if (award.error.code === "42501") {
        audit.warn("award_access_denied");
        return NextResponse.json({ error: "Award access denied" }, { status: 403 });
      }
      return unavailable("award_read_failed");
    }
    if (!award.data) {
      audit.warn("award_not_found");
      return NextResponse.json({ error: "Award not found" }, { status: 404 });
    }
    const parsed = awardScopeSchema.safeParse(award.data);
    if (!parsed.success || parsed.data.id !== awardId) return unavailable("award_scope_invalid");
    const scope = parsed.data;
    const permission = await loadProjectAccess(client, scope.project_id, user.id, "programs.read");
    if (permission.error) {
      audit.error("award_access_read_failed");
      return NextResponse.json({ error: "Award access unavailable" }, { status: 503 });
    }
    if (!permission.allowed || !permission.membership || permission.membership.workspace_id !== scope.workspace_id || permission.project?.workspace_id !== scope.workspace_id) {
      audit.warn("award_access_denied");
      return NextResponse.json({ error: "Award access denied" }, { status: 403 });
    }
    const result = await loadAwardClosureHistory(client, { awardId, workspaceId: scope.workspace_id });
    if (result.error?.code === "42501") {
      audit.warn("history_access_denied");
      return NextResponse.json({ error: "Award transition history access denied" }, { status: 403 });
    }
    if (!result.history) return unavailable("history_read_unavailable");
    audit.info("history_read_succeeded", { receiptCount: result.history.receipts.length });
    return NextResponse.json(result.history, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return unavailable("history_read_exception");
  }
}
