/**
 * FARS — NHTSA Fatality Analysis Reporting System (Wave 8.2).
 *
 * WHY THIS SOURCE. CCRS covers California well and nothing else at all. Without
 * a national adapter the corridor scorecard would report "no crash source" for
 * every study area outside one state, which is not a product. FARS is the one
 * crash census that exists for the whole reporting geography: every crash on a
 * public road that killed someone within 30 days, 50 states + DC + Puerto Rico,
 * published by NHTSA with no key and no licence restriction.
 *
 * WHAT IT IS NOT. FARS is FATAL ONLY. It carries no injury crashes, no
 * property-damage crashes, and therefore no KSI denominator. That is why this
 * adapter advertises `severityCompleteness: "fatal_only"` — a study area served
 * by FARS must never be shown a "0 serious injuries" figure, because the
 * question was never asked. State DOT crash files are the upgrade path; each
 * one becomes another adapter here, exactly like CCRS.
 *
 * PERSISTENCE. `safety_crashes.source_id` explicitly admits this observed
 * source. The ordinary Safety ingest therefore freezes FARS records, source
 * attribution, exact publication cutoff, requested years, and project link in
 * the same tables used by richer regional sources. It remains fatal-only
 * evidence; persistence does not widen what the source can support.
 *
 * FIELD NOTES — read this before "fixing" the tolerant parsing below.
 *   - The CrashAPI location endpoint accepts state and county, not a bounding
 *     box. OpenPlan therefore reads NHTSA's immutable annual national CSV and
 *     applies the requested bbox locally. This is slower on a cold cache, but
 *     it works for arbitrary project geometry without guessing a county.
 *   - Column casing is NOT stable across CrashAPI endpoints (ST_CASE vs
 *     StCase, LONGITUD vs Longitude). Every field is looked up through a
 *     case-insensitive, separator-insensitive key map instead of one guessed
 *     spelling. This is why the retired implementation read no coordinates at
 *     all: it assumed a casing and silently got `undefined`.
 *   - FARS encodes unknown coordinates as sentinel values (77.7777 / 88.8888 /
 *     99.9999 in latitude, 777.7777 / 888.8888 / 999.9999 in longitude). Those
 *     are rejected — plotted literally they land in the Arctic Ocean.
 *   - Annual files publish roughly two years in arrears, so a requested year
 *     that returns nothing usable is skipped rather than treated as an outage.
 *     Only an ALL-years failure is reported as `source_unavailable`.
 *
 * NETWORK NOTE (2026-08): crashviewer.nhtsa.dot.gov answers 403 from this
 * development network. The official static annual files remain reachable and
 * are the supported retrieval path here. A missing or malformed archive is
 * source-unavailable, never zero crashes.
 */

import { parse as parseCsv } from "csv-parse/sync";
import JSZip from "jszip";
import type { StudyAreaBbox } from "@/lib/models/study-area";
import { CRASH_LEVEL_ONLY_DIMENSION_SUPPORT } from "@/lib/safety/vocabulary";
import {
  CrashSourceUnavailableError,
  type CrashFetchParams,
  type CrashFetchResult,
  type CrashRecord,
  type CrashSourceAdapter,
} from "./types";

export const FARS_SOURCE_ID = "fars-national";

const FARS_DOWNLOAD_BASE = "https://static.nhtsa.gov/nhtsa/downloads/FARS";

/**
 * The CrashAPI's documented lower bound for the location query. FARS itself
 * reaches back to 1975, but the by-location endpoint does not serve those years,
 * and claiming coverage we cannot retrieve would be a lie by omission.
 */
export const FARS_EARLIEST_YEAR = 2010;

/** Latest annual FARS file explicitly released by NHTSA. */
export const FARS_PUBLISHED_CUTOFF = {
  publishedThrough: "2024-12-31",
  provenance: {
    basis: "source_metadata",
    sourceUrl: "https://static.nhtsa.gov/nhtsa/downloads/FARS/2024/FARS2024%20Release%20Notes.txt",
    label: "NHTSA first release of the 2024 FARS annual file",
    finalAnnualFile: true,
    retrievedAt: "2026-08-25T00:00:00.000Z",
  },
} as const;

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_ARCHIVE_BYTES = 48 * 1024 * 1024;
const MAX_ACCIDENT_CSV_BYTES = 36 * 1024 * 1024;
const LATEST_PUBLISHED_YEAR = Number(FARS_PUBLISHED_CUTOFF.publishedThrough.slice(0, 4));

/**
 * Coarse envelopes for the FARS reporting geography. Purely a rejection filter
 * so a study area on another continent costs no round-trip; the API remains
 * authoritative about what is actually in a bbox. Deliberately generous —
 * a false positive costs one request, a false negative costs a whole region.
 *
 * KNOWN LIMIT: any rectangle containing northern Maine also contains southern
 * Ontario, so a near-border Canadian corridor resolves here and gets an empty
 * US answer. What keeps that honest is that the answer is attributed to
 * "NHTSA ... (FARS)" by name everywhere it is rendered. Fixing it properly
 * means a national boundary geometry, not a bigger pile of boxes.
 */
const FARS_ENVELOPES: readonly StudyAreaBbox[] = [
  // Conterminous US
  { minLon: -125.0, maxLon: -66.9, minLat: 24.4, maxLat: 49.4 },
  // Alaska (mainland + eastern Aleutians)
  { minLon: -172.5, maxLon: -129.9, minLat: 51.0, maxLat: 71.5 },
  // Alaska's Aleutian tail, west of the antimeridian
  { minLon: 172.0, maxLon: 180.0, minLat: 50.5, maxLat: 53.5 },
  // Hawaii
  { minLon: -160.3, maxLon: -154.7, minLat: 18.9, maxLat: 22.3 },
  // Puerto Rico
  { minLon: -67.4, maxLon: -65.2, minLat: 17.8, maxLat: 18.6 },
];

function overlaps(a: StudyAreaBbox, b: StudyAreaBbox): boolean {
  return a.minLon <= b.maxLon && a.maxLon >= b.minLon && a.minLat <= b.maxLat && a.maxLat >= b.minLat;
}

export function coversFarsGeography(bbox: StudyAreaBbox): boolean {
  return FARS_ENVELOPES.some((envelope) => overlaps(bbox, envelope));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Case- and separator-insensitive field lookup.
 *
 * `ST_CASE`, `St_Case` and `StCase` all normalize to `stcase`, so a casing
 * change at NHTSA degrades nothing.
 */
function normalizeKeys(row: Record<string, unknown>): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const [key, value] of Object.entries(row)) {
    out.set(key.replaceAll(/[^a-z0-9]/gi, "").toLowerCase(), value);
  }
  return out;
}

function pick(fields: Map<string, unknown>, ...names: string[]): unknown {
  for (const name of names) {
    const value = fields.get(name.replaceAll(/[^a-z0-9]/gi, "").toLowerCase());
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function toCount(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  }
  return 0;
}

/**
 * FARS `STATE` is a numeric state FIPS (6 = California, 32 = Nevada). Normalize
 * to the 2-digit zero-padded string used everywhere else so a backstop record
 * can be deduped against a regional source by state. Returns undefined for a
 * missing or out-of-range value rather than a guessed "00".
 */
export function toStateFips(value: unknown): string | undefined {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value.trim(), 10)
        : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 99) return undefined;
  return String(Math.trunc(parsed)).padStart(2, "0");
}

/** FARS sentinel values for "unknown", in both the lat and lon magnitudes. */
const COORDINATE_SENTINELS = [77.7777, 88.8888, 99.9999, 777.7777, 888.8888, 999.9999];

function isSentinelCoordinate(value: number): boolean {
  return COORDINATE_SENTINELS.some((sentinel) => Math.abs(value - sentinel) < 1e-4);
}

export function toFarsCoordinate(value: unknown, kind: "lat" | "lon"): number | null {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value.trim()) : Number.NaN;

  if (!Number.isFinite(parsed) || parsed === 0) return null;
  if (isSentinelCoordinate(Math.abs(parsed))) return null;

  const limit = kind === "lat" ? 90 : 180;
  return Math.abs(parsed) <= limit ? parsed : null;
}

/**
 * FARS dates arrive as ISO strings, as ASP.NET `/Date(ms)/` ticks, or not at
 * all. Anything unrecognized yields null rather than a guessed date.
 */
export function toFarsCollisionDate(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(trimmed);
  if (iso) return iso[1];

  const ticks = /^\/Date\((-?\d+)/.exec(trimmed);
  if (ticks) {
    const parsed = new Date(Number.parseInt(ticks[1], 10));
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  }

  return null;
}

function toFarsCollisionDateFromParts(fields: Map<string, unknown>, fallbackYear: number): string | null {
  const year = toCount(pick(fields, "YEAR", "CaseYear")) || fallbackYear;
  const month = toCount(pick(fields, "MONTH"));
  const day = toCount(pick(fields, "DAY"));
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date.toISOString().slice(0, 10)
    : null;
}

export function farsAnnualArchiveUrl(year: number): string {
  return `${FARS_DOWNLOAD_BASE}/${year}/National/FARS${year}NationalCSV.zip`;
}

export function toFarsCrashRecord(row: Record<string, unknown>, year: number): CrashRecord | null {
  const fields = normalizeKeys(row);

  const latitude = toFarsCoordinate(pick(fields, "LATITUDE", "LAT"), "lat");
  const longitude = toFarsCoordinate(pick(fields, "LONGITUD", "LONGITUDE", "LON", "LNG"), "lon");
  const caseId = pick(fields, "ST_CASE", "STCASE", "CASE");
  const caseYear = toCount(pick(fields, "CaseYear", "CASEYEAR", "YEAR")) || year;

  // No case id means the record cannot be deduplicated; no coordinates means it
  // cannot be mapped. Either way it stays out of `records` and remains visible
  // only through the matched/geocoded totals.
  if (latitude === null || longitude === null || caseId === undefined) return null;

  const collisionDate =
    toFarsCollisionDate(pick(fields, "CRASH_DT", "CrashDate", "CRASHDATE", "DATE")) ??
    toFarsCollisionDateFromParts(fields, caseYear);
  const killedCount = Math.max(1, toCount(pick(fields, "FATALS", "TOTALFATALS")));
  const stateFips = toStateFips(pick(fields, "STATE", "STATECODE", "STATEFIPS"));

  return {
    externalId: `${caseYear}-${String(caseId).trim()}`,
    collisionDate,
    collisionYear: caseYear,
    // FARS is a fatality census: every record in it is, by definition, fatal.
    severity: "fatal",
    killedCount,
    // FARS carries no injury count on the crash record — so this is NULL, not
    // zero. It used to be 0, which said "nobody was injured in this fatal
    // crash"; the truth is that the question was never asked.
    // `severityCompleteness: "fatal_only"` says the same thing at the source
    // level, and now the column agrees with it.
    injuredCount: null,
    pedestrianInvolved: toCount(pick(fields, "PEDS", "PEDESTRIANS")) > 0,
    bicyclistInvolved: toCount(pick(fields, "BICYCLISTS", "PEDALCYCLISTS", "BIKES")) > 0,
    // No motorcyclist count exists on this record. `party_role: "partial"` in
    // the capability declaration below is what keeps this false from reading as
    // "no motorcyclist was involved".
    motorcyclistInvolved: false,
    // This source records none of the three environmental dimensions. NULL, not
    // "unknown": "unknown" would claim the source asked and got no answer.
    collisionType: null,
    lighting: null,
    weather: null,
    sourceAttributes: {},
    latitude,
    longitude,
    stateFips,
    sourceId: FARS_SOURCE_ID,
  };
}

function withinBbox(record: CrashRecord, bbox: StudyAreaBbox): boolean {
  return (
    record.longitude >= bbox.minLon &&
    record.longitude <= bbox.maxLon &&
    record.latitude >= bbox.minLat &&
    record.latitude <= bbox.maxLat
  );
}

/** Parse and spatially filter the official annual accident table. */
export function parseFarsAnnualCsv(
  csv: string,
  year: number,
  bbox: StudyAreaBbox
): { matchedTotal: number; records: CrashRecord[] } {
  const rows = parseCsv(csv, {
    bom: true,
    columns: true,
    relax_column_count: true,
    skip_empty_lines: true,
  }) as unknown[];
  const records: CrashRecord[] = [];

  for (const row of rows) {
    if (!isRecord(row)) continue;
    const record = toFarsCrashRecord(row, year);
    if (record && withinBbox(record, bbox)) records.push(record);
  }

  return { matchedTotal: records.length, records };
}

async function fetchWithTimeout(url: string, signal?: AbortSignal): Promise<Response | null> {
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(() => controller.abort("FARS annual archive timed out"), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, { cache: "force-cache", signal: controller.signal });
    return response.ok ? response : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }
}

async function fetchFarsAnnualCsv(year: number, signal?: AbortSignal): Promise<string | null> {
  const response = await fetchWithTimeout(farsAnnualArchiveUrl(year), signal);
  if (!response) return null;

  const declaredBytes = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredBytes) && declaredBytes > MAX_ARCHIVE_BYTES) return null;

  const archiveBytes = await response.arrayBuffer();
  if (archiveBytes.byteLength > MAX_ARCHIVE_BYTES) return null;

  try {
    const archive = await JSZip.loadAsync(archiveBytes);
    const accidentEntry = Object.values(archive.files).find(
      (entry) => !entry.dir && /(?:^|\/)accident\.csv$/i.test(entry.name)
    );
    if (!accidentEntry) return null;

    const csv = await accidentEntry.async("string");
    return Buffer.byteLength(csv, "utf8") <= MAX_ACCIDENT_CSV_BYTES ? csv : null;
  } catch {
    return null;
  }
}

export async function fetchFarsCrashes(params: CrashFetchParams): Promise<CrashFetchResult> {
  const years = Array.from(new Set(params.years))
    .filter(
      (year) => Number.isFinite(year) && year >= FARS_EARLIEST_YEAR && year <= LATEST_PUBLISHED_YEAR
    )
    .sort((a, b) => b - a);

  const records: CrashRecord[] = [];
  const yearsAnswered: number[] = [];
  let matchedTotal = 0;
  let geocodedTotal = 0;

  for (const year of years) {
    const csv = await fetchFarsAnnualCsv(year, params.signal);
    if (csv === null) continue;
    const parsed = parseFarsAnnualCsv(csv, year, params.bbox);

    yearsAnswered.push(year);
    matchedTotal += parsed.matchedTotal;

    for (const record of parsed.records) {
      geocodedTotal += 1;
      if (records.length < (params.maxRecords ?? Number.POSITIVE_INFINITY)) {
        records.push(record);
      }
    }
  }

  if (years.length > 0 && yearsAnswered.length === 0) {
    throw new CrashSourceUnavailableError(
      FARS_SOURCE_ID,
      "NHTSA annual FARS files returned no usable response for any published requested year"
    );
  }

  return {
    records,
    matchedTotal,
    geocodedTotal,
    yearsCovered: Array.from(
      new Set(records.map((record) => record.collisionYear).filter((y): y is number => typeof y === "number"))
    ).sort((a, b) => a - b),
    truncated: typeof params.maxRecords === "number" && geocodedTotal > params.maxRecords,
    publishedCutoff: FARS_PUBLISHED_CUTOFF,
  };
}

export const farsAdapter: CrashSourceAdapter = {
  id: FARS_SOURCE_ID,
  label: "NHTSA Fatality Analysis Reporting System (FARS)",
  attribution:
    "U.S. Department of Transportation, National Highway Traffic Safety Administration, Fatality Analysis Reporting System (FARS). Public domain — U.S. Government work.",
  license: "U.S. Government Work (public domain)",
  coverageState: "fars_fatal_only",
  severityCompleteness: "fatal_only",
  // A fatality census knows almost nothing about the neutral dimensions, and
  // saying so explicitly is the whole point: a lighting facet rendered as an
  // empty list here would read as "no fatal crash in this corridor happened
  // after dark", which is a finding this source cannot support. `party_role` is
  // `partial` rather than `not_supplied` because pedestrian and bicyclist
  // involvement ARE derivable from crash-level counts — there are simply no
  // person rows and no motorcyclist signal.
  dimensions: CRASH_LEVEL_ONLY_DIMENSION_SUPPORT,
  earliestYear: FARS_EARLIEST_YEAR,
  persistable: true,
  covers: coversFarsGeography,
  fetch: fetchFarsCrashes,
};
