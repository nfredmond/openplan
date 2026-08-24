import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { requireWorkspaceWriteAccess } from "@/lib/auth/workspace-write-gate";
import { cancelCountyOnrampJob } from "@/lib/api/county-onramp-dispatch";
import { isWriteFailure, writeMatchedNoRows } from "@/lib/http/write-outcome";

const paramsSchema = z.object({ countyRunId: z.string().uuid() });

type RouteContext = { params: Promise<{ countyRunId: string }> };

/** Planner-facing cancellation. Worker callbacks cannot call this route, and
 * no assistant action may target it. The planner's session is the principal. */
export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("county-runs.cancel", request);
  const parsedParams = paramsSchema.safeParse(await context.params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: "Invalid county run route params" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: countyRun, error: lookupError } = await supabase
    .from("county_runs")
    .select("id, workspace_id, worker_job_id, worker_url, enqueue_status")
    .eq("id", parsedParams.data.countyRunId)
    .maybeSingle();
  if (lookupError) return NextResponse.json({ error: "Failed to load county run" }, { status: 500 });
  if (!countyRun) return NextResponse.json({ error: "County run not found" }, { status: 404 });

  const writeAccess = await requireWorkspaceWriteAccess(supabase, user.id, countyRun.workspace_id);
  if (!writeAccess.ok) return writeAccess.response;

  if (!["queued", "running", "cancelling"].includes(countyRun.enqueue_status)) {
    return NextResponse.json({ error: "This county run has no cancellable worker attempt" }, { status: 409 });
  }
  if (!countyRun.worker_job_id || !countyRun.worker_url) {
    return NextResponse.json({ error: "The active worker attempt has no cancellation endpoint" }, { status: 409 });
  }

  const requestedAt = new Date().toISOString();
  const { data: cancellationClaim, error: updateError } = await supabase
    .from("county_runs")
    .update({
      enqueue_status: "cancelling",
      cancellation_requested_at: requestedAt,
      cancellation_requested_by: user.id,
      worker_dispatch_error: null,
    })
    .eq("id", countyRun.id)
    .eq("worker_job_id", countyRun.worker_job_id)
    .in("enqueue_status", ["queued", "running", "cancelling"])
    .select("id")
    .maybeSingle();
  if (isWriteFailure(updateError)) {
    return NextResponse.json({ error: "Failed to record county run cancellation" }, { status: 500 });
  }
  if (writeMatchedNoRows({ data: cancellationClaim, error: updateError })) {
    return NextResponse.json({ error: "This worker attempt finished before cancellation was recorded" }, { status: 409 });
  }

  try {
    await cancelCountyOnrampJob({ workerUrl: countyRun.worker_url, jobId: countyRun.worker_job_id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Worker cancellation failed";
    const { data: cancellationErrorRow, error: cancellationErrorWrite } = await supabase
      .from("county_runs")
      .update({ worker_dispatch_error: message })
      .eq("id", countyRun.id)
      .eq("worker_job_id", countyRun.worker_job_id)
      .select("id")
      .maybeSingle();
    if (
      isWriteFailure(cancellationErrorWrite) ||
      writeMatchedNoRows({ data: cancellationErrorRow, error: cancellationErrorWrite })
    ) {
      audit.error("county_run_worker_cancel_error_not_recorded", {
        countyRunId: countyRun.id,
        jobId: countyRun.worker_job_id,
        writeError: cancellationErrorWrite?.message ?? "matched no active attempt",
      });
    }
    audit.error("county_run_worker_cancel_failed", { countyRunId: countyRun.id, jobId: countyRun.worker_job_id, message });
    return NextResponse.json({ error: "The cancellation request did not reach the worker" }, { status: 502 });
  }

  audit.info("county_run_cancellation_requested", {
    countyRunId: countyRun.id,
    jobId: countyRun.worker_job_id,
    requestedBy: user.id,
  });
  return NextResponse.json(
    { countyRunId: countyRun.id, jobId: countyRun.worker_job_id, status: "cancelling", requestedAt },
    { status: 202 }
  );
}
