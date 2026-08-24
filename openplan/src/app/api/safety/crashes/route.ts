import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import {
  checkWorkspaceMembership,
  type WorkspaceMembershipResult,
} from "@/lib/workspaces/membership";
import {
  applyCrashFiltersToQuery,
  CRASH_FILTER_FACETS,
  CRASH_QUERY_PROJECTION,
  CRASH_SEVERITY_BANDS,
  parseFacetParam,
  restrictCrashQueryToSeverityBand,
  type CrashFilterSelection,
} from "@/lib/safety/crash-filters";
import { toStoredCrashProperties } from "@/lib/safety/crash-properties";
import {
  readSafetyKsiConcentrations,
  readSafetyKsiEquityTracts,
} from "@/lib/safety/ksi-concentrations";
import { CRASH_KSI_SEVERITIES } from "@/lib/safety/vocabulary";
import { ACS_YEAR } from "@/lib/data-sources/census";

/**
 * Crash query for the Safety map and list.
 *
 * Deliberately NOT a `/api/map-features/*` sibling. Those seven routes take no
 * query parameters and hard-cap at `.limit(500)` under PostgREST
 * `max_rows = 1000`, which is fine for the hundreds of rows they serve — but a
 * county crash extract is 10^4-10^5 rows, so 500 arbitrary crashes would be a
 * meaningless map. This route takes an explicit bbox plus severity/mode/year
 * filters, and returns `returnedCount` alongside `matchedCount` so the UI can
 * say "showing N of M in view" instead of silently truncating.
 *
 * ═══ WHY THIS ROUTE ALSO COUNTS SEVERITY BANDS ═══
 *
 * The rows are capped and always will be — a map cannot draw 10^5 points. The
 * page's headline, however, is KSI — killed or seriously injured — which is the
 * measure SS4A and HSIP score a project on, so it is what a planner copies into
 * a funding application. Adding it up from the rows this route
 * returned understated it by roughly an order of magnitude on a real run: 1,000
 * crashes drawn against 11,870 matching the study area.
 *
 * You cannot sum what you did not fetch, so the bands are counted in Postgres,
 * one exact HEAD count per band, all built through the SAME `applyFilters`
 * closure the rows and the matched count go through. That is what stops the
 * headline and the map disagreeing: there is one filter definition
 * (`crash-filters.ts`), one interpreter over it, and one scope closure here.
 *
 * NO GROUPED-COUNT MIGRATION, deliberately. `idx_safety_crashes_severity (workspace_id,
 * severity)` already serves this: measured against the local 32,650-row extract,
 * one band count is a 0.2 ms bitmap scan. The alternatives were both worse — a
 * PostgREST grouped aggregate depends on `db-aggregates-enabled`, which is an
 * operator setting a self-hosting agency controls and can turn off, and a new
 * SQL function would have to re-spell every filter in Postgres, which is the
 * second filter definition this module was refactored to eliminate. The two
 * spatial screening outputs below do use narrowly scoped SQL functions because
 * they must inspect every matched point rather than the capped map slice.
 */

const DEFAULT_LIMIT = 2000;
const MAX_LIMIT = 5000;

const querySchema = z.object({
  workspaceId: z.string().uuid(),
  /**
   * Optional project scope. Crashes carry no project link themselves — the
   * INGEST is the acquisition unit — so this filter resolves the project's
   * ingests first and returns only crashes stored by those acquisitions.
   */
  projectId: z.string().uuid().optional(),
  minLon: z.coerce.number().min(-180).max(180),
  minLat: z.coerce.number().min(-90).max(90),
  maxLon: z.coerce.number().min(-180).max(180),
  maxLat: z.coerce.number().min(-90).max(90),
  yearFrom: z.coerce.number().int().min(1900).max(2100).optional(),
  yearTo: z.coerce.number().int().min(1900).max(2100).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
});

/**
 * THE FACET FILTERS ARE NOT SPELLED HERE.
 *
 * They used to be: a hand-written `severity` refinement and a `mode` enum, whose
 * twin lived in `safety-workspace.tsx` for the live lane and was documented as
 * having been "written to mirror" this one. Both are now generated from
 * `CRASH_FILTER_FACETS`, so a facet cannot be filterable in one lane and dead in
 * the other. `parseFacetParam` returns null — not an empty list — for a value
 * outside the vocabulary, which is what turns a typo into a 400 rather than into
 * a silently unfiltered total.
 *
 * `mode` is gone as a parameter name. It was a single-choice enum over two of
 * the three involvement flags; `involvement` is the multi-select over all three,
 * and motorcyclists are reachable for the first time.
 */
function parseFacetSelection(params: URLSearchParams): CrashFilterSelection | null {
  const selection: CrashFilterSelection = {};
  for (const facet of CRASH_FILTER_FACETS) {
    const parsed = parseFacetParam(facet, params.get(facet.id));
    if (parsed === null) return null;
    if (parsed.length > 0) selection[facet.id] = parsed;
  }
  return selection;
}

function membershipErrorResponse(result: Extract<WorkspaceMembershipResult, { ok: false }>) {
  if (result.kind === "schema_pending") {
    return NextResponse.json(
      {
        error: "Safety schema is not available yet",
        hint: "Apply the latest Supabase migrations before querying crash data.",
      },
      { status: 503 }
    );
  }
  if (result.kind === "not_member") {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }
  return NextResponse.json({ error: "Failed to verify workspace membership" }, { status: 500 });
}

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("safety.crashes.list", request);
  const startedAt = Date.now();

  try {
    const parsed = querySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams.entries())
    );
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid crash query parameters" }, { status: 400 });
    }

    const query = parsed.data;
    if (query.minLon >= query.maxLon || query.minLat >= query.maxLat) {
      return NextResponse.json({ error: "Invalid bounding box" }, { status: 400 });
    }

    const facetSelection = parseFacetSelection(request.nextUrl.searchParams);
    if (facetSelection === null) {
      return NextResponse.json({ error: "Invalid crash query parameters" }, { status: 400 });
    }
    const selection: CrashFilterSelection = {
      ...facetSelection,
      ...(query.yearFrom === undefined ? {} : { yearFrom: query.yearFrom }),
      ...(query.yearTo === undefined ? {} : { yearTo: query.yearTo }),
    };

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const membership = await checkWorkspaceMembership(supabase, user.id, query.workspaceId);
    if (!membership.ok) {
      return membershipErrorResponse(membership);
    }

    const limit = query.limit ?? DEFAULT_LIMIT;

    // Project scope: resolve the project's acquisitions, then restrict crashes
    // to those ingest ids. A project with no linked acquisitions returns an
    // honest empty collection (0 of 0) rather than the whole workspace's data.
    let projectIngestIds: string[] | null = null;
    if (query.projectId) {
      const { data: ingestRows, error: ingestError } = await supabase
        .from("safety_crash_ingests")
        .select("id")
        .eq("workspace_id", query.workspaceId)
        .eq("project_id", query.projectId);
      if (ingestError) {
        audit.warn("safety_crash_project_scope_failed", {
          workspaceId: query.workspaceId,
          error: ingestError.message,
        });
        return NextResponse.json(
          { error: "Failed to resolve the project's crash acquisitions" },
          { status: 500 }
        );
      }
      projectIngestIds = (ingestRows ?? []).map((row) => row.id as string);
      if (projectIngestIds.length === 0) {
        return NextResponse.json(
          {
            type: "FeatureCollection",
            features: [],
            returnedCount: 0,
            matchedCount: 0,
            undrawableCount: 0,
            // Every band is a TRUE zero here: the project has no acquisitions,
            // so no crash of any band is in scope. That is a different statement
            // from `null` below, which means the counts could not be read.
            severityTotals: Object.fromEntries(
              CRASH_SEVERITY_BANDS.map((band) => [band, 0])
            ),
            ksiConcentrations: [],
            ksiEquityTracts: [],
            ksiEquityDemographicSource: { label: "U.S. Census ACS 5-year", vintage: ACS_YEAR },
            truncated: false,
            limit,
          },
          { status: 200 }
        );
      }
    }

    // RLS scopes reads to workspace members; the explicit workspace filter keeps
    // the query planner honest and the intent obvious. The two queries are built
    // separately so each `select()` stays a string literal — supabase-js infers
    // row types from it, and a conditional expression defeats that.
    type CrashFilterable = {
      eq: (column: string, value: unknown) => CrashFilterable;
      gte: (column: string, value: unknown) => CrashFilterable;
      lte: (column: string, value: unknown) => CrashFilterable;
      in: (column: string, values: readonly unknown[]) => CrashFilterable;
      or: (filter: string) => CrashFilterable;
    };

    // Scope first (workspace, viewport, project), then the shared facet
    // interpreter. The scope predicates stay here because they are not filters a
    // planner chooses — they are the boundary of what this request may see.
    const applyFilters = <T>(builder: T): T => {
      let q = builder as unknown as CrashFilterable;
      q = q
        .eq("workspace_id", query.workspaceId)
        .gte("longitude", query.minLon)
        .lte("longitude", query.maxLon)
        .gte("latitude", query.minLat)
        .lte("latitude", query.maxLat);

      if (projectIngestIds) q = q.in("ingest_id", projectIngestIds);

      return applyCrashFiltersToQuery(q, selection) as unknown as T;
    };

    // ONE band, counted in Postgres, under the planner's own filters. Built by
    // handing the same `applyFilters` closure a head-count query and appending
    // the registry's own severity predicate — never by rebuilding the filters.
    const countBand = (band: string) =>
      restrictCrashQueryToSeverityBand(
        applyFilters(supabase.from("safety_crashes").select("id", { count: "exact", head: true })),
        band
      );

    const [countResult, rowsResult, bandResults, concentrationResult, equityResult] = await Promise.all([
      applyFilters(supabase.from("safety_crashes").select("id", { count: "exact", head: true })),
      applyFilters(supabase.from("safety_crashes").select(CRASH_QUERY_PROJECTION))
        .order("collision_date", { ascending: false, nullsFirst: false })
        .limit(limit),
      Promise.all(CRASH_SEVERITY_BANDS.map((band) => countBand(band))),
      supabase.rpc("safety_ksi_concentrations", {
        p_workspace_id: query.workspaceId,
        p_min_lon: query.minLon,
        p_min_lat: query.minLat,
        p_max_lon: query.maxLon,
        p_max_lat: query.maxLat,
        p_project_id: query.projectId ?? null,
        p_severities: [...CRASH_KSI_SEVERITIES],
        p_radius_meters: 150,
        p_min_points: 2,
        p_result_limit: 10,
      }),
      supabase.rpc("safety_ksi_tract_burden", {
        p_workspace_id: query.workspaceId,
        p_min_lon: query.minLon,
        p_min_lat: query.minLat,
        p_max_lon: query.maxLon,
        p_max_lat: query.maxLat,
        p_project_id: query.projectId ?? null,
        p_severities: [...CRASH_KSI_SEVERITIES],
        p_result_limit: 10,
      }),
    ]);

    if (rowsResult.error) {
      audit.warn("safety_crash_list_failed", {
        workspaceId: query.workspaceId,
        error: rowsResult.error.message,
      });
      return NextResponse.json({ error: "Failed to load crash data" }, { status: 500 });
    }

    const rows = (rowsResult.data ?? []) as unknown as Array<Record<string, unknown>>;
    const exactMatchedCount =
      !countResult.error && typeof countResult.count === "number" && Number.isFinite(countResult.count)
        ? countResult.count
        : null;
    const matchedCount = exactMatchedCount ?? rows.length;
    // WHETHER THAT DENOMINATOR IS THE REAL ONE. When the count query fails the
    // fallback is the number of rows fetched, which is capped — so "showing
    // 1,000 of 1,000" would assert that the study area holds exactly a thousand
    // crashes, the same understatement this route's band counts exist to end.
    // The flag lets the page say "at least" instead of stating a total it does
    // not have.
    const matchedCountIsExact = exactMatchedCount !== null;

    /**
     * ONE TOTAL PER SEVERITY BAND, over every crash the filters matched.
     *
     * ALL OR NOTHING, and never a fabricated zero. If any band's count could not
     * be read, the whole map is `null` — a partial map would present a band that
     * failed to count as a band with no crashes in it, and on this page a zero in
     * the fatal row is the most damaging wrong number the product can publish.
     * `null` means "not counted"; it never means "none".
     */
    const bandCounts = CRASH_SEVERITY_BANDS.map((band, index) => {
      const result = bandResults[index];
      const count = result?.error ? null : result?.count;
      return typeof count === "number" && Number.isFinite(count)
        ? ([band, count] as const)
        : null;
    });
    const severityTotals = bandCounts.every((entry) => entry !== null)
      ? Object.fromEntries(bandCounts as ReadonlyArray<readonly [string, number]>)
      : null;
    if (severityTotals === null) {
      audit.warn("safety_crash_severity_totals_unavailable", {
        workspaceId: query.workspaceId,
        bands: CRASH_SEVERITY_BANDS.filter((_, index) => bandCounts[index] === null),
      });
    }

    const ksiConcentrations = concentrationResult.error
      ? null
      : readSafetyKsiConcentrations(concentrationResult.data);
    if (concentrationResult.error) {
      audit.warn("safety_ksi_concentrations_unavailable", {
        workspaceId: query.workspaceId,
        error: concentrationResult.error.message,
      });
    }
    const ksiEquityTracts = equityResult.error
      ? null
      : readSafetyKsiEquityTracts(equityResult.data);
    if (equityResult.error) {
      audit.warn("safety_ksi_equity_unavailable", {
        workspaceId: query.workspaceId,
        error: equityResult.error.message,
      });
    }

    // Built through the shared reader so this route and the shared backdrop
    // layer cannot disagree about what a row means — in particular about a
    // casualty count the source never supplied, which must stay null and never
    // become a zero that reads as "nobody was hurt".
    const features = rows.flatMap((row) => {
      const properties = toStoredCrashProperties(row);
      if (!properties) return [];
      const longitude = Number(row.longitude);
      const latitude = Number(row.latitude);
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return [];
      return [
        {
          // GeoJSON so the map can consume it directly.
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [longitude, latitude] },
          properties,
        },
      ];
    });

    // Rows the response could not render honestly. Reported rather than
    // swallowed: silently returning fewer features than were matched is how a
    // count on screen stops agreeing with the record behind it.
    const undrawableCount = rows.length - features.length;

    audit.info("safety_crash_list_loaded", {
      workspaceId: query.workspaceId,
      returnedCount: features.length,
      matchedCount,
      undrawableCount,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      {
        type: "FeatureCollection",
        features,
        // Load-bearing for honest UI copy: "showing N of M crashes in view".
        returnedCount: features.length,
        matchedCount,
        matchedCountIsExact,
        undrawableCount,
        /**
         * THE STUDY-AREA TOTAL, per band — what the page's KSI headline is built
         * from. It is NOT derived from `features`: those are capped, and adding
         * them up is exactly the understatement this field exists to end.
         */
        severityTotals,
        ksiConcentrations,
        ksiEquityTracts,
        ksiEquityDemographicSource: { label: "U.S. Census ACS 5-year", vintage: ACS_YEAR },
        truncated: features.length + undrawableCount < matchedCount,
        limit,
      },
      { status: 200 }
    );
  } catch (error) {
    audit.error("safety_crash_list_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json({ error: "Unexpected error while loading crash data" }, { status: 500 });
  }
}
