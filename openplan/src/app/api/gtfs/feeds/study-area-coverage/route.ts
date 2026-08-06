/**
 * DOES THIS FEED SERVE THIS STUDY AREA? — asked before a run is queued.
 *
 * WHY THIS EXISTS AS A ROUTE. The same question is answered server-side inside
 * `prepareTransitFeedHandoff` and stamped into the run, and the AequilibraE
 * worker's own `feed_covers` is the authority over both. What this endpoint
 * buys is the ORDER OF EVENTS. A planner picking their agency out of a list of
 * four learns here, at the launch control, that the one they picked has no
 * stops anywhere near their corridor — instead of from a `no_feed_reason` on a
 * run that queued, waited on a worker the app cannot see, and came back with no
 * transit fifteen minutes later.
 *
 * IT IS A DISCLOSURE, NOT A GATE. It refuses nothing and it is allowed to
 * disagree with the worker: this compares against the study area's ENVELOPE and
 * the worker compares against the resolved zone system. The response says
 * `not_determined` wherever it cannot answer, and `gtfs/coverage.ts` argues at
 * length why a failed read must never become a coverage fact.
 *
 * WHY IT IS A POST. The study-area geometry is the input, and a corridor
 * polygon does not fit in a query string. Nothing is written.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { BODY_LIMITS, readJsonWithLimit } from "@/lib/http/body-limit";
import { classifyRouteReadFailure } from "@/lib/http/read-outcome";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { createClient } from "@/lib/supabase/server";
import { checkWorkspaceMembership } from "@/lib/workspaces/membership";
import { assessFeedVersionCoverage, type CoverageQueryClient } from "@/lib/gtfs/coverage";
import { filterToCurrentReadyVersion } from "@/lib/gtfs/persist";
import { corridorGeojsonSchema } from "@/lib/models/run-launch";
import { zoneAttributeBboxFromGeojson } from "@/lib/models/zone-attribute-payload";

export const runtime = "nodejs";

/**
 * Just enough of a PostgREST builder for the current-version read to compile.
 *
 * `filterToCurrentReadyVersion` is generic over the builder, and instantiating
 * that generic against the full Supabase client type is this repo's recurring
 * TS2589 ("type instantiation is excessively deep") trigger — it fired here on
 * first write. The clients are untyped by convention anyway, so naming the two
 * methods used loses nothing, and the read stays routed through the shared
 * predicate rather than hand-written `.eq()` calls.
 */
type CurrentVersionQuery = {
  eq: (column: string, value: never) => CurrentVersionQuery;
  maybeSingle: () => Promise<{ data: unknown; error: { message: string } | null }>;
};

const requestSchema = z
  .object({
    workspaceId: z.string().uuid(),
    /** A `gtfs_feeds` row this workspace owns. The version is resolved here. */
    feedId: z.string().uuid(),
    corridorGeojson: corridorGeojsonSchema,
  })
  .strict();

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("gtfs.feeds.study_area_coverage", request);

  try {
    // `networkGeoJson`, not `smallJson`: a real corridor or county boundary is
    // hundreds of kilobytes of coordinates, and refusing it on size would make
    // this disclosure unavailable to exactly the planners with the largest
    // study areas.
    const body = await readJsonWithLimit(request, BODY_LIMITS.networkGeoJson);
    if (!body.ok) return body.response;

    const parsed = requestSchema.safeParse(body.data);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid study-area coverage request" },
        { status: 400 }
      );
    }
    const { workspaceId, feedId, corridorGeojson } = parsed.data;

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
      // Never 403: confirming the workspace exists is an enumeration oracle.
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    // `workspace_id` explicitly, exactly as the rest of this lane does:
    // `gtfs_feeds.workspace_id IS NULL` is a PUBLIC preloaded feed readable by
    // every tenant, and a read written without this filter answers questions
    // about rows this workspace does not own.
    const feedResult = await supabase
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
      return NextResponse.json({ error: "Transit feed not found" }, { status: 404 });
    }

    // THE ONE EXPRESSION OF "the version this workspace analyses with".
    const versionResult = await filterToCurrentReadyVersion(
      supabase
        .from("gtfs_feed_versions")
        .select("id, service_start_date, service_end_date, frequency_trip_count")
        .eq("feed_id", feedId)
        .eq("workspace_id", workspaceId) as unknown as CurrentVersionQuery
    ).maybeSingle();

    const versionFailure = classifyRouteReadFailure("the transit feed version", versionResult);
    if (versionFailure) {
      audit.error("gtfs_current_version_read_failed", { message: versionFailure.message });
      return NextResponse.json(versionFailure.body, { status: versionFailure.status });
    }

    const version = versionResult.data as unknown as {
      id: string;
      service_start_date: string | null;
      service_end_date: string | null;
      frequency_trip_count: number | null;
    } | null;

    if (!version) {
      // An honest `not_determined` rather than a 404: the feed exists, and
      // "there is no completed ingest in use" is the answer, not an absence.
      audit.info("gtfs_coverage_no_current_version", { workspaceId, feedId });
      return NextResponse.json({
        coverage: "not_determined",
        stopServiceRowsInStudyArea: null,
        reason:
          "This transit feed has no completed ingest in use, so whether it serves the study area cannot " +
          "be checked. Bring the feed in again from the Data Hub.",
        serviceEndDate: null,
        usesFrequencies: null,
      });
    }

    const bbox = zoneAttributeBboxFromGeojson(corridorGeojson);
    if (!bbox) {
      audit.info("gtfs_coverage_no_study_area_envelope", { workspaceId, feedId });
      return NextResponse.json({
        coverage: "not_determined",
        stopServiceRowsInStudyArea: null,
        reason:
          "This study area has no usable coordinates, so whether the feed serves it cannot be checked.",
        serviceEndDate: version.service_end_date,
        usesFrequencies: (version.frequency_trip_count ?? 0) > 0,
      });
    }

    const assessment = await assessFeedVersionCoverage({
      client: supabase as unknown as CoverageQueryClient,
      feedVersionId: version.id,
      bbox,
    });

    audit.info("gtfs_coverage_checked", {
      workspaceId,
      feedId,
      feedVersionId: version.id,
      coverage: assessment.coverage,
    });

    return NextResponse.json({
      coverage: assessment.coverage,
      stopServiceRowsInStudyArea: assessment.stopServiceRowsInStudyArea,
      reason: assessment.reason,
      serviceEndDate: version.service_end_date,
      // Disclosed alongside coverage because it is the OTHER way a
      // successfully ingested feed fails to reach the travel model, and a
      // planner deciding which feed to pick needs both answers at once.
      usesFrequencies: (version.frequency_trip_count ?? 0) > 0,
    });
  } catch (error) {
    audit.error("gtfs_coverage_error", { error });
    return NextResponse.json(
      { error: "Unexpected error checking transit feed coverage" },
      { status: 500 }
    );
  }
}
