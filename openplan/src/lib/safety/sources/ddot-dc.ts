/**
 * DDOT: District Department of Transportation, Crashes in DC (2026-11-02).
 *
 * WHY THIS SOURCE. Outside California and Oregon the Safety module had only
 * FARS, which is fatal-only. DDOT publishes every located crash the
 * Metropolitan Police Department reports, refreshed nightly, as an ArcGIS
 * point layer with fatal, major and minor injury counts by mode, under an open
 * license. Checked 2026-11-01 (see
 * docs/research/STATE_INJURY_CRASH_SOURCES_2026-11-01.md):
 *
 *   - layer `DCGIS_DATA/Public_Safety_WebMercator/MapServer/24`, "Vehicular
 *     Crash Data", 356,668 crashes, envelope queries in EPSG:4326,
 *     maxRecordCount 1,000, no key, no account;
 *   - license on the Open Data DC item: "This work is licensed under a
 *     Creative Commons Attribution 4.0 International License".
 *
 * WHAT IT IS NOT.
 *   - Not stored. `safety_crashes.source_id` admits only the CCRS and FARS
 *     ids, so this adapter is `persistable: false`, like `odot-or`.
 *   - Not every reported crash. DDOT: "In the event that location data is
 *     missing or incomplete for a crash, it is unable to be published within
 *     this dataset." `matchedTotal` therefore equals `geocodedTotal`.
 *   - No crash date. `REPORTDATE` is "The date the offense was reported to
 *     MPD, which may be later than the date the offense actually occurred",
 *     and the layer has no other crash date. Years are report years, the
 *     record's `collisionYear` is the report year, and `collisionDate` stays
 *     null rather than presenting a report date as a crash date.
 *   - No KABCO letter. Severity is derived from DDOT's outcome counts by the
 *     rule in `ddot-dc-vocabulary.ts`; minor injury is not split into B and C.
 *   - Not a published cutoff. The adapter asks the layer for its latest report
 *     date and queries no year after it. Reports before 2009 are sparse (18 in
 *     2005), so years before 2009 are not offered.
 */

import { fetchJsonWithRetry } from "@/lib/data-sources/http";
import { stateFipsFromUsps } from "@/lib/geographies/state-fips";
import { type CrashSeverity } from "@/lib/safety/vocabulary";
import type { ArcgisCrashFeature } from "./arcgis-crash-query";
import {
  DDOT_DC_BICYCLIST_OUTCOME_COLUMNS,
  DDOT_DC_CRASH_COLUMNS as COLUMNS,
  DDOT_DC_DIMENSION_SUPPORT,
  DDOT_DC_FATAL_COLUMNS,
  DDOT_DC_MAJOR_INJURY_COLUMNS,
  DDOT_DC_MINOR_INJURY_COLUMNS,
  DDOT_DC_PEDESTRIAN_OUTCOME_COLUMNS,
  DDOT_DC_UNKNOWN_INJURY_COLUMNS,
} from "./ddot-dc-vocabulary";
import {
  allReadableZero,
  anyPositiveCount,
  bboxOverlapsBounds,
  readStateCrashLayer,
  readStatistic,
  sumReadableCounts,
  yearRange,
  type LayerRecordMapping,
} from "./state-crash-layer";
import { CrashSourceUnavailableError, type CrashFetchParams, type CrashFetchResult, type CrashSourceAdapter } from "./types";

export const DDOT_DC_SOURCE_ID = "ddot-dc";

export const DDOT_DC_LAYER_URL =
  "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Public_Safety_WebMercator/MapServer/24";

const DDOT_DC_ITEM_URL = "https://opendata.dc.gov/datasets/70392a096a8e431381f1f692aaa06afd";

/** First year with more than 10,000 reports (12,014 in 2009) when checked on 2026-11-01. */
const DDOT_DC_EARLIEST_YEAR = 2009;

/** The District's FIPS code, looked up rather than typed. */
const DC_STATE_FIPS = stateFipsFromUsps("DC")!;

/** Layer maxRecordCount is 1,000. */
const PAGE_SIZE = 1000;
const DEFAULT_MAX_RECORDS = 50_000;
const YEARS_CACHE_TTL_MS = 60 * 60 * 1000;

/** Coarse District envelope, a rejection filter only. */
const DC_BOUNDS = { minLon: -77.13, maxLon: -76.9, minLat: 38.79, maxLat: 39.0 };

const OUTCOME_COLUMNS = [
  ...DDOT_DC_FATAL_COLUMNS,
  ...DDOT_DC_MAJOR_INJURY_COLUMNS,
  ...DDOT_DC_MINOR_INJURY_COLUMNS,
  ...DDOT_DC_UNKNOWN_INJURY_COLUMNS,
] as const;

/** The columns requested, and the complete list of them. Nothing else is fetched. */
export const DDOT_DC_REQUESTED_COLUMNS = [
  COLUMNS.crashId,
  COLUMNS.reportDate,
  ...OUTCOME_COLUMNS,
  COLUMNS.totalPedestrians,
  COLUMNS.totalBicyclists,
] as const;

const valuesOf = (row: Record<string, unknown>, columns: readonly string[]) => columns.map((column) => row[column]);

/**
 * Severity from DDOT's outcome counts. A positive count is a positive
 * observation and wins over an unreadable one; property damage only needs
 * every count to be a readable zero.
 */
export function ddotSeverity(row: Record<string, unknown>): CrashSeverity {
  if (anyPositiveCount(valuesOf(row, DDOT_DC_FATAL_COLUMNS))) return "fatal";
  if (anyPositiveCount(valuesOf(row, DDOT_DC_MAJOR_INJURY_COLUMNS))) return "severe_injury";
  if (anyPositiveCount(valuesOf(row, DDOT_DC_MINOR_INJURY_COLUMNS))) return "injury";
  if (allReadableZero(valuesOf(row, OUTCOME_COLUMNS))) return "pdo";
  return "unknown";
}

function toDdotCrashRecord(feature: ArcgisCrashFeature, year: number): LayerRecordMapping {
  const row = feature.attributes;
  const rawId = row[COLUMNS.crashId];
  const externalId = rawId == null ? "" : String(rawId).trim();
  if (!externalId || feature.latitude === null || feature.longitude === null) return null;

  return {
    record: {
      externalId,
      // A report date is not a crash date (see the header).
      collisionDate: null,
      collisionYear: year,
      severity: ddotSeverity(row),
      killedCount: sumReadableCounts(valuesOf(row, DDOT_DC_FATAL_COLUMNS)),
      // Major and minor injuries. Unknown injuries are not counted as people injured.
      injuredCount: sumReadableCounts([
        ...valuesOf(row, DDOT_DC_MAJOR_INJURY_COLUMNS),
        ...valuesOf(row, DDOT_DC_MINOR_INJURY_COLUMNS),
      ]),
      pedestrianInvolved: anyPositiveCount([
        row[COLUMNS.totalPedestrians],
        ...valuesOf(row, DDOT_DC_PEDESTRIAN_OUTCOME_COLUMNS),
      ]),
      bicyclistInvolved: anyPositiveCount([
        row[COLUMNS.totalBicyclists],
        ...valuesOf(row, DDOT_DC_BICYCLIST_OUTCOME_COLUMNS),
      ]),
      motorcyclistInvolved: false,
      collisionType: null,
      lighting: null,
      weather: null,
      sourceAttributes: {},
      latitude: feature.latitude,
      longitude: feature.longitude,
      stateFips: DC_STATE_FIPS,
      sourceId: DDOT_DC_SOURCE_ID,
    },
    unmapped: [],
  };
}

type LatestReportBody = {
  error?: unknown;
  features?: Array<{ attributes?: Record<string, unknown> }>;
};

/**
 * Report years the layer can answer for: 2009 through the year of its latest
 * report. An error body or a missing date is unavailable, not empty.
 */
async function fetchDdotYearsHeld(signal?: AbortSignal): Promise<number[]> {
  const params = new URLSearchParams({
    where: "1=1",
    outStatistics: JSON.stringify([
      { statisticType: "max", onStatisticField: COLUMNS.reportDate, outStatisticFieldName: "last_report" },
    ]),
    f: "json",
  });
  const body = await fetchJsonWithRetry<LatestReportBody>(
    `${DDOT_DC_LAYER_URL}/query?${params.toString()}`,
    signal ? { signal } : undefined,
    { timeoutMs: 30_000, retries: 1, cacheTtlMs: YEARS_CACHE_TTL_MS, cacheKey: `${DDOT_DC_SOURCE_ID}:years` }
  );
  if (body === null || body.error || !Array.isArray(body.features)) {
    throw new CrashSourceUnavailableError(DDOT_DC_SOURCE_ID, "DDOT crash layer did not report its latest date");
  }
  const latest = readStatistic(body.features[0]?.attributes, "last_report");
  const lastYear = typeof latest === "number" && Number.isFinite(latest) ? new Date(latest).getUTCFullYear() : null;
  const years = yearRange(DDOT_DC_EARLIEST_YEAR, lastYear);
  if (years.length === 0) {
    throw new CrashSourceUnavailableError(DDOT_DC_SOURCE_ID, "DDOT crash layer reported no report dates");
  }
  return years;
}

/**
 * WHERE for one report year. `year` is an integer, never caller text. The
 * layer declares its dates in Eastern time, so the boundaries are local.
 */
function whereForYear(year: number): string {
  const y = Math.trunc(year);
  return (
    `${COLUMNS.reportDate} >= TIMESTAMP '${y}-01-01 00:00:00'` +
    ` AND ${COLUMNS.reportDate} < TIMESTAMP '${y + 1}-01-01 00:00:00'`
  );
}

export async function fetchDdotCrashes(params: CrashFetchParams): Promise<CrashFetchResult> {
  const yearsHeld = await fetchDdotYearsHeld(params.signal);
  return readStateCrashLayer<undefined>(params, {
    sourceId: DDOT_DC_SOURCE_ID,
    yearsHeld,
    queryForYear: (year) => ({ layerUrl: DDOT_DC_LAYER_URL, where: whereForYear(year) }),
    outFields: DDOT_DC_REQUESTED_COLUMNS,
    orderBy: COLUMNS.objectId,
    pageSize: PAGE_SIZE,
    defaultMaxRecords: DEFAULT_MAX_RECORDS,
    toRecord: (feature, year) => toDdotCrashRecord(feature, year),
  });
}

export const ddotDcAdapter: CrashSourceAdapter = {
  id: DDOT_DC_SOURCE_ID,
  label: "DDOT Crashes in DC",
  attribution: `District Department of Transportation, Crashes in DC, from Metropolitan Police Department reports (${DDOT_DC_ITEM_URL}), licensed under Creative Commons Attribution 4.0 International. Years are the years crashes were reported.`,
  license: "CC BY 4.0",
  coverageState: "state_injury_file",
  severityCompleteness: "kabco_full",
  dimensions: DDOT_DC_DIMENSION_SUPPORT,
  earliestYear: DDOT_DC_EARLIEST_YEAR,
  persistable: false,
  roadContextProvider: "us-census-tiger-line",
  coversStateFips: [DC_STATE_FIPS],
  servesStateFips: [DC_STATE_FIPS],
  covers: (bbox) => bboxOverlapsBounds(bbox, DC_BOUNDS),
  fetch: fetchDdotCrashes,
};
