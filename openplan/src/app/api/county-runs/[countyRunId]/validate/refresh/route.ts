import { readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import {
  buildCountyRunArtifacts,
  buildCountyRunRecord,
  deriveCountyBundleValidationSummary,
  deriveCountyRunStageFromValidation,
} from "@/lib/api/county-onramp-persistence";
import { presentCountyRunDetail } from "@/lib/api/county-onramp-presenters";
import {
  countyOnrampManifestSchema,
  countyOnrampValidationSummarySchema,
} from "@/lib/models/county-onramp";

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

function resolveStoredPath(pathValue: string): string {
  return isAbsolute(pathValue) ? pathValue : resolve(process.cwd(), "..", pathValue);
}

function hasErrnoCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("county-runs.validate.refresh", request);
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
    const validationSummaryPath = resolveStoredPath(
      manifest.artifacts.validation_summary_json ?? join(manifest.run_dir, "validation", "validation_summary.json")
    );
    const parsedValidationSummary = countyOnrampValidationSummarySchema.parse(
      JSON.parse(await readFile(validationSummaryPath, "utf8"))
    );
    const bundleValidation = deriveCountyBundleValidationSummary(
      parsedValidationSummary as Record<string, unknown>
    );
    const nextStage = deriveCountyRunStageFromValidation({
      runSummary: manifest.summary.run as Record<string, unknown>,
      validationSummary: parsedValidationSummary as Record<string, unknown>,
    });

    const nextManifest = countyOnrampManifestSchema.parse({
      ...manifest,
      stage: nextStage,
      artifacts: {
        ...manifest.artifacts,
        validation_summary_json: validationSummaryPath,
      },
      summary: {
        ...manifest.summary,
        validation: parsedValidationSummary,
        bundle_validation: bundleValidation,
      },
    });

    const nextRecord = buildCountyRunRecord({
      workspaceId: existingRow.workspace_id,
      geographyId: existingRow.geography_id,
      geographyLabel: existingRow.geography_label,
      manifest: nextManifest,
    });
    const artifacts = buildCountyRunArtifacts({
      workspaceId: existingRow.workspace_id,
      manifest: nextManifest,
    });

    const { data: updatedRow, error: updateError } = await supabase
      .from("county_runs")
      .update({
        stage: nextRecord.stage,
        status_label: nextRecord.status_label,
        manifest_json: nextRecord.manifest_json,
        run_summary_json: nextRecord.run_summary_json,
        validation_summary_json: nextRecord.validation_summary_json,
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
      return NextResponse.json({ error: "Failed to refresh county run validation" }, { status: 500 });
    }

    const { error: artifactDeleteError } = await supabase
      .from("county_run_artifacts")
      .delete()
      .eq("county_run_id", existingRow.id);

    if (artifactDeleteError) {
      audit.error("county_run_artifact_delete_failed", {
        message: artifactDeleteError.message,
        code: artifactDeleteError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to refresh county run artifacts" }, { status: 500 });
    }

    const artifactPayload = artifacts.map((artifact) => ({
      county_run_id: existingRow.id,
      ...artifact,
    }));

    const { data: insertedArtifacts, error: artifactInsertError } = await supabase
      .from("county_run_artifacts")
      .insert(artifactPayload)
      .select("artifact_type, path");

    if (artifactInsertError) {
      audit.error("county_run_artifact_insert_failed", {
        message: artifactInsertError.message,
        code: artifactInsertError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to store county run artifacts" }, { status: 500 });
    }

    const response = presentCountyRunDetail({
      row: updatedRow as CountyRunRow,
      artifacts: (insertedArtifacts ?? []) as { artifact_type: string; path: string }[],
      origin: new URL(request.url).origin,
    });

    audit.info("county_run_validation_refreshed", {
      countyRunId: existingRow.id,
      stage: response.stage,
      statusLabel: response.statusLabel ?? null,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    if (hasErrnoCode(error, "ENOENT")) {
      audit.warn("county_run_validation_summary_missing", {
        durationMs: Date.now() - startedAt,
      });
      return NextResponse.json({ error: "Validation summary file was not found on disk" }, { status: 404 });
    }

    if (error instanceof SyntaxError || error instanceof z.ZodError) {
      audit.warn("county_run_validation_summary_invalid", {
        durationMs: Date.now() - startedAt,
        message: error.message,
      });
      return NextResponse.json({ error: "Validation summary file is invalid or unreadable" }, { status: 400 });
    }

    audit.error("county_run_validation_refresh_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json({ error: "Unexpected error while refreshing county validation" }, { status: 500 });
  }
}
