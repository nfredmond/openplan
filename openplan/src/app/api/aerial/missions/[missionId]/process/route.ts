import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { buildOdmProcessingBoundary } from "@/lib/aerial/odm-processing";
import { AERIAL_IMAGERY_BUCKET } from "@/lib/aerial/imagery";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { isReadOnlyWorkspaceRole } from "@/lib/auth/role-matrix";
import {
  buildProcessingRequest,
  processingCallbackSchema,
  PROCESSING_PRESET_IDS,
  type BuildProcessingRequestImageryInput,
} from "@/lib/aerial/processing-contract";

export const runtime = "nodejs";

/**
 * CONTRACT COMPATIBILITY NOTE — read before touching the dispatch shape.
 *
 * `OPENPLAN_AERIAL_PROCESSING_WORKER_CONTRACT` selects, per deployment, which
 * contract revision the configured worker speaks:
 *
 *   - unset or "v1" (the default): the existing pasted-ZIP-URL path, UNTOUCHED.
 *     The external Aerial Intel Platform validates v1 strictly and receives
 *     BYTE-IDENTICAL payloads to what it has always received — no v1.1 marker,
 *     no new fields. If a change here alters the v1 dispatch payload, it is a
 *     breaking change to a worker this repository does not deploy.
 *
 *   - "v1.1": the route reads the mission's stored photos (`aerial_imagery`,
 *     uploaded through the mission imagery panel) and dispatches them as a
 *     `photo_manifest` of signed, time-limited per-photo URLs. If no photos are
 *     stored and the planner pasted a ZIP URL, it falls back to the zip path —
 *     which still declares v1, because a zip_url request must (the contract's
 *     versioning rule). If neither exists, it refuses honestly.
 *
 * Callbacks are accepted under either version, so the callback route needs no
 * per-worker configuration.
 */

const WORKER_DISPATCH_TIMEOUT_MS = 15_000;

const ACTIVE_JOB_STATUSES = ["requested", "accepted", "running"] as const;

/**
 * How long the signed per-photo URLs in a v1.1 manifest stay valid. The
 * contract warns that imagery links "must remain valid long enough for the
 * platform's ingest cron to pull it"; six hours is that headroom. Operator
 * configuration, not a tier.
 */
const IMAGERY_URL_TTL_ENV = "OPENPLAN_AERIAL_IMAGERY_URL_TTL_SECONDS";
const IMAGERY_URL_TTL_DEFAULT_SECONDS = 21_600;

const WORKER_CONTRACT_ENV = "OPENPLAN_AERIAL_PROCESSING_WORKER_CONTRACT";
const WORKER_CONTRACT_VALUES = ["v1", "v1.1"] as const;
type WorkerContract = (typeof WORKER_CONTRACT_VALUES)[number];

function resolveWorkerContract(): WorkerContract | { invalid: string } {
  const raw = process.env[WORKER_CONTRACT_ENV]?.trim();
  if (!raw) return "v1";
  if ((WORKER_CONTRACT_VALUES as readonly string[]).includes(raw)) {
    return raw as WorkerContract;
  }
  return { invalid: raw };
}

function resolveImageryUrlTtlSeconds(): number {
  const raw = process.env[IMAGERY_URL_TTL_ENV]?.trim();
  if (!raw) return IMAGERY_URL_TTL_DEFAULT_SECONDS;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return IMAGERY_URL_TTL_DEFAULT_SECONDS;
  return parsed;
}

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

const imageryZipUrlSchema = z
  .string()
  .url()
  .refine(isAcceptableImageryUrl, {
    message: "imageryZipUrl must be an https URL (http allowed for localhost only)",
  });

// Contract v1: the worker takes exactly one shape, so the URL is required.
const processBodySchemaV1 = z.object({
  imageryZipUrl: imageryZipUrlSchema,
  imageCount: z.number().int().positive().optional(),
  sizeBytes: z.number().int().positive().optional(),
  presetId: z.enum(PROCESSING_PRESET_IDS).default("balanced"),
  notes: z.string().trim().max(2048).optional(),
});

// Contract v1.1: the mission's stored photos are the primary source, so the
// pasted URL is only the fallback and may be absent.
const processBodySchemaV11 = processBodySchemaV1.extend({
  imageryZipUrl: imageryZipUrlSchema.optional(),
});

type RouteContext = { params: Promise<{ missionId: string }> };

function resolveCallbackUrl(request: NextRequest): string {
  const configuredBase = process.env.OPENPLAN_AERIAL_PROCESSING_CALLBACK_URL?.trim();
  const base = (configuredBase || new URL(request.url).origin).replace(/\/+$/, "");
  return `${base}/api/aerial/processing-callback`;
}

type StoredImageryRow = {
  id: string;
  storage_bucket: string;
  storage_path: string;
  original_filename: string;
  byte_size: number | null;
  checksum_sha256: string | null;
};

/**
 * GET — what a dispatch from this deployment would do, so the request form can
 * say it truthfully instead of guessing. Answers which contract the configured
 * worker speaks and how many photos are stored on this mission.
 *
 * The stored-photo count degrades HONESTLY: a count that could not be read
 * (e.g. the aerial_imagery migration has not run here yet) is reported as
 * unavailable with the reason — never as zero, because "no photos" and "could
 * not look" require different sentences from the form.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("aerial-missions.odm-process-capability", request);

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
      .select("id, workspace_id")
      .eq("id", parsedParams.data.missionId)
      .maybeSingle();

    if (missionError) {
      audit.error("aerial_mission_load_failed", {
        missionId: parsedParams.data.missionId,
        message: missionError.message,
      });
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
      audit.error("membership_check_failed", {
        workspaceId: mission.workspace_id,
        message: membershipError.message,
      });
      return NextResponse.json({ error: "Failed to verify workspace access" }, { status: 500 });
    }
    if (!membership) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    const workerUrl = process.env.OPENPLAN_AERIAL_PROCESSING_WORKER_URL?.trim();
    const workerToken = process.env.OPENPLAN_AERIAL_PROCESSING_WORKER_TOKEN?.trim();
    const workerConfigured = Boolean(workerUrl && workerToken);

    const contract = resolveWorkerContract();
    const workerContract = typeof contract === "string" ? contract : null;

    let storedImagery:
      | { status: "counted"; count: number }
      | { status: "unavailable"; reason: string };

    const { count, error: imageryCountError } = await supabase
      .from("aerial_imagery")
      .select("id", { count: "exact", head: true })
      .eq("mission_id", mission.id);

    if (imageryCountError) {
      audit.warn("stored_imagery_count_unavailable", {
        missionId: mission.id,
        message: imageryCountError.message,
      });
      storedImagery = {
        status: "unavailable",
        reason:
          "The stored-photo count could not be read on this deployment, so the form cannot say whether this mission has stored imagery.",
      };
    } else {
      storedImagery = { status: "counted", count: count ?? 0 };
    }

    audit.info("aerial_processing_capability_read", {
      missionId: mission.id,
      userId: user.id,
      workerConfigured,
      workerContract,
    });

    return NextResponse.json({ workerConfigured, workerContract, storedImagery });
  } catch (error) {
    audit.error("aerial_processing_capability_unhandled_error", { error });
    return NextResponse.json(
      { error: "Unexpected error while reading processing capability" },
      { status: 500 }
    );
  }
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

    if (isReadOnlyWorkspaceRole((membership as { role?: string }).role)) {
      return NextResponse.json(
        { error: "Viewers have read-only access to this workspace" },
        { status: 403 }
      );
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

    const contract = resolveWorkerContract();
    if (typeof contract !== "string") {
      audit.error("worker_contract_misconfigured", { value: contract.invalid });
      return NextResponse.json(
        {
          error: "worker_contract_misconfigured",
          detail: `${WORKER_CONTRACT_ENV} is set to "${contract.invalid}", which is not a contract this deployment knows. Set it to "v1" (the external worker's pasted-ZIP contract, the default) or "v1.1" (stored-photo manifests), or unset it. Nothing was dispatched.`,
        },
        { status: 500 }
      );
    }

    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.smallJson);
    if (!payloadBody.ok) return payloadBody.response;

    const bodySchema = contract === "v1.1" ? processBodySchemaV11 : processBodySchemaV1;
    const parsedBody = bodySchema.safeParse(payloadBody.data);
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

    // Decide the imagery shape BEFORE writing anything, so a refusal leaves no
    // job row behind (and after the active-job check, so no signed links are
    // minted for a request that will be refused as a duplicate).
    let imageryInput: BuildProcessingRequestImageryInput;
    let jobImageryColumns: {
      imagery_url: string | null;
      imagery_image_count: number | null;
      imagery_size_bytes: number | null;
      imagery_type?: "photo_manifest";
    };

    if (contract === "v1.1") {
      const { data: storedRows, error: storedError } = await supabase
        .from("aerial_imagery")
        .select("id, storage_bucket, storage_path, original_filename, byte_size, checksum_sha256")
        .eq("mission_id", mission.id)
        .order("original_filename", { ascending: true });

      if (storedError) {
        // A failed read is not an empty mission. Refuse rather than silently
        // dispatching the fallback as though no photos existed.
        audit.error("stored_imagery_read_failed", {
          missionId: mission.id,
          message: storedError.message,
        });
        return NextResponse.json(
          {
            error: "stored_imagery_unreadable",
            detail:
              "This mission's stored photos could not be read, so nothing was dispatched. That is a read failure, not an empty mission — retry, and if it persists the deployment operator should check the aerial_imagery table.",
          },
          { status: 500 }
        );
      }

      const rows = (storedRows ?? []) as StoredImageryRow[];

      if (rows.length > 0) {
        const ttlSeconds = resolveImageryUrlTtlSeconds();
        const serviceClient = createServiceRoleClient();

        // Signing is pinned to the imagery bucket, exactly like the download
        // route: a row naming any other bucket is refused rather than signed.
        // Only service-role code writes these rows, so a foreign bucket here
        // means a compromised or buggy write path — the one case where
        // "trust the row" is the wrong posture for a credential mint.
        const foreignBucketRow = rows.find((row) => row.storage_bucket !== AERIAL_IMAGERY_BUCKET);
        if (foreignBucketRow) {
          audit.error("stored_imagery_foreign_bucket_refused", {
            missionId: mission.id,
            imageryId: foreignBucketRow.id,
            bucket: foreignBucketRow.storage_bucket,
          });
          return NextResponse.json(
            {
              error: "stored_imagery_unreadable",
              detail:
                "A stored photo record points outside the imagery store, so no processing request was sent. Whoever operates this deployment should check the aerial imagery records for this mission.",
            },
            { status: 500 }
          );
        }
        const byBucket = new Map<string, StoredImageryRow[]>([[AERIAL_IMAGERY_BUCKET, rows]]);

        const signedByPath = new Map<string, string>();
        for (const [bucket, group] of byBucket) {
          const { data: signed, error: signError } = await serviceClient.storage
            .from(bucket)
            .createSignedUrls(group.map((row) => row.storage_path), ttlSeconds);

          const failedEntry = signed?.find((entry) => entry.error || !entry.signedUrl);
          if (signError || !signed || signed.length !== group.length || failedEntry) {
            audit.error("stored_imagery_signing_failed", {
              missionId: mission.id,
              bucket,
              message: signError?.message ?? String(failedEntry?.error ?? "missing signed URL"),
            });
            return NextResponse.json(
              {
                error: "stored_imagery_unreadable",
                detail:
                  "Signed links for this mission's stored photos could not be minted, so nothing was dispatched.",
              },
              { status: 500 }
            );
          }
          signed.forEach((entry, index) => {
            // failedEntry above already refused any row without a signedUrl;
            // the cast records that, it does not assume it.
            signedByPath.set(group[index].storage_path, entry.signedUrl as string);
          });
        }

        const knownSizes = rows.map((row) => row.byte_size).filter(
          (value): value is number => typeof value === "number"
        );

        imageryInput = {
          type: "photo_manifest",
          photos: rows.map((row) => ({
            url: signedByPath.get(row.storage_path) as string,
            filename: row.original_filename,
            sizeBytes: row.byte_size,
            checksumSha256: row.checksum_sha256,
          })),
          totalSizeBytes:
            knownSizes.length === rows.length
              ? knownSizes.reduce((sum, value) => sum + value, 0)
              : null,
        };
        jobImageryColumns = {
          imagery_url: null,
          imagery_image_count: rows.length,
          imagery_size_bytes:
            knownSizes.length === rows.length
              ? knownSizes.reduce((sum, value) => sum + value, 0)
              : null,
          imagery_type: "photo_manifest",
        };
      } else if (body.imageryZipUrl) {
        // Fallback: no stored photos, but the planner pasted a ZIP link. A
        // zip_url request declares v1 even to a v1.1 worker — the contract's
        // versioning rule.
        imageryInput = {
          type: "zip_url",
          url: body.imageryZipUrl,
          imageCount: body.imageCount,
          sizeBytes: body.sizeBytes,
        };
        jobImageryColumns = {
          imagery_url: body.imageryZipUrl,
          imagery_image_count: body.imageCount ?? null,
          imagery_size_bytes: body.sizeBytes ?? null,
        };
      } else {
        return NextResponse.json(
          {
            error: "no_imagery_available",
            detail:
              "This mission has no stored photos and no imagery ZIP link was provided, so there is nothing to dispatch. Upload the mission's photos in the imagery panel, or paste a ZIP link the worker can fetch.",
          },
          { status: 422 }
        );
      }
    } else {
      // Contract v1 — the external worker's pasted-ZIP path, byte-identical to
      // what it has always received. The v1 body schema made the URL required.
      imageryInput = {
        type: "zip_url",
        url: body.imageryZipUrl as string,
        imageCount: body.imageCount,
        sizeBytes: body.sizeBytes,
      };
      jobImageryColumns = {
        imagery_url: body.imageryZipUrl as string,
        imagery_image_count: body.imageCount ?? null,
        imagery_size_bytes: body.sizeBytes ?? null,
      };
    }

    const requestId = crypto.randomUUID();
    const callbackUrl = resolveCallbackUrl(request);

    // aerial_processing_jobs is member-SELECT-only under RLS; the row writes
    // happen with the service role AFTER the explicit membership check above,
    // matching the callback route's posture.
    const jobsWriter = createServiceRoleClient();

    // Insert the job row BEFORE calling the worker so a crash between the
    // two steps cannot orphan an accepted worker job: the callback route
    // resolves mission/workspace from request_id via this row.
    //
    // `imagery_type` is only written for manifest jobs: zip rows rely on the
    // column's DB default, so the zip lane keeps working during the window
    // where this code is deployed but 20260811000004 has not run yet.
    const { data: jobRow, error: jobInsertError } = await jobsWriter
      .from("aerial_processing_jobs")
      .insert({
        workspace_id: mission.workspace_id,
        project_id: mission.project_id,
        mission_id: mission.id,
        request_id: requestId,
        status: "requested",
        preset_id: body.presetId,
        ...jobImageryColumns,
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
      imagery: imageryInput,
      presetId: body.presetId,
      notes: body.notes,
    });

    const markDispatchFailed = async (detail: string) => {
      const { error: failError } = await jobsWriter
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

    const { error: acceptUpdateError } = await jobsWriter
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
      imageryType: imageryInput.type,
      contract,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      {
        requestId,
        jobReference: accepted.jobReference,
        status: "accepted",
        imageryType: imageryInput.type,
      },
      { status: 202 }
    );
  } catch (error) {
    audit.error("aerial_mission_odm_unhandled_error", { error });
    return NextResponse.json({ error: "Unexpected error while handling ODM request" }, { status: 500 }
    );
  }
}
