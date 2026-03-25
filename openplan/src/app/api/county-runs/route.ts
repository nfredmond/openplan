import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import {
  createCountyRunRequestSchema,
  createCountyRunResponseSchema,
  countyRunListResponseSchema,
} from "@/lib/api/county-onramp";
import { buildCountyOnrampWorkerPayload } from "@/lib/api/county-onramp-worker";
import { presentCountyRunListItem } from "@/lib/api/county-onramp-presenters";

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("county-runs.list", request);
  const startedAt = Date.now();

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      audit.warn("unauthorized", { durationMs: Date.now() - startedAt });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");
    const stage = searchParams.get("stage");
    const geographyId = searchParams.get("geographyId");
    const limitParam = searchParams.get("limit");
    const limit = Math.min(Math.max(Number(limitParam || 20), 1), 100);

    if (!workspaceId) {
      audit.warn("missing_workspace_id", {});
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    let query = supabase
      .from("county_runs")
      .select("id, geography_label, geography_id, run_name, stage, status_label, updated_at")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (stage) {
      query = query.eq("stage", stage);
    }

    if (geographyId) {
      query = query.eq("geography_id", geographyId);
    }

    const { data, error } = await query;

    if (error) {
      audit.error("county_runs_list_failed", {
        message: error.message,
        code: error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load county runs" }, { status: 500 });
    }

    const response = countyRunListResponseSchema.parse({
      items: (data ?? []).map((row) =>
        presentCountyRunListItem({
          id: row.id,
          workspace_id: workspaceId,
          geography_type: "county_fips",
          geography_id: row.geography_id,
          geography_label: row.geography_label,
          run_name: row.run_name,
          stage: row.stage,
          status_label: row.status_label,
          updated_at: row.updated_at,
        })
      ),
    });

    audit.info("county_runs_list_loaded", {
      userId: user.id,
      workspaceId,
      count: response.items.length,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    audit.error("county_runs_list_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json({ error: "Unexpected error while loading county runs" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("county-runs.create", request);
  const startedAt = Date.now();

  try {
    const payload = await request.json().catch(() => null);
    const parsed = createCountyRunRequestSchema.safeParse(payload);

    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      audit.warn("unauthorized", { durationMs: Date.now() - startedAt });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const workspaceId = parsed.data.workspaceId;
    const geographyId = parsed.data.geographyId;
    const geographyLabel = parsed.data.geographyLabel;
    const runName = parsed.data.runName;

    const { data, error } = await supabase
      .from("county_runs")
      .insert({
        workspace_id: workspaceId,
        geography_type: parsed.data.geographyType,
        geography_id: geographyId,
        geography_label: geographyLabel,
        run_name: runName,
        stage: "bootstrap-incomplete",
        status_label: null,
        mode: "build-and-bootstrap",
        manifest_json: {},
        run_summary_json: {},
        validation_summary_json: {},
        created_by: user.id,
      })
      .select("id, run_name, stage")
      .single();

    if (error || !data) {
      audit.error("county_run_insert_failed", {
        message: error?.message ?? "unknown",
        code: error?.code ?? null,
      });
      return NextResponse.json({ error: "Failed to create county run" }, { status: 500 });
    }

    const workerPayload = buildCountyOnrampWorkerPayload({
      origin: new URL(request.url).origin,
      jobId: crypto.randomUUID(),
      countyRunId: data.id,
      input: parsed.data,
    });

    const response = createCountyRunResponseSchema.parse({
      countyRunId: data.id,
      stage: data.stage,
      runName: data.run_name,
      workerPayload,
    });

    audit.info("county_run_created", {
      userId: user.id,
      countyRunId: data.id,
      workspaceId,
      geographyId,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    audit.error("county_runs_create_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json({ error: "Unexpected error while creating county run" }, { status: 500 });
  }
}
