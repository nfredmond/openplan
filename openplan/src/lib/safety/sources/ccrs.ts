/**
 * CCRS — California Crash Reporting System (Wave 8.1 primary crash source).
 *
 * WHY THIS SOURCE. CHP shut down iSWITRS on 2025-01-08 and replaced it with
 * CCRS. SWITRS therefore receives no new records: every SWITRS artifact — the
 * public SWITRS mirrors, the regional ArcGIS republications, the operator-local
 * CSV extract the corridor scorecard used to read — is frozen legacy data by
 * construction. CCRS is the live successor and CHP publishes it on
 * data.ca.gov with the CKAN DataStore enabled, which gives us:
 *
 *   - record-level crashes WITH coordinates, statewide,
 *   - arbitrary read-only SQL (so the bbox filter runs server-side),
 *   - no API key and no account,
 *   - "Other (Public Domain)" / "No restrictions on public use",
 *   - daily refresh (accrualPeriodicity R/P1D), 2016 → present.
 *
 * FIELD NOTES (verified against Crashes_2025, not assumed):
 *   - There is NO KABCO severity column. `Crashes_*` carries only NumberKilled
 *     and NumberInjured, so this adapter can separate fatal / injury / PDO but
 *     NOT suspected-serious-injury (KABCO A). Hence
 *     severityCompleteness = "fatal_injury_only". Serious injury lives on
 *     InjuredWitnessPassengers_YYYY.ExtentOfInjuryCode and requires a join —
 *     that is a separate, later slice, and until it lands nothing in this module
 *     may present a KSI figure.
 *   - `NumberKilled` is typed TEXT in the DataStore while `NumberInjured` is
 *     numeric. Both are parsed defensively here.
 *   - Pedestrian / bicyclist involvement is derived from
 *     MotorVehicleInvolvedWithDesc ('PEDESTRIAN' / 'BICYCLE').
 *   - `IsDeleted` marks retracted reports and is always filtered out.
 *   - Roughly 22% of records have no Latitude/Longitude. Those can never match a
 *     bbox predicate, so a bbox-only query silently under-counts. Passing
 *     `countyCode` gives the lossless denominator — see CrashFetchParams.
 *   - Per-year resource ids are resolved at runtime from the package manifest.
 *     They are NOT hardcoded: CKAN reissues resource ids, and a stale constant
 *     would fail closed in a way that looks like "no crashes here".
 */

import { fetchJsonWithRetry } from "@/lib/data-sources/http";
import type { StudyAreaBbox } from "@/lib/models/study-area";
import {
  deriveSeverityFromCounts,
  mapCrashDimension,
  toCasualtyCount,
  type CrashCollisionType,
  type CrashDimension,
  type CrashLighting,
  type CrashSeverity,
  type CrashWeather,
} from "@/lib/safety/vocabulary";
import { CCRS_CRASH_COLUMNS, CCRS_DIMENSION_SUPPORT, CCRS_VOCABULARY } from "./ccrs-vocabulary";
import { fetchCcrsParties } from "./ccrs-parties";
import {
  CrashSourceUnavailableError,
  type CrashFetchParams,
  type CrashFetchResult,
  type CrashRecord,
  type CrashSourceAdapter,
} from "./types";

export const CCRS_SOURCE_ID = "ccrs-ca";

const CKAN_BASE = "https://data.ca.gov/api/3/action";
const CCRS_PACKAGE_ID = "ccrs";
const CCRS_DATASET_URL = "https://lab.data.ca.gov/dataset/ccrs";

/** CCRS begins in 2016; requesting earlier years would silently return nothing. */
export const CCRS_EARLIEST_YEAR = 2016;

/** DataStore page size. CKAN accepts larger, but this keeps each response modest. */
const PAGE_SIZE = 1000;

/** Safety valve so a metropolitan county cannot page forever. */
const DEFAULT_MAX_RECORDS = 50_000;

const PACKAGE_CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * Generous CA envelope. Deliberately a coarse rejection filter, not a precise
 * boundary: its only job is to avoid pointless round-trips for clearly
 * out-of-state study areas. A bbox that merely overlaps this box still gets a
 * real query, and the returned records are authoritative about what is
 * genuinely in California.
 */
const CA_BOUNDS = { minLon: -124.6, maxLon: -114.0, minLat: 32.4, maxLat: 42.1 };

type CkanResource = { id?: unknown; name?: unknown; last_modified?: unknown };
type CkanPackageShow = { result?: { resources?: CkanResource[] } };
type CkanSqlResponse = { result?: { records?: Array<Record<string, unknown>> } };

/**
 * Overlap, not containment.
 *
 * The retired SWITRS reader used containment, which silently dropped any study
 * area straddling a state line — a real problem for Truckee, Tahoe, Yreka and
 * Needles. Overlap is the correct test: a corridor that crosses into Nevada
 * still has California crashes worth returning.
 */
export function overlapsCalifornia(bbox: StudyAreaBbox): boolean {
  return (
    bbox.minLon <= CA_BOUNDS.maxLon &&
    bbox.maxLon >= CA_BOUNDS.minLon &&
    bbox.minLat <= CA_BOUNDS.maxLat &&
    bbox.maxLat >= CA_BOUNDS.minLat
  );
}

function toFiniteNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toCoordinate(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number.parseFloat(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Derive a severity band from the two count columns CCRS actually has.
 *
 * TAKES RAW VALUES, NOT NUMBERS, and that signature is the fix. It used to take
 * two numbers, which meant its caller had already run a missing count through
 * `Math.max(0, …)` and handed it a 0 — so a collision whose casualty counts CCRS
 * never supplied arrived here as "nobody killed, nobody injured" and left as
 * property-damage-only. Probed 2025: 18,967 statewide records carry both counts
 * NULL (4.7%), 112 of 1,180 in one rural county (9.5%), and the person-level
 * table has no rows for them either — the outcome is genuinely unknown, not
 * zero. `NumberKilled` additionally carries '-1' in the wild, which the old
 * clamp also turned into 0.
 *
 * `severe_injury` remains intentionally unreachable here: it comes from the
 * person-level join, which upgrades rows in place afterwards.
 *
 * Numbers still work as inputs, so a caller with genuine counts is unaffected.
 */
export function deriveCcrsSeverity(killedRaw: unknown, injuredRaw: unknown): CrashSeverity {
  return deriveSeverityFromCounts(toCasualtyCount(killedRaw), toCasualtyCount(injuredRaw));
}

/** CCRS spells the involved party in MotorVehicleInvolvedWithDesc. */
export function deriveInvolvement(motorVehicleInvolvedWith: unknown): {
  pedestrianInvolved: boolean;
  bicyclistInvolved: boolean;
} {
  const desc = typeof motorVehicleInvolvedWith === "string" ? motorVehicleInvolvedWith.toUpperCase() : "";
  return {
    pedestrianInvolved: desc.includes("PEDESTRIAN"),
    bicyclistInvolved: desc.includes("BICYCLE"),
  };
}

/** CCRS "Crash Date Time" is an ISO timestamp; we keep the calendar date. */
export function toCollisionDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  return match ? match[0] : null;
}

export function collisionYearFromDate(date: string | null): number | null {
  if (!date) return null;
  const year = Number.parseInt(date.slice(0, 4), 10);
  return Number.isFinite(year) ? year : null;
}

/** Single-quote escaping for values interpolated into the DataStore SQL. */
function sqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Resolve `Crashes_<year>` → DataStore resource id from the live package
 * manifest. Cached briefly because an ingest asks for several years at once.
 */
async function fetchCcrsManifest(signal?: AbortSignal): Promise<{
  byYear: Map<number, string>;
  updatedByYear: Map<number, string>;
}> {
  const payload = await fetchJsonWithRetry<CkanPackageShow>(
    `${CKAN_BASE}/package_show?id=${CCRS_PACKAGE_ID}`,
    signal ? { signal } : undefined,
    {
      timeoutMs: 15_000,
      retries: 2,
      cacheTtlMs: PACKAGE_CACHE_TTL_MS,
      cacheKey: `ccrs:package:${CCRS_PACKAGE_ID}`,
    }
  );

  // A null payload means the request failed outright (fetchJsonWithRetry never
  // throws). Returning an empty map here would make every downstream year
  // resolve to "no crashes", which is how an outage becomes a safe-looking
  // corridor. Fail loudly instead.
  if (payload === null) {
    throw new CrashSourceUnavailableError(CCRS_SOURCE_ID, "data.ca.gov package manifest unreachable");
  }

  const byYear = new Map<number, string>();
  const updatedByYear = new Map<number, string>();
  for (const resource of payload?.result?.resources ?? []) {
    const name = typeof resource?.name === "string" ? resource.name : "";
    const id = typeof resource?.id === "string" ? resource.id : "";
    const match = /^Crashes_(\d{4})$/.exec(name);
    if (match && id) {
      const year = Number.parseInt(match[1], 10);
      byYear.set(year, id);
      const lastModified = typeof resource.last_modified === "string"
        ? /^(\d{4}-\d{2}-\d{2})/.exec(resource.last_modified.trim())?.[1] ?? null
        : null;
      if (lastModified) updatedByYear.set(year, lastModified);
    }
  }

  // The manifest answered but holds no Crashes_* resource at all: the dataset
  // was restructured. That is an outage of our integration, not an absence of
  // crashes in California.
  if (byYear.size === 0) {
    throw new CrashSourceUnavailableError(
      CCRS_SOURCE_ID,
      "data.ca.gov CCRS package lists no Crashes_<year> resources"
    );
  }

  return { byYear, updatedByYear };
}

export async function fetchCcrsResourceIds(signal?: AbortSignal): Promise<Map<number, string>> {
  return (await fetchCcrsManifest(signal)).byYear;
}

async function runSql<T = Record<string, unknown>>(sql: string, signal?: AbortSignal): Promise<T[]> {
  const payload = await fetchJsonWithRetry<CkanSqlResponse>(
    `${CKAN_BASE}/datastore_search_sql?sql=${encodeURIComponent(sql)}`,
    signal ? { signal } : undefined,
    { timeoutMs: 30_000, retries: 1 }
  );

  // Same reasoning as the manifest: `{ records: [] }` is "no matching crashes",
  // `null` is "the query never succeeded". Only the first is a finding.
  if (payload === null) {
    throw new CrashSourceUnavailableError(CCRS_SOURCE_ID, "data.ca.gov DataStore query failed");
  }

  return (payload.result?.records ?? []) as T[];
}

/**
 * Build the shared WHERE predicate.
 *
 * `requireCoordinates` is the switch between "what can be mapped" and "what was
 * reported": the count query runs without it so the operator can be told how
 * many crashes exist but cannot be plotted.
 */
function buildWhere(params: {
  bbox: StudyAreaBbox;
  countyCode?: number;
  requireCoordinates: boolean;
}): string {
  const clauses = [`"IsDeleted" = 'False'`];

  if (typeof params.countyCode === "number" && Number.isFinite(params.countyCode)) {
    clauses.push(`"County Code" = ${Math.trunc(params.countyCode)}`);
  }

  if (params.requireCoordinates) {
    const { minLat, maxLat, minLon, maxLon } = params.bbox;
    clauses.push(`"Latitude" BETWEEN ${minLat} AND ${maxLat}`);
    clauses.push(`"Longitude" BETWEEN ${minLon} AND ${maxLon}`);
  }

  return clauses.join(" AND ");
}

async function countForYear(
  resourceId: string,
  bbox: StudyAreaBbox,
  countyCode: number | undefined,
  requireCoordinates: boolean,
  signal?: AbortSignal
): Promise<number> {
  const where = buildWhere({ bbox, countyCode, requireCoordinates });
  const rows = await runSql<{ n?: unknown }>(
    `SELECT count(*) AS n FROM "${sqlLiteral(resourceId)}" WHERE ${where}`,
    signal
  );
  return Math.trunc(toFiniteNumber(rows[0]?.n));
}

/**
 * The columns this adapter requests, and the complete list of them.
 *
 * DELIBERATELY NARROW. `Crashes_2025` has 75 columns; these ten are the ones
 * with a reader shipping in this release. The rest are not "not yet mapped" —
 * several are refused on purpose, and the refusals are argued in
 * `ccrs-vocabulary.ts` (free-text violation codes, undocumented code-only
 * fields, a field that is 46% null) and in
 * `src/test/refused-crash-person-fields.test.ts` (everything that identifies a
 * person or alleges fault). Adding a column here is a product decision, not a
 * widening of a fetch.
 */
const CCRS_REQUESTED_COLUMNS = [
  CCRS_CRASH_COLUMNS.collisionId,
  CCRS_CRASH_COLUMNS.crashDateTime,
  CCRS_CRASH_COLUMNS.latitude,
  CCRS_CRASH_COLUMNS.longitude,
  CCRS_CRASH_COLUMNS.numberKilled,
  CCRS_CRASH_COLUMNS.numberInjured,
  CCRS_CRASH_COLUMNS.involvedWith,
  CCRS_CRASH_COLUMNS.collisionType,
  CCRS_CRASH_COLUMNS.lighting,
  CCRS_CRASH_COLUMNS.weather,
] as const;

/**
 * Map the three descriptor-driven dimensions off one CCRS row.
 *
 * Every unrecognised value is counted and its raw string kept: the tally is what
 * lets the ingest disclose "N values in this facet could not be classified", and
 * the raw string is what lets a later descriptor pick the value up without a
 * re-ingest being the only way to learn what was lost. Nothing is fuzzy-matched.
 */
function mapCcrsDimensions(row: Record<string, unknown>): {
  collisionType: CrashCollisionType | null;
  lighting: CrashLighting | null;
  weather: CrashWeather | null;
  sourceAttributes: Record<string, string>;
  unmapped: CrashDimension[];
} {
  const sourceAttributes: Record<string, string> = {};
  const unmapped: CrashDimension[] = [];

  const read = (dimension: CrashDimension, column: string) => {
    const mapping = mapCrashDimension(CCRS_VOCABULARY, dimension, row[column]);
    if (mapping === null) return null;
    if (mapping.unmapped && mapping.raw !== null) {
      sourceAttributes[column] = mapping.raw;
      unmapped.push(dimension);
    }
    return mapping.value;
  };

  return {
    collisionType: read("collision_type", CCRS_CRASH_COLUMNS.collisionType) as CrashCollisionType | null,
    lighting: read("lighting", CCRS_CRASH_COLUMNS.lighting) as CrashLighting | null,
    weather: read("weather", CCRS_CRASH_COLUMNS.weather) as CrashWeather | null,
    sourceAttributes,
    unmapped,
  };
}

async function fetchYearRecords(
  resourceId: string,
  bbox: StudyAreaBbox,
  countyCode: number | undefined,
  remaining: number,
  signal?: AbortSignal
): Promise<{ records: CrashRecord[]; truncated: boolean; unmapped: Partial<Record<CrashDimension, number>> }> {
  const where = buildWhere({ bbox, countyCode, requireCoordinates: true });
  const columns = CCRS_REQUESTED_COLUMNS.map((c) => `"${c}"`).join(",");

  const records: CrashRecord[] = [];
  const unmapped: Partial<Record<CrashDimension, number>> = {};
  let offset = 0;

  while (records.length < remaining) {
    const limit = Math.min(PAGE_SIZE, remaining - records.length);
    const rows = await runSql(
      `SELECT ${columns} FROM "${sqlLiteral(resourceId)}" WHERE ${where} ` +
        `ORDER BY "Collision Id" LIMIT ${limit} OFFSET ${offset}`,
      signal
    );

    for (const row of rows) {
      const latitude = toCoordinate(row[CCRS_CRASH_COLUMNS.latitude]);
      const longitude = toCoordinate(row[CCRS_CRASH_COLUMNS.longitude]);
      const rawId = row[CCRS_CRASH_COLUMNS.collisionId];
      const externalId = rawId == null ? "" : String(rawId).trim();
      // A row without usable coordinates or a case id cannot be mapped or
      // deduplicated, so it is dropped rather than stored half-formed. The
      // count query above is what keeps such rows visible to the operator.
      if (latitude === null || longitude === null || !externalId) continue;

      // NOT clamped to zero. `toCasualtyCount` yields null for a missing or
      // negative count, which is what makes the `unknown` severity band
      // reachable instead of collapsing into property-damage-only.
      const killedCount = toCasualtyCount(row[CCRS_CRASH_COLUMNS.numberKilled]);
      const injuredCount = toCasualtyCount(row[CCRS_CRASH_COLUMNS.numberInjured]);
      const collisionDate = toCollisionDate(row[CCRS_CRASH_COLUMNS.crashDateTime]);
      const dimensions = mapCcrsDimensions(row);
      for (const dimension of dimensions.unmapped) {
        unmapped[dimension] = (unmapped[dimension] ?? 0) + 1;
      }

      records.push({
        externalId,
        collisionDate,
        collisionYear: collisionYearFromDate(collisionDate),
        severity: deriveSeverityFromCounts(killedCount, injuredCount),
        killedCount,
        injuredCount,
        ...deriveInvolvement(row[CCRS_CRASH_COLUMNS.involvedWith]),
        // Crash-level involvement flags UNDERCOUNT, measurably: probed 2025, the
        // crash-level bicycle flag reports 10,221 collisions where 11,944 carry
        // a bicyclist party row (+16.9%), and pedestrians 12,789 vs 13,177
        // (+3.0%). Motorcyclists have no crash-level flag at all. The ingest
        // recomputes all three from person rows when it retrieved them, and
        // records which basis it used — see `ingest.ts`.
        motorcyclistInvolved: false,
        collisionType: dimensions.collisionType,
        lighting: dimensions.lighting,
        weather: dimensions.weather,
        sourceAttributes: dimensions.sourceAttributes,
        latitude,
        longitude,
        // CCRS is a California-only system, so every record is state 06. This
        // lets the multi-source read dedup a national backstop (FARS) against it.
        stateFips: "06",
        sourceId: CCRS_SOURCE_ID,
      });
    }

    if (rows.length < limit) {
      // Source exhausted for this year.
      return { records, truncated: false, unmapped };
    }
    offset += rows.length;
  }

  return { records, truncated: true, unmapped };
}

export async function fetchCcrsCrashes(params: CrashFetchParams): Promise<CrashFetchResult> {
  const maxRecords = params.maxRecords ?? DEFAULT_MAX_RECORDS;
  const manifest = await fetchCcrsManifest(params.signal);
  const resourceIds = manifest.byYear;

  // Clamp to years CCRS actually holds rather than reporting empty results for
  // years that never existed in the system.
  const years = Array.from(new Set(params.years))
    .filter((year) => Number.isFinite(year) && year >= CCRS_EARLIEST_YEAR && resourceIds.has(year))
    .sort((a, b) => b - a);

  const records: CrashRecord[] = [];
  const unmappedByDimension: Partial<Record<CrashDimension, number>> = {};
  let matchedTotal = 0;
  let geocodedTotal = 0;
  let truncated = false;

  for (const year of years) {
    const resourceId = resourceIds.get(year);
    if (!resourceId) continue;

    const geocodedForYear = await countForYear(resourceId, params.bbox, params.countyCode, true, params.signal);
    geocodedTotal += geocodedForYear;
    // Without a county filter an ungeocoded crash cannot be attributed to the
    // study area at all, so the reported total is only knowable via the county
    // path. Falling back to the geocoded count keeps the two figures honest
    // (equal) rather than inventing a larger denominator.
    matchedTotal +=
      typeof params.countyCode === "number"
        ? await countForYear(resourceId, params.bbox, params.countyCode, false, params.signal)
        : geocodedForYear;

    if (records.length >= maxRecords) {
      truncated = true;
      continue;
    }

    const page = await fetchYearRecords(
      resourceId,
      params.bbox,
      params.countyCode,
      maxRecords - records.length,
      params.signal
    );
    records.push(...page.records);
    truncated = truncated || page.truncated;
    for (const [dimension, count] of Object.entries(page.unmapped)) {
      const key = dimension as CrashDimension;
      unmappedByDimension[key] = (unmappedByDimension[key] ?? 0) + count;
    }
  }

  return {
    records,
    matchedTotal,
    geocodedTotal,
    yearsCovered: Array.from(
      new Set(records.map((r) => r.collisionYear).filter((y): y is number => typeof y === "number"))
    ).sort((a, b) => a - b),
    truncated,
    unmappedByDimension,
    // Every requested yearly crash table is refreshed independently. The
    // oldest exact `last_modified` date is the common publication cutoff we
    // can defend across the combined extract; a newer package timestamp would
    // overstate the older table. If even one selected table omits metadata, the
    // cutoff stays unavailable rather than being inferred from another year.
    publishedCutoff:
      years.length > 0 && years.every((year) => manifest.updatedByYear.has(year))
        ? {
            publishedThrough: years
              .map((year) => manifest.updatedByYear.get(year) as string)
              .sort()[0],
            provenance: {
              basis: "source_metadata",
              sourceUrl: CCRS_DATASET_URL,
              label: "CCRS yearly crash-resource last-modified metadata",
              retrievedAt: new Date().toISOString(),
            },
          }
        : undefined,
  };
}

export const ccrsAdapter: CrashSourceAdapter = {
  id: CCRS_SOURCE_ID,
  label: "California Crash Reporting System (CCRS)",
  attribution:
    "California Highway Patrol, California Crash Reporting System (CCRS), published on data.ca.gov. Public domain — no restrictions on public use.",
  license: "Other (Public Domain)",
  coverageState: "ccrs_ca_statewide",
  severityCompleteness: "fatal_injury_only",
  // Declared in the descriptor beside the mapping tables, not here: capability
  // and translation are one statement about a source, and splitting them is how
  // they drift.
  dimensions: CCRS_DIMENSION_SUPPORT,
  earliestYear: CCRS_EARLIEST_YEAR,
  persistable: true,
  // California only — a national backstop's records in state 06 are redundant
  // with CCRS and must be dropped when the two are merged.
  coversStateFips: ["06"],
  covers: overlapsCalifornia,
  fetch: fetchCcrsCrashes,
  fetchParties: fetchCcrsParties,
};
