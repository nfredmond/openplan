import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { BODY_LIMITS, readJsonWithLimit } from "@/lib/http/body-limit";
import { isReadOnlyWorkspaceRole } from "@/lib/auth/role-matrix";
import { AERIAL_IMAGERY_BUCKET, resolveAerialImageMaxBytes } from "@/lib/aerial/imagery";
import {
  aerialImageEmptyResponse,
  aerialImageTooLargeResponse,
  resolveAerialMissionAccess,
} from "@/lib/aerial/imagery-intake";
import { STAGED_UPLOAD_CONTENT_TYPE, stagedUploadPath } from "@/lib/files/staged-upload";
import { checkWorkspaceStorageRoom, workspaceStorageRefusal } from "@/lib/workspaces/storage-quota";

/**
 * Issue a signed upload URL for one mission photo, so the browser can put it in
 * private Storage without sending it through this function (KI-2026-10-12-017).
 *
 * The mission's own workspace, membership, the writer-role gate, the declared
 * size against the operator's ceiling and the workspace's storage room are all
 * settled before any URL exists. The URL writes exactly one new object under
 * `<workspace>/staged/<user>/` and cannot overwrite. `./complete` trusts none
 * of what was declared here. See `lib/files/staged-upload.ts`.
 */

export const runtime = "nodejs";

const paramsSchema = z.object({ missionId: z.string().uuid() });

const startSchema = z
  .object({
    filename: z.string().trim().min(1).max(255),
    /** The size the browser reports for the chosen file. */
    byteSize: z.number().int().nonnegative(),
    /** What the browser says the file is. Recorded nowhere: the bytes decide. */
    contentType: z.string().max(255).optional(),
  })
  .strict();

type RouteContext = { params: Promise<{ missionId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("aerial-imagery.upload.start", request);

  try {
    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid mission id" }, { status: 400 });
    }

    const read = await readJsonWithLimit(request, BODY_LIMITS.smallJson);
    if (!read.ok) return read.response;
    const parsed = startSchema.safeParse(read.data);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid upload request" }, { status: 400 });
    }
    const { byteSize } = parsed.data;

    const access = await resolveAerialMissionAccess(parsedParams.data.missionId, audit);
    if (!access.ok) return access.response;
    if (isReadOnlyWorkspaceRole(access.role)) {
      return NextResponse.json({ error: "Viewers have read-only access to this workspace" }, { status: 403 });
    }
    const { mission, userId } = access;

    if (byteSize === 0) return aerialImageEmptyResponse();

    // The same ceiling the body route enforces, checked before a URL exists.
    // The complete route measures the stored object again.
    const maxBytes = resolveAerialImageMaxBytes();
    if (byteSize > maxBytes) {
      audit.warn("aerial_image_too_large", { byteLength: byteSize, maxBytes, declared: true });
      return aerialImageTooLargeResponse(maxBytes);
    }

    const service = createServiceRoleClient();

    // The workspace's total, with the declared size, before any URL exists.
    // The complete route removes the staged object before it checks again.
    const room = await checkWorkspaceStorageRoom(service, mission.workspace_id, byteSize);
    if (room.status !== "room") {
      audit.warn("aerial_imagery_workspace_storage_refused", {
        missionId: mission.id,
        status: room.status,
        byteLength: byteSize,
        ...(room.status === "full" ? { usedBytes: room.usedBytes, quotaBytes: room.quotaBytes } : { detail: room.detail }),
      });
      return workspaceStorageRefusal(room);
    }

    const objectPath = stagedUploadPath(mission.workspace_id, userId, randomUUID());
    const signed = await service.storage
      .from(AERIAL_IMAGERY_BUCKET)
      .createSignedUploadUrl(objectPath, { upsert: false });
    if (signed.error || !signed.data?.signedUrl) {
      audit.error("aerial_imagery_upload_url_failed", { message: signed.error?.message ?? "no signed URL" });
      return NextResponse.json({ error: "Storage could not accept an upload right now" }, { status: 503 });
    }

    audit.info("aerial_imagery_upload_url_issued", { missionId: mission.id, userId, byteSize });
    return NextResponse.json({
      uploadUrl: signed.data.signedUrl,
      objectPath,
      contentType: STAGED_UPLOAD_CONTENT_TYPE,
    });
  } catch (error) {
    audit.error("aerial_imagery_upload_start_unhandled_error", { error });
    return NextResponse.json({ error: "Unexpected error while preparing the upload" }, { status: 500 });
  }
}
