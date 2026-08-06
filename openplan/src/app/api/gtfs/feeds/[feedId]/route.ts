import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { classifyRouteReadFailure } from "@/lib/http/read-outcome";
import { writeMatchedNoRows } from "@/lib/http/write-outcome";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { isReadOnlyWorkspaceRole } from "@/lib/auth/role-matrix";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { checkWorkspaceMembership } from "@/lib/workspaces/membership";
import { selectGtfsCaveats } from "@/lib/gtfs/caveats";
import { filterToCurrentReadyVersion, GTFS_UPLOADS_BUCKET } from "@/lib/gtfs/persist";
import {
  GTFS_FEED_COLUMNS,
  GTFS_FEED_VERSION_COLUMNS,
  GTFS_FEED_VERSION_TEARDOWN_COLUMNS,
  gtfsCaveatContextFromVersionRow,
} from "@/lib/gtfs/route-projections";

/**
 * ONE TRANSIT FEED: everything known about it, and how to remove it.
 *
 * ============================== A PUBLIC PRELOADED FEED IS NOT THIS WORKSPACE'S
 *
 * `gtfs_feeds.workspace_id IS NULL` marks a feed every tenant on the deployment
 * reads. 20260805000006 spells out the consequence and predicts that someone
 * will later "fix" the asymmetry it created: the read policy has a
 * `workspace_id IS NULL` branch and the UPDATE and DELETE policies deliberately
 * do NOT, because a public feed is readable by everyone and editable by nobody
 * through a client. Deleting one would take every version and every derived
 * service-level row with it by cascade — for every workspace on the deployment
 * at once.
 *
 * So DELETE here finds its target with `.eq("workspace_id", …)`, which no
 * public feed can satisfy. When that misses, a second read looks the feed up
 * AS A PUBLIC FEED and, if it is one, says so plainly. That second probe is not
 * an enumeration oracle: public feeds are world-readable to any signed-in user
 * by policy, so confirming one exists discloses nothing tenant-specific. A feed
 * belonging to ANOTHER WORKSPACE matches neither read and is reported as
 * absent — 404 and never 403, because 403 confirms the id.
 *
 * ==================================== WHAT A DELETE ACTUALLY DESTROYS, SAID
 *
 * The cascade from `gtfs_feeds` reaches `gtfs_feed_versions` and from there
 * both derived service-level tables. For a mid-size agency that is tens of
 * thousands of rows — the measured figure in `persist.ts` is 18,141 stop rows
 * from a single 2.7 MB feed — and none of it is recoverable without re-running
 * the ingest, which for an UPLOADED feed means finding the original `.zip`
 * again. The response therefore states the counts it removed rather than
 * answering `{ ok: true }`, and the objects in the private bucket are removed
 * BEFORE the rows that name them, because a row is the only thing that knows
 * where an object is.
 */

export const runtime = "nodejs";

const paramsSchema = z.object({ feedId: z.string().uuid() }).strict();
const querySchema = z.object({ workspaceId: z.string().uuid() }).strict();

function membershipResponse(kind: "schema_pending" | "not_member" | "error"): NextResponse {
  if (kind === "schema_pending") {
    return NextResponse.json(
      {
        error: "Transit feed schema is not available yet",
        hint: "Apply the latest Supabase migrations, then try again.",
      },
      { status: 503 }
    );
  }
  if (kind === "error") {
    return NextResponse.json({ error: "Failed to verify workspace membership" }, { status: 500 });
  }
  return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
}

export async function GET(request: NextRequest, context: { params: Promise<{ feedId: string }> }) {
  const audit = createApiAuditLogger("gtfs.feeds.detail", request);

  try {
    const routeParams = paramsSchema.safeParse(await context.params);
    if (!routeParams.success) {
      return NextResponse.json({ error: "Invalid feed id" }, { status: 400 });
    }
    const query = querySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams.entries())
    );
    if (!query.success) {
      return NextResponse.json({ error: "Invalid feed detail parameters" }, { status: 400 });
    }
    const { feedId } = routeParams.data;
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
      }
      return membershipResponse(membership.kind);
    }

    const feedResult = await supabase
      .from("gtfs_feeds")
      .select(GTFS_FEED_COLUMNS)
      .eq("id", feedId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    const feedFailure = classifyRouteReadFailure("the transit feed", feedResult, {
      pendingError: "Transit feed schema is not available yet",
      pendingHint: "Apply the latest Supabase migrations, then try again.",
    });
    if (feedFailure) {
      audit.error("gtfs_feed_read_failed", { message: feedFailure.message });
      return NextResponse.json(feedFailure.body, { status: feedFailure.status });
    }
    if (!feedResult.data) {
      return NextResponse.json({ error: "Transit feed not found" }, { status: 404 });
    }

    // THE ONE EXPRESSION OF "the version this workspace analyses with" — both
    // `is_current` and `status = 'ready'`, applied together, in the one place
    // the codebase states them.
    const currentResult = await filterToCurrentReadyVersion(
      supabase
        .from("gtfs_feed_versions")
        .select(GTFS_FEED_VERSION_COLUMNS)
        .eq("feed_id", feedId)
        .eq("workspace_id", workspaceId)
    ).maybeSingle();

    const currentFailure = classifyRouteReadFailure("the transit feed version", currentResult);
    if (currentFailure) {
      audit.error("gtfs_current_version_read_failed", { message: currentFailure.message });
      return NextResponse.json(currentFailure.body, { status: currentFailure.status });
    }

    const versionsResult = await supabase
      .from("gtfs_feed_versions")
      .select(GTFS_FEED_VERSION_COLUMNS)
      .eq("feed_id", feedId)
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(50);

    const versionsFailure = classifyRouteReadFailure("this feed's ingests", versionsResult);
    if (versionsFailure) {
      audit.error("gtfs_feed_versions_read_failed", { message: versionsFailure.message });
      return NextResponse.json(versionsFailure.body, { status: versionsFailure.status });
    }

    const currentVersion = currentResult.data as Record<string, unknown> | null;

    return NextResponse.json(
      {
        feed: feedResult.data,
        currentVersion,
        versions: versionsResult.data ?? [],
        // Empty when nothing has been adopted yet. A caveat list about a feed
        // that is not in use would qualify numbers nobody is looking at.
        caveats: currentVersion
          ? selectGtfsCaveats(gtfsCaveatContextFromVersionRow(currentVersion))
          : [],
      },
      { status: 200 }
    );
  } catch (error) {
    audit.error("gtfs_feed_detail_unhandled_error", { error });
    return NextResponse.json(
      { error: "Unexpected error while reading the transit feed" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ feedId: string }> }
) {
  const audit = createApiAuditLogger("gtfs.feeds.delete", request);

  try {
    const routeParams = paramsSchema.safeParse(await context.params);
    if (!routeParams.success) {
      return NextResponse.json({ error: "Invalid feed id" }, { status: 400 });
    }
    const query = querySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams.entries())
    );
    if (!query.success) {
      return NextResponse.json({ error: "Invalid feed delete parameters" }, { status: 400 });
    }
    const { feedId } = routeParams.data;
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
      }
      return membershipResponse(membership.kind);
    }
    if (isReadOnlyWorkspaceRole(membership.role)) {
      return NextResponse.json(
        { error: "Viewers have read-only access to this workspace" },
        { status: 403 }
      );
    }

    const service = createServiceRoleClient();

    const feedResult = await service
      .from("gtfs_feeds")
      .select("id, agency_name")
      .eq("id", feedId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    const feedFailure = classifyRouteReadFailure("the transit feed", feedResult);
    if (feedFailure) {
      audit.error("gtfs_feed_read_failed", { message: feedFailure.message });
      return NextResponse.json(feedFailure.body, { status: feedFailure.status });
    }

    if (!feedResult.data) {
      // Not this workspace's. Before answering 404, find out whether it is a
      // PUBLIC preloaded feed — one this member can read and must not destroy —
      // so the refusal explains itself instead of denying the feed exists.
      const publicResult = await service
        .from("gtfs_feeds")
        .select("id, agency_name")
        .eq("id", feedId)
        .is("workspace_id", null)
        .maybeSingle();

      const publicFailure = classifyRouteReadFailure("the transit feed", publicResult);
      if (publicFailure) {
        audit.error("gtfs_public_feed_read_failed", { message: publicFailure.message });
        return NextResponse.json(publicFailure.body, { status: publicFailure.status });
      }
      if (publicResult.data) {
        return NextResponse.json(
          {
            error: "This is a shared preloaded feed and cannot be removed by a workspace",
            detail:
              "Every workspace on this deployment reads this feed. Removing it here would delete " +
              "its service levels for all of them, so it is authored and removed by whoever " +
              "operates the deployment. Your workspace can ingest its own copy of the same " +
              "agency's feed instead.",
          },
          { status: 403 }
        );
      }
      return NextResponse.json({ error: "Transit feed not found" }, { status: 404 });
    }

    // What is about to be destroyed, read before it is gone. The counts come
    // off the version rows, which is where `writeParsedFeedVersion` recorded
    // what it actually wrote.
    const versionsResult = await service
      .from("gtfs_feed_versions")
      .select(GTFS_FEED_VERSION_TEARDOWN_COLUMNS)
      .eq("feed_id", feedId)
      .eq("workspace_id", workspaceId)
      .limit(500);

    const versionsFailure = classifyRouteReadFailure("this feed's ingests", versionsResult);
    if (versionsFailure) {
      audit.error("gtfs_feed_versions_read_failed", { message: versionsFailure.message });
      return NextResponse.json(versionsFailure.body, { status: versionsFailure.status });
    }

    const versions = (versionsResult.data ?? []) as unknown as Array<{
      id: string;
      storage_path: string | null;
      route_service_level_rows: number | null;
      stop_service_level_rows: number | null;
    }>;

    const storagePaths = versions
      .map((version) => version.storage_path)
      .filter((path): path is string => typeof path === "string" && path.length > 0);
    const routeServiceLevelRows = versions.reduce(
      (total, version) => total + (version.route_service_level_rows ?? 0),
      0
    );
    const stopServiceLevelRows = versions.reduce(
      (total, version) => total + (version.stop_service_level_rows ?? 0),
      0
    );

    // OBJECTS FIRST. Deleting the rows first would erase the only record of
    // where the objects are, leaving them in a private bucket with nothing able
    // to find them again. A failure here is reported and does NOT stop the
    // delete: an orphaned object is housekeeping, while a feed a planner asked
    // to remove and which is still there is a broken promise.
    let storageObjectsRemoved = 0;
    if (storagePaths.length > 0) {
      const removed = await service.storage.from(GTFS_UPLOADS_BUCKET).remove(storagePaths);
      if (removed.error) {
        audit.warn("gtfs_feed_objects_not_removed", {
          feedId,
          objects: storagePaths.length,
          message: removed.error.message,
        });
      } else {
        storageObjectsRemoved = removed.data?.length ?? storagePaths.length;
      }
    }

    const deleted = await service
      .from("gtfs_feeds")
      .delete()
      .eq("id", feedId)
      .eq("workspace_id", workspaceId)
      .select("id")
      .maybeSingle();

    if (deleted.error) {
      audit.error("gtfs_feed_delete_failed", { feedId, message: deleted.error.message });
      return NextResponse.json({ error: "Failed to remove the transit feed" }, { status: 500 });
    }
    if (writeMatchedNoRows(deleted)) {
      // The row was read a moment ago through this same service client, so zero
      // matched rows means it went away underneath this request — not that the
      // caller was refused.
      return NextResponse.json(
        {
          error: "Transit feed not found",
          detail: "It was removed while this request was in flight.",
        },
        { status: 404 }
      );
    }

    audit.info("gtfs_feed_deleted", {
      workspaceId,
      feedId,
      versionsDeleted: versions.length,
      routeServiceLevelRows,
      stopServiceLevelRows,
      storageObjectsRemoved,
    });

    return NextResponse.json(
      {
        deleted: true,
        feedId,
        versionsDeleted: versions.length,
        routeServiceLevelRows,
        stopServiceLevelRows,
        storageObjectsRemoved,
        detail:
          `Removed this feed and all ${versions.length} of its ingests, together with the ` +
          `${routeServiceLevelRows} route and ${stopServiceLevelRows} stop service-level rows ` +
          "derived from them. Those service levels are gone — anything that read this feed's " +
          "frequencies now has nothing to read. Bringing the feed back means ingesting it again.",
      },
      { status: 200 }
    );
  } catch (error) {
    audit.error("gtfs_feed_delete_unhandled_error", { error });
    return NextResponse.json(
      { error: "Unexpected error while removing the transit feed" },
      { status: 500 }
    );
  }
}
