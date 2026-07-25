import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";
import {
  HOME_GEOGRAPHY_SCOPE_COLUMNS,
  parseWorkspaceHomeGeography,
} from "@/lib/workspaces/home-geography";
import {
  describeCensusTractCoverage,
  MAP_FEATURE_LAYER_LIMIT,
  resolveCensusTractScope,
  type CensusTractScope,
} from "@/lib/geographies/census-tract-scope";

type TractMapRow = {
  geoid: string;
  state_fips: string;
  county_fips: string;
  name: string | null;
  geometry_geojson: unknown;
  pop_total: number | string | null;
  households: number | string | null;
  pct_nonwhite: number | string | null;
  pct_zero_vehicle: number | string | null;
  pct_poverty: number | string | null;
};

// PostgREST surfaces INTEGER / NUMERIC as either number or string depending
// on magnitude and driver plumbing. Normalize defensively; null-out on
// anything non-finite so the paint expression's null-fallback branch
// renders a neutral color rather than a garbage step bin.
function coerceNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "string" ? Number.parseFloat(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(n) ? n : null;
}

// The view exposes geometry as jsonb via ST_AsGeoJSON(geometry)::jsonb, so
// the payload is already a parsed object. Only accept MultiPolygon with a
// non-empty coordinates array — a single-ring polygon-shaped tract would
// also be invalid for this layer (census_tracts is declared as
// GEOMETRY(MultiPolygon, 4326) in migration 20260219000003).
function isMultiPolygonGeometry(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const g = value as { type?: unknown; coordinates?: unknown };
  if (g.type !== "MultiPolygon") return false;
  if (!Array.isArray(g.coordinates)) return false;
  if (g.coordinates.length === 0) return false;
  return true;
}

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("map-features.census-tracts", request);
  const startedAt = Date.now();

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // Census tracts are public data — no workspace membership required to READ
    // them. Membership is still resolved, because it is what says WHICH tracts
    // belong on this map: the table is national and shared.
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { membership } = await loadCurrentWorkspaceMembership(supabase, user.id);

    let scope: CensusTractScope;
    if (!membership) {
      scope = resolveCensusTractScope(null, { hasWorkspace: false });
    } else {
      // Identity columns only — the full set carries the boundary polygon, and
      // this route fires on every (app) page load.
      const { data: workspaceRow } = await supabase
        .from("workspaces")
        .select(HOME_GEOGRAPHY_SCOPE_COLUMNS)
        .eq("id", membership.workspace_id)
        .maybeSingle();
      scope = resolveCensusTractScope(parseWorkspaceHomeGeography(workspaceRow), {
        hasWorkspace: true,
      });
    }

    // Nothing to scope to means nothing to draw. Returning a state-wide or
    // unfiltered slice here is what put another jurisdiction's tracts under
    // this workspace's map; the coverage notes say so instead.
    if (scope.scopeState !== "home_geography") {
      const notes = describeCensusTractCoverage({
        scopeState: scope.scopeState,
        scopeLabel: scope.scopeLabel,
        unsupportedKind: scope.unsupportedKind,
        matchedCount: 0,
        returnedCount: 0,
        droppedCount: 0,
        limit: MAP_FEATURE_LAYER_LIMIT,
      });

      audit.info("census_tract_choropleth_unscoped", {
        scopeState: scope.scopeState,
        durationMs: Date.now() - startedAt,
      });

      return NextResponse.json(
        {
          type: "FeatureCollection",
          features: [],
          returnedCount: 0,
          matchedCount: 0,
          droppedCount: 0,
          truncated: false,
          limit: MAP_FEATURE_LAYER_LIMIT,
          scopeState: scope.scopeState,
          scopeLabel: scope.scopeLabel,
          coverageNotes: notes,
        },
        { status: 200 }
      );
    }

    // `count: "exact"` rides the same round trip: PostgREST reports the full
    // matched total in Content-Range even under a LIMIT, so the disclosure and
    // the drawn features can never come from differently-filtered queries.
    // `.order()` makes a truncated payload a stable prefix rather than an
    // arbitrary subset that changes between loads.
    const { data, error, count } = await supabase
      .from("census_tracts_map")
      .select(
        "geoid, state_fips, county_fips, name, geometry_geojson, pop_total, households, pct_nonwhite, pct_zero_vehicle, pct_poverty",
        { count: "exact" }
      )
      .eq("state_fips", scope.stateFips)
      .eq("county_fips", scope.countyFips)
      .order("geoid", { ascending: true })
      .limit(MAP_FEATURE_LAYER_LIMIT);

    if (error) {
      audit.error("census_tract_choropleth_query_failed", {
        message: error.message,
        code: error.code ?? null,
      });
      return NextResponse.json(
        { error: "Failed to load census tract choropleth" },
        { status: 500 }
      );
    }

    const rows = (data ?? []) as TractMapRow[];

    const features = rows.flatMap((row) => {
      if (!isMultiPolygonGeometry(row.geometry_geojson)) return [];
      return [
        {
          type: "Feature" as const,
          id: row.geoid,
          geometry: row.geometry_geojson as {
            type: "MultiPolygon";
            coordinates: number[][][][];
          },
          properties: {
            kind: "census_tract",
            geoid: row.geoid,
            name: row.name,
            popTotal: coerceNumber(row.pop_total),
            pctZeroVehicle: coerceNumber(row.pct_zero_vehicle),
            pctPoverty: coerceNumber(row.pct_poverty),
            pctNonwhite: coerceNumber(row.pct_nonwhite),
          },
        },
      ];
    });

    const matchedCount = typeof count === "number" && Number.isFinite(count) ? count : rows.length;
    const droppedCount = rows.length - features.length;

    audit.info("census_tract_choropleth_loaded", {
      count: features.length,
      matchedCount,
      droppedCount,
      stateFips: scope.stateFips,
      countyFips: scope.countyFips,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      {
        type: "FeatureCollection" as const,
        features,
        returnedCount: features.length,
        matchedCount,
        droppedCount,
        truncated: features.length + droppedCount < matchedCount,
        limit: MAP_FEATURE_LAYER_LIMIT,
        scopeState: scope.scopeState,
        scopeLabel: scope.scopeLabel,
        coverageNotes: describeCensusTractCoverage({
          scopeState: scope.scopeState,
          scopeLabel: scope.scopeLabel,
          matchedCount,
          returnedCount: features.length,
          droppedCount,
          limit: MAP_FEATURE_LAYER_LIMIT,
        }),
      },
      { status: 200 }
    );
  } catch (error) {
    audit.error("census_tract_choropleth_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json(
      { error: "Unexpected error while loading census tract choropleth" },
      { status: 500 }
    );
  }
}
