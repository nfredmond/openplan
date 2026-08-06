import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { classifyRouteReadFailure } from "@/lib/http/read-outcome";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { isReadOnlyWorkspaceRole } from "@/lib/auth/role-matrix";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { checkWorkspaceMembership } from "@/lib/workspaces/membership";
import { resolveGtfsCatalogRedirect } from "@/lib/gtfs/catalog";
import { runGtfsIngest } from "@/lib/gtfs/ingest";
import { GTFS_FEED_REFRESH_SOURCE_COLUMNS } from "@/lib/gtfs/route-projections";

/**
 * FETCH THIS FEED AGAIN, FROM WHERE THE DATABASE SAYS IT CAME FROM.
 *
 * ===================================== THE ADDRESS COMES OFF THE STORED ROW
 *
 * The request carries a workspace id and, at most, one boolean. It carries NO
 * URL and no catalog id. That is the rule this route exists to hold: a refresh
 * re-fetches the source the feed was REGISTERED with, so the provenance columns
 * on every version keep meaning what they say. Accepting an address here would
 * let a caller repoint an established feed at anything they liked while every
 * derived row, every citation and every "last refreshed" timestamp continued to
 * carry the original agency's name. `GTFS_FEED_REFRESH_SOURCE_COLUMNS` is the
 * mechanism rather than the intention: the route holds only the columns it read
 * out of the database, so there is no address from the caller for it to prefer.
 *
 * A CATALOG FEED IS RE-RESOLVED THROUGH THE CATALOG'S OWN REDIRECTS, not
 * re-fetched from the address stored last time. Agencies republish under new
 * ids and the old row is marked `deprecated` with `redirect.id` naming the
 * successor — 244 US rows were in that state when this lane was written. A
 * refresh that used the stored URL would keep downloading a frozen mirror of a
 * schedule that no longer runs, indefinitely, and nothing on screen would say
 * so.
 *
 * ================================ A WITHHELD REFETCH IS A 200, NOT AN ERROR
 *
 * `promoteGtfsFeedVersion` declines to adopt a refetch that is materially
 * smaller than the feed in use — 20% fewer routes or stops — because a drop
 * that size is as likely to be a truncated download as a real service cut, and
 * adopting it would move every number that reads transit service with nothing
 * on screen changing. When that happens the refetch SUCCEEDED: it was
 * downloaded, parsed, stored and marked `ready`, and a human was simply not
 * asked to accept it yet. Answering 4xx would tell a planner their agency's
 * feed is broken. The response is 200 with the assessment — both counts, so
 * nobody has to trust a verdict — and `adoptDespiteCollapse` is how a person
 * who has read it says yes.
 *
 * THAT FLAG MUST NEVER BECOME REACHABLE BY AN ASSISTANT ACTION. An agent
 * optimising for "the refresh completed" would set it every time, which is
 * exactly the incentive the collapse rule exists to defeat. If a
 * `refresh_gtfs_feed` action is ever registered, this endpoint is WIDER than
 * that action and must use `refuseOutOfScopeAgentRequest` — the approval hash
 * covers the action the route rebuilds, not the request body, so a body
 * carrying the action's fields plus this one hashes identically to what the
 * planner approved.
 */

export const runtime = "nodejs";
export const maxDuration = 300;

const paramsSchema = z.object({ feedId: z.string().uuid() }).strict();

const refreshBodySchema = z
  .object({
    workspaceId: z.string().uuid(),
    /** See the header. A person who was shown the collapse assessment said yes. */
    adoptDespiteCollapse: z.boolean().optional(),
  })
  .strict();

type StoredFeedSource = {
  id: string;
  workspace_id: string | null;
  agency_name: string;
  source_kind: string | null;
  feed_url: string | null;
  catalog_provider: string | null;
  catalog_source_id: string | null;
};

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

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ feedId: string }> }
) {
  const audit = createApiAuditLogger("gtfs.feeds.refresh", request);
  const startedAt = Date.now();

  try {
    const routeParams = paramsSchema.safeParse(await context.params);
    if (!routeParams.success) {
      return NextResponse.json({ error: "Invalid feed id" }, { status: 400 });
    }

    const bodyRead = await readJsonOrNullWithLimit(request, BODY_LIMITS.smallJson);
    if (!bodyRead.ok) return bodyRead.response;
    const payload = refreshBodySchema.safeParse(bodyRead.data);
    if (!payload.success) {
      return NextResponse.json(
        {
          error: "Invalid refresh payload",
          hint: "Send { workspaceId } and, only when a person has accepted a smaller refetch, adoptDespiteCollapse.",
        },
        { status: 400 }
      );
    }
    const { feedId } = routeParams.data;
    const { workspaceId } = payload.data;

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
      .select(GTFS_FEED_REFRESH_SOURCE_COLUMNS)
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
      // A PUBLIC preloaded feed is readable by every signed-in user and
      // refreshable by none of them: a refresh writes a new version and can
      // move `current_version_id`, which would change what every other tenant
      // on this deployment analyses with. Naming it discloses nothing that
      // policy does not already make world-readable.
      const publicResult = await service
        .from("gtfs_feeds")
        .select("id")
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
            error: "This is a shared preloaded feed and cannot be refreshed by a workspace",
            detail:
              "Every workspace on this deployment analyses with this feed, so it is refreshed by " +
              "whoever operates the deployment. Your workspace can ingest its own copy of the " +
              "same agency's feed instead.",
          },
          { status: 403 }
        );
      }
      return NextResponse.json({ error: "Transit feed not found" }, { status: 404 });
    }

    const feed = feedResult.data as unknown as StoredFeedSource;

    if (feed.source_kind === "upload") {
      return NextResponse.json(
        {
          error: "An uploaded feed cannot be refreshed",
          detail:
            "This feed was ingested from a file, so there is no address to fetch it from again. " +
            "Upload the agency's newer archive to this feed instead — the upload door takes a " +
            "feedId and adds a version to the feed named here rather than registering a second " +
            "one for the same agency.",
        },
        { status: 422 }
      );
    }

    /* ------------------------------------------------------------------ */
    /* Where to fetch from, decided entirely from the stored row           */
    /* ------------------------------------------------------------------ */

    let downloadUrl: string | null = null;
    let catalogProvider: string | null = null;
    let catalogSourceId: string | null = null;
    let catalogRowStatus: string | null = null;
    let supersededIds: string[] = [];

    if (feed.catalog_source_id) {
      const resolved = await resolveGtfsCatalogRedirect(feed.catalog_source_id);

      if (resolved.status === "catalog_unavailable") {
        audit.warn("gtfs_catalog_unavailable", {
          code: resolved.code,
          detail: resolved.detail,
          ...(resolved.diagnostic ? { diagnostic: resolved.diagnostic } : {}),
        });
        return NextResponse.json(
          { error: "The transit feed catalog could not be read", detail: resolved.detail },
          { status: 503 }
        );
      }
      if (resolved.status === "refused") {
        return NextResponse.json(
          {
            error: "This feed's catalog entry can no longer be fetched",
            reason: resolved.reason,
            detail: resolved.detail,
            supersededIds: resolved.supersededIds,
          },
          { status: 422 }
        );
      }

      downloadUrl = resolved.entry.downloadUrl;
      catalogProvider = resolved.entry.provider;
      catalogSourceId = resolved.entry.catalogId;
      catalogRowStatus = resolved.entry.status;
      supersededIds = resolved.supersededIds;
    } else {
      downloadUrl = feed.feed_url;
    }

    if (!downloadUrl) {
      return NextResponse.json(
        {
          error: "This feed has no address to refresh from",
          detail:
            "No download address was recorded for this feed, so there is nothing to fetch again. " +
            "Register the agency's feed URL, or upload their archive.",
        },
        { status: 422 }
      );
    }

    const result = await runGtfsIngest({
      service,
      workspaceId,
      feedId: feed.id,
      requestedBy: user.id,
      provisionalName: feed.agency_name,
      adoptDespiteCollapse: payload.data.adoptDespiteCollapse,
      source: catalogSourceId
        ? { kind: "catalog", downloadUrl, catalogProvider, catalogSourceId, catalogRowStatus }
        : { kind: "url", downloadUrl },
      onDiagnostic: (diagnostic) => audit.warn("gtfs_fetch_refusal_diagnostic", { diagnostic }),
    });

    if (!result.ok) {
      audit.warn("gtfs_feed_refresh_failed", {
        workspaceId,
        feedId,
        versionId: result.versionId,
        code: result.code,
        durationMs: Date.now() - startedAt,
      });
      return NextResponse.json(
        {
          error: "This transit feed could not be refreshed",
          code: result.code,
          detail: result.detail,
          feedId: result.feedId,
          versionId: result.versionId,
        },
        { status: result.status }
      );
    }

    audit.info("gtfs_feed_refreshed", {
      workspaceId,
      feedId,
      versionId: result.versionId,
      adopted: result.adoption.adopted,
      adoptionReason: result.adoption.adopted ? null : result.adoption.reason,
      routeRows: result.routeServiceLevelRows,
      stopRows: result.stopServiceLevelRows,
      durationMs: Date.now() - startedAt,
    });

    // 200 IN ALL THREE ADOPTION OUTCOMES. The refetch is the thing that
    // succeeded; whether it replaced the feed in use is a separate fact the
    // body states rather than a status code encodes. See the header.
    return NextResponse.json(
      {
        feedId: result.feedId,
        versionId: result.versionId,
        adoption: result.adoption,
        displayName: result.displayName,
        routeServiceLevelRows: result.routeServiceLevelRows,
        stopServiceLevelRows: result.stopServiceLevelRows,
        droppedForMissingCoordinates: result.droppedForMissingCoordinates,
        warnings: result.warnings,
        caveats: result.caveats,
        checksumSha256: result.checksumSha256,
        byteSize: result.byteSize,
        supersededCatalogIds: supersededIds,
      },
      { status: 200 }
    );
  } catch (error) {
    audit.error("gtfs_feed_refresh_unhandled_error", { error });
    return NextResponse.json(
      { error: "Unexpected error while refreshing the transit feed" },
      { status: 500 }
    );
  }
}
