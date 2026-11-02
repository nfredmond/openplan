/**
 * Iowa DOT: Iowa Department of Transportation crash data (2026-11-02).
 *
 * WHY THIS SOURCE. Outside California and Oregon the Safety module had only
 * FARS, which is fatal-only. Iowa DOT publishes ten years of statewide crashes
 * as an ArcGIS point layer with its own crash severity on every crash, under
 * an open license. Checked 2026-11-01 (see
 * docs/research/STATE_INJURY_CRASH_SOURCES_2026-11-01.md):
 *
 *   - layer `Traffic_Safety/Crash_Data/FeatureServer/0`, "Crash Data",
 *     639,173 crashes dated 2015-01-01 to 2026-10-29, envelope queries in
 *     EPSG:4326, maxRecordCount 2,000, no key, no account;
 *   - license on the item: "This work is licensed under a Creative Commons
 *     Attribution 4.0 International License", with Iowa DOT's GIS Data Terms
 *     of Use (effective June 19, 2026) as additional terms. Those terms
 *     disclaim warranties and ask users to indemnify Iowa DOT; they do not
 *     restrict reuse.
 *
 * WHAT IT IS NOT.
 *   - Not stored. `safety_crashes.source_id` admits only the CCRS and FARS
 *     ids, so this adapter is `persistable: false`, like `odot-or`.
 *   - Not every reported crash. Iowa DOT places a crash it could not locate
 *     at one default point outside the state (see
 *     `IOWADOT_IA_UNLOCATED_POINT`); those crashes are excluded and cannot be
 *     counted for a drawn area. Eight crashes have no geometry at all and
 *     cannot satisfy an envelope either. `matchedTotal` equals `geocodedTotal`.
 *   - Not a published cutoff. The layer is a rolling window ("General
 *     crash-wide data from the prior 10 years") refreshed by Iowa DOT; this
 *     adapter asks the layer for its first and last crash dates and queries
 *     only the years between them. The newest year is partial, and the layer
 *     states no date through which it is complete, so no cutoff is reported.
 *   - No person rows. Pedestrian and bicyclist involvement come from Iowa
 *     DOT's person layer (CC BY 4.0, same terms), read only for its crash key
 *     and non-motorist type. Motorcyclist involvement is not read.
 */

import { fetchJsonWithRetry } from "@/lib/data-sources/http";
import type { StudyAreaBbox } from "@/lib/models/study-area";
import { stateFipsFromUsps } from "@/lib/geographies/state-fips";
import {
  mapCrashDimension,
  toCasualtyCount,
  type CrashCollisionType,
  type CrashLighting,
  type CrashSeverity,
  type CrashWeather,
} from "@/lib/safety/vocabulary";
import { fetchArcgisCrashFeatures, type ArcgisCrashFeature } from "./arcgis-crash-query";
import {
  IOWADOT_IA_BICYCLIST_TYPES,
  IOWADOT_IA_CRASH_COLUMNS as COLUMNS,
  IOWADOT_IA_DIMENSION_SUPPORT,
  IOWADOT_IA_PEDESTRIAN_TYPES,
  IOWADOT_IA_PERSON_COLUMNS as PERSON_COLUMNS,
  IOWADOT_IA_POSSIBLE_OR_UNKNOWN_CODE,
  IOWADOT_IA_UNLOCATED_POINT,
  IOWADOT_IA_VOCABULARY,
} from "./iowadot-ia-vocabulary";
import {
  bboxOverlapsBounds,
  mapLayerDimensions,
  readStateCrashLayer,
  readStatistic,
  sumReadableCounts,
  yearRange,
  type LayerRecordMapping,
} from "./state-crash-layer";
import { CrashSourceUnavailableError, type CrashFetchParams, type CrashFetchResult, type CrashSourceAdapter } from "./types";

export const IOWADOT_IA_SOURCE_ID = "iowadot-ia";

export const IOWADOT_IA_LAYER_URL =
  "https://gis.iowadot.gov/agshost/rest/services/Traffic_Safety/Crash_Data/FeatureServer/0";

export const IOWADOT_IA_PERSON_LAYER_URL =
  "https://gis.iowadot.gov/agshost/rest/services/Traffic_Safety/Crash_Person_Data/FeatureServer/0";

const IOWADOT_IA_ITEM_URL = "https://www.arcgis.com/home/item.html?id=7a1f786d55a2439a9bfa8f7a527936e8";

/** First year in the layer as published on 2026-11-01. The layer is asked which years it holds. */
const IOWADOT_IA_EARLIEST_YEAR = 2015;

/** Iowa's state FIPS code, looked up rather than typed. */
const IOWA_STATE_FIPS = stateFipsFromUsps("IA")!;

/** Layer maxRecordCount is 2,000. */
const PAGE_SIZE = 2000;
const DEFAULT_MAX_RECORDS = 50_000;
/** Non-motorist person rows in one envelope and year; 1,498 statewide in 2024. */
const PERSON_ROW_LIMIT = 100_000;
const YEARS_CACHE_TTL_MS = 60 * 60 * 1000;

/** Coarse Iowa envelope, a rejection filter only. */
const IA_BOUNDS = { minLon: -96.7, maxLon: -90.1, minLat: 40.3, maxLat: 43.6 };

/** The columns requested, and the complete list of them. Nothing else is fetched. */
export const IOWADOT_IA_REQUESTED_COLUMNS = [
  COLUMNS.crashKey,
  COLUMNS.crashDate,
  COLUMNS.severity,
  COLUMNS.fatalCount,
  COLUMNS.majorInjuryCount,
  COLUMNS.minorInjuryCount,
  COLUMNS.possibleInjuryCount,
  COLUMNS.collisionManner,
  COLUMNS.lighting,
  COLUMNS.weather,
] as const;

export const IOWADOT_IA_REQUESTED_PERSON_COLUMNS = [PERSON_COLUMNS.crashKey, PERSON_COLUMNS.nonMotoristType] as const;

/**
 * Calendar date from the layer's `CRASH_DATE`, or null.
 *
 * The layer declares its dates in UTC and stores each crash date at UTC
 * midnight (the first crash is 1420070400000, 2015-01-01T00:00:00Z), so the
 * UTC calendar date is the crash date.
 */
export function toIowaCollisionDate(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

/** Iowa DOT's crash key as text. The crash layer stores it as a double, the person layer as a string. */
export function toIowaCrashKey(value: unknown): string | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? String(Math.trunc(parsed)) : null;
}

/**
 * Severity from `CSEV`, with code 4 split by the possible-injury count.
 *
 * A positive `POSSINJURY` is a positive observation of a possible injury
 * (KABCO C), so the crash is an injury crash. Without one the code-4 crash
 * stays unknown: Iowa DOT put it in the class that also holds unknown injuries.
 */
export function iowaSeverity(code: unknown, possibleInjuryCount: unknown): {
  severity: CrashSeverity;
  raw: string | null;
  unmapped: boolean;
} {
  // Severity is always supplied by this descriptor, so the mapping is never null.
  const mapping = mapCrashDimension(IOWADOT_IA_VOCABULARY, "severity", code)!;
  if (mapping.raw === IOWADOT_IA_POSSIBLE_OR_UNKNOWN_CODE) {
    const possible = toCasualtyCount(possibleInjuryCount);
    return { severity: possible !== null && possible > 0 ? "injury" : "unknown", raw: mapping.raw, unmapped: false };
  }
  return { severity: mapping.value as CrashSeverity, raw: mapping.raw, unmapped: mapping.unmapped };
}

type Involvement = { pedestrian: Set<string>; bicyclist: Set<string> };

/**
 * Crash keys with a pedestrian or bicyclist, for one year inside the envelope.
 *
 * Person points sit on their crash's point (checked 2026-11-01: 737 of 737
 * non-motorist crashes in 2024), so the same envelope finds them.
 */
async function fetchIowaInvolvement(year: number, bbox: StudyAreaBbox, signal?: AbortSignal): Promise<Involvement> {
  const types = [...IOWADOT_IA_PEDESTRIAN_TYPES, ...IOWADOT_IA_BICYCLIST_TYPES]
    .map((type) => `'${type.replace(/'/g, "''")}'`)
    .join(", ");
  const page = await fetchArcgisCrashFeatures({
    sourceId: IOWADOT_IA_SOURCE_ID,
    layerUrl: IOWADOT_IA_PERSON_LAYER_URL,
    where: `${PERSON_COLUMNS.year} = ${Math.trunc(year)} AND ${PERSON_COLUMNS.nonMotoristType} IN (${types})`,
    bbox,
    signal,
    outFields: IOWADOT_IA_REQUESTED_PERSON_COLUMNS,
    orderBy: COLUMNS.objectId,
    pageSize: PAGE_SIZE,
    limit: PERSON_ROW_LIMIT,
  });
  if (page.truncated) {
    throw new CrashSourceUnavailableError(IOWADOT_IA_SOURCE_ID, "Iowa DOT person layer returned more rows than the adapter reads");
  }
  const involvement: Involvement = { pedestrian: new Set(), bicyclist: new Set() };
  const pedestrianTypes = new Set<string>(IOWADOT_IA_PEDESTRIAN_TYPES);
  const bicyclistTypes = new Set<string>(IOWADOT_IA_BICYCLIST_TYPES);
  for (const feature of page.features) {
    const key = toIowaCrashKey(feature.attributes[PERSON_COLUMNS.crashKey]);
    const type = feature.attributes[PERSON_COLUMNS.nonMotoristType];
    if (!key || typeof type !== "string") continue;
    if (pedestrianTypes.has(type.trim())) involvement.pedestrian.add(key);
    if (bicyclistTypes.has(type.trim())) involvement.bicyclist.add(key);
  }
  return involvement;
}

/** One layer feature to a crash record, or null when it has no key or no point. */
function toIowaCrashRecord(feature: ArcgisCrashFeature, involvement: Involvement | undefined): LayerRecordMapping {
  const row = feature.attributes;
  const externalId = toIowaCrashKey(row[COLUMNS.crashKey]);
  if (!externalId || feature.latitude === null || feature.longitude === null) return null;

  const collisionDate = toIowaCollisionDate(row[COLUMNS.crashDate]);
  const severity = iowaSeverity(row[COLUMNS.severity], row[COLUMNS.possibleInjuryCount]);
  const dimensions = mapLayerDimensions(IOWADOT_IA_VOCABULARY, row, {
    collision_type: COLUMNS.collisionManner,
    lighting: COLUMNS.lighting,
    weather: COLUMNS.weather,
  });
  const sourceAttributes = { ...dimensions.sourceAttributes };
  const unmapped = [...dimensions.unmapped];
  if (severity.unmapped && severity.raw !== null) {
    sourceAttributes[COLUMNS.severity] = severity.raw;
    unmapped.push("severity");
  }

  return {
    record: {
      externalId,
      collisionDate,
      collisionYear: collisionDate ? Number(collisionDate.slice(0, 4)) : null,
      severity: severity.severity,
      killedCount: toCasualtyCount(row[COLUMNS.fatalCount]),
      // Major, minor and possible injuries. Unknown injuries are not counted
      // as people injured: Iowa DOT does not say whether they were hurt.
      injuredCount: sumReadableCounts([
        row[COLUMNS.majorInjuryCount],
        row[COLUMNS.minorInjuryCount],
        row[COLUMNS.possibleInjuryCount],
      ]),
      pedestrianInvolved: involvement?.pedestrian.has(externalId) ?? false,
      bicyclistInvolved: involvement?.bicyclist.has(externalId) ?? false,
      // Not read. `party_role: "partial"` keeps this false from reading as
      // "no motorcyclist".
      motorcyclistInvolved: false,
      collisionType: dimensions.values.collision_type as CrashCollisionType | null,
      lighting: dimensions.values.lighting as CrashLighting | null,
      weather: dimensions.values.weather as CrashWeather | null,
      sourceAttributes,
      latitude: feature.latitude,
      longitude: feature.longitude,
      stateFips: IOWA_STATE_FIPS,
      sourceId: IOWADOT_IA_SOURCE_ID,
    },
    unmapped,
  };
}

type DateRangeBody = {
  error?: unknown;
  features?: Array<{ attributes?: Record<string, unknown> }>;
};

function utcYear(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const year = new Date(value).getUTCFullYear();
  return Number.isInteger(year) && year >= 1900 ? year : null;
}

/**
 * The crash years the layer holds: every year from its first crash date to
 * its last. An error body or a missing date is unavailable, not empty.
 */
async function fetchIowaYearsHeld(signal?: AbortSignal): Promise<number[]> {
  const params = new URLSearchParams({
    where: "1=1",
    outStatistics: JSON.stringify([
      { statisticType: "min", onStatisticField: COLUMNS.crashDate, outStatisticFieldName: "first_date" },
      { statisticType: "max", onStatisticField: COLUMNS.crashDate, outStatisticFieldName: "last_date" },
    ]),
    f: "json",
  });
  const body = await fetchJsonWithRetry<DateRangeBody>(
    `${IOWADOT_IA_LAYER_URL}/query?${params.toString()}`,
    signal ? { signal } : undefined,
    { timeoutMs: 30_000, retries: 1, cacheTtlMs: YEARS_CACHE_TTL_MS, cacheKey: `${IOWADOT_IA_SOURCE_ID}:years` }
  );
  if (body === null || body.error || !Array.isArray(body.features)) {
    throw new CrashSourceUnavailableError(IOWADOT_IA_SOURCE_ID, "Iowa DOT crash layer did not report its dates");
  }
  const attributes = body.features[0]?.attributes;
  const years = yearRange(utcYear(readStatistic(attributes, "first_date")), utcYear(readStatistic(attributes, "last_date")));
  if (years.length === 0) {
    throw new CrashSourceUnavailableError(IOWADOT_IA_SOURCE_ID, "Iowa DOT crash layer reported no crash dates");
  }
  return years;
}

/**
 * WHERE for one crash year, located crashes only. `year` is an integer, never
 * caller text. The unlocated point is excluded by its own coordinates. No crash
 * lacked either coordinate attribute on 2026-11-01.
 *
 * KEEP THE CLAUSE PLAIN. Iowa DOT's service sits behind a web application
 * firewall that answered an HTML block page, not JSON, to a WHERE combining
 * `IS NULL OR ... <>` on 2026-11-01. A block page reads as no response, so the
 * read fails as unavailable rather than as zero, but it fails every time.
 */
function whereForYear(year: number): string {
  const y = Math.trunc(year);
  const { easting, northing } = IOWADOT_IA_UNLOCATED_POINT;
  return (
    `${COLUMNS.crashDate} >= DATE '${y}-01-01' AND ${COLUMNS.crashDate} < DATE '${y + 1}-01-01'` +
    ` AND NOT (${COLUMNS.utmEasting} = ${easting} AND ${COLUMNS.utmNorthing} = ${northing})`
  );
}

export async function fetchIowaCrashes(params: CrashFetchParams): Promise<CrashFetchResult> {
  const yearsHeld = await fetchIowaYearsHeld(params.signal);
  return readStateCrashLayer<Involvement>(params, {
    sourceId: IOWADOT_IA_SOURCE_ID,
    yearsHeld,
    queryForYear: (year) => ({ layerUrl: IOWADOT_IA_LAYER_URL, where: whereForYear(year) }),
    outFields: IOWADOT_IA_REQUESTED_COLUMNS,
    orderBy: COLUMNS.objectId,
    pageSize: PAGE_SIZE,
    defaultMaxRecords: DEFAULT_MAX_RECORDS,
    prepareYear: fetchIowaInvolvement,
    toRecord: (feature, _year, involvement) => toIowaCrashRecord(feature, involvement),
  });
}

export const iowaDotIaAdapter: CrashSourceAdapter = {
  id: IOWADOT_IA_SOURCE_ID,
  label: "Iowa DOT crash data",
  attribution: `Iowa Department of Transportation, Crash Data (${IOWADOT_IA_ITEM_URL}), licensed under Creative Commons Attribution 4.0 International, with Iowa DOT's GIS Data Terms of Use.`,
  license: "CC BY 4.0, with Iowa DOT GIS Data Terms of Use",
  coverageState: "state_injury_file",
  severityCompleteness: "kabco_full",
  dimensions: IOWADOT_IA_DIMENSION_SUPPORT,
  earliestYear: IOWADOT_IA_EARLIEST_YEAR,
  persistable: false,
  roadContextProvider: "us-census-tiger-line",
  coversStateFips: [IOWA_STATE_FIPS],
  servesStateFips: [IOWA_STATE_FIPS],
  covers: (bbox) => bboxOverlapsBounds(bbox, IA_BOUNDS),
  fetch: fetchIowaCrashes,
};
