import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { ingestCountyRunManifestRequestSchema } from "@/lib/api/county-onramp";
import {
  buildCountyRunArtifacts,
  buildCountyRunRecord,
} from "@/lib/api/county-onramp-persistence";
import { presentCountyRunDetail } from "@/lib/api/county-onramp-presenters";
import { persistBehavioralOnrampKpis } from "@/lib/models/behavioral-onramp-kpis";
import { refreshCountyRunModelingEvidence } from "@/lib/models/evidence-backbone";

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

export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("county-runs.manifest", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid county run route params" }, { status: 400 });
    }

    const payload = await request.json().catch(() => null);
    const parsed = ingestCountyRunManifestRequestSchema.safeParse(payload);
    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid manifest ingest payload" }, { status: 400 });
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
      .select("id, workspace_id, geography_type, geography_id, geography_label, run_name, stage, status_label, enqueue_status, last_enqueued_at, requested_runtime_json, manifest_json, validation_summary_json")
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

    if (parsed.data.status === "failed") {
      const failureStatus = parsed.data.error?.message ?? "Worker failed";
      const { error: updateError } = await supabase
        .from("county_runs")
        .update({
          status_label: failureStatus,
        })
        .eq("id", existingRow.id);

      if (updateError) {
        audit.error("county_run_failure_update_failed", {
          message: updateError.message,
          code: updateError.code ?? null,
        });
        return NextResponse.json({ error: "Failed to record county run failure" }, { status: 500 });
      }

      audit.warn("county_run_worker_failed", {
        countyRunId: existingRow.id,
        jobId: parsed.data.jobId ?? null,
        message: failureStatus,
        durationMs: Date.now() - startedAt,
      });

      return NextResponse.json({ countyRunId: existingRow.id, status: "failed" }, { status: 202 });
    }

    const manifest = parsed.data.manifest;
    if (!manifest) {
      audit.warn("manifest_missing_for_completed_status", {
        countyRunId: existingRow.id,
      });
      return NextResponse.json({ error: "Completed county run payload is missing a manifest" }, { status: 400 });
    }

    const nextRecord = buildCountyRunRecord({
      workspaceId: existingRow.workspace_id,
      geographyId: existingRow.geography_id,
      geographyLabel: existingRow.geography_label,
      manifest,
    });
    const artifacts = buildCountyRunArtifacts({
      workspaceId: existingRow.workspace_id,
      manifest,
    });

    const { data: updatedRows, error: updateError } = await supabase
      .from("county_runs")
      .update({
        geography_type: nextRecord.geography_type,
        geography_id: nextRecord.geography_id,
        geography_label: nextRecord.geography_label,
        run_name: nextRecord.run_name,
        stage: nextRecord.stage,
        status_label: nextRecord.status_label,
        mode: nextRecord.mode,
        manifest_json: nextRecord.manifest_json,
        run_summary_json: nextRecord.run_summary_json,
        validation_summary_json: nextRecord.validation_summary_json,
      })
      .eq("id", existingRow.id)
      .select("id, workspace_id, geography_type, geography_id, geography_label, run_name, stage, status_label, enqueue_status, last_enqueued_at, requested_runtime_json, manifest_json, validation_summary_json")
      .single();

    if (updateError || !updatedRows) {
      audit.error("county_run_update_failed", {
        message: updateError?.message ?? "unknown",
        code: updateError?.code ?? null,
      });
      return NextResponse.json({ error: "Failed to update county run" }, { status: 500 });
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

    const kpiResult = await persistBehavioralOnrampKpis({
      supabase,
      countyRunId: existingRow.id,
      manifest,
    });

    if (kpiResult.error) {
      audit.warn("county_run_behavioral_kpis_failed", {
        countyRunId: existingRow.id,
        message: kpiResult.error.message,
        code: kpiResult.error.code ?? null,
      });
    } else {
      audit.info("county_run_behavioral_kpis_written", {
        countyRunId: existingRow.id,
        kpiCount: kpiResult.inserted.length,
        stage: manifest.stage,
      });
    }

    const evidenceResult = await refreshCountyRunModelingEvidence({
      supabase,
      workspaceId: existingRow.workspace_id,
      countyRunId: existingRow.id,
      manifest,
      geographyLabel: existingRow.geography_label,
    });

    if (evidenceResult.error) {
      audit.warn("county_run_modeling_evidence_backbone_failed", {
        countyRunId: existingRow.id,
        message: evidenceResult.error.message,
        code: evidenceResult.error.code ?? null,
        missingSchema: evidenceResult.error.missingSchema ?? false,
        claimStatus: evidenceResult.bundle.claimDecision.claimStatus,
      });
    } else {
      audit.info("county_run_modeling_evidence_backbone_written", {
        countyRunId: existingRow.id,
        sourceManifestCount: evidenceResult.insertedSourceManifestCount,
        validationResultCount: evidenceResult.insertedValidationResultCount,
        claimStatus: evidenceResult.bundle.claimDecision.claimStatus,
      });
    }

    const response = presentCountyRunDetail({
      row: updatedRows as CountyRunRow,
      artifacts: (insertedArtifacts ?? []) as { artifact_type: string; path: string }[],
      origin: new URL(request.url).origin,
    });

    audit.info("county_run_manifest_ingested", {
      countyRunId: existingRow.id,
      jobId: parsed.data.jobId ?? null,
      stage: response.stage,
      statusLabel: response.statusLabel ?? null,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    audit.error("county_run_manifest_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json({ error: "Unexpected error while ingesting county run manifest" }, { status: 500 });
  }
}
