/**
 * LEHD/LODES (Longitudinal Employer-Household Dynamics / LODES)
 *
 * Real employment comes from LODES8 Workplace Area Characteristics (WAC): a
 * keyless, public per-state .csv.gz keyed by 15-digit block GEOID, whose first
 * 11 chars are the tract GEOID and whose `C000` column is total jobs. We stream
 * the state file, sum jobs to tracts, and total over the study-area tracts —
 * mirroring the AequilibraE worker's port (workers/aequilibrae_worker/lodes.py)
 * so the app-side sketch/accessibility lanes read the SAME real jobs the worker
 * does. When the WAC file is unavailable (or no tracts are supplied) we fall
 * back to the clearly-labeled ACS estimate.
 */

import { gunzipSync } from "node:zlib";
import { stateUspsFromFips } from "@/lib/geographies/state-fips";

/** LODES vintage. Must match the worker's LODES_YEAR so the two lanes cite the
 * same evidence year. */
const LODES_YEAR = process.env.LODES_YEAR || "2022";

export interface LODESSummary {
  totalJobs: number;
  jobsByEarnings: {
    low: number;    // $1,250/mo or less (SE01 / CE01)
    mid: number;    // $1,251-$3,333/mo (SE02 / CE02)
    high: number;   // $3,333+/mo (SE03 / CE03)
  };
  jobsByIndustry: {
    goods: number;       // SI01 - Goods Producing
    trade: number;       // SI02 - Trade, Transportation, Utilities
    services: number;    // SI03 - All Other Services
  };
  inflow: number;     // workers commuting IN to corridor area
  outflow: number;    // workers commuting OUT from corridor area
  internal: number;   // live and work in corridor area
  jobsPerResident: number;
  // "lodes-wac" = real Census WAC jobs; "acs-estimate" = the population-based
  // fallback (flagged Estimated in transparency badges via isEstimatedSource).
  source: "lodes-wac" | "lodes-api" | "acs-estimate";
}

/**
 * Estimate employment data from Census ACS tract data when LODES API
 * is unavailable. Uses population-based heuristics calibrated to
 * national averages.
 */
export function estimateFromCensus(
  totalPopulation: number,
  totalCommuters: number
): LODESSummary {
  // National average: ~0.47 jobs per resident, ~60% labor force participation
  const estJobs = Math.round(totalPopulation * 0.47);
  const estCommuters = totalCommuters || Math.round(totalPopulation * 0.45);

  return {
    totalJobs: estJobs,
    jobsByEarnings: {
      low: Math.round(estJobs * 0.21),
      mid: Math.round(estJobs * 0.33),
      high: Math.round(estJobs * 0.46),
    },
    jobsByIndustry: {
      goods: Math.round(estJobs * 0.14),
      trade: Math.round(estJobs * 0.21),
      services: Math.round(estJobs * 0.65),
    },
    inflow: Math.round(estCommuters * 0.6),
    outflow: Math.round(estCommuters * 0.55),
    internal: Math.round(estCommuters * 0.15),
    jobsPerResident: totalPopulation > 0 ? Math.round((estJobs / totalPopulation) * 100) / 100 : 0,
    source: "acs-estimate",
  };
}

// --- Real LODES8 WAC (Workplace Area Characteristics) -----------------------

/** LODES WAC .csv.gz URL for a state (keyless, public). */
export function lodesWacUrl(stateAbbr: string, year: string = LODES_YEAR): string {
  const st = stateAbbr.toLowerCase();
  return `https://lehd.ces.census.gov/data/lodes/LODES8/${st}/wac/${st}_wac_S000_JT00_${year}.csv.gz`;
}

export interface LodesWacTractRow {
  totalJobs: number; // C000
  earnLow: number;   // CE01
  earnMid: number;   // CE02
  earnHigh: number;  // CE03
  goods: number;     // SI01 = CNS01,02,04,05
  trade: number;     // SI02 = CNS03,06,07,08
  services: number;  // SI03 = CNS09..CNS20
}

// LODES CNS NAICS-sector columns grouped into the three LODES industry segments.
const CNS_GOODS = ["CNS01", "CNS02", "CNS04", "CNS05"];
const CNS_TRADE = ["CNS03", "CNS06", "CNS07", "CNS08"];
const CNS_SERVICES = [
  "CNS09", "CNS10", "CNS11", "CNS12", "CNS13", "CNS14",
  "CNS15", "CNS16", "CNS17", "CNS18", "CNS19", "CNS20",
];

/**
 * Sum WAC rows (block-level) to 11-digit tract GEOIDs. Pure + unit-testable.
 * `w_geocode` = state[2]+county[3]+tract[6]+block[4]; take the first 11.
 */
export function aggregateWacByTract(csvText: string): Map<string, LodesWacTractRow> {
  const byTract = new Map<string, LodesWacTractRow>();
  const lines = csvText.split("\n");
  if (lines.length < 2) return byTract;

  const header = lines[0].replace(/\r$/, "").split(",");
  const col = (name: string) => header.indexOf(name);
  const iGeo = col("w_geocode");
  const iC000 = col("C000");
  if (iGeo < 0 || iC000 < 0) return byTract;

  const iCE01 = col("CE01"), iCE02 = col("CE02"), iCE03 = col("CE03");
  const goodsIdx = CNS_GOODS.map(col).filter((i) => i >= 0);
  const tradeIdx = CNS_TRADE.map(col).filter((i) => i >= 0);
  const servicesIdx = CNS_SERVICES.map(col).filter((i) => i >= 0);

  const at = (cols: string[], i: number) => (i >= 0 ? Number.parseInt(cols[i], 10) || 0 : 0);
  const sumAt = (cols: string[], idxs: number[]) => idxs.reduce((s, i) => s + (Number.parseInt(cols[i], 10) || 0), 0);

  for (let r = 1; r < lines.length; r += 1) {
    const line = lines[r];
    if (!line) continue;
    const cols = line.split(",");
    const geo = (cols[iGeo] || "").trim();
    if (geo.length < 11) continue;
    const tract = geo.slice(0, 11);
    const row = byTract.get(tract) ?? {
      totalJobs: 0, earnLow: 0, earnMid: 0, earnHigh: 0, goods: 0, trade: 0, services: 0,
    };
    row.totalJobs += at(cols, iC000);
    row.earnLow += at(cols, iCE01);
    row.earnMid += at(cols, iCE02);
    row.earnHigh += at(cols, iCE03);
    row.goods += sumAt(cols, goodsIdx);
    row.trade += sumAt(cols, tradeIdx);
    row.services += sumAt(cols, servicesIdx);
    byTract.set(tract, row);
  }
  return byTract;
}

// Warm-instance cache of a state's tract-summed WAC (keyed by state:year), so
// repeated runs in the same serverless instance don't re-download the file.
const wacTractCache = new Map<string, Map<string, LodesWacTractRow>>();

async function fetchStateWacByTract(
  stateAbbr: string,
  year: string = LODES_YEAR
): Promise<Map<string, LodesWacTractRow>> {
  const cacheKey = `${stateAbbr.toLowerCase()}:${year}`;
  const cached = wacTractCache.get(cacheKey);
  if (cached) return cached;

  const res = await fetch(lodesWacUrl(stateAbbr, year), { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`LODES WAC HTTP ${res.status} for ${stateAbbr} ${year}`);
  const gz = Buffer.from(await res.arrayBuffer());
  const csv = gunzipSync(gz).toString("utf-8");
  const byTract = aggregateWacByTract(csv);
  wacTractCache.set(cacheKey, byTract);
  return byTract;
}

/**
 * Real employment for a set of study-area tracts from LODES8 WAC. Groups tracts
 * by state, fetches each state's WAC once, and totals jobs over the study-area
 * tracts. Throws when a state file can't be fetched/parsed (the caller falls
 * back to the ACS estimate). WAC has no OD flows, so inflow/outflow/internal are
 * left 0 (they are not consumed downstream) rather than fabricated.
 */
export async function fetchLODESWacForTracts(
  tractGeoids: string[],
  totalPopulation: number,
  year: string = LODES_YEAR
): Promise<LODESSummary> {
  const geoidSet = new Set(tractGeoids.map((g) => g.slice(0, 11)).filter((g) => g.length === 11));
  const statesFips = new Set(Array.from(geoidSet, (g) => g.slice(0, 2)));

  let totalJobs = 0, low = 0, mid = 0, high = 0, goods = 0, trade = 0, services = 0;

  for (const fips of statesFips) {
    const abbr = stateUspsFromFips(fips);
    if (!abbr) continue;
    const byTract = await fetchStateWacByTract(abbr, year);
    for (const geoid of geoidSet) {
      if (geoid.slice(0, 2) !== fips) continue;
      const row = byTract.get(geoid);
      if (!row) continue;
      totalJobs += row.totalJobs;
      low += row.earnLow;
      mid += row.earnMid;
      high += row.earnHigh;
      goods += row.goods;
      trade += row.trade;
      services += row.services;
    }
  }

  const jobsPerResident = totalPopulation > 0 ? Math.round((totalJobs / totalPopulation) * 100) / 100 : 0;

  return {
    totalJobs,
    jobsByEarnings: { low, mid, high },
    jobsByIndustry: { goods, trade, services },
    inflow: 0,
    outflow: 0,
    internal: 0,
    jobsPerResident,
    source: "lodes-wac",
  };
}

/**
 * Employment for a corridor. Uses REAL LODES8 WAC when the study-area tract
 * GEOIDs are supplied; falls back to the clearly-labeled ACS estimate when they
 * are absent or the WAC file can't be fetched/parsed.
 */
export async function fetchLODESForCorridor(
  _corridorGeojson: { type: string; coordinates: unknown },
  totalPopulation: number,
  totalCommuters: number,
  tractGeoids?: string[]
): Promise<LODESSummary> {
  if (tractGeoids && tractGeoids.length > 0) {
    try {
      return await fetchLODESWacForTracts(tractGeoids, totalPopulation);
    } catch {
      // Real WAC unavailable (network/parse) — fall through to the honest,
      // Estimated-flagged ACS fallback rather than failing the run.
    }
  }
  return estimateFromCensus(totalPopulation, totalCommuters);
}
