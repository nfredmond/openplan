/**
 * REGISTRY DISPOSITION — REFUSED as an assistant action, 2026-08-11, and
 * recorded executably in `src/test/refused-aerial-actions-stay-refused.test.ts`.
 *
 * Uploading mission imagery is a HUMAN CONSOLE WRITE, not a candidate for a
 * `propose_*` tool: the consequential content is megabytes of binary photo
 * evidence a model would author from OUTSIDE the system — the offline
 * comment-import refusal wearing wings, at 64 MiB per file instead of 4 MB —
 * and no approval sheet can render what a planner would be consenting to. The
 * photos are also the source evidence every processed output (orthomosaic,
 * DSM, point cloud) derives from, so a fabricated frame would sit invisibly
 * UNDER later deliverables. Every registered action's consequential payload is
 * an id verified against a workspace row or an enum; bytes are neither.
 */
import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { readBytesWithLimitStreaming } from "@/lib/http/body-limit";
import { isReadOnlyWorkspaceRole } from "@/lib/auth/role-matrix";
import {
  AERIAL_IMAGE_MAX_BYTES_ENV,
  AERIAL_IMAGERY_BUCKET,
  AERIAL_IMAGERY_COLUMNS,
  buildAerialImageryStoragePath,
  extractAerialImageExif,
  resolveAerialImageMaxBytes,
  sniffImageFormat,
} from "@/lib/aerial/imagery";

// Photos are streamed and hashed inline; allow more than the default budget.
export const runtime = "nodejs";
export const maxDuration = 60;

const paramsSchema = z.object({
  missionId: z.string().uuid(),
});

const uploadQuerySchema = z.object({
  filename: z.string().trim().min(1).max(255),
});

type RouteContext = { params: Promise<{ missionId: string }> };

type MissionRow = { id: string; workspace_id: string };

type AccessResult =
  | { ok: true; mission: MissionRow; userId: string; role: string | undefined }
  | { ok: false; response: NextResponse };

/**
 * The shared front half of both handlers: session -> mission -> membership
 * against the MISSION'S OWN workspace, so an imagery request can never ride a
 * mission id from a workspace the caller merely knows the uuid of.
 */
async function resolveMissionAccess(
  missionId: string,
  audit: ReturnType<typeof createApiAuditLogger>
): Promise<AccessResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const { data: mission, error: missionError } = await supabase
    .from("aerial_missions")
    .select("id, workspace_id")
    .eq("id", missionId)
    .maybeSingle();

  if (missionError) {
    audit.error("aerial_mission_load_failed", { missionId, message: missionError.message });
    return {
      ok: false,
      response: NextResponse.json({ error: "Failed to load mission" }, { status: 500 }),
    };
  }
  if (!mission) {
    return { ok: false, response: NextResponse.json({ error: "Mission not found" }, { status: 404 }) };
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
    return {
      ok: false,
      response: NextResponse.json({ error: "Failed to verify workspace access" }, { status: 500 }),
    };
  }
  if (!membership) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Workspace access denied" }, { status: 403 }),
    };
  }

  return {
    ok: true,
    mission: mission as MissionRow,
    userId: user.id,
    role: (membership as { role?: string }).role,
  };
}

export async function GET(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("aerial-imagery.list", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid mission id" }, { status: 400 });
    }

    const access = await resolveMissionAccess(parsedParams.data.missionId, audit);
    if (!access.ok) return access.response;

    // User client on purpose: the member SELECT policy is a second net under
    // the explicit membership check above.
    const supabase = await createClient();
    const { data: rows, error: listError } = await supabase
      .from("aerial_imagery")
      .select(AERIAL_IMAGERY_COLUMNS)
      .eq("mission_id", access.mission.id)
      .order("created_at", { ascending: true });

    if (listError) {
      // A failed read is a failure, never an empty photo list.
      audit.error("aerial_imagery_list_failed", {
        missionId: access.mission.id,
        message: listError.message,
      });
      return NextResponse.json({ error: "Failed to load mission imagery" }, { status: 500 });
    }

    audit.info("aerial_imagery_listed", {
      missionId: access.mission.id,
      userId: access.userId,
      count: rows?.length ?? 0,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ imagery: rows ?? [] });
  } catch (error) {
    audit.error("aerial_imagery_list_unhandled_error", { error, durationMs: Date.now() - startedAt });
    return NextResponse.json({ error: "Unexpected error while loading mission imagery" }, { status: 500 });
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("aerial-imagery.upload", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid mission id" }, { status: 400 });
    }

    const query = uploadQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams.entries())
    );
    if (!query.success) {
      return NextResponse.json(
        { error: "State the photo's filename in the `filename` query parameter." },
        { status: 400 }
      );
    }

    const access = await resolveMissionAccess(parsedParams.data.missionId, audit);
    if (!access.ok) return access.response;
    if (isReadOnlyWorkspaceRole(access.role)) {
      return NextResponse.json(
        { error: "Viewers have read-only access to this workspace" },
        { status: 403 }
      );
    }
    const { mission, userId } = access;

    // The ceiling is the operator's, resolved per request so raising the env
    // takes effect without a redeploy of anything but the process env.
    const maxBytes = resolveAerialImageMaxBytes();
    const bodyRead = await readBytesWithLimitStreaming(request, maxBytes);
    if (!bodyRead.ok) {
      audit.warn("aerial_image_too_large", { byteLength: bodyRead.byteLength, maxBytes });
      return NextResponse.json(
        {
          error:
            `This photo is larger than the ${Math.floor(maxBytes / (1024 * 1024))} MiB per-file ceiling of this ` +
            `deployment. Whoever operates it can raise ${AERIAL_IMAGE_MAX_BYTES_ENV} — OpenPlan itself is free ` +
            "and has no usage tiers.",
          maxBytes,
        },
        { status: 413 }
      );
    }
    if (bodyRead.byteLength === 0) {
      return NextResponse.json({ error: "The uploaded photo is empty" }, { status: 400 });
    }

    // The BYTES decide the format, never the Content-Type header — cameras and
    // transfer tools mislabel routinely, and a mislabel must not lose data.
    const sniffed = sniffImageFormat(bodyRead.bytes);
    if (!sniffed) {
      return NextResponse.json(
        {
          error:
            "This file is not a JPEG, PNG, or TIFF image, which are the formats photogrammetry processing " +
            "can read. Nothing was stored.",
        },
        { status: 415 }
      );
    }

    const checksum = createHash("sha256").update(bodyRead.bytes).digest("hex");
    const service = createServiceRoleClient();

    // Same bytes twice per mission is a no-op, not a copy: answer the existing
    // row. A failed probe is OBSERVED (it would silently turn dedupe off) but
    // does not refuse the upload — the unique constraint below is the backstop.
    const { data: existing, error: dedupeError } = await service
      .from("aerial_imagery")
      .select(AERIAL_IMAGERY_COLUMNS)
      .eq("mission_id", mission.id)
      .eq("checksum_sha256", checksum)
      .maybeSingle();
    if (dedupeError) {
      audit.warn("aerial_imagery_dedupe_probe_failed", { message: dedupeError.message });
    }
    if (existing) {
      audit.info("aerial_imagery_upload_deduped", {
        missionId: mission.id,
        userId,
        checksum,
        durationMs: Date.now() - startedAt,
      });
      return NextResponse.json({ imagery: existing, deduped: true }, { status: 200 });
    }

    const imageryId = randomUUID();
    const storagePath = buildAerialImageryStoragePath({
      workspaceId: mission.workspace_id,
      missionId: mission.id,
      imageryId,
      filename: query.data.filename,
    });

    const { error: uploadError } = await service.storage
      .from(AERIAL_IMAGERY_BUCKET)
      .upload(storagePath, bodyRead.bytes, { contentType: sniffed.contentType, upsert: false });
    if (uploadError) {
      audit.error("aerial_imagery_storage_upload_failed", { message: uploadError.message });
      return NextResponse.json({ error: "Failed to store the photo" }, { status: 500 });
    }

    // EXIF is EVIDENCE: what the file said, or null because it said nothing.
    const exif = extractAerialImageExif(bodyRead.bytes);

    const { data: inserted, error: insertError } = await service
      .from("aerial_imagery")
      .insert({
        id: imageryId,
        workspace_id: mission.workspace_id,
        mission_id: mission.id,
        storage_bucket: AERIAL_IMAGERY_BUCKET,
        storage_path: storagePath,
        original_filename: query.data.filename,
        byte_size: bodyRead.byteLength,
        checksum_sha256: checksum,
        content_type: sniffed.contentType,
        captured_at: exif.capturedAt,
        gps_lat: exif.gpsLat,
        gps_lon: exif.gpsLon,
        gps_altitude_m: exif.gpsAltitudeM,
        camera_make: exif.cameraMake,
        camera_model: exif.cameraModel,
        uploaded_by: userId,
      })
      .select(AERIAL_IMAGERY_COLUMNS)
      .single();

    if (insertError || !inserted) {
      // Never leave orphaned bytes claiming to be mission evidence.
      await service.storage
        .from(AERIAL_IMAGERY_BUCKET)
        .remove([storagePath])
        .catch(() => undefined);

      // A concurrent identical upload won the unique race: that is the dedupe
      // outcome arriving late, not a failure.
      if (insertError?.code === "23505") {
        const { data: winner, error: winnerError } = await service
          .from("aerial_imagery")
          .select(AERIAL_IMAGERY_COLUMNS)
          .eq("mission_id", mission.id)
          .eq("checksum_sha256", checksum)
          .maybeSingle();
        if (winnerError) {
          // Observed, then fall through to the honest 500: the upload did not
          // land AND the winning row could not be read back.
          audit.warn("aerial_imagery_race_readback_failed", { message: winnerError.message });
        }
        if (winner) {
          return NextResponse.json({ imagery: winner, deduped: true }, { status: 200 });
        }
      }

      audit.error("aerial_imagery_insert_failed", {
        missionId: mission.id,
        message: insertError?.message ?? "unknown",
        code: insertError?.code ?? null,
      });
      return NextResponse.json({ error: "Failed to record the photo" }, { status: 500 });
    }

    audit.info("aerial_imagery_uploaded", {
      missionId: mission.id,
      workspaceId: mission.workspace_id,
      userId,
      imageryId,
      byteSize: bodyRead.byteLength,
      format: sniffed.format,
      hasLocation: exif.gpsLat !== null,
      hasCaptureInstant: exif.capturedAt !== null,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ imagery: inserted, deduped: false }, { status: 201 });
  } catch (error) {
    audit.error("aerial_imagery_upload_unhandled_error", { error, durationMs: Date.now() - startedAt });
    return NextResponse.json({ error: "Unexpected error while storing the photo" }, { status: 500 });
  }
}
