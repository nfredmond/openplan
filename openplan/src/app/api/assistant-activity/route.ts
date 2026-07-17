import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadCurrentWorkspaceMembership, unwrapWorkspaceRecord } from "@/lib/workspaces/current";
import {
  ASSISTANT_ACTIVITY_SELECT,
  buildAssistantActivitySummary,
  type AssistantActionExecutionRow,
} from "./summary";

const listAssistantActivitySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("assistant_activity.list", request);
  const startedAt = Date.now();

  try {
    const parsedFilters = listAssistantActivitySchema.safeParse({
      limit: request.nextUrl.searchParams.get("limit") ?? undefined,
    });

    if (!parsedFilters.success) {
      audit.warn("validation_failed", { issues: parsedFilters.error.issues });
      return NextResponse.json({ error: "Invalid filters" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { membership } = await loadCurrentWorkspaceMembership(supabase, user.id);

    if (!membership) {
      audit.info("assistant_activity_no_membership", {
        userId: user.id,
        durationMs: Date.now() - startedAt,
      });
      return NextResponse.json(
        {
          executions: [],
          summary: buildAssistantActivitySummary([]),
          workspace: null,
        },
        { status: 200 }
      );
    }

    const { data, error } = await supabase
      .from("assistant_action_executions")
      .select(ASSISTANT_ACTIVITY_SELECT)
      .eq("workspace_id", membership.workspace_id)
      .order("completed_at", { ascending: false })
      .limit(parsedFilters.data.limit);

    if (error) {
      audit.error("assistant_activity_list_failed", {
        userId: user.id,
        workspaceId: membership.workspace_id,
        message: error.message,
        code: error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load assistant activity" }, { status: 500 });
    }

    const executions = (data ?? []) as AssistantActionExecutionRow[];
    const summary = buildAssistantActivitySummary(executions);

    audit.info("assistant_activity_loaded", {
      userId: user.id,
      workspaceId: membership.workspace_id,
      count: executions.length,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      {
        executions,
        summary,
        workspace: {
          id: membership.workspace_id,
          name: unwrapWorkspaceRecord(membership.workspaces)?.name ?? null,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    audit.error("assistant_activity_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json({ error: "Unexpected error while loading assistant activity" }, { status: 500 });
  }
}
