/**
 * ODOT: Oregon Department of Transportation crash data (2026-11-02).
 *
 * WHY THIS SOURCE. Outside California the Safety module had only FARS, which
 * is fatal-only and cannot support a killed-and-serious-injury figure. ODOT's
 * Crash Analysis and Reporting Unit publishes statewide reported crashes as an
 * ArcGIS point layer behind the Oregon Transportation Safety Data Explorer
 * (OTSDE), with the source's own KABCO letter on every crash. Checked
 * 2026-11-01 (see docs/research/STATE_INJURY_CRASH_SOURCES_2026-11-01.md):
 *
 *   - layer `OTSDE_Crash/MapServer/0`, "ODOT Crash Data 2019 - 2024",
 *     273,810 crashes, envelope queries in EPSG:4326, no key, no account;
 *   - terms on the OTSDE item: "There are no access constraints. This product
 *     is for informational purposes and may not have been prepared for legal,
 *     engineering or surveying purposes", and the item invites users to
 *     "download data to perform your own analyses". ODOT's Crash Data
 *     Disclaimers (April 14, 2026) describe re-release by customers and
 *     disclaim liability for it. No open license is named, which the
 *     attribution and label below say plainly.
 *
 * WHAT IT IS NOT.
 *   - Not stored. `safety_crashes.source_id` admits only the CCRS and FARS
 *     ids, so this adapter is `persistable: false` and serves the live read
 *     lane, the corridor scorecard and the shared map. A Safety acquisition in
 *     Oregon still stores fatal-only FARS until a migration widens that CHECK.
 *   - Not every reported crash. A crash ODOT could not locate carries the
 *     Unlocatable Flag and sits at a default point inside its city or county
 *     (code manual, "Unlocatable Crash Flag"). Such a point is not a
 *     location, so those crashes are excluded from the bbox query and cannot
 *     be counted for a drawn area. `matchedTotal` therefore equals
 *     `geocodedTotal`, the same rule CCRS uses without a county filter.
 *   - Not a rolling feed with a published cutoff. The layer holds whole crash
 *     years; this adapter asks the layer which years it holds rather than
 *     assuming the six in its name, and states no publication cutoff.
 *   - No person rows. Pedestrian and pedalcyclist involvement come from ODOT's
 *     documented crash-level participant counts; motorcyclist involvement is
 *     not read (see `odot-or-vocabulary.ts`).
 */

import { fetchJsonWithRetry } from "@/lib/data-sources/http";
import type { StudyAreaBbox } from "@/lib/models/study-area";
import { STATE_FIPS_TO_USPS } from "@/lib/geographies/state-fips";
import {
  mapCrashDimension,
  toCasualtyCount,
  type CrashCollisionType,
  type CrashDimension,
  type CrashLighting,
  type CrashSeverity,
  type CrashWeather,
} from "@/lib/safety/vocabulary";
import { countArcgisCrashes, fetchArcgisCrashFeatures } from "./arcgis-crash-query";
import { noRequestedYearsHeld } from "./state-crash-layer";
import { ODOT_OR_CRASH_COLUMNS as COLUMNS, ODOT_OR_DIMENSION_SUPPORT, ODOT_OR_VOCABULARY } from "./odot-or-vocabulary";
import {
  CrashSourceUnavailableError,
  type CrashFetchParams,
  type CrashFetchResult,
  type CrashRecord,
  type CrashSourceAdapter,
} from "./types";

export const ODOT_OR_SOURCE_ID = "odot-or";

export const ODOT_OR_LAYER_URL =
  "https://gis.odot.state.or.us/arcgis1006/rest/services/agol/OTSDE_Crash/MapServer/0";

const ODOT_OR_ITEM_URL = "https://www.arcgis.com/home/item.html?id=df0b3cdb2f1149d3bd43436bc1dd4eac";

/** First year in the layer as published on 2026-11-01. The layer is asked which years it holds. */
const ODOT_OR_EARLIEST_YEAR = 2019;

/** Oregon's state FIPS code, looked up rather than typed. */
const OREGON_STATE_FIPS = Object.keys(STATE_FIPS_TO_USPS).find((fips) => STATE_FIPS_TO_USPS[fips] === "OR")!;

/** Layer maxRecordCount is 10,000; smaller pages keep each response modest. */
const PAGE_SIZE = 2000;
const DEFAULT_MAX_RECORDS = 50_000;
const YEARS_CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * Coarse Oregon envelope, a rejection filter only. The state is decided by the
 * study area's place, never by this rectangle (see `crashSourcesForStudyArea`).
 */
const OR_BOUNDS = { minLon: -124.8, maxLon: -116.4, minLat: 41.9, maxLat: 46.4 };

function overlapsOregon(bbox: StudyAreaBbox): boolean {
  return (
    bbox.minLon <= OR_BOUNDS.maxLon &&
    bbox.maxLon >= OR_BOUNDS.minLon &&
    bbox.minLat <= OR_BOUNDS.maxLat &&
    bbox.maxLat >= OR_BOUNDS.minLat
  );
}

/** The columns requested, and the complete list of them. Nothing else is fetched. */
export const ODOT_OR_REQUESTED_COLUMNS = [
  COLUMNS.crashId,
  COLUMNS.year,
  COLUMNS.month,
  COLUMNS.day,
  COLUMNS.kabco,
  COLUMNS.fatalCount,
  COLUMNS.seriousInjuryCount,
  COLUMNS.moderateInjuryCount,
  COLUMNS.minorInjuryCount,
  COLUMNS.pedestrianCount,
  COLUMNS.pedalcyclistCount,
  COLUMNS.collisionType,
  COLUMNS.lighting,
  COLUMNS.weather,
] as const;

/**
 * Calendar date from ODOT's year, month and day columns, or null.
 *
 * The layer's date column is a timestamp at noon UTC; the three text columns
 * are the coded values themselves, so they are read and checked instead.
 */
export function toOdotCollisionDate(year: unknown, month: unknown, day: unknown): string | null {
  const parts = [year, month, day].map((value) => (typeof value === "string" ? value.trim() : ""));
  const [y, m, d] = parts;
  if (!/^\d{4}$/.test(y) || !/^\d{1,2}$/.test(m) || !/^\d{1,2}$/.test(d)) return null;
  const iso = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso ? null : iso;
}

/** True only for a readable count above zero. */
function hasParticipants(value: unknown): boolean {
  const count = toCasualtyCount(value);
  return count !== null && count > 0;
}

/**
 * People injured: the sum of ODOT's A, B and C counts.
 *
 * Null when none of the three was readable, so a crash with no counts stays
 * unknown rather than becoming zero injured. A readable count beside an
 * unreadable one still contributes, as in `deriveSeverityFromCounts`.
 */
export function odotInjuredCount(a: unknown, b: unknown, c: unknown): number | null {
  const counts = [a, b, c].map(toCasualtyCount);
  if (counts.every((count) => count === null)) return null;
  return counts.reduce<number>((sum, count) => sum + (count ?? 0), 0);
}

type OdotDimensions = {
  severity: CrashSeverity;
  collisionType: CrashCollisionType | null;
  lighting: CrashLighting | null;
  weather: CrashWeather | null;
  sourceAttributes: Record<string, string>;
  unmapped: CrashDimension[];
};

function mapOdotDimensions(row: Record<string, unknown>): OdotDimensions {
  const sourceAttributes: Record<string, string> = {};
  const unmapped: CrashDimension[] = [];
  const read = (dimension: CrashDimension, column: string) => {
    const mapping = mapCrashDimension(ODOT_OR_VOCABULARY, dimension, row[column]);
    if (mapping === null) return null;
    if (mapping.unmapped && mapping.raw !== null) {
      sourceAttributes[column] = mapping.raw;
      unmapped.push(dimension);
    }
    return mapping.value;
  };
  return {
    // Severity is always supplied by this descriptor, so `read` never returns null here.
    severity: (read("severity", COLUMNS.kabco) ?? "unknown") as CrashSeverity,
    collisionType: read("collision_type", COLUMNS.collisionType) as CrashCollisionType | null,
    lighting: read("lighting", COLUMNS.lighting) as CrashLighting | null,
    weather: read("weather", COLUMNS.weather) as CrashWeather | null,
    sourceAttributes,
    unmapped,
  };
}

/** One layer feature to a crash record, or null when it has no id or no point. */
function toOdotCrashRecord(
  feature: { attributes: Record<string, unknown>; longitude: number | null; latitude: number | null }
): { record: CrashRecord; unmapped: CrashDimension[] } | null {
  const row = feature.attributes;
  const rawId = row[COLUMNS.crashId];
  const externalId = rawId == null ? "" : String(rawId).trim();
  if (!externalId || feature.latitude === null || feature.longitude === null) return null;

  const collisionDate = toOdotCollisionDate(row[COLUMNS.year], row[COLUMNS.month], row[COLUMNS.day]);
  const dimensions = mapOdotDimensions(row);
  return {
    record: {
      externalId,
      collisionDate,
      collisionYear: collisionDate ? Number(collisionDate.slice(0, 4)) : null,
      severity: dimensions.severity,
      killedCount: toCasualtyCount(row[COLUMNS.fatalCount]),
      injuredCount: odotInjuredCount(
        row[COLUMNS.seriousInjuryCount],
        row[COLUMNS.moderateInjuryCount],
        row[COLUMNS.minorInjuryCount]
      ),
      // ODOT's documented participant counts, not the layer's "present" flags,
      // which never coincide with a pedestrian or pedalcyclist participant.
      pedestrianInvolved: hasParticipants(row[COLUMNS.pedestrianCount]),
      bicyclistInvolved: hasParticipants(row[COLUMNS.pedalcyclistCount]),
      // Not read: the motorcycle flag is undocumented. `party_role: "partial"`
      // is what keeps this false from reading as "no motorcyclist".
      motorcyclistInvolved: false,
      collisionType: dimensions.collisionType,
      lighting: dimensions.lighting,
      weather: dimensions.weather,
      sourceAttributes: dimensions.sourceAttributes,
      latitude: feature.latitude,
      longitude: feature.longitude,
      stateFips: OREGON_STATE_FIPS,
      sourceId: ODOT_OR_SOURCE_ID,
    },
    unmapped: dimensions.unmapped,
  };
}

type YearStatisticsBody = {
  error?: unknown;
  features?: Array<{ attributes?: Record<string, unknown> }>;
};

/**
 * The crash years the layer holds, asked of the layer itself.
 *
 * A layer that answers with no years, or with an error body, is unavailable,
 * not empty: ODOT replaces this layer when it publishes a year.
 */
async function fetchOdotYearsHeld(signal?: AbortSignal): Promise<number[]> {
  const params = new URLSearchParams({
    where: "1=1",
    groupByFieldsForStatistics: COLUMNS.year,
    outStatistics: JSON.stringify([
      { statisticType: "count", onStatisticField: COLUMNS.objectId, outStatisticFieldName: "n" },
    ]),
    f: "json",
  });
  const body = await fetchJsonWithRetry<YearStatisticsBody>(
    `${ODOT_OR_LAYER_URL}/query?${params.toString()}`,
    signal ? { signal } : undefined,
    { timeoutMs: 30_000, retries: 1, cacheTtlMs: YEARS_CACHE_TTL_MS, cacheKey: `${ODOT_OR_SOURCE_ID}:years` }
  );
  if (body === null || body.error || !Array.isArray(body.features)) {
    throw new CrashSourceUnavailableError(ODOT_OR_SOURCE_ID, "ODOT crash layer did not report its years");
  }
  const years = body.features
    .map((feature) => Number.parseInt(String(feature.attributes?.[COLUMNS.year] ?? ""), 10))
    .filter((year) => Number.isInteger(year) && year >= 1900);
  if (years.length === 0) {
    throw new CrashSourceUnavailableError(ODOT_OR_SOURCE_ID, "ODOT crash layer reported no crash years");
  }
  return Array.from(new Set(years)).sort((a, b) => a - b);
}

/** WHERE for one crash year, located crashes only. `year` is an integer, never caller text. */
function whereForYear(year: number): string {
  return `${COLUMNS.year} = '${Math.trunc(year)}' AND ${COLUMNS.unlocatable} = 0`;
}

export async function fetchOdotCrashes(params: CrashFetchParams): Promise<CrashFetchResult> {
  const maxRecords = params.maxRecords ?? DEFAULT_MAX_RECORDS;
  const yearsHeld = await fetchOdotYearsHeld(params.signal);
  const held = new Set(yearsHeld);
  const years = Array.from(new Set(params.years))
    .filter((year) => Number.isInteger(year) && held.has(year))
    .sort((a, b) => b - a);
  // An empty read would read as zero crashes; no held year means no answer.
  if (params.years.length > 0 && years.length === 0) {
    throw new CrashSourceUnavailableError(ODOT_OR_SOURCE_ID, noRequestedYearsHeld(yearsHeld));
  }

  const records: CrashRecord[] = [];
  const unmappedByDimension: Partial<Record<CrashDimension, number>> = {};
  let geocodedTotal = 0;
  let truncated = false;

  for (const year of years) {
    const query = { sourceId: ODOT_OR_SOURCE_ID, layerUrl: ODOT_OR_LAYER_URL, where: whereForYear(year), bbox: params.bbox, signal: params.signal };
    const countForYear = await countArcgisCrashes(query);
    geocodedTotal += countForYear;

    const remaining = maxRecords - records.length;
    if (remaining <= 0) {
      truncated = truncated || countForYear > 0;
      continue;
    }
    const page = await fetchArcgisCrashFeatures({
      ...query,
      outFields: ODOT_OR_REQUESTED_COLUMNS,
      orderBy: COLUMNS.objectId,
      pageSize: PAGE_SIZE,
      limit: remaining,
    });
    // Truncated only when the cap left crashes behind, not when it landed exactly.
    truncated = truncated || (page.truncated && countForYear > page.features.length);

    for (const feature of page.features) {
      const mapped = toOdotCrashRecord(feature);
      if (!mapped) continue;
      records.push(mapped.record);
      for (const dimension of mapped.unmapped) {
        unmappedByDimension[dimension] = (unmappedByDimension[dimension] ?? 0) + 1;
      }
    }
  }

  return {
    records,
    matchedTotal: geocodedTotal,
    geocodedTotal,
    yearsCovered: Array.from(
      new Set(records.map((record) => record.collisionYear).filter((year): year is number => year !== null))
    ).sort((a, b) => a - b),
    yearsQueried: [...years].sort((a, b) => a - b),
    truncated,
    unmappedByDimension,
  };
}

export const odotOrAdapter: CrashSourceAdapter = {
  id: ODOT_OR_SOURCE_ID,
  label: "Oregon DOT crash data (OTSDE)",
  attribution: `Oregon Department of Transportation, Crash Analysis and Reporting Unit, crash data published in the Oregon Transportation Safety Data Explorer (${ODOT_OR_ITEM_URL}). ODOT states no access constraints and names no open license; the data are for informational purposes.`,
  license: "No access constraints stated by ODOT; no open license named",
  coverageState: "state_injury_file",
  severityCompleteness: "kabco_full",
  dimensions: ODOT_OR_DIMENSION_SUPPORT,
  earliestYear: ODOT_OR_EARLIEST_YEAR,
  persistable: false,
  roadContextProvider: "us-census-tiger-line",
  coversStateFips: [OREGON_STATE_FIPS],
  servesStateFips: [OREGON_STATE_FIPS],
  covers: overlapsOregon,
  fetch: fetchOdotCrashes,
};
