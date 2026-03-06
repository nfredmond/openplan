import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";

const querySchema = z.object({
  workspaceId: z.string().uuid(),
  runId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("stage_gates.decisions.get", request);
  const startedAt = Date.now();

  const parsed = querySchema.safeParse({
    workspaceId: request.nextUrl.searchParams.get("workspaceId"),
    runId: request.nextUrl.searchParams.get("runId") ?? undefined,
    limit: request.nextUrl.searchParams.get("limit") ?? undefined,
  });

  if (!parsed.success) {
    audit.warn("validation_failed", { issues: parsed.error.issues });
    return NextResponse.json({ error: "Invalid stage-gate decision query" }, { status: 400 });
  }

  const { workspaceId, runId, limit } = parsed.data;

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      audit.warn("unauthorized", {
        workspaceId,
        runId: runId ?? null,
        durationMs: Date.now() - startedAt,
      });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: membership, error: membershipError } = await supabase
      .from("workspace_members")
      .select("workspace_id, role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (membershipError) {
      audit.error("membership_lookup_failed", {
        workspaceId,
        runId: runId ?? null,
        userId: user.id,
        message: membershipError.message,
        code: membershipError.code ?? null,
      });

      return NextResponse.json({ error: "Failed to verify workspace access" }, { status: 500 });
    }

    if (!membership) {
      audit.warn("forbidden_workspace", {
        workspaceId,
        runId: runId ?? null,
        userId: user.id,
      });
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    if (!canAccessWorkspaceAction("stage_gates.decisions.read", membership.role)) {
      audit.warn("forbidden_role", {
        workspaceId,
        runId: runId ?? null,
        userId: user.id,
        role: membership.role ?? null,
      });
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    let decisionQuery = supabase
      .from("stage_gate_decisions")
      .select(
        "id, workspace_id, run_id, gate_id, decision, rationale, missing_artifacts, metadata, decided_by, decided_at"
      )
      .eq("workspace_id", workspaceId);

    if (runId) {
      decisionQuery = decisionQuery.eq("run_id", runId);
    }

    const { data, error } = await decisionQuery
      .order("decided_at", { ascending: false })
      .limit(limit);

    if (error) {
      audit.error("decision_query_failed", {
        workspaceId,
        runId: runId ?? null,
        userId: user.id,
        message: error.message,
        code: error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to fetch stage-gate decisions" }, { status: 500 });
    }

    audit.info("decisions_fetched", {
      workspaceId,
      runId: runId ?? null,
      userId: user.id,
      rowCount: data?.length ?? 0,
      limit,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ decisions: data ?? [] }, { status: 200 });
  } catch (error) {
    audit.error("decisions_unhandled_error", {
      workspaceId,
      runId: runId ?? null,
      durationMs: Date.now() - startedAt,
      error,
    });

    return NextResponse.json({ error: "Unexpected error while fetching decisions" }, { status: 500 });
  }
}
