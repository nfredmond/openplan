/**
 * Census-tract ingestion — populate `census_tracts` for ANY US county on demand.
 *
 * WHY THIS EXISTS. The `census_tracts` table (and the equity choropleth that
 * reads it) had exactly one writer: the NCTC demo seed, four hand-authored fake
 * Nevada County tracts. For every other agency in the country the equity layer
 * rendered nothing, with no explanation — the read route's own TODO said so.
 * This closes that: tract geometry (TIGERweb) joined to tract demographics (ACS,
 * reusing `fetchAcsForCounties`) and upserted through the existing
 * `seed_public_census_tract` RPC, for any state+county.
 *
 * The data is PUBLIC (the table is anon-readable), so ingestion is not
 * workspace-scoped — loading Franklin County, OH once benefits every user
 * looking at Franklin County. The trigger is authenticated so anonymous callers
 * cannot drive our server against TIGERweb/ACS.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAcsForCounties } from "./census";
import { fetchJsonWithRetry } from "./http";

const TIGERWEB_TRACTS_URL =
  "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer/0/query";

/** TIGERweb caps a single response; page through with resultOffset until dry. */
const TIGERWEB_PAGE_SIZE = 1000;
/** Backstop so a pathological response cannot page forever. */
const MAX_TIGERWEB_PAGES = 20;

export type CountyRef = { stateFips: string; countyFips: string };

export type TractGeometry = { geoid: string; name: string; geometry: GeoJSON.Geometry };

type TigerFeature = {
  properties?: Record<string, unknown> | null;
  geometry?: GeoJSON.Geometry | null;
};
type TigerResponse = {
  features?: TigerFeature[];
  exceededTransferLimit?: boolean;
  properties?: { exceededTransferLimit?: boolean };
};

export type CountyIngestResult = {
  stateFips: string;
  countyFips: string;
  status: "ingested" | "no_tracts" | "no_demographics" | "failed";
  tractsUpserted: number;
  /** Tracts that had geometry but no ACS match, or vice versa — disclosed, not hidden. */
  unmatched: number;
  error: string | null;
};

/** A 5-digit county GEOID is 2-digit state FIPS + 3-digit county FIPS. */
function isValidCountyRef(ref: CountyRef): boolean {
  return /^\d{2}$/.test(ref.stateFips) && /^\d{3}$/.test(ref.countyFips);
}

/**
 * Normalize a tract polygon to MultiPolygon coordinates.
 *
 * The `seed_public_census_tract` RPC casts to `geometry(MultiPolygon, 4326)`,
 * which REJECTS a plain Polygon. TIGERweb returns tracts as either, so a single
 * Polygon must be wrapped before it reaches the RPC — otherwise a county of
 * single-polygon tracts would fail to ingest entirely.
 */
export function toMultiPolygonGeoJson(geometry: GeoJSON.Geometry): GeoJSON.MultiPolygon | null {
  if (geometry.type === "MultiPolygon") return geometry as GeoJSON.MultiPolygon;
  if (geometry.type === "Polygon") {
    return { type: "MultiPolygon", coordinates: [(geometry as GeoJSON.Polygon).coordinates] };
  }
  return null;
}

/**
 * All tract geometries in a county, paged out of TIGERweb.
 *
 * Queried by the county's own STATE/COUNTY fields rather than a bounding box, so
 * a county is complete and exact — no neighbor tracts leaking in, none clipped
 * out at the edge.
 */
export async function fetchCountyTractGeometry(ref: CountyRef): Promise<TractGeometry[]> {
  const out: TractGeometry[] = [];
  let offset = 0;

  for (let page = 0; page < MAX_TIGERWEB_PAGES; page += 1) {
    const params = new URLSearchParams({
      where: `STATE='${ref.stateFips}' AND COUNTY='${ref.countyFips}'`,
      outFields: "GEOID,NAME,BASENAME",
      returnGeometry: "true",
      outSR: "4326",
      f: "geojson",
      resultOffset: String(offset),
      resultRecordCount: String(TIGERWEB_PAGE_SIZE),
    });

    const data = await fetchJsonWithRetry<TigerResponse>(`${TIGERWEB_TRACTS_URL}?${params.toString()}`, undefined, {
      timeoutMs: 20000,
      retries: 1,
      cacheTtlMs: 6 * 60 * 60 * 1000,
      cacheKey: `tiger-county-tracts:${ref.stateFips}:${ref.countyFips}:${offset}`,
    });

    const features = data?.features ?? [];
    for (const feature of features) {
      if (!feature.geometry) continue;
      const geoid = String(feature.properties?.GEOID ?? "").trim();
      if (!geoid) continue;
      out.push({
        geoid,
        name: String(feature.properties?.NAME ?? feature.properties?.BASENAME ?? geoid),
        geometry: feature.geometry,
      });
    }

    const more =
      features.length >= TIGERWEB_PAGE_SIZE &&
      (data?.exceededTransferLimit === true || data?.properties?.exceededTransferLimit === true);
    if (!more) break;
    offset += features.length;
  }

  return out;
}

/**
 * Ingest one county's tracts: join geometry to ACS demographics and upsert.
 *
 * Either source coming back empty is a distinct, reported outcome rather than a
 * silent partial write — an agency needs to know whether "no equity data" means
 * the county has none published or the fetch failed.
 */
export async function ingestCensusTractsForCounty(
  service: SupabaseClient,
  ref: CountyRef
): Promise<CountyIngestResult> {
  const base: CountyIngestResult = {
    stateFips: ref.stateFips,
    countyFips: ref.countyFips,
    status: "failed",
    tractsUpserted: 0,
    unmatched: 0,
    error: null,
  };

  if (!isValidCountyRef(ref)) {
    return { ...base, error: "Invalid county reference (need 2-digit state + 3-digit county FIPS)" };
  }

  let geometries: TractGeometry[];
  let acs: Awaited<ReturnType<typeof fetchAcsForCounties>>;
  try {
    [geometries, acs] = await Promise.all([
      fetchCountyTractGeometry(ref),
      fetchAcsForCounties([{ state: ref.stateFips, county: ref.countyFips }]),
    ]);
  } catch (error) {
    return { ...base, error: error instanceof Error ? error.message : "Fetch failed" };
  }

  if (geometries.length === 0) {
    return { ...base, status: "no_tracts" };
  }
  if (acs.length === 0) {
    return { ...base, status: "no_demographics" };
  }

  const acsByGeoid = new Map(acs.map((tract) => [tract.geoid, tract]));
  let upserted = 0;
  let unmatched = 0;

  for (const geometry of geometries) {
    const demographics = acsByGeoid.get(geometry.geoid);
    const multiPolygon = toMultiPolygonGeoJson(geometry.geometry);
    if (!demographics || !multiPolygon) {
      unmatched += 1;
      continue;
    }

    const { error } = await service.rpc("seed_public_census_tract", {
      p_geoid: geometry.geoid,
      p_state_fips: ref.stateFips,
      p_county_fips: ref.countyFips,
      p_name: geometry.name,
      p_geometry_geojson: multiPolygon,
      p_pop_total: demographics.population,
      p_pop_white: demographics.popWhiteNonHispanic,
      p_households: demographics.totalHouseholds,
      p_households_zero_vehicle: demographics.zeroVehicleHouseholds,
      p_median_household_income: demographics.medianIncome,
      p_pop_below_poverty: demographics.popBelowPoverty,
    });

    if (error) {
      return {
        ...base,
        status: "failed",
        tractsUpserted: upserted,
        unmatched,
        error: `Upsert failed at ${geometry.geoid}: ${error.message}`,
      };
    }
    upserted += 1;
  }

  return {
    stateFips: ref.stateFips,
    countyFips: ref.countyFips,
    status: "ingested",
    tractsUpserted: upserted,
    unmatched,
    error: null,
  };
}
