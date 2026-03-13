import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";

const workspaceIdSchema = z.string().uuid();
const runIdSchema = z.string().uuid();
const runLimitSchema = z.coerce.number().int().min(1).max(200);
const mapViewStateSchema = z.object({
  tractMetric: z.enum(["minority", "poverty", "income", "disadvantaged"]).optional(),
  showTracts: z.boolean().optional(),
  showCrashes: z.boolean().optional(),
  crashSeverityFilter: z.enum(["all", "fatal", "severe_injury", "injury"]).optional(),
  crashUserFilter: z.enum(["all", "pedestrian", "bicycle", "vru"]).optional(),
  activeDatasetOverlayId: z.string().uuid().nullable().optional(),
});
const runUpdateSchema = z.object({
  id: z.string().uuid(),
  mapViewState: mapViewStateSchema,
});

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

    const requestedLimit = request.nextUrl.searchParams.get("limit");
    let limit = 50;

    if (requestedLimit !== null) {
      const parsedLimit = runLimitSchema.safeParse(requestedLimit);

      if (!parsedLimit.success) {
        audit.warn("validation_failed", {
          workspaceId: parsed.data,
          requestedLimit,
          issues: parsedLimit.error.issues,
        });
        return NextResponse.json({ error: "Invalid limit" }, { status: 400 });
      }

      limit = parsedLimit.data;
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
      .select("workspace_id, role")
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

    if (!canAccessWorkspaceAction("runs.list", membership.role)) {
      audit.warn("forbidden_role", {
        workspaceId: parsed.data,
        userId: user.id,
        role: membership.role ?? null,
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
      .limit(limit);

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
      limit,
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

export async function PATCH(request: NextRequest) {
  const audit = createApiAuditLogger("runs.patch", request);
  const startedAt = Date.now();

  try {
    const body = await request.json().catch(() => null);
    const parsed = runUpdateSchema.safeParse(body);

    if (!parsed.success) {
      audit.warn("validation_failed", {
        issues: parsed.error.issues,
      });
      return NextResponse.json({ error: "Invalid run update payload" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      audit.warn("unauthorized", {
        runId: parsed.data.id,
        durationMs: Date.now() - startedAt,
      });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: run, error: runLookupError } = await supabase
      .from("runs")
      .select("id, workspace_id, metrics")
      .eq("id", parsed.data.id)
      .maybeSingle();

    if (runLookupError) {
      audit.error("run_lookup_failed", {
        runId: parsed.data.id,
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
        runId: parsed.data.id,
        userId: user.id,
      });
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    const { data: membership, error: membershipError } = await supabase
      .from("workspace_members")
      .select("workspace_id, role")
      .eq("workspace_id", run.workspace_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (membershipError) {
      audit.error("membership_lookup_failed", {
        runId: parsed.data.id,
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
        runId: parsed.data.id,
        workspaceId: run.workspace_id,
        userId: user.id,
      });
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    if (!canAccessWorkspaceAction("runs.update", membership.role)) {
      audit.warn("forbidden_role", {
        runId: parsed.data.id,
        workspaceId: run.workspace_id,
        userId: user.id,
        role: membership.role ?? null,
      });
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    const existingMetrics =
      run.metrics && typeof run.metrics === "object" && !Array.isArray(run.metrics)
        ? (run.metrics as Record<string, unknown>)
        : {};

    const nextMetrics = {
      ...existingMetrics,
      mapViewState: parsed.data.mapViewState,
    };

    const { error: updateError } = await supabase
      .from("runs")
      .update({ metrics: nextMetrics })
      .eq("id", parsed.data.id);

    if (updateError) {
      audit.error("update_failed", {
        runId: parsed.data.id,
        workspaceId: run.workspace_id,
        userId: user.id,
        message: updateError.message,
        code: updateError.code ?? null,
      });

      return NextResponse.json(
        {
          error: "Failed to update run",
          details: updateError.message,
        },
        { status: 500 }
      );
    }

    audit.info("run_updated", {
      runId: parsed.data.id,
      workspaceId: run.workspace_id,
      userId: user.id,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    audit.error("runs_patch_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });

    return NextResponse.json(
      { error: "Unexpected error while updating run" },
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

    const confirmed = request.nextUrl.searchParams.get("confirm") === "true";
    if (!confirmed) {
      audit.warn("delete_confirmation_required", {
        runId: parsed.data,
      });

      return NextResponse.json(
        { error: "Run deletion requires explicit confirmation" },
        { status: 400 }
      );
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
      .select("workspace_id, role")
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

    if (!canAccessWorkspaceAction("runs.delete", membership.role)) {
      audit.warn("forbidden_role", {
        runId: parsed.data,
        workspaceId: run.workspace_id,
        userId: user.id,
        role: membership.role ?? null,
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
