import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { buildOdmProcessingBoundary } from "@/lib/aerial/odm-processing";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import {
  buildProcessingRequest,
  processingCallbackSchema,
  PROCESSING_PRESET_IDS,
} from "@/lib/aerial/processing-contract";

export const runtime = "nodejs";

const WORKER_DISPATCH_TIMEOUT_MS = 15_000;

const ACTIVE_JOB_STATUSES = ["requested", "accepted", "running"] as const;

const paramsSchema = z.object({
  missionId: z.string().uuid(),
});

// Mirrors the worker's URL rule (isAcceptableContractUrl on the platform
// side): https anywhere, plain http only for localhost loops — self-hosted
// deployments serve imagery to the worker from the same machine.
function isAcceptableImageryUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol === "https:") return true;
  if (parsed.protocol !== "http:") return false;
  return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
}

const processBodySchema = z.object({
  imageryZipUrl: z
    .string()
    .url()
    .refine(isAcceptableImageryUrl, {
      message: "imageryZipUrl must be an https URL (http allowed for localhost only)",
    }),
  imageCount: z.number().int().positive().optional(),
  sizeBytes: z.number().int().positive().optional(),
  presetId: z.enum(PROCESSING_PRESET_IDS).default("balanced"),
  notes: z.string().trim().max(2048).optional(),
});

type RouteContext = { params: Promise<{ missionId: string }> };

function resolveCallbackUrl(request: NextRequest): string {
  const configuredBase = process.env.OPENPLAN_AERIAL_PROCESSING_CALLBACK_URL?.trim();
  const base = (configuredBase || new URL(request.url).origin).replace(/\/+$/, "");
  return `${base}/api/aerial/processing-callback`;
}

export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("aerial-missions.odm-process", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid mission id" }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: mission, error: missionError } = await supabase
      .from("aerial_missions")
      .select("id, workspace_id, project_id, title")
      .eq("id", parsedParams.data.missionId)
      .maybeSingle();

    if (missionError) {
      audit.error("aerial_mission_load_failed", { missionId: parsedParams.data.missionId, message: missionError.message });
      return NextResponse.json({ error: "Failed to load mission" }, { status: 500 });
    }
    if (!mission) {
      return NextResponse.json({ error: "Mission not found" }, { status: 404 });
    }

    const { data: membership, error: membershipError } = await supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", mission.workspace_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (membershipError) {
      audit.error("membership_check_failed", { workspaceId: mission.workspace_id, message: membershipError.message });
      return NextResponse.json({ error: "Failed to verify workspace access" }, { status: 500 });
    }
    if (!membership) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    const workerUrl = process.env.OPENPLAN_AERIAL_PROCESSING_WORKER_URL?.trim();
    const workerToken = process.env.OPENPLAN_AERIAL_PROCESSING_WORKER_TOKEN?.trim();

    if (!workerUrl || !workerToken) {
      const boundary = buildOdmProcessingBoundary();
      audit.info("aerial_mission_odm_processing_requested", {
        missionId: mission.id,
        userId: user.id,
        status: boundary.status,
      });
      return NextResponse.json(boundary, { status: 501 });
    }

    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.smallJson);
    if (!payloadBody.ok) return payloadBody.response;

    const parsedBody = processBodySchema.safeParse(payloadBody.data);
    if (!parsedBody.success) {
      audit.warn("validation_failed", { issues: parsedBody.error.issues });
      return NextResponse.json(
        { error: "Invalid processing request payload", issues: parsedBody.error.issues },
        { status: 400 }
      );
    }

    const body = parsedBody.data;

    const { data: activeJob, error: activeJobError } = await supabase
      .from("aerial_processing_jobs")
      .select("id, request_id, status")
      .eq("mission_id", mission.id)
      .in("status", [...ACTIVE_JOB_STATUSES])
      .limit(1)
      .maybeSingle();

    if (activeJobError) {
      audit.error("active_job_check_failed", { missionId: mission.id, message: activeJobError.message });
      return NextResponse.json({ error: "Failed to check active processing jobs" }, { status: 500 });
    }

    if (activeJob) {
      audit.warn("processing_already_active", {
        missionId: mission.id,
        requestId: activeJob.request_id,
        jobStatus: activeJob.status,
      });
      return NextResponse.json(
        { error: "processing_already_active", requestId: activeJob.request_id },
        { status: 409 }
      );
    }

    const requestId = crypto.randomUUID();
    const callbackUrl = resolveCallbackUrl(request);

    // Insert the job row BEFORE calling the worker so a crash between the
    // two steps cannot orphan an accepted worker job: the callback route
    // resolves mission/workspace from request_id via this row.
    const { data: jobRow, error: jobInsertError } = await supabase
      .from("aerial_processing_jobs")
      .insert({
        workspace_id: mission.workspace_id,
        project_id: mission.project_id,
        mission_id: mission.id,
        request_id: requestId,
        status: "requested",
        preset_id: body.presetId,
        imagery_url: body.imageryZipUrl,
        imagery_image_count: body.imageCount ?? null,
        imagery_size_bytes: body.sizeBytes ?? null,
        created_by: user.id,
      })
      .select("id")
      .single();

    if (jobInsertError || !jobRow) {
      audit.error("processing_job_insert_failed", {
        missionId: mission.id,
        requestId,
        message: jobInsertError?.message ?? "unknown",
        code: jobInsertError?.code ?? null,
      });
      return NextResponse.json({ error: "Failed to record processing job" }, { status: 500 });
    }

    const processingRequest = buildProcessingRequest({
      requestId,
      callbackUrl,
      missionId: mission.id,
      workspaceId: mission.workspace_id,
      projectId: mission.project_id,
      missionTitle: mission.title ?? "Aerial mission",
      imageryZipUrl: body.imageryZipUrl,
      imageCount: body.imageCount,
      sizeBytes: body.sizeBytes,
      presetId: body.presetId,
      notes: body.notes,
    });

    const markDispatchFailed = async (detail: string) => {
      const { error: failError } = await supabase
        .from("aerial_processing_jobs")
        .update({ status: "dispatch_failed", dispatch_error: detail.slice(0, 2048) })
        .eq("id", jobRow.id);

      if (failError) {
        audit.error("dispatch_failure_writeback_failed", {
          requestId,
          message: failError.message,
        });
      }
    };

    let workerResponse: Response;
    try {
      workerResponse = await fetch(
        `${workerUrl.replace(/\/+$/, "")}/api/v1/processing-requests`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
            authorization: `Bearer ${workerToken}`,
          },
          body: JSON.stringify(processingRequest),
          signal: AbortSignal.timeout(WORKER_DISPATCH_TIMEOUT_MS),
        }
      );
    } catch (fetchError) {
      const detail = fetchError instanceof Error ? fetchError.message : "worker fetch failed";
      audit.error("worker_dispatch_failed", { requestId, missionId: mission.id, detail });
      await markDispatchFailed(detail);
      return NextResponse.json({ error: "worker_dispatch_failed", detail }, { status: 502 });
    }

    if (workerResponse.status !== 200 && workerResponse.status !== 202) {
      const errorText = (await workerResponse.text().catch(() => "")).trim();
      const detail = errorText
        ? `worker responded ${workerResponse.status}: ${errorText}`
        : `worker responded ${workerResponse.status}`;
      audit.error("worker_dispatch_rejected", { requestId, missionId: mission.id, status: workerResponse.status });
      await markDispatchFailed(detail);
      return NextResponse.json({ error: "worker_dispatch_failed", detail }, { status: 502 });
    }

    const acceptedBody = await workerResponse.json().catch(() => null);
    const parsedAccepted = processingCallbackSchema.safeParse(acceptedBody);

    if (!parsedAccepted.success || parsedAccepted.data.status !== "accepted") {
      const detail = "worker accepted response did not match the processing contract";
      audit.error("worker_accepted_response_invalid", {
        requestId,
        missionId: mission.id,
        issues: parsedAccepted.success ? null : parsedAccepted.error.issues,
      });
      await markDispatchFailed(detail);
      return NextResponse.json({ error: "worker_dispatch_failed", detail }, { status: 502 });
    }

    const accepted = parsedAccepted.data;

    const { error: acceptUpdateError } = await supabase
      .from("aerial_processing_jobs")
      .update({
        status: "accepted",
        job_reference: accepted.jobReference,
        last_callback_id: accepted.callbackId,
        last_callback_at: accepted.occurredAt,
      })
      .eq("id", jobRow.id);

    if (acceptUpdateError) {
      // The worker owns the job now; keep the row (callbacks will advance it)
      // but surface the writeback problem.
      audit.error("processing_job_accept_update_failed", {
        requestId,
        message: acceptUpdateError.message,
      });
    }

    audit.info("aerial_processing_dispatched", {
      missionId: mission.id,
      userId: user.id,
      requestId,
      jobReference: accepted.jobReference,
      presetId: body.presetId,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      { requestId, jobReference: accepted.jobReference, status: "accepted" },
      { status: 202 }
    );
  } catch (error) {
    audit.error("aerial_mission_odm_unhandled_error", { error });
    return NextResponse.json({ error: "Unexpected error while handling ODM request" }, { status: 500 });
  }
}
