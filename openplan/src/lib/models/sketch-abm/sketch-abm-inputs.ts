/**
 * Sketch ABM input builder — turns corridor-level Census/ACS tract summaries
 * and a corridor LODES employment summary into `ABMInputs` for `runABM`.
 *
 * Everything here is a SCREENING ASSUMPTION. Zones, the synthetic household
 * sample, and the distance-based skims are exploratory scaffolding for
 * comparing scenarios at sketch level; none of it is a validated network,
 * survey-expanded population, or calibrated level-of-service model. Each
 * constant below is annotated with the screening assumption it encodes.
 *
 * Determinism: all stochastic draws come from a single mulberry32 stream
 * seeded by the caller (same PRNG the sketch-abm test suite substitutes for
 * Math.random), consumed in a fixed iteration order (zones sorted by geoid),
 * so identical `{censusTracts, lodesJobs, seed}` inputs always produce
 * identical `ABMInputs`.
 */

import type { ABMInputs, Household, Person, SkimRow, Zone, ZoneSkims } from "./types";

/** Tract-level inputs the builder needs. `CensusTractData` from
 * `@/lib/data-sources/census` satisfies this shape structurally; centroid and
 * area fields are optional because the corridor ACS fetcher does not return
 * tract geometry (see the grid-placement screening assumption below). */
export interface SketchAbmTractInput {
  geoid: string;
  population: number;
  totalHouseholds: number;
  /** Optional real centroid longitude; when absent the zone is placed on a deterministic grid. */
  lon?: number;
  /** Optional real centroid latitude; when absent the zone is placed on a deterministic grid. */
  lat?: number;
  /** Optional real tract area; when absent DEFAULT_ZONE_AREA_SQ_KM applies. */
  areaSqKm?: number;
}

/** Corridor-level employment inputs. `LODESSummary` from
 * `@/lib/data-sources/lodes` satisfies this shape structurally. */
export interface SketchAbmLodesInput {
  totalJobs: number;
}

export interface SketchAbmInputParams {
  censusTracts: SketchAbmTractInput[];
  lodesJobs: SketchAbmLodesInput;
  seed: number;
}

export interface SketchAbmBuildResult {
  inputs: ABMInputs;
  /** Sum of real ACS households across all zones — the full household base
   * the capped synthetic sample stands in for. Callers use
   * totalRealHouseholds / syntheticHouseholds as the expansion factor when
   * scaling sample-level trip and VMT totals back to the full population. */
  totalRealHouseholds: number;
  /** Number of synthetic households actually generated (≤ roughly
   * SYNTHETIC_HOUSEHOLD_CAP plus one per small zone). */
  syntheticHouseholds: number;
}

// ---------------------------------------------------------------------------
// Screening constants (every value is a screening assumption, not calibration)
// ---------------------------------------------------------------------------

/** Screening assumption: cap on total synthetic households so the sketch run
 * stays in-process and fast; per-zone counts scale proportionally to real
 * ACS household counts. */
export const SYNTHETIC_HOUSEHOLD_CAP = 2000;

/** Screening assumption: default zone area (km²) when tract geometry is not
 * available — roughly a small-urban census tract footprint. */
export const DEFAULT_ZONE_AREA_SQ_KM = 4;

/** Screening assumption: network circuity factor applied to centroid
 * great-circle distances to approximate over-the-road distance. */
export const CIRCUITY_FACTOR = 1.3;

/** Screening assumption: average door-to-door auto speed (km/h). */
export const AUTO_SPEED_KMH = 45;

/** Screening assumption: average walking speed (km/h). */
export const WALK_SPEED_KMH = 4.8;

/** Screening assumption: average cycling speed (km/h). */
export const BIKE_SPEED_KMH = 15;

/** Screening assumption: transit in-vehicle time as a multiple of auto time. */
export const TRANSIT_IVTT_FACTOR = 1.5;

/** Screening assumption: flat transit wait time (minutes). */
export const TRANSIT_WAIT_MIN = 8;

/** Screening assumption: flat transit walk access + egress time (minutes). */
export const TRANSIT_ACCESS_WALK_MIN = 8;

/** Screening assumption: auto operating cost per km (dollars). */
export const AUTO_COST_PER_KM = 0.2;

/** Screening assumption: flat per-trip parking cost (dollars). */
export const AUTO_PARKING_COST = 1.0;

/** Screening assumption: flat transit fare (dollars). */
export const TRANSIT_FARE = 2.5;

/** Screening assumption: median household income anchor for the lognormal-ish
 * synthetic income draw ($75k screening median). */
export const SCREENING_MEDIAN_INCOME = 75000;

/** Screening assumption: dispersion (sigma) of the lognormal-ish income draw. */
export const INCOME_LOGNORMAL_SIGMA = 0.6;

/**
 * Fixed employment sector shares — the SAME screening shares the AequilibraE
 * worker applies to tract job totals (workers/aequilibrae_worker/
 * data_pipeline.py: retail 0.15, health 0.09, education 0.10,
 * accommodation 0.04, govt 0.07).
 */
export const SKETCH_ABM_SECTOR_SHARES = {
  retail: 0.15,
  health: 0.09,
  education: 0.1,
  accommodation: 0.04,
  govt: 0.07,
} as const;

/**
 * Mapping of the worker's five sector shares onto the sketch ABM `Zone` size
 * terms (screening assumption):
 *   - retail_employment      = retail (0.15)
 *   - service_employment     = health + accommodation (0.13) — service-facing
 *   - office_employment      = education + govt (0.17) — institutional/office
 *   - industrial_employment  = 0 — the worker's fixed shares classify no
 *     industrial sector; the remaining 0.55 of jobs stays only in
 *     total_employment (mirroring the worker, whose downstream demand uses
 *     total jobs only).
 * The mapped shares sum to 0.45 ≤ 1 by construction.
 */
export const SKETCH_ABM_ZONE_SECTOR_MAPPING = {
  retail_employment: SKETCH_ABM_SECTOR_SHARES.retail,
  service_employment: SKETCH_ABM_SECTOR_SHARES.health + SKETCH_ABM_SECTOR_SHARES.accommodation,
  office_employment: SKETCH_ABM_SECTOR_SHARES.education + SKETCH_ABM_SECTOR_SHARES.govt,
  industrial_employment: 0,
} as const;

/** Screening assumption: household size distribution (sizes 1–5, national-ish
 * mix rounded to sum to 1). */
const HOUSEHOLD_SIZE_DISTRIBUTION: ReadonlyArray<{ size: number; p: number }> = [
  { size: 1, p: 0.28 },
  { size: 2, p: 0.35 },
  { size: 3, p: 0.15 },
  { size: 4, p: 0.14 },
  { size: 5, p: 0.08 },
];

/** Screening assumption: household auto-ownership distribution. */
const AUTO_OWNERSHIP_DISTRIBUTION: ReadonlyArray<{ vehicles: number; p: number }> = [
  { vehicles: 0, p: 0.06 },
  { vehicles: 1, p: 0.32 },
  { vehicles: 2, p: 0.42 },
  { vehicles: 3, p: 0.2 },
];

/** Screening assumption: labor-force participation for the first and second
 * adult in a synthetic household. */
const FIRST_ADULT_WORKER_PROBABILITY = 0.65;
const SECOND_ADULT_WORKER_PROBABILITY = 0.5;

/** Screening assumption: building-type mix (single-family / multi-family /
 * mobile home). */
const BUILDING_TYPE_SPLITS = { single_family: 0.65, multi_family: 0.3 } as const;

/** Grid anchor for zones without real centroids. Only relative distances feed
 * the skims, so the absolute anchor is inert; it sits in the North State
 * pilot region for map-plausibility. */
const GRID_ANCHOR_LON = -121.0;
const GRID_ANCHOR_LAT = 39.0;

const EARTH_RADIUS_KM = 6371;
const KM_PER_DEGREE_LAT = 110.574;

// ---------------------------------------------------------------------------
// Deterministic PRNG
// ---------------------------------------------------------------------------

/** Deterministic PRNG (mulberry32) — same generator the sketch-abm test suite
 * substitutes for Math.random. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Derive a deterministic 32-bit seed from a model-run UUID (first 8 hex
 * digits), so a given run id always synthesizes the same inputs. */
export function seedFromRunId(runId: string): number {
  const hex = runId.replace(/-/g, "").slice(0, 8);
  const parsed = Number.parseInt(hex, 16);
  return Number.isFinite(parsed) ? parsed >>> 0 : 0;
}

// ---------------------------------------------------------------------------
// Zones
// ---------------------------------------------------------------------------

function gridPosition(index: number, count: number): { lon: number; lat: number } {
  // Screening assumption: when tract centroids are unavailable (the corridor
  // ACS fetcher returns no geometry), zones are placed on a deterministic
  // square grid ordered by geoid, spaced sqrt(DEFAULT_ZONE_AREA_SQ_KM) km
  // apart — a stand-in spatial arrangement for sketch-level distance skims,
  // not real tract geography.
  const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
  const spacingKm = Math.sqrt(DEFAULT_ZONE_AREA_SQ_KM);
  const row = Math.floor(index / cols);
  const col = index % cols;
  const lat = GRID_ANCHOR_LAT + (row * spacingKm) / KM_PER_DEGREE_LAT;
  const kmPerDegreeLon = KM_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180);
  const lon = GRID_ANCHOR_LON + (col * spacingKm) / kmPerDegreeLon;
  return { lon, lat };
}

function buildZones(tracts: SketchAbmTractInput[], totalJobs: number): Zone[] {
  const sorted = [...tracts].sort((a, b) => a.geoid.localeCompare(b.geoid));
  const totalPopulation = sorted.reduce((sum, tract) => sum + Math.max(0, tract.population), 0);

  return sorted.map((tract, index) => {
    const { lon, lat } =
      typeof tract.lon === "number" && typeof tract.lat === "number"
        ? { lon: tract.lon, lat: tract.lat }
        : gridPosition(index, sorted.length);

    // Screening assumption: the corridor LODES summary is not tract-resolved,
    // so total jobs distribute across zones proportionally to population
    // (evenly when the corridor has zero reported population).
    const populationShare =
      totalPopulation > 0 ? Math.max(0, tract.population) / totalPopulation : 1 / sorted.length;
    const zoneJobs = Math.round(totalJobs * populationShare);

    return {
      id: tract.geoid,
      total_employment: zoneJobs,
      retail_employment: Math.round(zoneJobs * SKETCH_ABM_ZONE_SECTOR_MAPPING.retail_employment),
      service_employment: Math.round(zoneJobs * SKETCH_ABM_ZONE_SECTOR_MAPPING.service_employment),
      office_employment: Math.round(zoneJobs * SKETCH_ABM_ZONE_SECTOR_MAPPING.office_employment),
      industrial_employment: Math.round(zoneJobs * SKETCH_ABM_ZONE_SECTOR_MAPPING.industrial_employment),
      total_households: Math.max(0, tract.totalHouseholds),
      population: Math.max(0, tract.population),
      area_sq_km: tract.areaSqKm && tract.areaSqKm > 0 ? tract.areaSqKm : DEFAULT_ZONE_AREA_SQ_KM,
      lon,
      lat,
    };
  });
}

// ---------------------------------------------------------------------------
// Households
// ---------------------------------------------------------------------------

function drawCategorical<T>(prng: () => number, entries: ReadonlyArray<{ p: number } & T>): T {
  const u = prng();
  let cumulative = 0;
  for (const entry of entries) {
    cumulative += entry.p;
    if (u < cumulative) return entry;
  }
  return entries[entries.length - 1];
}

/** Standard-normal draw via Box–Muller from two PRNG draws. */
function drawStandardNormal(prng: () => number): number {
  const u1 = Math.max(prng(), Number.EPSILON);
  const u2 = prng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Screening assumption: lognormal-ish income around the $75k screening
 * median, clamped to a plausible band. */
function drawIncome(prng: () => number): number {
  const z = drawStandardNormal(prng);
  const income = SCREENING_MEDIAN_INCOME * Math.exp(INCOME_LOGNORMAL_SIGMA * z);
  return Math.round(Math.min(500000, Math.max(10000, income)));
}

/** Map annual income onto the 1–6 income_category bands the sketch model
 * expects (screening bands: <25k, <50k, <75k, <100k, <150k, 150k+). */
function incomeCategory(income: number): number {
  if (income < 25000) return 1;
  if (income < 50000) return 2;
  if (income < 75000) return 3;
  if (income < 100000) return 4;
  if (income < 150000) return 5;
  return 6;
}

function synthesizePersons(
  householdId: string,
  size: number,
  income: number,
  prng: () => number
): Person[] {
  const persons: Person[] = [];
  const category = incomeCategory(income);
  // Screening assumption: the first two members are adults aged 25–64; any
  // further members are children aged 3–17 who are students from age 5.
  const adults = Math.min(size, 2);

  for (let index = 0; index < size; index += 1) {
    const isAdult = index < adults;
    const age = isAdult ? 25 + Math.floor(prng() * 40) : 3 + Math.floor(prng() * 15);
    const workerProbability =
      index === 0 ? FIRST_ADULT_WORKER_PROBABILITY : SECOND_ADULT_WORKER_PROBABILITY;

    persons.push({
      id: `${householdId}-p${index + 1}`,
      household_id: householdId,
      age,
      sex: prng() < 0.5 ? "M" : "F",
      worker: isAdult && prng() < workerProbability,
      student: !isAdult && age >= 5,
      income_category: category,
    });
  }

  return persons;
}

function buildHouseholds(zones: Zone[], prng: () => number): Household[] {
  const totalRealHouseholds = zones.reduce((sum, zone) => sum + zone.total_households, 0);
  // Screening assumption: proportional scaling against the synthetic cap;
  // any zone with at least one real household keeps at least one synthetic
  // household so it stays represented in the sketch.
  const scale =
    totalRealHouseholds > SYNTHETIC_HOUSEHOLD_CAP
      ? SYNTHETIC_HOUSEHOLD_CAP / totalRealHouseholds
      : 1;

  const households: Household[] = [];

  for (const zone of zones) {
    const zoneCount =
      zone.total_households > 0 ? Math.max(1, Math.round(zone.total_households * scale)) : 0;

    for (let index = 0; index < zoneCount; index += 1) {
      const householdId = `hh-${zone.id}-${index + 1}`;
      const { size } = drawCategorical(prng, HOUSEHOLD_SIZE_DISTRIBUTION);
      const income = drawIncome(prng);
      const persons = synthesizePersons(householdId, size, income, prng);
      const { vehicles } = drawCategorical(prng, AUTO_OWNERSHIP_DISTRIBUTION);
      const buildingDraw = prng();

      households.push({
        id: householdId,
        home_taz_id: zone.id,
        persons,
        income,
        vehicles,
        building_type:
          buildingDraw < BUILDING_TYPE_SPLITS.single_family
            ? "single_family"
            : buildingDraw < BUILDING_TYPE_SPLITS.single_family + BUILDING_TYPE_SPLITS.multi_family
              ? "multi_family"
              : "mobile_home",
      });
    }
  }

  return households;
}

// ---------------------------------------------------------------------------
// Skims
// ---------------------------------------------------------------------------

function greatCircleKm(aLon: number, aLat: number, bLon: number, bLat: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h =
    sinLat * sinLat + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * sinLon * sinLon;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function skimRowForDistance(rawKm: number): SkimRow {
  // Screening assumption: over-the-road distance = great-circle × circuity.
  const distKm = rawKm * CIRCUITY_FACTOR;
  const autoTime = (distKm / AUTO_SPEED_KMH) * 60;

  return {
    auto_time: autoTime,
    auto_dist: distKm,
    auto_cost: distKm * AUTO_COST_PER_KM + AUTO_PARKING_COST,
    transit_ivtt: autoTime * TRANSIT_IVTT_FACTOR,
    transit_walk_time: TRANSIT_ACCESS_WALK_MIN,
    transit_wait_time: TRANSIT_WAIT_MIN,
    transit_fare: TRANSIT_FARE,
    walk_time: (distKm / WALK_SPEED_KMH) * 60,
    bike_time: (distKm / BIKE_SPEED_KMH) * 60,
  };
}

function buildSkims(zones: Zone[]): { [originId: string]: ZoneSkims } {
  const rawDistances = new Map<string, number>();
  for (const origin of zones) {
    for (const dest of zones) {
      if (origin.id === dest.id) continue;
      rawDistances.set(
        `${origin.id}|${dest.id}`,
        greatCircleKm(origin.lon, origin.lat, dest.lon, dest.lat)
      );
    }
  }

  const skims: { [originId: string]: ZoneSkims } = {};

  for (const origin of zones) {
    const row: ZoneSkims = {};

    // Screening assumption: intrazonal distance = half the great-circle
    // distance to the nearest other zone; a single-zone corridor falls back
    // to the zone's square-root width.
    let nearestKm = Number.POSITIVE_INFINITY;
    for (const dest of zones) {
      if (dest.id === origin.id) continue;
      const raw = rawDistances.get(`${origin.id}|${dest.id}`);
      if (typeof raw === "number") {
        nearestKm = Math.min(nearestKm, raw);
      }
    }
    if (!Number.isFinite(nearestKm)) {
      nearestKm = Math.sqrt(origin.area_sq_km);
    }

    for (const dest of zones) {
      const rawKm =
        dest.id === origin.id
          ? nearestKm / 2
          : rawDistances.get(`${origin.id}|${dest.id}`) ?? 0;
      row[dest.id] = skimRowForDistance(rawKm);
    }

    skims[origin.id] = row;
  }

  return skims;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Build deterministic screening-grade `ABMInputs` from corridor tract and
 * LODES summaries, alongside the real-vs-synthetic household counts callers
 * need to expansion-weight sample-level outputs. Same params (including
 * seed) always yield identical output.
 */
export function buildSketchAbmInputs(params: SketchAbmInputParams): SketchAbmBuildResult {
  const prng = mulberry32(params.seed);
  const zones = buildZones(params.censusTracts, Math.max(0, params.lodesJobs.totalJobs));
  const households = buildHouseholds(zones, prng);
  const skims = buildSkims(zones);
  const totalRealHouseholds = zones.reduce((sum, zone) => sum + zone.total_households, 0);

  return {
    inputs: { households, zones, skims },
    totalRealHouseholds,
    syntheticHouseholds: households.length,
  };
}
