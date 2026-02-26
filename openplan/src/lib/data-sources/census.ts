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

import { fetchJsonWithRetry } from "./http";

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
}

interface BBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

const CENSUS_BASE = "https://api.census.gov/data";
const ACS_YEAR = "2023"; // latest 5-year ACS
const ACS_DATASET = "acs/acs5";
const CENSUS_API_KEY = process.env.CENSUS_API_KEY;

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
export function bboxFromGeojson(geojson: { type: string; coordinates: number[][][] | number[][][][] }): BBox {
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
    return { minLon: -124.3, maxLon: -121.8, minLat: 39.0, maxLat: 40.4 };
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
 */
async function fetchAcsForCounties(
  counties: Array<{ state: string; county: string }>
): Promise<CensusTractData[]> {
  const countyResults = await Promise.all(
    counties.map(async ({ state, county }) => {
      const url =
        `${CENSUS_BASE}/${ACS_YEAR}/${ACS_DATASET}?get=NAME,${VARIABLES}` +
        `&for=tract:*&in=state:${state}%20county:${county}` +
        (CENSUS_API_KEY ? `&key=${encodeURIComponent(CENSUS_API_KEY)}` : "");

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
        } satisfies CensusTractData;
      });
    })
  );

  return countyResults.flat();
}

/**
 * Summarize tract-level data into corridor-level statistics.
 */
function summarizeTracts(tracts: CensusTractData[]): CensusSummary {
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
  };
}

/**
 * Main entry: fetch Census/ACS data for tracts overlapping a corridor.
 */
export async function fetchCensusForCorridor(
  corridorGeojson: { type: string; coordinates: number[][][] | number[][][][] }
): Promise<CensusSummary> {
  const bbox = bboxFromGeojson(corridorGeojson);
  const counties = await resolveCountiesFromBbox(bbox);

  if (counties.length === 0) {
    return summarizeTracts([]);
  }

  const tracts = await fetchAcsForCounties(counties);

  const dedupedTracts = Array.from(
    new Map(tracts.map((tract) => [tract.geoid, tract])).values()
  );

  return summarizeTracts(dedupedTracts);
}
