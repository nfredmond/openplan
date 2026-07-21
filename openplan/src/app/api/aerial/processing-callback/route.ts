import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { rebuildAerialProjectPosture } from "@/lib/aerial/posture-writeback";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import {
  isAerialProcessingCallbackConfigured,
  isAuthenticatedAerialProcessingCallback,
} from "@/lib/api/aerial-processing-auth";
import {
  processingCallbackSchema,
  type ProcessingCallback,
} from "@/lib/aerial/processing-contract";

export const runtime = "nodejs";

const POSTGRES_UNIQUE_VIOLATION = "23505";

const TERMINAL_STATUSES = new Set(["succeeded", "failed", "canceled"]);

type ProcessingJobRow = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  mission_id: string;
  request_id: string;
  job_reference: string | null;
  status: string;
};

function summarizeArtifacts(callback: ProcessingCallback): string {
  const kinds = (callback.artifacts ?? []).map((artifact) => artifact.kind);
  const kindSummary = kinds.length > 0 ? kinds.join(", ") : "none";
  return [
    `Outputs from aerial processing job ${callback.jobReference} (request ${callback.requestId}).`,
    `Artifact kinds: ${kindSummary}.`,
    "Download URLs are time-limited signed URLs recorded on the processing job row (aerial_processing_jobs.artifacts).",
  ].join(" ");
}

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("aerial-processing.callback", request);
  const startedAt = Date.now();

  try {
    if (!isAerialProcessingCallbackConfigured()) {
      audit.warn("missing_config", { durationMs: Date.now() - startedAt });
      return NextResponse.json({ error: "missing_config" }, { status: 503 });
    }

    if (!isAuthenticatedAerialProcessingCallback(request)) {
      audit.warn("unauthorized", { durationMs: Date.now() - startedAt });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);
    if (!payloadBody.ok) return payloadBody.response;

    const parsed = processingCallbackSchema.safeParse(payloadBody.data);
    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json(
        { error: "Invalid processing callback payload", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const callback = parsed.data;
    const supabase = createServiceRoleClient();

    const { data: jobData, error: jobError } = await supabase
      .from("aerial_processing_jobs")
      .select("id, workspace_id, project_id, mission_id, request_id, job_reference, status")
      .eq("request_id", callback.requestId)
      .maybeSingle();

    if (jobError) {
      audit.error("processing_job_lookup_failed", {
        requestId: callback.requestId,
        message: jobError.message,
        code: jobError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load processing job" }, { status: 500 });
    }

    if (!jobData) {
      audit.warn("unknown_request", { requestId: callback.requestId, callbackId: callback.callbackId });
      return NextResponse.json({ error: "unknown_request" }, { status: 404 });
    }

    const job = jobData as ProcessingJobRow;

    if (job.job_reference && callback.jobReference && job.job_reference !== callback.jobReference) {
      audit.warn("job_reference_mismatch", {
        requestId: callback.requestId,
        storedJobReference: job.job_reference,
        callbackJobReference: callback.jobReference,
      });
      // Proceed by request_id: it is the idempotency key both sides agreed on.
    }

    // Idempotency ledger first: a redelivered callbackId fails the UNIQUE
    // constraint and we answer deduped without re-applying the transition.
    const { error: ledgerError } = await supabase.from("aerial_processing_callbacks").insert({
      processing_job_id: job.id,
      workspace_id: job.workspace_id,
      callback_id: callback.callbackId,
      status: callback.status,
      occurred_at: callback.occurredAt,
      payload: callback,
    });

    if (ledgerError) {
      if (ledgerError.code === POSTGRES_UNIQUE_VIOLATION) {
        audit.info("callback_deduped", {
          requestId: callback.requestId,
          callbackId: callback.callbackId,
        });
        return NextResponse.json({ ok: true, deduped: true }, { status: 200 });
      }

      audit.error("callback_ledger_insert_failed", {
        requestId: callback.requestId,
        callbackId: callback.callbackId,
        message: ledgerError.message,
        code: ledgerError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to record processing callback" }, { status: 500 });
    }

    // Never downgrade a terminal status: the ledger row is recorded above,
    // but the job state stays as-is.
    if (TERMINAL_STATUSES.has(job.status) && callback.status !== job.status) {
      audit.info("terminal_status_preserved", {
        requestId: callback.requestId,
        jobStatus: job.status,
        callbackStatus: callback.status,
      });
      return NextResponse.json({ ok: true, ignored: "terminal" }, { status: 200 });
    }

    const update: Record<string, unknown> = {
      status: callback.status,
      message: callback.message ?? null,
      last_callback_id: callback.callbackId,
      last_callback_at: callback.occurredAt,
    };

    if (!job.job_reference && callback.jobReference) {
      update.job_reference = callback.jobReference;
    }

    if (callback.status === "succeeded") {
      update.progress = 100;
      update.artifacts = callback.artifacts ?? [];
      update.benchmark_summary = callback.benchmarkSummary ?? null;
    } else if (callback.progress !== undefined) {
      update.progress = callback.progress;
    }

    const { error: updateError } = await supabase
      .from("aerial_processing_jobs")
      .update(update)
      .eq("id", job.id);

    if (updateError) {
      audit.error("processing_job_update_failed", {
        requestId: callback.requestId,
        callbackId: callback.callbackId,
        message: updateError.message,
        code: updateError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to update processing job" }, { status: 500 });
    }

    if (callback.status === "succeeded") {
      // Idempotent evidence-package creation keyed on processing_job_id.
      const { data: existingPackage, error: existingPackageError } = await supabase
        .from("aerial_evidence_packages")
        .select("id")
        .eq("processing_job_id", job.id)
        .maybeSingle();

      if (existingPackageError) {
        audit.error("evidence_package_lookup_failed", {
          requestId: callback.requestId,
          processingJobId: job.id,
          message: existingPackageError.message,
          code: existingPackageError.code ?? null,
        });
        return NextResponse.json({ error: "Failed to check evidence package" }, { status: 500 });
      }

      if (!existingPackage) {
        const { data: mission, error: missionError } = await supabase
          .from("aerial_missions")
          .select("title")
          .eq("id", job.mission_id)
          .maybeSingle();

        if (missionError) {
          audit.warn("mission_title_lookup_failed", {
            missionId: job.mission_id,
            message: missionError.message,
          });
        }

        const missionTitle = (mission?.title as string | undefined)?.trim();
        const packageTitle = missionTitle
          ? `${missionTitle} aerial processing outputs`
          : "Aerial processing outputs";

        const { data: pkg, error: insertError } = await supabase
          .from("aerial_evidence_packages")
          .insert({
            mission_id: job.mission_id,
            workspace_id: job.workspace_id,
            project_id: job.project_id,
            title: packageTitle,
            package_type: "measurable_output",
            status: "ready",
            verification_readiness: "partial",
            processing_job_id: job.id,
            notes: summarizeArtifacts(callback),
          })
          .select("id")
          .single();

        if (insertError || !pkg) {
          audit.error("evidence_package_insert_failed", {
            requestId: callback.requestId,
            processingJobId: job.id,
            message: insertError?.message ?? "unknown",
            code: insertError?.code ?? null,
          });
          return NextResponse.json({ error: "Failed to create evidence package" }, { status: 500 });
        }

        audit.info("evidence_package_created", {
          packageId: pkg.id,
          missionId: job.mission_id,
          workspaceId: job.workspace_id,
          processingJobId: job.id,
        });
      }

      if (job.project_id) {
        const postureResult = await rebuildAerialProjectPosture({
          supabase,
          projectId: job.project_id,
          workspaceId: job.workspace_id,
        });

        if (postureResult.error) {
          audit.warn("aerial_posture_rebuild_failed", {
            projectId: job.project_id,
            workspaceId: job.workspace_id,
            message: postureResult.error.message,
            code: postureResult.error.code ?? null,
          });
        } else {
          audit.info("aerial_posture_rebuilt", {
            projectId: job.project_id,
            workspaceId: job.workspace_id,
            verificationReadiness: postureResult.posture?.verificationReadiness ?? "none",
          });
        }
      }
    }

    audit.info("processing_callback_applied", {
      requestId: callback.requestId,
      callbackId: callback.callbackId,
      status: callback.status,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ ok: true, status: callback.status }, { status: 200 });
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof z.ZodError) {
      audit.warn("processing_callback_invalid", {
        durationMs: Date.now() - startedAt,
        message: error.message,
      });
      return NextResponse.json({ error: "Invalid processing callback payload" }, { status: 400 });
    }

    audit.error("processing_callback_unhandled_error", {
      error,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json(
      { error: "Unexpected error while handling processing callback" },
      { status: 500 }
    );
  }
}
