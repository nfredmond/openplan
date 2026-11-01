import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import type { createApiAuditLogger } from "@/lib/observability/audit";
import {
  AERIAL_IMAGE_MAX_BYTES_ENV,
  AERIAL_IMAGERY_BUCKET,
  AERIAL_IMAGERY_COLUMNS,
  buildAerialImageryStoragePath,
  extractAerialImageExif,
  sniffImageFormat,
} from "@/lib/aerial/imagery";
import { checkWorkspaceStorageRoom, workspaceStorageRefusal } from "@/lib/workspaces/storage-quota";

/**
 * The two halves every aerial photo upload shares, whichever door the bytes
 * came through: `POST .../imagery` (the body) or `.../imagery/upload/complete`
 * (an object the browser staged in Storage). Both doors call the same access
 * check before they read anything and the same `storeAerialImage` after, so a
 * staged photo meets exactly the format sniff, checksum, dedupe, storage limit
 * and EXIF reading a body photo meets.
 */

type AuditLogger = ReturnType<typeof createApiAuditLogger>;
type ServiceClient = ReturnType<typeof createServiceRoleClient>;

export type AerialMissionRow = { id: string; workspace_id: string };

export type AerialMissionAccess =
  | { ok: true; mission: AerialMissionRow; userId: string; role: string | undefined }
  | { ok: false; response: NextResponse };

/**
 * Session -> mission -> membership against the MISSION'S OWN workspace, so an
 * imagery request can never ride a mission id from a workspace the caller
 * merely knows the uuid of.
 */
export async function resolveAerialMissionAccess(missionId: string, audit: AuditLogger): Promise<AerialMissionAccess> {
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
    mission: mission as AerialMissionRow,
    userId: user.id,
    role: (membership as { role?: string }).role,
  };
}

/** The per-file refusal, naming the setting an operator can raise. */
export function aerialImageTooLargeResponse(maxBytes: number): NextResponse {
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

export function aerialImageEmptyResponse(): NextResponse {
  return NextResponse.json({ error: "The uploaded photo is empty" }, { status: 400 });
}

/**
 * Validate, dedupe, store and record one photo whose bytes are already in
 * memory and already within the per-file ceiling.
 */
export async function storeAerialImage(input: {
  service: ServiceClient;
  mission: AerialMissionRow;
  userId: string;
  filename: string;
  bytes: Uint8Array;
  audit: AuditLogger;
  startedAt: number;
}): Promise<NextResponse> {
  const { service, mission, userId, filename, bytes, audit, startedAt } = input;

  if (bytes.byteLength === 0) return aerialImageEmptyResponse();

  // The BYTES decide the format, never the Content-Type header — cameras and
  // transfer tools mislabel routinely, and a mislabel must not lose data.
  const sniffed = sniffImageFormat(bytes);
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

  const checksum = createHash("sha256").update(bytes).digest("hex");

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

  // The workspace's total, after dedupe and before any byte reaches Storage.
  const room = await checkWorkspaceStorageRoom(service, mission.workspace_id, bytes.byteLength);
  if (room.status !== "room") {
    audit.warn("aerial_imagery_workspace_storage_refused", {
      missionId: mission.id,
      status: room.status,
      byteLength: bytes.byteLength,
      ...(room.status === "full" ? { usedBytes: room.usedBytes, quotaBytes: room.quotaBytes } : { detail: room.detail }),
    });
    return workspaceStorageRefusal(room);
  }

  const imageryId = randomUUID();
  const storagePath = buildAerialImageryStoragePath({
    workspaceId: mission.workspace_id,
    missionId: mission.id,
    imageryId,
    filename,
  });

  const { error: uploadError } = await service.storage
    .from(AERIAL_IMAGERY_BUCKET)
    .upload(storagePath, bytes, { contentType: sniffed.contentType, upsert: false });
  if (uploadError) {
    audit.error("aerial_imagery_storage_upload_failed", { message: uploadError.message });
    return NextResponse.json({ error: "Failed to store the photo" }, { status: 500 });
  }

  // EXIF is EVIDENCE: what the file said, or null because it said nothing.
  const exif = extractAerialImageExif(bytes);

  const { data: inserted, error: insertError } = await service
    .from("aerial_imagery")
    .insert({
      id: imageryId,
      workspace_id: mission.workspace_id,
      mission_id: mission.id,
      storage_bucket: AERIAL_IMAGERY_BUCKET,
      storage_path: storagePath,
      original_filename: filename,
      byte_size: bytes.byteLength,
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
    byteSize: bytes.byteLength,
    format: sniffed.format,
    hasLocation: exif.gpsLat !== null,
    hasCaptureInstant: exif.capturedAt !== null,
    durationMs: Date.now() - startedAt,
  });

  return NextResponse.json({ imagery: inserted, deduped: false }, { status: 201 });
}
