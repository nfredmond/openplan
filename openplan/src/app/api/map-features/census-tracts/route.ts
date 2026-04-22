import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";

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

    // Census tracts are public data — no workspace membership required.
    // The auth gate just keeps the public-landing pages from firing an
    // unnecessary fetch (they render no shell backdrop).
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // TODO(pagination): hard cap at 500 tracts so the GeoJSON payload stays
    // under ~1MB. A real statewide choropleth needs tile-based delivery;
    // revisit when we ship live TIGER ingestion beyond the hand-authored
    // NCTC demo tracts.
    const { data, error } = await supabase
      .from("census_tracts_map")
      .select(
        "geoid, state_fips, county_fips, name, geometry_geojson, pop_total, households, pct_nonwhite, pct_zero_vehicle, pct_poverty"
      )
      .limit(500);

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

    audit.info("census_tract_choropleth_loaded", {
      count: features.length,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      { type: "FeatureCollection" as const, features },
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
