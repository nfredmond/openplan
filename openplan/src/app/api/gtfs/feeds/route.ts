import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { BODY_LIMITS, readJsonWithLimit } from "@/lib/http/body-limit";
import { classifyRouteReadFailure } from "@/lib/http/read-outcome";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { isReadOnlyWorkspaceRole } from "@/lib/auth/role-matrix";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { checkWorkspaceMembership } from "@/lib/workspaces/membership";
import { resolveGtfsCatalogRedirect } from "@/lib/gtfs/catalog";
import {
  normalizeGtfsSourceUrl,
  provisionalFeedNameFromUrl,
  runGtfsIngest,
} from "@/lib/gtfs/ingest";
import { filterToCurrentReadyVersion } from "@/lib/gtfs/persist";
import {
  GTFS_FEED_COLUMNS,
  GTFS_FEED_VERSION_COLUMNS,
  gtfsCaveatContextFromVersionRow,
} from "@/lib/gtfs/route-projections";
import { selectGtfsCaveats } from "@/lib/gtfs/caveats";

/**
 * THE WORKSPACE'S TRANSIT FEEDS: what is here, and how another one gets here.
 *
 * ================================================= WHY POST TAKES 300 SECONDS
 *
 * An ingest downloads an archive that may be 190 MB, unzips it, counts every
 * departure in it and writes tens of thousands of derived rows. The measured
 * shape of that work is in `persist.ts` — Sacramento Regional Transit's real
 * feed derives 18,141 stop rows from a 2.7 MB archive, and a large agency is
 * several times that. `maxDuration = 300` is the platform ceiling this lane is
 * designed around, and `GTFS_INGEST_ABANDONED_AFTER_MS` is derived FROM it, so
 * the two must not drift: lowering this without lowering that leaves genuinely
 * dead ingests sitting on a card for longer than necessary, and raising it
 * without raising that lets the reaper close an ingest that is still running.
 *
 * ================================ WHY `workspace_id` IS FILTERED EXPLICITLY
 *
 * `gtfs_feeds.workspace_id IS NULL` means a PUBLIC PRELOADED FEED — one row
 * every tenant on the deployment can read. The RLS SELECT policy allows exactly
 * that, so a read written without `.eq("workspace_id", …)` returns every public
 * feed on the deployment mixed in with this workspace's own, and a delete or a
 * refresh written the same way would let one tenant destroy or repoint a row
 * every other tenant reads. Every query in this lane names the workspace.
 *
 * ============================================= WHAT THE PLANNER MAY SUPPLY
 *
 * For a CATALOG feed the request carries an id and NOTHING ELSE about the feed.
 * The provider, the download address and the upstream status are read off the
 * catalog row this route resolves for itself. That is not ceremony: accepting a
 * URL beside a catalog id would let a caller label an arbitrary address as
 * "Sacramento Regional Transit, from the Mobility Database", and the provenance
 * columns exist precisely so a planner can trust where a number came from.
 */

export const runtime = "nodejs";
export const maxDuration = 300;

const listQuerySchema = z.object({ workspaceId: z.string().uuid() }).strict();

const catalogSourceSchema = z
  .object({
    source: z.literal("catalog"),
    workspaceId: z.string().uuid(),
    /** `mdb_source_id`, or whatever the configured catalog keys its rows on. */
    catalogId: z.string().trim().min(1).max(120),
    /**
     * The area the planner searched, when they searched one. OPTIONAL, and it
     * is a DISCLOSURE INPUT rather than a filter: the response says whether the
     * resolved entry's published service area covers it. It is not used to
     * refuse, because `catalog.ts`'s central argument is that only the planner
     * knows which operator is theirs — and because a redirect may legitimately
     * land on a successor whose published box is drawn differently.
     */
    area: z
      .object({
        minLon: z.number().min(-180).max(180),
        minLat: z.number().min(-90).max(90),
        maxLon: z.number().min(-180).max(180),
        maxLat: z.number().min(-90).max(90),
      })
      .strict()
      .optional(),
  })
  .strict();

const urlSourceSchema = z
  .object({
    source: z.literal("url"),
    workspaceId: z.string().uuid(),
    url: z.string().trim().url().max(2048),
    /** What to call the feed until the parse names it. The hostname otherwise. */
    label: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

const createFeedSchema = z.discriminatedUnion("source", [catalogSourceSchema, urlSourceSchema]);

function membershipResponse(
  kind: "schema_pending" | "not_member" | "error"
): NextResponse {
  if (kind === "schema_pending") {
    return NextResponse.json(
      {
        error: "Transit feed schema is not available yet",
        hint: "Apply the latest Supabase migrations before ingesting a feed.",
      },
      { status: 503 }
    );
  }
  if (kind === "error") {
    return NextResponse.json({ error: "Failed to verify workspace membership" }, { status: 500 });
  }
  // Never 403: confirming the workspace exists is an enumeration oracle.
  return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
}

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("gtfs.feeds.list", request);

  try {
    const query = listQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams.entries())
    );
    if (!query.success) {
      return NextResponse.json({ error: "Invalid feed list parameters" }, { status: 400 });
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
      }
      return membershipResponse(membership.kind);
    }

    const feedsResult = await supabase
      .from("gtfs_feeds")
      .select(GTFS_FEED_COLUMNS)
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(200);

    const feedsFailure = classifyRouteReadFailure("transit feeds", feedsResult, {
      pendingError: "Transit feed schema is not available yet",
      pendingHint: "Apply the latest Supabase migrations, then try again.",
    });
    if (feedsFailure) {
      audit.error("gtfs_feeds_read_failed", { message: feedsFailure.message });
      return NextResponse.json(feedsFailure.body, { status: feedsFailure.status });
    }
    const feeds = (feedsResult.data ?? []) as unknown as Array<Record<string, unknown>>;

    // THE ONE EXPRESSION OF "the feed this workspace analyses with". Both halves
    // — `is_current` AND `status = 'ready'` — are applied by
    // `filterToCurrentReadyVersion`, because filtering on either alone is wrong
    // in a different direction (a promoted-then-failed version read as service
    // data; three successful ingests reported as triple the stops).
    const currentResult = await filterToCurrentReadyVersion(
      supabase
        .from("gtfs_feed_versions")
        .select(GTFS_FEED_VERSION_COLUMNS)
        .eq("workspace_id", workspaceId)
    ).limit(200);

    const currentFailure = classifyRouteReadFailure("transit feed versions", currentResult);
    if (currentFailure) {
      audit.error("gtfs_current_versions_read_failed", { message: currentFailure.message });
      return NextResponse.json(currentFailure.body, { status: currentFailure.status });
    }

    // Every recent ingest attempt, whatever its status. This is what lets a card
    // say "the last refresh failed, and here is why" instead of silently
    // continuing to show the older version as though nothing had happened.
    const recentResult = await supabase
      .from("gtfs_feed_versions")
      .select(GTFS_FEED_VERSION_COLUMNS)
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(200);

    const recentFailure = classifyRouteReadFailure("transit feed ingests", recentResult);
    if (recentFailure) {
      audit.error("gtfs_recent_versions_read_failed", { message: recentFailure.message });
      return NextResponse.json(recentFailure.body, { status: recentFailure.status });
    }

    const currentVersions = (currentResult.data ?? []) as unknown as Array<Record<string, unknown>>;

    return NextResponse.json(
      {
        feeds,
        currentVersions,
        recentVersions: recentResult.data ?? [],
        // The qualifications that travel with every number derived from each
        // adopted feed, keyed by feed id. Derived through the same function the
        // ingest response uses, so the two surfaces cannot disagree.
        caveatsByFeedId: Object.fromEntries(
          currentVersions.map((version) => [
            String(version.feed_id),
            selectGtfsCaveats(gtfsCaveatContextFromVersionRow(version)),
          ])
        ),
      },
      { status: 200 }
    );
  } catch (error) {
    audit.error("gtfs_feeds_list_unhandled_error", { error });
    return NextResponse.json(
      { error: "Unexpected error while listing transit feeds" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("gtfs.feeds.create", request);
  const startedAt = Date.now();

  try {
    const body = await readJsonWithLimit(request, BODY_LIMITS.smallJson);
    if (!body.ok) return body.response;
    const payload = createFeedSchema.safeParse(body.data);
    if (!payload.success) {
      return NextResponse.json(
        {
          error: "Invalid feed payload",
          hint: 'Send { source: "catalog", workspaceId, catalogId } or { source: "url", workspaceId, url }.',
        },
        { status: 400 }
      );
    }
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

    /* ------------------------------------------------------------------ */
    /* Resolve the source                                                  */
    /* ------------------------------------------------------------------ */

    let downloadUrl: string;
    let provisionalName: string;
    let catalogProvider: string | null = null;
    let catalogSourceId: string | null = null;
    let catalogRowStatus: string | null = null;
    let coversRequestedArea: boolean | null = null;
    let supersededIds: string[] = [];

    if (payload.data.source === "catalog") {
      // FOLLOW THE CATALOG'S OWN REDIRECTS FIRST. An agency that republished
      // under a new id leaves the old row `deprecated` with `redirect.id`
      // naming the successor, and 244 US rows were in that state when this lane
      // was written. Resolving here means a planner who saved an id months ago
      // gets today's feed rather than a refusal.
      const resolved = await resolveGtfsCatalogRedirect(payload.data.catalogId);

      if (resolved.status === "catalog_unavailable") {
        audit.warn("gtfs_catalog_unavailable", {
          code: resolved.code,
          detail: resolved.detail,
          ...(resolved.diagnostic ? { diagnostic: resolved.diagnostic } : {}),
        });
        // The diagnostic can name a resolved internal address; it is logged
        // above and never returned.
        return NextResponse.json(
          { error: "The transit feed catalog could not be read", detail: resolved.detail },
          { status: 503 }
        );
      }
      if (resolved.status === "refused") {
        return NextResponse.json(
          {
            error: "That catalog entry cannot be ingested",
            reason: resolved.reason,
            detail: resolved.detail,
            supersededIds: resolved.supersededIds,
          },
          { status: 422 }
        );
      }

      const entry = resolved.entry;
      // `downloadUrl` is non-null on a `live` entry by construction — the
      // resolver refuses `no_download_url` before it can return one — but the
      // type is nullable, and inventing a fallback address would be the exact
      // thing this branch exists to prevent.
      if (!entry.downloadUrl) {
        return NextResponse.json(
          {
            error: "That catalog entry publishes no download address",
            detail: `The catalog lists entry ${entry.catalogId} and offers no address for its feed.`,
          },
          { status: 422 }
        );
      }

      downloadUrl = entry.downloadUrl;
      catalogProvider = entry.provider;
      catalogSourceId = entry.catalogId;
      catalogRowStatus = entry.status;
      supersededIds = resolved.supersededIds;
      provisionalName = entry.provider ?? entry.name ?? `Catalog entry ${entry.catalogId}`;

      if (payload.data.area && entry.boundingBox) {
        const area = payload.data.area;
        const box = entry.boundingBox;
        coversRequestedArea = !(
          box.minLon > area.maxLon ||
          box.maxLon < area.minLon ||
          box.minLat > area.maxLat ||
          box.maxLat < area.minLat
        );
      }
    } else {
      downloadUrl = payload.data.url;
      provisionalName = payload.data.label ?? provisionalFeedNameFromUrl(payload.data.url);
    }

    /* ------------------------------------------------------------------ */
    /* Reuse the feed row when this source is already registered           */
    /* ------------------------------------------------------------------ */

    // WHY A PROBE AND NOT A CAUGHT UNIQUE VIOLATION. 20260805000006 put partial
    // unique indexes on (workspace_id, catalog_source_id) and
    // (workspace_id, normalized_source_url), so re-ingesting a source a
    // workspace already has would otherwise fail the INSERT with a 23505 that
    // reads to a planner as an error. It is not an error — it is a REFRESH, and
    // adding a version to the feed they already have is what they meant.
    const normalizedSourceUrl = normalizeGtfsSourceUrl(downloadUrl);
    if (!normalizedSourceUrl) {
      // `z.string().url()` accepts `ftp://` and `mailto:`. The outbound guard
      // would refuse those a moment later with a less useful sentence, and the
      // partial unique index is keyed on the normalised form, so a source that
      // has no normalised form has no identity to key on either.
      return NextResponse.json(
        {
          error: "That address cannot be used as a feed source",
          detail: "A GTFS feed address must be an http:// or https:// URL.",
        },
        { status: 400 }
      );
    }

    const existingResult = await (catalogSourceId
      ? service
          .from("gtfs_feeds")
          .select("id, agency_name")
          .eq("workspace_id", workspaceId)
          .eq("catalog_source_id", catalogSourceId)
      : service
          .from("gtfs_feeds")
          .select("id, agency_name")
          .eq("workspace_id", workspaceId)
          .eq("normalized_source_url", normalizedSourceUrl)
    ).maybeSingle();

    const existingFailure = classifyRouteReadFailure("transit feeds", existingResult);
    if (existingFailure) {
      audit.error("gtfs_existing_feed_probe_failed", { message: existingFailure.message });
      return NextResponse.json(existingFailure.body, { status: existingFailure.status });
    }
    const existingFeed = existingResult.data as { id: string; agency_name: string } | null;

    /* ------------------------------------------------------------------ */
    /* Ingest                                                              */
    /* ------------------------------------------------------------------ */

    const result = await runGtfsIngest({
      service,
      workspaceId,
      feedId: existingFeed?.id ?? null,
      requestedBy: user.id,
      provisionalName: existingFeed?.agency_name ?? provisionalName,
      source: catalogSourceId
        ? { kind: "catalog", downloadUrl, catalogProvider, catalogSourceId, catalogRowStatus }
        : { kind: "url", downloadUrl },
      onDiagnostic: (diagnostic) => audit.warn("gtfs_fetch_refusal_diagnostic", { diagnostic }),
    });

    if (!result.ok) {
      audit.warn("gtfs_feed_ingest_failed", {
        workspaceId,
        feedId: result.feedId,
        versionId: result.versionId,
        code: result.code,
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

    audit.info("gtfs_feed_ingested", {
      workspaceId,
      feedId: result.feedId,
      versionId: result.versionId,
      createdFeed: result.createdFeed,
      adopted: result.adoption.adopted,
      routeRows: result.routeServiceLevelRows,
      stopRows: result.stopServiceLevelRows,
      // Operator-visible, because a bucket that has started refusing writes
      // shows up here first — as feeds that ingest fine and then cannot be
      // handed to a model run.
      bytesStored: result.bytesStored,
      bytesNotStoredReason: result.bytesNotStoredReason,
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
        // WHETHER THIS FEED CAN REACH THE TRAVEL MODEL. Every door stores its
        // archive since 2026-08-06, because a model run is handed the exact
        // bytes OpenPlan parsed rather than an address the worker refetches.
        // A catalog/URL ingest whose object write missed still produces correct
        // service levels — so it is `ok`, and this is the only place that says
        // the run handoff will refuse it until the feed is brought in again.
        bytesStored: result.bytesStored,
        bytesNotStoredReason: result.bytesNotStoredReason,
        // Null when no area was supplied or the catalog publishes no service
        // area for the entry. A boolean would claim a comparison that was
        // never made.
        coversRequestedArea,
        // The ids walked through to reach today's entry. Empty when the saved
        // id was already current, which is the answer to "is my feed still the
        // right one" rather than a boring degenerate case.
        supersededCatalogIds: supersededIds,
      },
      { status: result.createdFeed ? 201 : 200 }
    );
  } catch (error) {
    audit.error("gtfs_feed_create_unhandled_error", { error });
    return NextResponse.json(
      { error: "Unexpected error while ingesting the transit feed" },
      { status: 500 }
    );
  }
}
