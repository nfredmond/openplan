/**
 * CCRS — California Crash Reporting System (Wave 8.1 primary crash source).
 *
 * WHY THIS SOURCE. CHP shut down iSWITRS on 2025-01-08 and replaced it with
 * CCRS. SWITRS therefore receives no new records: every SWITRS artifact — the
 * legacy `SWITRS_CSV_PATH` reader in `src/lib/data-sources/crashes.ts`, the
 * public SWITRS mirrors, the regional ArcGIS republications — is frozen legacy
 * data by construction. CCRS is the live successor and CHP publishes it on
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
import type {
  CrashFetchParams,
  CrashFetchResult,
  CrashRecord,
  CrashSeverity,
  CrashSourceAdapter,
} from "./types";

export const CCRS_SOURCE_ID = "ccrs-ca";

const CKAN_BASE = "https://data.ca.gov/api/3/action";
const CCRS_PACKAGE_ID = "ccrs";

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

type CkanResource = { id?: unknown; name?: unknown };
type CkanPackageShow = { result?: { resources?: CkanResource[] } };
type CkanSqlResponse = { result?: { records?: Array<Record<string, unknown>> } };

/**
 * Overlap, not containment.
 *
 * The legacy SWITRS reader used containment (`crashes.ts:115`), which silently
 * dropped any study area straddling a state line — a real problem for Truckee,
 * Tahoe, Yreka and Needles. Overlap is the correct test: a corridor that crosses
 * into Nevada still has California crashes worth returning.
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
 * Derive a KABCO-aligned bucket from the two count columns CCRS actually has.
 *
 * `severe_injury` is intentionally unreachable here — see the field notes. If a
 * later slice adds the ExtentOfInjuryCode join, it upgrades rows in place rather
 * than changing this function's contract.
 */
export function deriveCcrsSeverity(killedCount: number, injuredCount: number): CrashSeverity {
  if (killedCount > 0) return "fatal";
  if (injuredCount > 0) return "injury";
  return "pdo";
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
export async function fetchCcrsResourceIds(signal?: AbortSignal): Promise<Map<number, string>> {
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

  const byYear = new Map<number, string>();
  for (const resource of payload?.result?.resources ?? []) {
    const name = typeof resource?.name === "string" ? resource.name : "";
    const id = typeof resource?.id === "string" ? resource.id : "";
    const match = /^Crashes_(\d{4})$/.exec(name);
    if (match && id) {
      byYear.set(Number.parseInt(match[1], 10), id);
    }
  }
  return byYear;
}

async function runSql<T = Record<string, unknown>>(sql: string, signal?: AbortSignal): Promise<T[]> {
  const payload = await fetchJsonWithRetry<CkanSqlResponse>(
    `${CKAN_BASE}/datastore_search_sql?sql=${encodeURIComponent(sql)}`,
    signal ? { signal } : undefined,
    { timeoutMs: 30_000, retries: 1 }
  );
  return (payload?.result?.records ?? []) as T[];
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

async function fetchYearRecords(
  resourceId: string,
  bbox: StudyAreaBbox,
  countyCode: number | undefined,
  remaining: number,
  signal?: AbortSignal
): Promise<{ records: CrashRecord[]; truncated: boolean }> {
  const where = buildWhere({ bbox, countyCode, requireCoordinates: true });
  const columns = [
    "Collision Id",
    "Crash Date Time",
    "Latitude",
    "Longitude",
    "NumberKilled",
    "NumberInjured",
    "MotorVehicleInvolvedWithDesc",
  ]
    .map((c) => `"${c}"`)
    .join(",");

  const records: CrashRecord[] = [];
  let offset = 0;

  while (records.length < remaining) {
    const limit = Math.min(PAGE_SIZE, remaining - records.length);
    const rows = await runSql(
      `SELECT ${columns} FROM "${sqlLiteral(resourceId)}" WHERE ${where} ` +
        `ORDER BY "Collision Id" LIMIT ${limit} OFFSET ${offset}`,
      signal
    );

    for (const row of rows) {
      const latitude = toCoordinate(row["Latitude"]);
      const longitude = toCoordinate(row["Longitude"]);
      const externalId = row["Collision Id"] == null ? "" : String(row["Collision Id"]).trim();
      // A row without usable coordinates or a case id cannot be mapped or
      // deduplicated, so it is dropped rather than stored half-formed. The
      // count query above is what keeps such rows visible to the operator.
      if (latitude === null || longitude === null || !externalId) continue;

      const killedCount = Math.max(0, Math.trunc(toFiniteNumber(row["NumberKilled"])));
      const injuredCount = Math.max(0, Math.trunc(toFiniteNumber(row["NumberInjured"])));
      const collisionDate = toCollisionDate(row["Crash Date Time"]);

      records.push({
        externalId,
        collisionDate,
        collisionYear: collisionYearFromDate(collisionDate),
        severity: deriveCcrsSeverity(killedCount, injuredCount),
        killedCount,
        injuredCount,
        ...deriveInvolvement(row["MotorVehicleInvolvedWithDesc"]),
        latitude,
        longitude,
      });
    }

    if (rows.length < limit) {
      // Source exhausted for this year.
      return { records, truncated: false };
    }
    offset += rows.length;
  }

  return { records, truncated: true };
}

export async function fetchCcrsCrashes(params: CrashFetchParams): Promise<CrashFetchResult> {
  const maxRecords = params.maxRecords ?? DEFAULT_MAX_RECORDS;
  const resourceIds = await fetchCcrsResourceIds(params.signal);

  // Clamp to years CCRS actually holds rather than reporting empty results for
  // years that never existed in the system.
  const years = Array.from(new Set(params.years))
    .filter((year) => Number.isFinite(year) && year >= CCRS_EARLIEST_YEAR && resourceIds.has(year))
    .sort((a, b) => b - a);

  const records: CrashRecord[] = [];
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
  }

  return {
    records,
    matchedTotal,
    geocodedTotal,
    yearsCovered: Array.from(
      new Set(records.map((r) => r.collisionYear).filter((y): y is number => typeof y === "number"))
    ).sort((a, b) => a - b),
    truncated,
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
  earliestYear: CCRS_EARLIEST_YEAR,
  covers: overlapsCalifornia,
  fetch: fetchCcrsCrashes,
};
