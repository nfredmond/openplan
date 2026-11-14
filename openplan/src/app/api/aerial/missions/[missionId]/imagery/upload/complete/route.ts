import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { BODY_LIMITS, readJsonWithLimit } from "@/lib/http/body-limit";
import { isReadOnlyWorkspaceRole } from "@/lib/auth/role-matrix";
import { AERIAL_IMAGERY_BUCKET, resolveAerialImageMaxBytes } from "@/lib/aerial/imagery";
import {
  aerialImageTooLargeResponse,
  resolveAerialMissionAccess,
  storeAerialImage,
} from "@/lib/aerial/imagery-intake";
import { consumeStagedUpload, isOwnStagedUploadPath } from "@/lib/files/staged-upload";

/**
 * Store a mission photo the browser already put in private Storage.
 *
 * The staged path must belong to this user in the mission's own workspace.
 * The stored object is read back against the operator's ceiling, compared with
 * the size declared when its URL was issued, and removed. Only then do the
 * bytes meet `storeAerialImage`, the same format sniff, checksum, dedupe,
 * storage limit, EXIF reading and write that `POST .../imagery` runs.
 */

export const runtime = "nodejs";
// Reading the staged copy back and writing the stored copy both move the
// whole photo; give a 64 MiB frame room on a slow Storage day.
export const maxDuration = 300;

const paramsSchema = z.object({ missionId: z.string().uuid() });

const completeSchema = z
  .object({
    objectPath: z.string().min(1).max(512),
    /** The size declared when the upload URL was issued. */
    byteSize: z.number().int().positive(),
    filename: z.string().trim().min(1).max(255),
    contentType: z.string().max(255).optional(),
  })
  .strict();

type RouteContext = { params: Promise<{ missionId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("aerial-imagery.upload.complete", request);
  const startedAt = Date.now();

  try {
    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid mission id" }, { status: 400 });
    }

    const read = await readJsonWithLimit(request, BODY_LIMITS.smallJson);
    if (!read.ok) return read.response;
    const parsed = completeSchema.safeParse(read.data);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid upload request" }, { status: 400 });
    }
    const { objectPath, byteSize, filename } = parsed.data;

    const access = await resolveAerialMissionAccess(parsedParams.data.missionId, audit);
    if (!access.ok) return access.response;
    if (isReadOnlyWorkspaceRole(access.role)) {
      return NextResponse.json({ error: "Viewers have read-only access to this workspace" }, { status: 403 });
    }
    const { mission, userId } = access;

    // Before any Storage read: the path must be one this user staged in the
    // mission's workspace. Nothing else in the bucket can be named here.
    if (!isOwnStagedUploadPath(objectPath, mission.workspace_id, userId)) {
      return NextResponse.json({ error: "Upload not found" }, { status: 404 });
    }

    const service = createServiceRoleClient();
    const maxBytes = resolveAerialImageMaxBytes();
    const staged = await consumeStagedUpload(service, AERIAL_IMAGERY_BUCKET, objectPath, {
      maxBytes,
      declaredBytes: byteSize,
    });
    if (staged.status === "missing") {
      return NextResponse.json(
        { error: "The photo did not reach storage", detail: "Upload the file again." },
        { status: 409 }
      );
    }
    if (staged.status === "unavailable") {
      audit.error("aerial_imagery_staged_read_failed", { message: staged.message });
      return NextResponse.json({ error: "Storage could not be read right now" }, { status: 503 });
    }
    if (!staged.removed) {
      audit.warn("aerial_imagery_staged_upload_not_removed", { missionId: mission.id, status: staged.status });
    }
    if (staged.status === "too_large") {
      audit.warn("aerial_image_too_large", { byteLength: staged.bytesRead, maxBytes, staged: true });
      return aerialImageTooLargeResponse(maxBytes);
    }
    if (staged.status === "size_mismatch") {
      audit.warn("aerial_imagery_staged_size_mismatch", {
        declared: staged.declaredBytes,
        stored: staged.storedBytes,
      });
      return NextResponse.json(
        { error: "The stored photo is not the file that was chosen", detail: "Upload the file again." },
        { status: 409 }
      );
    }

    return await storeAerialImage({
      service,
      mission,
      userId,
      filename,
      bytes: staged.bytes,
      audit,
      startedAt,
    });
  } catch (error) {
    audit.error("aerial_imagery_upload_complete_unhandled_error", { error, durationMs: Date.now() - startedAt });
    return NextResponse.json({ error: "Unexpected error while storing the photo" }, { status: 500 });
  }
}
