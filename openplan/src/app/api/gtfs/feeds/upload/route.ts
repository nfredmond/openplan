import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { BODY_LIMITS, readBytesWithLimitStreaming } from "@/lib/http/body-limit";
import { classifyRouteReadFailure } from "@/lib/http/read-outcome";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { isReadOnlyWorkspaceRole } from "@/lib/auth/role-matrix";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { checkWorkspaceMembership } from "@/lib/workspaces/membership";
import { runGtfsIngest } from "@/lib/gtfs/ingest";

/**
 * A `.zip` A PLANNER WAS EMAILED, TURNED INTO SERVICE LEVELS.
 *
 * THE DOOR THAT HAS TO EXIST. A great many agencies — especially small ones,
 * which is most of them — do not publish a feed at a stable address and are not
 * in any catalog. Their GTFS arrives as an attachment from the person who
 * maintains it. A product that can only ingest what a national registry already
 * knows about is a product that works for large agencies and refuses the ones
 * with the least capacity, which is the opposite of the point.
 *
 * =========================================== WHY THE METADATA IS IN THE QUERY
 *
 * The BODY IS THE FILE, raw, so there is nowhere else for the metadata to go.
 * `multipart/form-data` is the obvious alternative and is worse here: parsing
 * it means calling the platform's multipart reader on the incoming request,
 * which materialises the whole 200 MiB body in memory before anything can look
 * at its size — exactly the read this lane's transport limit exists to prevent.
 * `body-limit-route-inventory.test.ts` forbids that spelling for that reason,
 * and it greps this file's source INCLUDING COMMENTS, so the method is
 * described here rather than named. The Knowledge Base upload made the same
 * choice for the same reason.
 *
 * ============================================ AUTHORIZE FIRST, READ SECOND
 *
 * The order below is load-bearing and is not the order that reads most
 * naturally. Membership and the writer-role gate are settled BEFORE a single
 * byte of the body is pulled, so an unauthenticated caller — or a viewer —
 * cannot make this deployment stream 200 MiB before being told no. Reading
 * first and checking after is how an upload endpoint becomes a free bandwidth
 * amplifier for anyone who knows the URL.
 *
 * =============================================== WHAT THE BUCKET WILL TAKE
 *
 * `gtfs-uploads` declares exactly three allowed mime types (20260219000006,
 * ceiling raised to 200 MiB by 20260805000006). A content type outside that set
 * is refused BY STORAGE, at the end of an upload, with a message a planner
 * cannot act on — so it is refused here instead, by name, before anything is
 * transferred. A `.zip` filename with a missing or unhelpful declared type is
 * accepted as `application/zip`, because a browser's guess is not the planner's
 * fault and the parser is the real arbiter of whether these bytes are a feed.
 */

export const runtime = "nodejs";
export const maxDuration = 300;

/** Exactly the `gtfs-uploads` bucket's `allowed_mime_types`. */
const ALLOWED_UPLOAD_CONTENT_TYPES = [
  "application/zip",
  "application/x-zip-compressed",
  "application/octet-stream",
] as const;

const uploadQuerySchema = z
  .object({
    workspaceId: z.string().uuid(),
    /** Add a version to a feed that already exists, instead of creating one. */
    feedId: z.string().uuid().optional(),
    filename: z.string().trim().min(1).max(255).optional(),
    /** What to call the feed until the parse names it. */
    label: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

/**
 * A name to show while the ingest runs, from what the planner actually gave us.
 *
 * Never a guess at an agency — see `provisionalFeedNameFromUrl`. A filename is
 * a fact about the file they chose; anything inferred from its contents is a
 * claim, and this runs before anything has been read.
 */
function provisionalNameFor(label: string | undefined, filename: string | undefined): string {
  if (label) return label;
  const base = (filename ?? "").split(/[\\/]/).pop() ?? "";
  const withoutExtension = base.replace(/\.[^.]+$/, "").trim();
  return withoutExtension || "Uploaded transit feed";
}

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("gtfs.feeds.upload", request);
  const startedAt = Date.now();

  try {
    const query = uploadQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams.entries())
    );
    if (!query.success) {
      return NextResponse.json(
        {
          error: "Invalid upload parameters",
          hint: "Supply workspaceId, and optionally feedId, filename and label, in the query string.",
        },
        { status: 400 }
      );
    }
    const { workspaceId } = query.data;

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
        return NextResponse.json(
          { error: "Failed to verify workspace membership" },
          { status: 500 }
        );
      }
      if (membership.kind === "schema_pending") {
        return NextResponse.json(
          {
            error: "Transit feed schema is not available yet",
            hint: "Apply the latest Supabase migrations before ingesting a feed.",
          },
          { status: 503 }
        );
      }
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }
    if (isReadOnlyWorkspaceRole(membership.role)) {
      return NextResponse.json(
        { error: "Viewers have read-only access to this workspace" },
        { status: 403 }
      );
    }

    const service = createServiceRoleClient();

    // A feed named in the request must belong to THIS workspace. The
    // `.eq("workspace_id", …)` is what makes a public preloaded feed
    // (workspace_id IS NULL) and another tenant's feed both answer 404 — never
    // 403, which would confirm the id exists.
    if (query.data.feedId) {
      const feedResult = await service
        .from("gtfs_feeds")
        .select("id")
        .eq("id", query.data.feedId)
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

    const declaredContentType = (request.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    const contentType = (ALLOWED_UPLOAD_CONTENT_TYPES as readonly string[]).includes(
      declaredContentType
    )
      ? declaredContentType
      : /\.zip$/i.test(query.data.filename ?? "")
        ? "application/zip"
        : null;

    if (!contentType) {
      return NextResponse.json(
        {
          error: "A GTFS feed is uploaded as a .zip archive",
          detail:
            `This request declared "${declaredContentType || "no content type"}". Send the archive ` +
            `with one of ${ALLOWED_UPLOAD_CONTENT_TYPES.join(", ")}, or name the file so it ends ` +
            "in .zip.",
        },
        { status: 415 }
      );
    }

    // STREAMING, not buffering. `readBytesWithLimit` calls `arrayBuffer()` and
    // compares the length afterwards, which at this limit is a 200 MiB
    // allocation anyone holding the URL can ask for repeatedly before a single
    // byte is validated. This one cancels the stream the moment the cap is
    // passed.
    const bodyRead = await readBytesWithLimitStreaming(request, BODY_LIMITS.gtfsFeedRaw);
    if (!bodyRead.ok) {
      audit.warn("gtfs_upload_body_too_large", {
        bytesRead: bodyRead.byteLength,
        maxBytes: BODY_LIMITS.gtfsFeedRaw,
      });
      return bodyRead.response;
    }
    if (bodyRead.byteLength === 0) {
      return NextResponse.json(
        { error: "The uploaded feed is empty", detail: "Nothing was received." },
        { status: 400 }
      );
    }

    const result = await runGtfsIngest({
      service,
      workspaceId,
      feedId: query.data.feedId ?? null,
      requestedBy: user.id,
      provisionalName: provisionalNameFor(query.data.label, query.data.filename),
      source: {
        kind: "upload",
        bytes: bodyRead.bytes,
        contentType,
        filename: query.data.filename ?? null,
      },
      onDiagnostic: (diagnostic) => audit.warn("gtfs_fetch_refusal_diagnostic", { diagnostic }),
    });

    if (!result.ok) {
      audit.warn("gtfs_feed_upload_failed", {
        workspaceId,
        feedId: result.feedId,
        versionId: result.versionId,
        code: result.code,
        byteSize: bodyRead.byteLength,
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
    audit.error("gtfs_feed_upload_unhandled_error", { error });
    return NextResponse.json(
      { error: "Unexpected error while ingesting the uploaded transit feed" },
      { status: 500 }
    );
  }
}
