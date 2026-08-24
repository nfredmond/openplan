import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { enqueueCountyRunResponseSchema } from "@/lib/api/county-onramp";
import { dispatchCountyOnrampJob, type CountyOnrampDispatchResult } from "@/lib/api/county-onramp-dispatch";
import {
  buildCountyOnrampWorkerPayloadFromStoredRequest,
  sanitizeCountyOnrampWorkerPayload,
  storedCountyOnrampRequestSchema,
} from "@/lib/api/county-onramp-worker";
import { requireWorkspaceWriteAccess } from "@/lib/auth/workspace-write-gate";
import { isWriteFailure, writeMatchedNoRows } from "@/lib/http/write-outcome";

const paramsSchema = z.object({
  countyRunId: z.string().uuid(),
});

type RouteContext = {
  params: Promise<{ countyRunId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("county-runs.enqueue", request);
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
      .select("id, workspace_id, requested_runtime_json, enqueue_status")
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

    if (["queued", "running", "cancelling"].includes(String(countyRun.enqueue_status))) {
      return NextResponse.json({ error: "This county run already has an active worker attempt" }, { status: 409 });
    }

    // Dispatching a worker job and stamping enqueue state onto the run are
    // writes; seeing the run is not enough to perform them.
    const writeAccess = await requireWorkspaceWriteAccess(
      supabase,
      user.id,
      (countyRun as { workspace_id: string }).workspace_id
    );
    if (!writeAccess.ok) return writeAccess.response;

    const storedRequest = storedCountyOnrampRequestSchema.safeParse(countyRun.requested_runtime_json);
    if (!storedRequest.success) {
      audit.warn("county_run_missing_launch_state", {
        countyRunId: parsedParams.data.countyRunId,
      });
      return NextResponse.json({ error: "County run is missing launch request state" }, { status: 409 });
    }

    const workerPayload = buildCountyOnrampWorkerPayloadFromStoredRequest({
      origin: new URL(request.url).origin,
      jobId: crypto.randomUUID(),
      countyRunId: parsedParams.data.countyRunId,
      input: storedRequest.data,
    });
    const sanitizedWorkerPayload = sanitizeCountyOnrampWorkerPayload(workerPayload);
    const workerUrl = process.env.OPENPLAN_COUNTY_ONRAMP_WORKER_URL?.trim() || null;

    // Claim the attempt BEFORE the network call. The worker sends a running
    // callback as soon as it starts; storing the job id after dispatch created
    // a race where that valid first callback looked stale. The state predicate
    // also prevents two concurrent clicks from dispatching two active jobs.
    const initialStatus = workerUrl ? "queued" : "prepared";
    const { data: claimedAttempt, error: claimError } = await supabase
      .from("county_runs")
      .update({
        enqueue_status: initialStatus,
        last_enqueued_at: new Date().toISOString(),
        worker_job_id: sanitizedWorkerPayload.jobId,
        worker_payload_json: sanitizedWorkerPayload,
        worker_url: workerUrl,
        worker_dispatch_error: null,
        worker_started_at: null,
        worker_heartbeat_at: null,
        cancellation_requested_at: null,
        cancellation_requested_by: null,
        cancelled_at: null,
        worker_completed_at: null,
      })
      .eq("id", parsedParams.data.countyRunId)
      .in("enqueue_status", ["not-enqueued", "prepared", "cancelled", "completed", "failed"])
      .select("id")
      .maybeSingle();
    if (isWriteFailure(claimError)) {
      return NextResponse.json({ error: "Failed to claim county worker attempt" }, { status: 500 });
    }
    if (writeMatchedNoRows({ data: claimedAttempt, error: claimError })) {
      return NextResponse.json({ error: "This county run already has an active worker attempt" }, { status: 409 });
    }

    let dispatchResult: CountyOnrampDispatchResult;
    try {
      dispatchResult = await dispatchCountyOnrampJob(workerPayload);
    } catch (dispatchError) {
      const dispatchMessage = dispatchError instanceof Error ? dispatchError.message : "County worker dispatch failed";
      const { data: failedAttempt, error: updateError } = await supabase
        .from("county_runs")
        .update({
          enqueue_status: "failed",
          last_enqueued_at: new Date().toISOString(),
          worker_job_id: sanitizedWorkerPayload.jobId,
          worker_payload_json: sanitizedWorkerPayload,
          worker_url: workerUrl,
          worker_dispatch_error: dispatchMessage,
          worker_started_at: null,
          worker_heartbeat_at: null,
          cancellation_requested_at: null,
          cancellation_requested_by: null,
          cancelled_at: null,
          worker_completed_at: null,
        })
        .eq("id", parsedParams.data.countyRunId)
        .eq("worker_job_id", sanitizedWorkerPayload.jobId)
        .select("id")
        .maybeSingle();

      if (isWriteFailure(updateError)) {
        audit.error("county_run_enqueue_failure_update_failed", {
          message: updateError?.message ?? "unknown",
          code: updateError?.code ?? null,
          dispatchMessage,
        });
        return NextResponse.json({ error: "Failed to persist county enqueue failure state" }, { status: 500 });
      }
      if (writeMatchedNoRows({ data: failedAttempt, error: updateError })) {
        audit.warn("county_run_enqueue_failure_overtaken", {
          countyRunId: parsedParams.data.countyRunId,
          jobId: sanitizedWorkerPayload.jobId,
          dispatchMessage,
        });
        return NextResponse.json({ error: "This worker attempt is no longer active" }, { status: 409 });
      }

      audit.error("county_run_worker_dispatch_failed", {
        countyRunId: parsedParams.data.countyRunId,
        jobId: sanitizedWorkerPayload.jobId,
        workerUrl,
        dispatchMessage,
        durationMs: Date.now() - startedAt,
      });

      return NextResponse.json(
        {
          countyRunId: parsedParams.data.countyRunId,
          status: "failed",
          error: "Failed to dispatch county worker",
        },
        { status: 502 }
      );
    }

    // The claim already persisted the state and payload. Do not write it again
    // after dispatch: a fast running callback may already have advanced it.

    const response = enqueueCountyRunResponseSchema.parse({
      countyRunId: parsedParams.data.countyRunId,
      status: dispatchResult.deliveryMode,
      workerJobId: sanitizedWorkerPayload.jobId,
      workerUrl: dispatchResult.workerUrl,
      workerPayload: sanitizedWorkerPayload,
    });

    audit.info(dispatchResult.deliveryMode === "queued" ? "county_run_worker_queued" : "county_run_enqueue_prepared", {
      countyRunId: parsedParams.data.countyRunId,
      jobId: sanitizedWorkerPayload.jobId,
      workerUrl: dispatchResult.workerUrl,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    audit.error("county_run_enqueue_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json({ error: "Unexpected error while preparing county run enqueue payload" }, { status: 500 });
  }
}
