import { mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, resolve } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { countyOnrampManifestSchema } from "@/lib/models/county-onramp";
import { updateCountyRunScaffoldRequestSchema } from "@/lib/api/county-onramp";
import {
  CountyValidationScaffoldCsvError,
  normalizeCountyValidationScaffoldCsvContent,
  summarizeCountyValidationScaffoldCsv,
} from "@/lib/api/county-onramp-scaffold";
import { presentCountyRunDetail } from "@/lib/api/county-onramp-presenters";

const paramsSchema = z.object({
  countyRunId: z.string().uuid(),
});

type RouteContext = {
  params: Promise<{ countyRunId: string }>;
};

type CountyRunRow = {
  id: string;
  workspace_id: string;
  geography_type: string;
  geography_id: string;
  geography_label: string | null;
  run_name: string;
  stage: "bootstrap-incomplete" | "runtime-complete" | "validation-scaffolded" | "validated-screening";
  status_label: string | null;
  enqueue_status?: "not-enqueued" | "queued_stub" | "failed" | null;
  last_enqueued_at?: string | null;
  requested_runtime_json?: Record<string, unknown> | null;
  manifest_json?: Record<string, unknown> | null;
  validation_summary_json?: Record<string, unknown> | null;
};

function resolveScaffoldPath(scaffoldPath: string): string {
  const resolvedPath = isAbsolute(scaffoldPath) ? scaffoldPath : resolve(process.cwd(), "..", scaffoldPath);
  if (extname(resolvedPath).toLowerCase() !== ".csv") {
    throw new CountyValidationScaffoldCsvError("Registered scaffold path must end with .csv.");
  }
  return resolvedPath;
}

export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("county-runs.scaffold", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid county run route params" }, { status: 400 });
    }

    const payload = await request.json().catch(() => null);
    const parsedBody = updateCountyRunScaffoldRequestSchema.safeParse(payload);
    if (!parsedBody.success) {
      audit.warn("validation_failed", { issues: parsedBody.error.issues });
      return NextResponse.json({ error: "Invalid scaffold update payload" }, { status: 400 });
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
        "id, workspace_id, geography_type, geography_id, geography_label, run_name, stage, status_label, enqueue_status, last_enqueued_at, requested_runtime_json, manifest_json, validation_summary_json"
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

    const existingRow = countyRun as CountyRunRow;
    const parsedManifest = countyOnrampManifestSchema.safeParse(existingRow.manifest_json ?? null);
    if (!parsedManifest.success) {
      audit.warn("county_run_manifest_missing", { countyRunId: existingRow.id });
      return NextResponse.json({ error: "County run does not have a stored onramp manifest yet" }, { status: 400 });
    }

    const manifest = parsedManifest.data;
    const scaffoldPath = manifest.artifacts.scaffold_csv;
    if (!scaffoldPath) {
      return NextResponse.json({ error: "County run does not have a registered scaffold CSV path" }, { status: 400 });
    }

    const normalizedCsvContent = normalizeCountyValidationScaffoldCsvContent(parsedBody.data.csvContent);
    const scaffoldSummary = summarizeCountyValidationScaffoldCsv(normalizedCsvContent);
    const resolvedScaffoldPath = resolveScaffoldPath(scaffoldPath);

    await mkdir(dirname(resolvedScaffoldPath), { recursive: true });
    await writeFile(resolvedScaffoldPath, normalizedCsvContent, "utf8");

    const invalidatesValidation = Boolean(manifest.summary.validation);
    const nextManifest = countyOnrampManifestSchema.parse({
      ...manifest,
      stage: invalidatesValidation ? "validation-scaffolded" : manifest.stage,
      artifacts: {
        ...manifest.artifacts,
        validation_summary_json: invalidatesValidation ? null : manifest.artifacts.validation_summary_json,
      },
      summary: {
        ...manifest.summary,
        validation: invalidatesValidation ? null : manifest.summary.validation,
        bundle_validation: invalidatesValidation ? null : manifest.summary.bundle_validation,
        scaffold: scaffoldSummary,
      },
    });

    const nextStatusLabel = invalidatesValidation ? "Validation pending scaffold edits" : existingRow.status_label;
    const nextValidationSummaryJson = invalidatesValidation ? null : existingRow.validation_summary_json ?? null;

    const { data: updatedRow, error: updateError } = await supabase
      .from("county_runs")
      .update({
        stage: nextManifest.stage,
        status_label: nextStatusLabel,
        manifest_json: nextManifest,
        validation_summary_json: nextValidationSummaryJson,
      })
      .eq("id", existingRow.id)
      .select(
        "id, workspace_id, geography_type, geography_id, geography_label, run_name, stage, status_label, enqueue_status, last_enqueued_at, requested_runtime_json, manifest_json, validation_summary_json"
      )
      .single();

    if (updateError || !updatedRow) {
      audit.error("county_run_update_failed", {
        message: updateError?.message ?? "unknown",
        code: updateError?.code ?? null,
      });
      return NextResponse.json({ error: "Failed to update county run scaffold" }, { status: 500 });
    }

    if (invalidatesValidation) {
      const { error: staleArtifactDeleteError } = await supabase
        .from("county_run_artifacts")
        .delete()
        .eq("county_run_id", existingRow.id)
        .eq("artifact_type", "validation_summary_json");

      if (staleArtifactDeleteError) {
        audit.error("county_run_stale_validation_artifact_delete_failed", {
          message: staleArtifactDeleteError.message,
          code: staleArtifactDeleteError.code ?? null,
        });
        return NextResponse.json({ error: "Failed to clear stale validation artifacts" }, { status: 500 });
      }
    }

    const { data: artifacts, error: artifactError } = await supabase
      .from("county_run_artifacts")
      .select("artifact_type, path")
      .eq("county_run_id", existingRow.id)
      .order("created_at", { ascending: true });

    if (artifactError) {
      audit.error("county_run_artifacts_lookup_failed", {
        message: artifactError.message,
        code: artifactError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load county run artifacts" }, { status: 500 });
    }

    const response = presentCountyRunDetail({
      row: updatedRow as CountyRunRow,
      artifacts: (artifacts ?? []) as { artifact_type: string; path: string }[],
      origin: new URL(request.url).origin,
    });

    audit.info("county_run_scaffold_updated", {
      countyRunId: existingRow.id,
      invalidatesValidation,
      scaffoldReadyStationCount: scaffoldSummary.ready_station_count,
      scaffoldStationCount: scaffoldSummary.station_count,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    if (error instanceof CountyValidationScaffoldCsvError) {
      audit.warn("county_run_scaffold_invalid_csv", {
        message: error.message,
        durationMs: Date.now() - startedAt,
      });
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    audit.error("county_run_scaffold_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json({ error: "Unexpected error while updating county run scaffold" }, { status: 500 });
  }
}
