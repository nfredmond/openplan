import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { BODY_LIMITS, readJsonWithLimit } from "@/lib/http/body-limit";
import { classifyRouteReadFailure } from "@/lib/http/read-outcome";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { isReadOnlyWorkspaceRole } from "@/lib/auth/role-matrix";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { checkWorkspaceMembership } from "@/lib/workspaces/membership";
import { runGtfsIngest } from "@/lib/gtfs/ingest";
import { managedGtfsEnabled } from "@/lib/gtfs/managed-route";
import {
  isOwnStagedGtfsUploadPath,
  provisionalUploadedFeedName,
  readStagedGtfsUpload,
  removeStagedGtfsUpload,
} from "@/lib/gtfs/staged-upload";

/**
 * Ingest a GTFS ZIP the browser already put in private Storage.
 *
 * The staged path must belong to this user in this workspace, and the stored
 * object must be the size declared when its URL was issued. Only then does the
 * route run the same `runGtfsIngest` as `POST /api/gtfs/feeds/upload`, which
 * stores its own copy under the version's path and records the checksum. The
 * staged object is removed once read, so one upload is ingested once.
 *
 * The 300-second function limit still bounds parsing. Reading the archive from
 * Storage moves the transfer out of the request body; it does not make a very
 * large feed parse faster.
 */

export const runtime = "nodejs";
export const maxDuration = 300;

const completeSchema = z
  .object({
    workspaceId: z.string().uuid(),
    objectPath: z.string().min(1).max(512),
    /** The size declared when the upload URL was issued. */
    byteSize: z.number().int().positive(),
    feedId: z.string().uuid().optional(),
    filename: z.string().trim().min(1).max(255).optional(),
    /** What to call the feed until the parse names it. */
    label: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("gtfs.feeds.upload.complete", request);
  const startedAt = Date.now();

  try {
    const read = await readJsonWithLimit(request, BODY_LIMITS.smallJson);
    if (!read.ok) return read.response;
    const parsed = completeSchema.safeParse(read.data);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid upload request" }, { status: 400 });
    }
    const { workspaceId, objectPath, byteSize, feedId } = parsed.data;

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

    // Before any Storage read: the path must be one this user staged in this
    // workspace. Nothing else in the bucket can be named here.
    if (!isOwnStagedGtfsUploadPath(objectPath, workspaceId, user.id)) {
      return NextResponse.json({ error: "Upload not found" }, { status: 404 });
    }

    const service = createServiceRoleClient();

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

    const stored = await readStagedGtfsUpload(service, objectPath, BODY_LIMITS.gtfsFeedRaw);
    if (stored.status === "missing") {
      return NextResponse.json(
        { error: "The archive did not reach storage", detail: "Upload the file again." },
        { status: 409 }
      );
    }
    if (stored.status === "unavailable") {
      audit.error("gtfs_staged_read_failed", { message: stored.message });
      return NextResponse.json({ error: "Storage could not be read right now" }, { status: 503 });
    }
    if (stored.status === "too_large") {
      await removeStagedGtfsUpload(service, objectPath);
      audit.warn("gtfs_staged_upload_too_large", { bytesRead: stored.bytesRead });
      return NextResponse.json(
        { error: "That archive is larger than this deployment accepts", maxBytes: BODY_LIMITS.gtfsFeedRaw },
        { status: 413 }
      );
    }
    if (stored.bytes.byteLength !== byteSize) {
      await removeStagedGtfsUpload(service, objectPath);
      audit.warn("gtfs_staged_upload_size_mismatch", { declared: byteSize, stored: stored.bytes.byteLength });
      return NextResponse.json(
        { error: "The stored archive is not the file that was chosen", detail: "Upload the file again." },
        { status: 409 }
      );
    }

    // Consumed once. A repeated complete call finds nothing and answers 409
    // instead of ingesting the same file twice.
    if (!(await removeStagedGtfsUpload(service, objectPath))) {
      audit.warn("gtfs_staged_upload_not_removed", { workspaceId });
    }

    const result = await runGtfsIngest({
      service,
      workspaceId,
      feedId: feedId ?? null,
      requestedBy: user.id,
      provisionalName: provisionalUploadedFeedName(parsed.data.label, parsed.data.filename),
      source: {
        kind: "upload",
        bytes: stored.bytes,
        // The bucket accepts this type, and the parser decides whether the
        // bytes are a feed, as on the catalog and URL doors.
        contentType: "application/zip",
        filename: parsed.data.filename ?? null,
      },
      onDiagnostic: (diagnostic) => audit.warn("gtfs_fetch_refusal_diagnostic", { diagnostic }),
    });

    if (!result.ok) {
      audit.warn("gtfs_feed_upload_failed", {
        workspaceId,
        feedId: result.feedId,
        versionId: result.versionId,
        code: result.code,
        byteSize,
        durationMs: Date.now() - startedAt,
      });
      return NextResponse.json(
        {
          error: "This transit feed could not be ingested",
          code: result.code,
          detail: result.detail,
          feedId: result.feedId,
          versionId: result.versionId,
        },
        { status: result.status }
      );
    }

    audit.info("gtfs_feed_uploaded", {
      workspaceId,
      feedId: result.feedId,
      versionId: result.versionId,
      createdFeed: result.createdFeed,
      adopted: result.adoption.adopted,
      routeRows: result.routeServiceLevelRows,
      stopRows: result.stopServiceLevelRows,
      byteSize: result.byteSize,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      {
        feedId: result.feedId,
        versionId: result.versionId,
        createdFeed: result.createdFeed,
        adoption: result.adoption,
        displayName: result.displayName,
        routeServiceLevelRows: result.routeServiceLevelRows,
        stopServiceLevelRows: result.stopServiceLevelRows,
        droppedForMissingCoordinates: result.droppedForMissingCoordinates,
        warnings: result.warnings,
        caveats: result.caveats,
        checksumSha256: result.checksumSha256,
        byteSize: result.byteSize,
      },
      { status: result.createdFeed ? 201 : 200 }
    );
  } catch (error) {
    audit.error("gtfs_feed_upload_complete_unhandled_error", { error });
    return NextResponse.json(
      { error: "Unexpected error while ingesting the uploaded transit feed" },
      { status: 500 }
    );
  }
}
