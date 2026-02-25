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
    const { error } = await supabase.from("runs").delete().eq("id", parsed.data);

    if (error) {
      audit.error("delete_failed", {
        runId: parsed.data,
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
