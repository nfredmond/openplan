import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { presentCountyRunDetail } from "@/lib/api/county-onramp-presenters";

const paramsSchema = z.object({
  countyRunId: z.string().uuid(),
});

type RouteContext = {
  params: Promise<{ countyRunId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("county-runs.detail", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid county run route params" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      audit.warn("unauthorized", { durationMs: Date.now() - startedAt });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: countyRun, error: countyRunError } = await supabase
      .from("county_runs")
      .select(
        "id, workspace_id, geography_type, geography_id, geography_label, run_name, stage, status_label, requested_runtime_json, manifest_json, validation_summary_json"
      )
      .eq("id", parsedParams.data.countyRunId)
      .maybeSingle();

    if (countyRunError) {
      audit.error("county_run_lookup_failed", {
        message: countyRunError.message,
        code: countyRunError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load county run" }, { status: 500 });
    }

    if (!countyRun) {
      return NextResponse.json({ error: "County run not found" }, { status: 404 });
    }

    const { data: artifacts, error: artifactError } = await supabase
      .from("county_run_artifacts")
      .select("artifact_type, path")
      .eq("county_run_id", parsedParams.data.countyRunId)
      .order("created_at", { ascending: true });

    if (artifactError) {
      audit.error("county_run_artifacts_lookup_failed", {
        message: artifactError.message,
        code: artifactError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load county run artifacts" }, { status: 500 });
    }

    const response = presentCountyRunDetail({
      row: countyRun,
      artifacts: (artifacts ?? []) as { artifact_type: string; path: string }[],
      origin: new URL(request.url).origin,
    });

    audit.info("county_run_loaded", {
      countyRunId: parsedParams.data.countyRunId,
      stage: response.stage,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    audit.error("county_run_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json({ error: "Unexpected error while loading county run" }, { status: 500 });
  }
}
