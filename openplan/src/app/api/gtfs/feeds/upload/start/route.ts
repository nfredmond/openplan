import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { BODY_LIMITS, readJsonWithLimit } from "@/lib/http/body-limit";
import { classifyRouteReadFailure } from "@/lib/http/read-outcome";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { isReadOnlyWorkspaceRole } from "@/lib/auth/role-matrix";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { checkWorkspaceMembership } from "@/lib/workspaces/membership";
import { managedGtfsEnabled } from "@/lib/gtfs/managed-route";
import { GTFS_UPLOADS_BUCKET } from "@/lib/gtfs/persist";
import { resolveGtfsUploadContentType, stagedGtfsUploadPath } from "@/lib/gtfs/staged-upload";
import { checkWorkspaceStorageRoom, workspaceStorageRefusal } from "@/lib/workspaces/storage-quota";

/**
 * Issue a signed upload URL for one GTFS ZIP, so the browser can put the file
 * in private Storage without sending it through this function.
 *
 * Membership, the writer-role gate, the declared size and the feed's workspace
 * are all settled before any URL exists. The URL writes exactly one new object
 * under `<workspace>/staged/<user>/` and cannot overwrite. Storage sets its
 * lifetime (two hours for signed upload URLs). See `lib/gtfs/staged-upload.ts`.
 */

export const runtime = "nodejs";

const startSchema = z
  .object({
    workspaceId: z.string().uuid(),
    /** Add a version to a feed that already exists, instead of creating one. */
    feedId: z.string().uuid().optional(),
    filename: z.string().trim().min(1).max(255),
    /** The size the browser reports for the chosen file. */
    byteSize: z.number().int().positive(),
    contentType: z.string().max(255).optional(),
  })
  .strict();

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("gtfs.feeds.upload.start", request);

  try {
    const read = await readJsonWithLimit(request, BODY_LIMITS.smallJson);
    if (!read.ok) return read.response;
    const parsed = startSchema.safeParse(read.data);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid upload request" }, { status: 400 });
    }
    const { workspaceId, feedId, filename, byteSize } = parsed.data;

    if (managedGtfsEnabled()) {
      return NextResponse.json(
        { error: "This installation receives transit archives through its retained import." },
        { status: 409 }
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const membership = await checkWorkspaceMembership(supabase, user.id, workspaceId);
    if (!membership.ok) {
      if (membership.kind === "error") {
        audit.error("membership_lookup_failed", { message: membership.message });
        return NextResponse.json({ error: "Failed to verify workspace membership" }, { status: 500 });
      }
      if (membership.kind === "schema_pending") {
        return NextResponse.json(
          { error: "Transit feed schema is not available yet", hint: "Apply the latest Supabase migrations." },
          { status: 503 }
        );
      }
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }
    if (isReadOnlyWorkspaceRole(membership.role)) {
      return NextResponse.json({ error: "Viewers have read-only access to this workspace" }, { status: 403 });
    }

    // The same ceiling the body route enforces, checked before a URL exists.
    // The complete route measures the stored object again; this number is only
    // what the browser claimed.
    if (byteSize > BODY_LIMITS.gtfsFeedRaw) {
      return NextResponse.json(
        { error: "That archive is larger than this deployment accepts", maxBytes: BODY_LIMITS.gtfsFeedRaw },
        { status: 413 }
      );
    }

    const contentType = resolveGtfsUploadContentType(parsed.data.contentType, filename);
    if (!contentType) {
      return NextResponse.json({ error: "A GTFS feed is uploaded as a .zip archive" }, { status: 415 });
    }

    const service = createServiceRoleClient();

    // The service role bypasses RLS, so this filter is the whole check that the
    // feed belongs to THIS workspace. A public or foreign feed answers 404.
    if (feedId) {
      const feedResult = await service
        .from("gtfs_feeds")
        .select("id")
        .eq("id", feedId)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      const feedFailure = classifyRouteReadFailure("the transit feed", feedResult);
      if (feedFailure) {
        audit.error("gtfs_feed_read_failed", { message: feedFailure.message });
        return NextResponse.json(feedFailure.body, { status: feedFailure.status });
      }
      if (!feedResult.data) {
        return NextResponse.json({ error: "Transit feed not found" }, { status: 404 });
      }
    }

    // The workspace's total, checked with the declared size before any URL
    // exists. The complete route removes the staged object before ingesting,
    // so the archive is never counted twice.
    const room = await checkWorkspaceStorageRoom(service, workspaceId, byteSize);
    if (room.status !== "room") {
      audit.warn("gtfs_upload_workspace_storage_refused", {
        workspaceId,
        status: room.status,
        byteSize,
        ...(room.status === "full" ? { usedBytes: room.usedBytes, quotaBytes: room.quotaBytes } : { detail: room.detail }),
      });
      return workspaceStorageRefusal(room);
    }

    const objectPath = stagedGtfsUploadPath(workspaceId, user.id, randomUUID());
    const signed = await service.storage
      .from(GTFS_UPLOADS_BUCKET)
      .createSignedUploadUrl(objectPath, { upsert: false });
    if (signed.error || !signed.data?.signedUrl) {
      audit.error("gtfs_upload_url_failed", { message: signed.error?.message ?? "no signed URL" });
      return NextResponse.json({ error: "Storage could not accept an upload right now" }, { status: 503 });
    }

    audit.info("gtfs_upload_url_issued", { workspaceId, feedId: feedId ?? null, byteSize });
    return NextResponse.json({ uploadUrl: signed.data.signedUrl, objectPath, contentType });
  } catch (error) {
    audit.error("gtfs_upload_start_unhandled_error", { error });
    return NextResponse.json({ error: "Unexpected error while preparing the upload" }, { status: 500 });
  }
}
