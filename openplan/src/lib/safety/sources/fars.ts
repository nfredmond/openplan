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
 * PERSISTENCE. `persistable: false` — `safety_crashes.source_id` is a closed
 * CHECK domain that currently lists only 'ccrs-ca'. FARS is read-only until a
 * migration widens it, so the Safety ingest keeps resolving it out rather than
 * discovering the mismatch as a constraint violation mid-write.
 *
 * FIELD NOTES — read this before "fixing" the tolerant parsing below.
 *   - The CrashAPI has shipped at least two response envelopes in the wild:
 *     `{ Results: [ {...} ] }` and `{ Results: [ [ {...} ] ] }`. Both are
 *     handled; the doubly-nested form was observed in production.
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
 * NETWORK NOTE (2026-07): crashviewer.nhtsa.dot.gov answers 403 from the
 * development network this adapter was written on — an Akamai edge block on a
 * consumer CGNAT range, not a datacenter block. That says nothing about whether
 * the API works from production, so this adapter is written to succeed if it
 * can and to report unavailability honestly if it cannot. Do not delete it on
 * the strength of a local 403.
 */

import { fetchJsonWithRetry } from "@/lib/data-sources/http";
import type { StudyAreaBbox } from "@/lib/models/study-area";
import {
  CrashSourceUnavailableError,
  type CrashFetchParams,
  type CrashFetchResult,
  type CrashRecord,
  type CrashSourceAdapter,
} from "./types";

export const FARS_SOURCE_ID = "fars-national";

const FARS_BASE = "https://crashviewer.nhtsa.dot.gov/CrashAPI/crashes/GetCrashesByLocation";

/**
 * The CrashAPI's documented lower bound for the location query. FARS itself
 * reaches back to 1975, but the by-location endpoint does not serve those years,
 * and claiming coverage we cannot retrieve would be a lie by omission.
 */
export const FARS_EARLIEST_YEAR = 2010;

const REQUEST_TIMEOUT_MS = 12_000;

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

type FarsResponse = { Results?: unknown };

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

/** Unwrap both observed envelope shapes. Returns null when unrecognizable. */
export function parseFarsResults(payload: unknown): Record<string, unknown>[] | null {
  const results = isRecord(payload) ? (payload as FarsResponse).Results : undefined;
  if (!Array.isArray(results)) return null;
  if (results.length === 0) return [];

  const first = results[0];
  if (Array.isArray(first)) return first.filter(isRecord);
  return results.filter(isRecord);
}

function buildYearUrl(bbox: StudyAreaBbox, year: number): string {
  const params = new URLSearchParams({
    fromCaseYear: String(year),
    toCaseYear: String(year),
    minLat: String(bbox.minLat),
    maxLat: String(bbox.maxLat),
    minLong: String(bbox.minLon),
    maxLong: String(bbox.maxLon),
    format: "json",
  });
  return `${FARS_BASE}?${params.toString()}`;
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

  const collisionDate = toFarsCollisionDate(pick(fields, "CRASH_DT", "CrashDate", "CRASHDATE", "DATE"));
  const killedCount = Math.max(1, toCount(pick(fields, "FATALS", "TOTALFATALS")));

  return {
    externalId: `${caseYear}-${String(caseId).trim()}`,
    collisionDate,
    collisionYear: caseYear,
    // FARS is a fatality census: every record in it is, by definition, fatal.
    severity: "fatal",
    killedCount,
    // FARS carries no injury counts on the crash record. Reporting 0 here is
    // the schema's floor, not a finding — `severityCompleteness: "fatal_only"`
    // is what stops a caller reading it as "nobody was hurt".
    injuredCount: 0,
    pedestrianInvolved: toCount(pick(fields, "PEDS", "PEDESTRIANS")) > 0,
    bicyclistInvolved: toCount(pick(fields, "BICYCLISTS", "PEDALCYCLISTS", "BIKES")) > 0,
    latitude,
    longitude,
  };
}

export async function fetchFarsCrashes(params: CrashFetchParams): Promise<CrashFetchResult> {
  const years = Array.from(new Set(params.years))
    .filter((year) => Number.isFinite(year) && year >= FARS_EARLIEST_YEAR)
    .sort((a, b) => b - a);

  const records: CrashRecord[] = [];
  const yearsAnswered: number[] = [];
  let matchedTotal = 0;
  let geocodedTotal = 0;

  for (const year of years) {
    const payload = await fetchJsonWithRetry<FarsResponse>(
      buildYearUrl(params.bbox, year),
      params.signal ? { signal: params.signal } : undefined,
      { timeoutMs: REQUEST_TIMEOUT_MS, retries: 1 }
    );

    const rows = parseFarsResults(payload);
    // A year that failed or answered in an unknown shape is not a year with no
    // fatalities. Skip it so it cannot dilute the density denominator, and let
    // the all-years check below decide whether the source is down.
    if (rows === null) continue;

    yearsAnswered.push(year);
    matchedTotal += rows.length;

    for (const row of rows) {
      const record = toFarsCrashRecord(row, year);
      if (!record) continue;
      geocodedTotal += 1;
      if (records.length < (params.maxRecords ?? Number.POSITIVE_INFINITY)) {
        records.push(record);
      }
    }
  }

  if (years.length > 0 && yearsAnswered.length === 0) {
    throw new CrashSourceUnavailableError(
      FARS_SOURCE_ID,
      "NHTSA CrashAPI returned no usable response for any requested year"
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
  earliestYear: FARS_EARLIEST_YEAR,
  persistable: false,
  covers: coversFarsGeography,
  fetch: fetchFarsCrashes,
};
