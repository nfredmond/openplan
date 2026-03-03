import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";

const workspaceIdSchema = z.string().uuid();
const runIdSchema = z.string().uuid();

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("runs.get", request);
  const startedAt = Date.now();

  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId");
    const parsed = workspaceIdSchema.safeParse(workspaceId);

    if (!parsed.success) {
      audit.warn("validation_failed", { workspaceId });
      return NextResponse.json({ error: "Invalid workspaceId" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      audit.warn("unauthorized", {
        workspaceId: parsed.data,
        durationMs: Date.now() - startedAt,
      });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: membership, error: membershipError } = await supabase
      .from("workspace_members")
      .select("workspace_id")
      .eq("workspace_id", parsed.data)
      .eq("user_id", user.id)
      .maybeSingle();

    if (membershipError) {
      audit.error("membership_lookup_failed", {
        workspaceId: parsed.data,
        userId: user.id,
        message: membershipError.message,
        code: membershipError.code ?? null,
      });

      return NextResponse.json(
        {
          error: "Failed to verify workspace access",
          details: membershipError.message,
        },
        { status: 500 }
      );
    }

    if (!membership) {
      audit.warn("forbidden_workspace", {
        workspaceId: parsed.data,
        userId: user.id,
      });
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    const { data, error } = await supabase
      .from("runs")
      .select(
        "id, workspace_id, title, query_text, corridor_geojson, metrics, result_geojson, summary_text, ai_interpretation, created_at"
      )
      .eq("workspace_id", parsed.data)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      audit.error("fetch_failed", {
        workspaceId: parsed.data,
        userId: user.id,
        message: error.message,
        code: error.code ?? null,
      });

      return NextResponse.json(
        {
          error: "Failed to fetch runs",
          details: error.message,
        },
        { status: 500 }
      );
    }

    audit.info("runs_fetched", {
      workspaceId: parsed.data,
      userId: user.id,
      runCount: data?.length ?? 0,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ runs: data ?? [] }, { status: 200 });
  } catch (error) {
    audit.error("runs_get_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });

    return NextResponse.json(
      { error: "Unexpected error while fetching runs" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const audit = createApiAuditLogger("runs.delete", request);
  const startedAt = Date.now();

  try {
    const runId = request.nextUrl.searchParams.get("id");
    const parsed = runIdSchema.safeParse(runId);

    if (!parsed.success) {
      audit.warn("validation_failed", { runId });
      return NextResponse.json({ error: "Invalid run id" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      audit.warn("unauthorized", {
        runId: parsed.data,
        durationMs: Date.now() - startedAt,
      });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: run, error: runLookupError } = await supabase
      .from("runs")
      .select("id, workspace_id")
      .eq("id", parsed.data)
      .maybeSingle();

    if (runLookupError) {
      audit.error("run_lookup_failed", {
        runId: parsed.data,
        userId: user.id,
        message: runLookupError.message,
        code: runLookupError.code ?? null,
      });

      return NextResponse.json(
        {
          error: "Failed to verify run access",
          details: runLookupError.message,
        },
        { status: 500 }
      );
    }

    if (!run) {
      audit.warn("run_not_found", {
        runId: parsed.data,
        userId: user.id,
      });
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    const { data: membership, error: membershipError } = await supabase
      .from("workspace_members")
      .select("workspace_id")
      .eq("workspace_id", run.workspace_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (membershipError) {
      audit.error("membership_lookup_failed", {
        runId: parsed.data,
        workspaceId: run.workspace_id,
        userId: user.id,
        message: membershipError.message,
        code: membershipError.code ?? null,
      });

      return NextResponse.json(
        {
          error: "Failed to verify workspace access",
          details: membershipError.message,
        },
        { status: 500 }
      );
    }

    if (!membership) {
      audit.warn("forbidden_workspace", {
        runId: parsed.data,
        workspaceId: run.workspace_id,
        userId: user.id,
      });
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    const { error } = await supabase.from("runs").delete().eq("id", parsed.data);

    if (error) {
      audit.error("delete_failed", {
        runId: parsed.data,
        workspaceId: run.workspace_id,
        userId: user.id,
        message: error.message,
        code: error.code ?? null,
      });

      return NextResponse.json(
        {
          error: "Failed to delete run",
          details: error.message,
        },
        { status: 500 }
      );
    }

    audit.info("run_deleted", {
      runId: parsed.data,
      workspaceId: run.workspace_id,
      userId: user.id,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    audit.error("runs_delete_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });

    return NextResponse.json(
      { error: "Unexpected error while deleting run" },
      { status: 500 }
    );
  }
}
