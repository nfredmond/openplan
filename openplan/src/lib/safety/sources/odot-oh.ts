/**
 * ODOT: Ohio Department of Transportation crash locations (2026-11-02).
 *
 * WHY THIS SOURCE. Outside California and Oregon the Safety module had only
 * FARS, which is fatal-only. ODOT's Transportation Information Mapping System
 * (TIMS) publishes every crash year as its own ArcGIS point layer with ODOT's
 * five-level crash severity on every crash. Checked 2026-11-01 (see
 * docs/research/STATE_INJURY_CRASH_SOURCES_2026-11-01.md):
 *
 *   - services `Safety/2021_Crash_Locations` to `Safety/2025_Crash_Locations`,
 *     one layer each (2024: 251,091 crashes; 2025: 264,530), envelope queries
 *     in EPSG:4326, no key, no account;
 *   - terms in each layer's metadata: "The information contained within this
 *     dataset is maintained by the Ohio Department of Transportation (ODOT),
 *     and is deemed to be public information", with a no-warranty and
 *     no-liability statement. No open license is named, which the attribution
 *     says.
 *
 * WHAT IT IS NOT.
 *   - Not limited to live reads. Migration 20261102100000 admits `odot-oh` to
 *     `safety_crashes.source_id`, so a Safety acquisition in Ohio stores
 *     these crashes rather than fatal-only FARS.
 *   - Not every reported crash. Every row carries a latitude and longitude
 *     (no null or zero coordinates in 2021 or 2025) and the layer is named
 *     "Crash Locations"; it does not say whether crashes ODOT could not locate
 *     are left out. `matchedTotal` therefore equals `geocodedTotal`, and the
 *     label does not claim every reported crash.
 *   - No crash date. The layer has month, day of week and hour, not the day
 *     of the month, so `collisionDate` is null and the year comes from
 *     `CRASH_YR`.
 *   - No casualty counts. `killedCount` and `injuredCount` are null; the
 *     corridor summary then counts at least one death per fatal crash, a floor.
 *   - Not a published cutoff. The adapter asks the TIMS catalog which crash
 *     years have a service and reads only those.
 */

import { fetchJsonWithRetry } from "@/lib/data-sources/http";
import { stateFipsFromUsps } from "@/lib/geographies/state-fips";
import { type CrashCollisionType, type CrashSeverity } from "@/lib/safety/vocabulary";
import type { ArcgisCrashFeature } from "./arcgis-crash-query";
import {
  ODOT_OH_CRASH_COLUMNS as COLUMNS,
  ODOT_OH_DIMENSION_SUPPORT,
  ODOT_OH_PEDALCYCLE_CRASH_TYPE,
  ODOT_OH_PEDESTRIAN_CRASH_TYPE,
  ODOT_OH_VOCABULARY,
} from "./odot-oh-vocabulary";
import { bboxOverlapsBounds, mapLayerDimensions, readStateCrashLayer, type LayerRecordMapping } from "./state-crash-layer";
import { CrashSourceUnavailableError, type CrashFetchParams, type CrashFetchResult, type CrashSourceAdapter } from "./types";

export const ODOT_OH_SOURCE_ID = "odot-oh";

/** The TIMS services folder; each crash year is `<folder>/<year>_Crash_Locations/MapServer/0`. */
export const ODOT_OH_SERVICES_URL = "https://tims.dot.state.oh.us/ags/rest/services/Safety";

const ODOT_OH_METADATA_URL = `${ODOT_OH_SERVICES_URL}/2025_Crash_Locations/MapServer/0/metadata`;

/** First year with a service as published on 2026-11-01. The catalog is asked which years exist. */
const ODOT_OH_EARLIEST_YEAR = 2021;

/** Ohio's state FIPS code, looked up rather than typed. */
const OHIO_STATE_FIPS = stateFipsFromUsps("OH")!;

/** Layer maxRecordCount is 2,000,000; pages stay at 2,000 to keep responses modest. */
const PAGE_SIZE = 2000;
const DEFAULT_MAX_RECORDS = 50_000;
const YEARS_CACHE_TTL_MS = 60 * 60 * 1000;

/** Coarse Ohio envelope, a rejection filter only. */
const OH_BOUNDS = { minLon: -84.9, maxLon: -80.4, minLat: 38.3, maxLat: 42.4 };

/** The service name pattern for one crash year in the TIMS Safety folder. */
const YEAR_SERVICE_PATTERN = /^Safety\/(\d{4})_Crash_Locations$/;

export function odotOhLayerUrl(year: number): string {
  return `${ODOT_OH_SERVICES_URL}/${Math.trunc(year)}_Crash_Locations/MapServer/0`;
}

/** The columns requested, and the complete list of them. Nothing else is fetched. */
export const ODOT_OH_REQUESTED_COLUMNS = [
  COLUMNS.documentNumber,
  COLUMNS.year,
  COLUMNS.severity,
  COLUMNS.crashType,
] as const;

/** ODOT's document number as text; the layer types it as a big integer. */
function toDocumentNumber(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return String(Math.trunc(value));
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return value.trim();
  return null;
}

function crashTypeIs(row: Record<string, unknown>, type: string): boolean {
  const raw = row[COLUMNS.crashType];
  return typeof raw === "string" && raw.trim().toUpperCase() === type;
}

function toOhioCrashRecord(feature: ArcgisCrashFeature, year: number): LayerRecordMapping {
  const row = feature.attributes;
  const externalId = toDocumentNumber(row[COLUMNS.documentNumber]);
  if (!externalId || feature.latitude === null || feature.longitude === null) return null;

  const dimensions = mapLayerDimensions(ODOT_OH_VOCABULARY, row, {
    severity: COLUMNS.severity,
    collision_type: COLUMNS.crashType,
  });
  const rowYear = typeof row[COLUMNS.year] === "number" ? (row[COLUMNS.year] as number) : null;
  return {
    record: {
      externalId,
      collisionDate: null,
      collisionYear: rowYear !== null && Number.isInteger(rowYear) ? rowYear : year,
      severity: (dimensions.values.severity ?? "unknown") as CrashSeverity,
      killedCount: null,
      injuredCount: null,
      // A floor: only crashes ODOT typed Pedestrian or Pedalcycles.
      pedestrianInvolved: crashTypeIs(row, ODOT_OH_PEDESTRIAN_CRASH_TYPE),
      bicyclistInvolved: crashTypeIs(row, ODOT_OH_PEDALCYCLE_CRASH_TYPE),
      motorcyclistInvolved: false,
      collisionType: dimensions.values.collision_type as CrashCollisionType | null,
      lighting: null,
      weather: null,
      sourceAttributes: dimensions.sourceAttributes,
      latitude: feature.latitude,
      longitude: feature.longitude,
      stateFips: OHIO_STATE_FIPS,
      sourceId: ODOT_OH_SOURCE_ID,
    },
    unmapped: dimensions.unmapped,
  };
}

type CatalogBody = { error?: unknown; services?: Array<{ name?: unknown; type?: unknown }> };

/**
 * The crash years with a published service, asked of the TIMS catalog.
 * An error body or a catalog with no crash-year service is unavailable.
 */
async function fetchOhioYearsHeld(signal?: AbortSignal): Promise<number[]> {
  const body = await fetchJsonWithRetry<CatalogBody>(
    `${ODOT_OH_SERVICES_URL}?f=json`,
    signal ? { signal } : undefined,
    { timeoutMs: 30_000, retries: 1, cacheTtlMs: YEARS_CACHE_TTL_MS, cacheKey: `${ODOT_OH_SOURCE_ID}:years` }
  );
  if (body === null || body.error || !Array.isArray(body.services)) {
    throw new CrashSourceUnavailableError(ODOT_OH_SOURCE_ID, "ODOT TIMS catalog did not list its crash services");
  }
  const years = body.services.flatMap((service) => {
    if (service.type !== "MapServer" || typeof service.name !== "string") return [];
    const match = YEAR_SERVICE_PATTERN.exec(service.name);
    return match ? [Number(match[1])] : [];
  });
  if (years.length === 0) {
    throw new CrashSourceUnavailableError(ODOT_OH_SOURCE_ID, "ODOT TIMS catalog listed no crash-year services");
  }
  return Array.from(new Set(years)).sort((a, b) => a - b);
}

export async function fetchOhioCrashes(params: CrashFetchParams): Promise<CrashFetchResult> {
  const yearsHeld = await fetchOhioYearsHeld(params.signal);
  return readStateCrashLayer<undefined>(params, {
    sourceId: ODOT_OH_SOURCE_ID,
    yearsHeld,
    // The year filter repeats the service's year, so a service that held a
    // second year by mistake could not add it to this one.
    queryForYear: (year) => ({ layerUrl: odotOhLayerUrl(year), where: `${COLUMNS.year} = ${Math.trunc(year)}` }),
    outFields: ODOT_OH_REQUESTED_COLUMNS,
    orderBy: COLUMNS.objectId,
    pageSize: PAGE_SIZE,
    defaultMaxRecords: DEFAULT_MAX_RECORDS,
    toRecord: (feature, year) => toOhioCrashRecord(feature, year),
  });
}

export const odotOhAdapter: CrashSourceAdapter = {
  id: ODOT_OH_SOURCE_ID,
  label: "Ohio DOT crash locations (TIMS)",
  attribution: `Ohio Department of Transportation, crash locations published in the Transportation Information Mapping System (${ODOT_OH_METADATA_URL}). ODOT deems the data public information and names no open license.`,
  license: "Public information per ODOT; no open license named",
  coverageState: "state_injury_file",
  severityCompleteness: "kabco_full",
  dimensions: ODOT_OH_DIMENSION_SUPPORT,
  earliestYear: ODOT_OH_EARLIEST_YEAR,
  persistable: true,
  roadContextProvider: "us-census-tiger-line",
  coversStateFips: [OHIO_STATE_FIPS],
  servesStateFips: [OHIO_STATE_FIPS],
  covers: (bbox) => bboxOverlapsBounds(bbox, OH_BOUNDS),
  fetch: fetchOhioCrashes,
};
