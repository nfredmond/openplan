/**
 * The parts a state crash-layer adapter shares, after transport.
 *
 * `arcgis-crash-query.ts` owns the HTTP shape (envelope, field list, paging,
 * error bodies). This file owns the reading loop every state layer adapter
 * runs once it knows which years the layer holds: count the year inside the
 * envelope, page the features up to the caller's cap, map each feature, and
 * tally what the descriptor could not classify. The Oregon adapter (`odot-or.ts`)
 * runs the same loop inline; Iowa, Ohio and DC use this one.
 *
 * NOTHING HERE SPELLS A SOURCE VALUE. Column names, codes and the WHERE clause
 * for a year come from each adapter and its vocabulary file.
 */

import type { StudyAreaBbox } from "@/lib/models/study-area";
import {
  mapCrashDimension,
  toCasualtyCount,
  type CrashDimension,
  type CrashSourceVocabularyDescriptor,
} from "@/lib/safety/vocabulary";
import { countArcgisCrashes, fetchArcgisCrashFeatures, type ArcgisCrashFeature } from "./arcgis-crash-query";
import type { CrashFetchParams, CrashFetchResult, CrashRecord } from "./types";

/** A coarse lon/lat rectangle. A rejection filter only; the state decides coverage. */
export type CoarseBounds = { minLon: number; maxLon: number; minLat: number; maxLat: number };

export function bboxOverlapsBounds(bbox: StudyAreaBbox, bounds: CoarseBounds): boolean {
  return (
    bbox.minLon <= bounds.maxLon &&
    bbox.maxLon >= bounds.minLon &&
    bbox.minLat <= bounds.maxLat &&
    bbox.maxLat >= bounds.minLat
  );
}

/**
 * The sum of the readable counts, or null when none was readable.
 *
 * A readable count beside an unreadable one still contributes, as in
 * `odotInjuredCount`; only "nothing readable at all" stays unknown.
 */
export function sumReadableCounts(values: readonly unknown[]): number | null {
  const counts = values.map(toCasualtyCount);
  if (counts.every((count) => count === null)) return null;
  return counts.reduce<number>((sum, count) => sum + (count ?? 0), 0);
}

/** True only when at least one value is a readable count above zero. */
export function anyPositiveCount(values: readonly unknown[]): boolean {
  return values.some((value) => {
    const count = toCasualtyCount(value);
    return count !== null && count > 0;
  });
}

/** True only when every value is a readable zero. */
export function allReadableZero(values: readonly unknown[]): boolean {
  return values.every((value) => toCasualtyCount(value) === 0);
}

/**
 * Read one statistic from an ArcGIS statistics answer, whatever its case.
 *
 * Some servers upper-case `outStatisticFieldName` (Iowa DOT's returns `N` for
 * `n`), so a reader that matched the requested spelling exactly would see
 * every statistic as missing.
 */
export function readStatistic(attributes: Record<string, unknown> | undefined, name: string): unknown {
  if (!attributes) return undefined;
  const key = Object.keys(attributes).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : attributes[key];
}

export type MappedLayerDimensions = {
  values: Partial<Record<CrashDimension, string | null>>;
  sourceAttributes: Record<string, string>;
  unmapped: CrashDimension[];
};

/**
 * Map the descriptor's dimensions for one feature.
 *
 * A dimension the descriptor does not supply maps to null. An undeclared
 * spelling keeps its raw text under its column name and is counted, exactly as
 * the Oregon adapter does.
 */
export function mapLayerDimensions(
  vocabulary: CrashSourceVocabularyDescriptor,
  row: Record<string, unknown>,
  columns: Partial<Record<CrashDimension, string>>
): MappedLayerDimensions {
  const values: Partial<Record<CrashDimension, string | null>> = {};
  const sourceAttributes: Record<string, string> = {};
  const unmapped: CrashDimension[] = [];
  for (const [dimension, column] of Object.entries(columns) as Array<[CrashDimension, string]>) {
    const mapping = mapCrashDimension(vocabulary, dimension, row[column]);
    if (mapping === null) {
      values[dimension] = null;
      continue;
    }
    if (mapping.unmapped && mapping.raw !== null) {
      sourceAttributes[column] = mapping.raw;
      unmapped.push(dimension);
    }
    values[dimension] = mapping.value;
  }
  return { values, sourceAttributes, unmapped };
}

/** One mapped feature, or null when it has no id or no point. */
export type LayerRecordMapping = { record: CrashRecord; unmapped: CrashDimension[] } | null;

type StateLayerYearQuery = {
  /** Layer URL ending in `/FeatureServer/<n>` or `/MapServer/<n>`. */
  layerUrl: string;
  /** WHERE for one crash year; built from an integer year, never caller text. */
  where: string;
};

export type StateLayerReadPlan<Context> = {
  sourceId: string;
  /** Years the layer holds, asked of the source. */
  yearsHeld: readonly number[];
  queryForYear: (year: number) => StateLayerYearQuery;
  outFields: readonly string[];
  orderBy: string;
  /** Must not exceed the layer's own maxRecordCount. */
  pageSize: number;
  defaultMaxRecords: number;
  /**
   * Optional per-year lookup run before the year's features are mapped, for a
   * fact the crash layer does not carry (Iowa's non-motorist rows). It throws
   * when its own source does not answer, like any other read.
   */
  prepareYear?: (year: number, bbox: StudyAreaBbox, signal?: AbortSignal) => Promise<Context>;
  toRecord: (feature: ArcgisCrashFeature, year: number, context: Context | undefined) => LayerRecordMapping;
};

/**
 * Read the requested years that the layer holds, most recent first, located
 * crashes only.
 *
 * `matchedTotal` equals `geocodedTotal`: an envelope query cannot count a
 * crash that has no location, so neither number pretends to.
 */
export async function readStateCrashLayer<Context>(
  params: CrashFetchParams,
  plan: StateLayerReadPlan<Context>
): Promise<CrashFetchResult> {
  const maxRecords = params.maxRecords ?? plan.defaultMaxRecords;
  const held = new Set(plan.yearsHeld);
  const years = Array.from(new Set(params.years))
    .filter((year) => Number.isInteger(year) && held.has(year))
    .sort((a, b) => b - a);

  const records: CrashRecord[] = [];
  const unmappedByDimension: Partial<Record<CrashDimension, number>> = {};
  let geocodedTotal = 0;
  let truncated = false;

  for (const year of years) {
    const { layerUrl, where } = plan.queryForYear(year);
    const query = { sourceId: plan.sourceId, layerUrl, where, bbox: params.bbox, signal: params.signal };
    const countForYear = await countArcgisCrashes(query);

    const remaining = maxRecords - records.length;
    if (remaining <= 0) {
      geocodedTotal += countForYear;
      truncated = truncated || countForYear > 0;
      continue;
    }
    const page = await fetchArcgisCrashFeatures({
      ...query,
      outFields: plan.outFields,
      orderBy: plan.orderBy,
      pageSize: plan.pageSize,
      limit: remaining,
    });
    // Truncated only when the cap left crashes behind, not when it landed exactly.
    const capLeftCrashes = page.truncated && countForYear > page.features.length;
    truncated = truncated || capLeftCrashes;
    // An untruncated feature answer is the complete answer, so it is the total.
    // The count and feature queries can disagree by a point on the envelope's
    // edge: DDOT's layer counted 30 crashes in the DC fixture's box on
    // 2026-11-01 and returned 29, the 30th lying 0.5 m outside it. Taking the
    // count would report a crash the map cannot show.
    geocodedTotal += capLeftCrashes ? countForYear : page.features.length;

    const context =
      plan.prepareYear && page.features.length > 0
        ? await plan.prepareYear(year, params.bbox, params.signal)
        : undefined;

    for (const feature of page.features) {
      const mapped = plan.toRecord(feature, year, context);
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

/** Calendar years from `first` to `last`, inclusive; empty when either is missing. */
export function yearRange(first: number | null, last: number | null): number[] {
  if (first === null || last === null || first > last) return [];
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}
