/**
 * Census / American Community Survey (ACS) data fetcher.
 *
 * Uses the Census Bureau API to pull demographics for census tracts
 * that intersect a given bounding box derived from a corridor polygon.
 *
 * Key tables used:
 *   - B01003_001E  Total population
 *   - B19013_001E  Median household income
 *   - B08301_001E  Total commuters (means of transport to work)
 *   - B08301_010E  Public transit commuters
 *   - B08301_019E  Walk commuters
 *   - B08301_018E  Bicycle commuters
 *   - B08301_021E  Work from home
 *   - B25044_001E  Vehicles available (total)
 *   - B25044_003E  Zero-vehicle households (owner)
 *   - B25044_010E  Zero-vehicle households (renter)
 *   - B03002_001E  Total population (race/ethnicity)
 *   - B03002_003E  White non-Hispanic
 *   - B03002_004E  Black/African American
 *   - B03002_012E  Hispanic/Latino
 *   - B17001_001E  Poverty status (total)
 *   - B17001_002E  Below poverty level
 */

import { withCensusApiKey } from "./census-api-key";
import { fetchJsonWithRetry } from "./http";
import { pointInPolygon } from "@/lib/engagement/representativeness";

export interface CensusTractData {
  geoid: string;
  state: string;
  county: string;
  tract: string;
  population: number;
  medianIncome: number | null;
  totalCommuters: number;
  transitCommuters: number;
  walkCommuters: number;
  bikeCommuters: number;
  wfhCommuters: number;
  zeroVehicleHouseholds: number;
  totalHouseholds: number;
  pctMinority: number;
  pctBelowPoverty: number;
  // Raw counts retained alongside the derived percentages, because the
  // census_tracts table stores counts and its computed view derives the
  // percentages itself. Tract ingestion needs the counts; the corridor
  // scorecard uses the percentages. Keeping both means one ACS fetch serves
  // both rather than two parallel readers of the same endpoint.
  popWhiteNonHispanic: number;
  popBelowPoverty: number;
}

/**
 * Whether the returned demographics actually describe the drawn corridor or fell
 * back to the whole overlapping county set. This provenance MUST travel with the
 * numbers: a whole-county denominator read as if it were corridor-clipped is the
 * exact "confidently wrong" failure — the population/equity figures would be for
 * an area orders of magnitude larger than the study area, with nothing downstream
 * able to tell the difference.
 *
 * - `clipped`               — TIGER centroid clip succeeded; figures are corridor-scale.
 * - `unclipped_county_fallback` — clip was unavailable (TIGERweb hiccup) or matched
 *                             no tract (a corridor smaller than any tract centroid),
 *                             so figures cover the WHOLE overlapping county set.
 * - `empty`                 — no resolvable geography or no ACS data; figures are zero.
 */
export type CensusClipStatus = "clipped" | "unclipped_county_fallback" | "empty";

export interface CensusClipProvenance {
  status: CensusClipStatus;
  /** Tracts whose TIGER centroid falls inside the corridor (0 unless clipped). */
  corridorTracts: number;
  /** Tracts in the overlapping counties — the size of the fallback set. */
  countyTracts: number;
  /** Number of counties the corridor bbox overlaps. */
  counties: number;
}

/**
 * Which ACS universes actually had a denominator, per corridor.
 *
 * THE DEFECT THIS EXISTS FOR. Every scalar on `CensusSummary` is a `number`, and
 * every one of them is `0` when nothing was measured: `summarizeCensusTracts([])`
 * returns a fully-zeroed summary, and `pct(n, 0)` returns `0` rather than
 * refusing to answer. Those zeros then travelled as findings — "Population: 0",
 * "0% transit, 0% walk, 0% bike", "0% of households have zero vehicles" — into
 * the corridor scorecard, the deterministic summary, and (via
 * `buildInterpretationFacts`, which drops nulls and keeps zeros) into the
 * grant narrative as CITABLE facts. A corridor whose ACS read returned nothing
 * was therefore describable as a measured place with no people and no transit
 * riders, which is a stronger and more actionable claim than the truth.
 *
 * The crash lane already solved this shape: `CrashSummary.observed` is the fact,
 * and unobserved counts are nulled at the metrics boundary rather than narrated.
 * This is the same fix for the demographic lane, one universe at a time, because
 * an ACS read can answer some universes and not others.
 *
 * `false` means NOT MEASURED, which is a different fact from a measured zero and
 * must be rendered and cited differently. A tract with a genuine population of
 * zero (an industrial or park tract) is a measurement and stays `population:
 * true` — the discriminator is whether a DENOMINATOR existed, never whether the
 * numerator happened to be zero.
 */
export interface CensusMeasuredUniverses {
  /** Any tract rows at all. False means nothing below was measured either. */
  tracts: boolean;
  /** Population universe (B01003) — the denominator for the race/poverty shares. */
  population: boolean;
  /** Commute universe (B08301 total) — the denominator for every mode share. */
  commuteMode: boolean;
  /** Household universe (B25044 total) — the denominator for zero-vehicle share. */
  vehicleAccess: boolean;
  /** At least one tract reported a median income AND had population to weight it. */
  income: boolean;
}

export interface CensusSummary {
  tracts: CensusTractData[];
  totalPopulation: number;
  totalCommuters: number;
  medianIncomeWeighted: number | null;
  pctTransit: number;
  pctWalk: number;
  pctBike: number;
  pctWfh: number;
  pctZeroVehicle: number;
  pctMinority: number;
  pctBelowPoverty: number;
  /** How faithfully these figures describe the drawn corridor — see the type doc. */
  clip: CensusClipProvenance;
  /**
   * Which of the figures above are measurements and which are placeholder zeros.
   * Read this before narrating, rendering, or citing any of them — or call
   * `censusReportedFigures`, which applies it for you.
   */
  measured: CensusMeasuredUniverses;
}

/**
 * The corridor's ACS figures with every unmeasured one replaced by `null`.
 *
 * This is the boundary the rest of the app should consume. `null` is load-bearing
 * in three places at once: render sites already print "N/A" / "Not measured" for
 * it, `buildInterpretationFacts` DROPS null metrics so the model physically
 * cannot cite a figure nobody measured, and the deterministic summary can test it
 * to decide whether to write a sentence at all.
 */
export interface CensusReportedFigures {
  totalPopulation: number | null;
  medianIncome: number | null;
  pctTransit: number | null;
  pctWalk: number | null;
  pctBike: number | null;
  pctWfh: number | null;
  pctZeroVehicle: number | null;
  pctMinority: number | null;
  pctBelowPoverty: number | null;
}

/**
 * Apply the measurement coverage to the figures. One function, so the scorecard,
 * the narrative, the report, and the AI fact list cannot disagree about which
 * numbers exist — the divergence CLAUDE.md names as the seam-defect class.
 */
export function censusReportedFigures(census: CensusSummary): CensusReportedFigures {
  const measured = census.measured;
  return {
    totalPopulation: measured.tracts ? census.totalPopulation : null,
    medianIncome: measured.income ? census.medianIncomeWeighted : null,
    pctTransit: measured.commuteMode ? census.pctTransit : null,
    pctWalk: measured.commuteMode ? census.pctWalk : null,
    pctBike: measured.commuteMode ? census.pctBike : null,
    pctWfh: measured.commuteMode ? census.pctWfh : null,
    pctZeroVehicle: measured.vehicleAccess ? census.pctZeroVehicle : null,
    pctMinority: measured.population ? census.pctMinority : null,
    pctBelowPoverty: measured.population ? census.pctBelowPoverty : null,
  };
}

/**
 * Why a universe has no figures, in a planner's words. Returned for the universes
 * that were NOT measured; `null` for the ones that were. The wording says what
 * did not happen, never "none found" — an unanswered read is not a finding of
 * zero.
 */
export function censusUniverseUnavailableNote(
  census: CensusSummary,
  universe: keyof CensusMeasuredUniverses
): string | null {
  if (census.measured[universe]) return null;
  if (!census.measured.tracts) {
    return "No census tract data was returned for this study area, so nothing here was measured.";
  }
  switch (universe) {
    case "population":
      return "The census tracts here reported no population universe, so population-weighted shares were not measured.";
    case "commuteMode":
      return "The census tracts here reported no commuter universe, so commute mode shares were not measured.";
    case "vehicleAccess":
      return "The census tracts here reported no household universe, so vehicle access was not measured.";
    case "income":
      return "No census tract here reported a median household income that could be population-weighted.";
    default:
      return "This figure was not measured for the study area.";
  }
}

const EMPTY_CLIP: CensusClipProvenance = {
  status: "empty",
  corridorTracts: 0,
  countyTracts: 0,
  counties: 0,
};

const NOTHING_MEASURED: CensusMeasuredUniverses = {
  tracts: false,
  population: false,
  commuteMode: false,
  vehicleAccess: false,
  income: false,
};

interface BBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

const CENSUS_BASE = "https://api.census.gov/data";
/**
 * The ACS 5-year vintage this module actually queries. Exported as the single
 * source of truth so provenance a consumer stamps on results (source id,
 * vintage, retrieval URL) is DERIVED from the year we fetched — never a separate
 * literal that can silently drift and claim the wrong vintage. Bump this one
 * place when a newer 5-year release lands.
 */
export const ACS_YEAR = "2023";
const ACS_DATASET = "acs/acs5";

/** Canonical ACS retrieval URL base for the vintage above (no key, no query). */
export const ACS_RETRIEVAL_URL = `${CENSUS_BASE}/${ACS_YEAR}/${ACS_DATASET}`;
// The key itself is attached by `withCensusApiKey` — the single place that
// knows how, so a new call site cannot omit it (see census-api-key.ts).

// TIGERweb tract/block-group layer used to corridor-clip the tract set. Layer 8
// returns 12-digit block-group-like GEOIDs + centroids; truncating to 11 digits
// gives the tract GEOID. Same layer the AequilibraE worker uses
// (workers/aequilibrae_worker/data_pipeline.py), so the app-side sketch lane
// sees the SAME corridor-scale study area.
const TIGER_TRACT_LAYER =
  "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/8/query";

const VARIABLES = [
  "B01003_001E", // total pop
  "B19013_001E", // median income
  "B08301_001E", // total commuters
  "B08301_010E", // transit
  "B08301_019E", // walk
  "B08301_018E", // bike
  "B08301_021E", // wfh
  "B25044_001E", // total HH (vehicles)
  "B25044_003E", // 0-veh owner
  "B25044_010E", // 0-veh renter
  "B03002_001E", // total pop (race)
  "B03002_003E", // white non-hisp
  "B17001_001E", // poverty total
  "B17001_002E", // below poverty
].join(",");

/**
 * Compute a bounding box from a GeoJSON polygon/multipolygon.
 */
/**
 * Bounding box of a study-area geometry, or null when it has no usable
 * coordinates.
 *
 * This MUST fail closed. It previously returned a Northern California box for a
 * degenerate geometry, and because the result feeds real ACS/LODES/crash
 * queries — not just a map camera — a user anywhere on Earth with an empty or
 * malformed geometry silently received demographics for Northern California.
 * Silently wrong is far worse than empty: nothing downstream could tell the
 * difference between "this is your area" and "this is somebody else's".
 */
export function bboxFromGeojson(geojson: { type: string; coordinates: number[][][] | number[][][][] }): BBox | null {
  const coords: number[][] = [];

  if (geojson.type === "Polygon") {
    for (const ring of geojson.coordinates as number[][][]) {
      for (const pt of ring) {
        coords.push(pt);
      }
    }
  } else {
    for (const poly of geojson.coordinates as number[][][][]) {
      for (const ring of poly) {
        for (const pt of ring) {
          coords.push(pt);
        }
      }
    }
  }

  if (coords.length === 0) {
    return null;
  }

  const lons = coords.map((c) => c[0]);
  const lats = coords.map((c) => c[1]);

  return {
    minLon: Math.min(...lons),
    maxLon: Math.max(...lons),
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
  };
}

/**
 * Determine which FIPS state+county codes overlap the bounding box.
 * Uses the Census geocoder to look up the four corners.
 */
async function resolveCountiesFromBbox(bbox: BBox): Promise<Array<{ state: string; county: string }>> {
  // Use the FCC Census Block API for fast point-to-FIPS lookups
  const corners = [
    [bbox.minLon, bbox.minLat],
    [bbox.maxLon, bbox.minLat],
    [bbox.minLon, bbox.maxLat],
    [bbox.maxLon, bbox.maxLat],
    [(bbox.minLon + bbox.maxLon) / 2, (bbox.minLat + bbox.maxLat) / 2], // centroid
  ];

  const seen = new Set<string>();
  const results: Array<{ state: string; county: string }> = [];

  for (const [lon, lat] of corners) {
    const url = `https://geo.fcc.gov/api/census/block/find?latitude=${lat}&longitude=${lon}&format=json`;
    const data = await fetchJsonWithRetry<{ Block?: { FIPS?: string } }>(url, undefined, {
      timeoutMs: 6000,
      retries: 1,
      cacheTtlMs: 24 * 60 * 60 * 1000,
      cacheKey: `fcc:${lat.toFixed(4)}:${lon.toFixed(4)}`,
    });

    const fips = data?.Block?.FIPS;
    if (!fips || fips.length < 5) continue;

    const state = fips.substring(0, 2);
    const county = fips.substring(2, 5);
    const key = `${state}${county}`;
    if (!seen.has(key)) {
      seen.add(key);
      results.push({ state, county });
    }
  }

  return results;
}

/**
 * Fetch ACS data for all tracts in the given counties.
 *
 * Exported so census-tract ingestion reuses the exact same national ACS query
 * (any US county, keyless-optional) rather than standing up a parallel fetcher.
 */
export async function fetchAcsForCounties(
  counties: Array<{ state: string; county: string }>
): Promise<CensusTractData[]> {
  const countyResults = await Promise.all(
    counties.map(async ({ state, county }) => {
      const url = withCensusApiKey(
        `${CENSUS_BASE}/${ACS_YEAR}/${ACS_DATASET}?get=NAME,${VARIABLES}` +
          `&for=tract:*&in=state:${state}%20county:${county}`
      );

      const rows = await fetchJsonWithRetry<string[][]>(url, undefined, {
        timeoutMs: 14000,
        retries: 1,
        cacheTtlMs: 6 * 60 * 60 * 1000,
        cacheKey: `acs:${ACS_YEAR}:${state}:${county}`,
      });

      if (!rows || rows.length < 2) {
        return [] as CensusTractData[];
      }

      const header = rows[0];
      const colIndex = (name: string) => header.indexOf(name);

      return rows.slice(1).map((row) => {
        const num = (col: string): number => {
          const val = parseInt(row[colIndex(col)], 10);
          return isNaN(val) || val < 0 ? 0 : val;
        };
        const numOrNull = (col: string): number | null => {
          const val = parseInt(row[colIndex(col)], 10);
          return isNaN(val) || val < 0 ? null : val;
        };

        const totalPop = num("B01003_001E");
        const totalPopRace = num("B03002_001E");
        const whiteNonHisp = num("B03002_003E");
        const povertyTotal = num("B17001_001E");
        const belowPoverty = num("B17001_002E");
        const zeroVehOwner = num("B25044_003E");
        const zeroVehRenter = num("B25044_010E");
        const totalHH = num("B25044_001E");

        const stFips = row[colIndex("state")];
        const coFips = row[colIndex("county")];
        const trFips = row[colIndex("tract")];

        return {
          geoid: `${stFips}${coFips}${trFips}`,
          state: stFips,
          county: coFips,
          tract: trFips,
          population: totalPop,
          medianIncome: numOrNull("B19013_001E"),
          totalCommuters: num("B08301_001E"),
          transitCommuters: num("B08301_010E"),
          walkCommuters: num("B08301_019E"),
          bikeCommuters: num("B08301_018E"),
          wfhCommuters: num("B08301_021E"),
          zeroVehicleHouseholds: zeroVehOwner + zeroVehRenter,
          totalHouseholds: totalHH,
          pctMinority: totalPopRace > 0 ? Math.round(((totalPopRace - whiteNonHisp) / totalPopRace) * 1000) / 10 : 0,
          pctBelowPoverty: povertyTotal > 0 ? Math.round((belowPoverty / povertyTotal) * 1000) / 10 : 0,
          popWhiteNonHispanic: whiteNonHisp,
          popBelowPoverty: belowPoverty,
        } satisfies CensusTractData;
      });
    })
  );

  return countyResults.flat();
}

/**
 * Summarize tract-level data into corridor-level statistics.
 */
export function summarizeCensusTracts(
  tracts: CensusTractData[],
  clip: CensusClipProvenance = EMPTY_CLIP
): CensusSummary {
  if (tracts.length === 0) {
    return {
      tracts: [],
      totalPopulation: 0,
      totalCommuters: 0,
      medianIncomeWeighted: null,
      pctTransit: 0,
      pctWalk: 0,
      pctBike: 0,
      pctWfh: 0,
      pctZeroVehicle: 0,
      pctMinority: 0,
      pctBelowPoverty: 0,
      clip,
      // The zeros above are placeholders, not readings. They are kept as numbers
      // so the scoring engine's arithmetic stays total, and disowned here so no
      // render, narrative, or citation can present them as findings.
      measured: NOTHING_MEASURED,
    };
  }

  const totalPop = tracts.reduce((s, t) => s + t.population, 0);
  const totalCommuters = tracts.reduce((s, t) => s + t.totalCommuters, 0);
  const totalTransit = tracts.reduce((s, t) => s + t.transitCommuters, 0);
  const totalWalk = tracts.reduce((s, t) => s + t.walkCommuters, 0);
  const totalBike = tracts.reduce((s, t) => s + t.bikeCommuters, 0);
  const totalWfh = tracts.reduce((s, t) => s + t.wfhCommuters, 0);
  const totalZeroVeh = tracts.reduce((s, t) => s + t.zeroVehicleHouseholds, 0);
  const totalHH = tracts.reduce((s, t) => s + t.totalHouseholds, 0);

  // Population-weighted median income
  const incomeTracts = tracts.filter((t) => t.medianIncome !== null && t.population > 0);
  const weightedIncome =
    incomeTracts.length > 0
      ? Math.round(
          incomeTracts.reduce((s, t) => s + (t.medianIncome! * t.population), 0) /
            incomeTracts.reduce((s, t) => s + t.population, 0)
        )
      : null;

  // Aggregate minority and poverty
  const totalPopRace = tracts.reduce((s, t) => s + t.population, 0);
  const weightedMinority =
    totalPopRace > 0
      ? Math.round(
          (tracts.reduce((s, t) => s + (t.pctMinority / 100) * t.population, 0) / totalPopRace) * 1000
        ) / 10
      : 0;

  const povertyDenominator = tracts.reduce(
    (s, t) => s + (t.pctBelowPoverty > 0 ? t.population : 0),
    0
  );
  const weightedPoverty =
    povertyDenominator > 0
      ? Math.round(
          (tracts.reduce((s, t) => s + (t.pctBelowPoverty / 100) * t.population, 0) / povertyDenominator) *
            1000
        ) / 10
      : 0;

  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);

  return {
    tracts,
    totalPopulation: totalPop,
    totalCommuters,
    medianIncomeWeighted: weightedIncome,
    pctTransit: pct(totalTransit, totalCommuters),
    pctWalk: pct(totalWalk, totalCommuters),
    pctBike: pct(totalBike, totalCommuters),
    pctWfh: pct(totalWfh, totalCommuters),
    pctZeroVehicle: pct(totalZeroVeh, totalHH),
    pctMinority: weightedMinority,
    pctBelowPoverty: weightedPoverty,
    clip,
    // A universe is measured when its DENOMINATOR exists. A zero numerator over a
    // real denominator (nobody walks to work here) is a finding and stays one;
    // a zero over a zero denominator is the absence of a reading.
    measured: {
      tracts: true,
      population: totalPop > 0,
      commuteMode: totalCommuters > 0,
      vehicleAccess: totalHH > 0,
      income: incomeTracts.length > 0,
    },
  };
}

/**
 * Corridor-clip: the set of tract GEOIDs whose TIGER centroid falls inside the
 * drawn corridor polygon. Mirrors the AequilibraE worker's tract identification
 * so the app-side sketch lane sees the SAME corridor-scale study area, not every
 * tract in the overlapping counties. Returns null on any TIGERweb failure so the
 * caller falls back to the unclipped county set rather than erroring.
 */
async function fetchCorridorTractGeoids(
  corridorGeojson: { type: string; coordinates: number[][][] | number[][][][] },
  bbox: BBox
): Promise<Set<string> | null> {
  const url =
    `${TIGER_TRACT_LAYER}?where=1%3D1` +
    `&geometry=${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat}` +
    `&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects` +
    `&outFields=GEOID,CENTLAT,CENTLON&returnGeometry=false&inSR=4326&resultRecordCount=5000&f=json`;

  try {
    const payload = await fetchJsonWithRetry<{
      features?: Array<{ attributes?: { GEOID?: string; CENTLAT?: string; CENTLON?: string } }>;
      error?: unknown;
    }>(url, undefined, {
      timeoutMs: 20000,
      retries: 1,
      cacheTtlMs: 24 * 60 * 60 * 1000,
      cacheKey: `tiger-tracts:${bbox.minLon.toFixed(3)}:${bbox.minLat.toFixed(3)}:${bbox.maxLon.toFixed(3)}:${bbox.maxLat.toFixed(3)}`,
    });

    if (!payload || payload.error || !Array.isArray(payload.features)) return null;

    const geoids = new Set<string>();
    for (const feat of payload.features) {
      const attrs = feat.attributes ?? {};
      const rawGeoid = String(attrs.GEOID ?? "");
      if (!rawGeoid) continue;
      // Layer 8 serves 12-digit block-group ids; truncate to the 11-digit tract.
      const tractGeoid = rawGeoid.length > 11 ? rawGeoid.slice(0, 11) : rawGeoid;
      const lat = Number.parseFloat(String(attrs.CENTLAT ?? "").replace("+", ""));
      const lon = Number.parseFloat(String(attrs.CENTLON ?? "").replace("+", ""));
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      if (pointInPolygon(lon, lat, corridorGeojson as Parameters<typeof pointInPolygon>[2])) {
        geoids.add(tractGeoid);
      }
    }
    return geoids;
  } catch {
    return null;
  }
}

/**
 * Main entry: fetch Census/ACS data for tracts inside a corridor.
 *
 * The county ACS fetch returns every tract in the overlapping counties; the
 * result is then CLIPPED to tracts whose centroid falls inside the drawn
 * corridor, so a modest corridor in a populous county resolves to its true
 * study-area scale (fewer false sketch-cap trips) and the population denominator
 * is corridor-honest — not whole counties. Falls back to the unclipped set when
 * the clip is unavailable (TIGERweb hiccup) or empty (a corridor smaller than
 * any tract centroid) so a run never errors.
 */
export async function fetchCensusForCorridor(
  corridorGeojson: { type: string; coordinates: number[][][] | number[][][][] }
): Promise<CensusSummary> {
  const bbox = bboxFromGeojson(corridorGeojson);
  // No resolvable extent: report nothing rather than substituting a geography.
  if (!bbox) {
    return summarizeCensusTracts([]);
  }
  const counties = await resolveCountiesFromBbox(bbox);

  if (counties.length === 0) {
    return summarizeCensusTracts([]);
  }

  const [tracts, clipGeoids] = await Promise.all([
    fetchAcsForCounties(counties),
    fetchCorridorTractGeoids(corridorGeojson, bbox),
  ]);

  const dedupedTracts = Array.from(
    new Map(tracts.map((tract) => [tract.geoid, tract])).values()
  );

  // Tracts whose TIGER centroid falls inside the drawn corridor. Empty when the
  // clip was unavailable (TIGERweb hiccup → clipGeoids null) OR matched nothing
  // (a corridor smaller than any tract centroid, or a GEOID mismatch).
  const corridorTracts =
    clipGeoids && clipGeoids.size > 0
      ? dedupedTracts.filter((tract) => clipGeoids.has(tract.geoid))
      : [];

  // Keep the county set when the clip yields nothing so a run never errors — but
  // record that fallback honestly so downstream disclosure can say the figures
  // cover the whole county, not the corridor. Never present a fallback as a clip.
  const isClipped = corridorTracts.length > 0;
  const resultTracts = isClipped ? corridorTracts : dedupedTracts;
  const clip: CensusClipProvenance = {
    status:
      dedupedTracts.length === 0
        ? "empty"
        : isClipped
          ? "clipped"
          : "unclipped_county_fallback",
    corridorTracts: corridorTracts.length,
    countyTracts: dedupedTracts.length,
    counties: counties.length,
  };

  return summarizeCensusTracts(resultTracts, clip);
}
