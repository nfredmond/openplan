/**
 * Crash data for the Explore corridor scorecard.
 *
 * ONE CRASH LANE (Wave 8.2). This module used to be a second, parallel crash
 * implementation: a containment-tested local SWITRS CSV reader (which could not
 * exist on Vercel and silently dropped any study area straddling a state line),
 * a FARS tier that read no coordinates, and an `fars-estimate` tier that
 * fabricated every field — fatalities, pedestrian deaths, crash density — from
 * the bounding box's area. It is now a *summarizer* over the crash-source
 * registry in `src/lib/safety/sources/`, which is the same lane the Safety
 * module ingests from. The scorecard and the safety analysis can no longer
 * disagree about a place's crash history.
 *
 * WHY THE ESTIMATE TIER IS GONE. It was disclosed (`isEstimatedSource()` flagged
 * it), and disclosure is what made it defensible when there was no national
 * alternative. Three things make it indefensible now:
 *
 *   1. Its numbers were manufactured from ratios that assume a US urban crash
 *      profile (1.3 crashes/sq-mi/yr, 17% pedestrian, 4.5 injuries per fatal).
 *      Those constants are a jurisdiction baked into core code, which is
 *      exactly what the platform's non-negotiables forbid, and they are
 *      meaningless outside the country they were fitted to.
 *   2. The disclosure stopped at the badge. The fabricated crash density flowed
 *      unlabeled into `computeSafety()`, into the overall score, and from there
 *      into grant narratives — where a reviewer sees a number, not a badge.
 *   3. A real national-capable registry now exists (CCRS + FARS), so the honest
 *      answer for an uncovered area is "no crash source covers this study area",
 *      and that answer is now *reachable*.
 *
 * Nothing renders blank as a result: an unobserved run reports `observed:false`
 * and the analysis route emits null crash metrics, which every consumer already
 * renders as "N/A" (see `explore-results-board`, `api/report`'s `fmt`). Because
 * `buildInterpretationFacts` skips null metrics, the AI narrative loses the
 * ability to cite a crash figure at all when there is no crash source.
 */

import { resolveCrashSource } from "@/lib/safety/sources/registry";
import type { StudyAreaBbox } from "@/lib/models/study-area";
import type {
  CrashFetchResult,
  CrashRecord,
  CrashSeverityCompleteness,
  CrashSourceAdapter,
} from "@/lib/safety/sources/types";

/**
 * What a crash figure on the scorecard is made of.
 *
 * `observed:false` is the honest state — either no adapter covers the study
 * area, or the covering adapter's source could not be reached. In that state
 * every count is zero-by-schema and MUST NOT be presented as a measurement;
 * callers key off `observed`, not off the numbers.
 */
export type CrashSummarySourceState = "out-of-coverage" | "source-unavailable";

/**
 * What `crashesPerSquareMile` counts.
 *
 * Sources differ in what they even record, so the density basis has to travel
 * with the number. `injury_and_fatal` is the reportable-crash density planners
 * expect; `fatal_only` is all a fatality census can offer and is roughly two
 * orders of magnitude smaller — comparing the two would be meaningless.
 */
export type CrashDensityBasis = "injury_and_fatal" | "fatal_only" | "none";

export interface CrashSummary {
  /** True only when a source actually answered. The gate for every figure below. */
  observed: boolean;
  /** Registry adapter id when observed; otherwise an explicit no-data state. */
  source: string | CrashSummarySourceState;
  sourceLabel: string;
  attribution: string | null;
  severityCompleteness: CrashSeverityCompleteness | null;
  totalFatalCrashes: number;
  totalFatalities: number;
  /** Fatal crashes INVOLVING a pedestrian — not the number of pedestrians killed. */
  pedestrianFatalities: number;
  bicyclistFatalities: number;
  /** null when the source cannot separate KABCO A (suspected serious injury). */
  severeInjuryCrashes: number | null;
  /** null when the source is fatal-only and therefore never saw an injury crash. */
  totalInjuryCrashes: number | null;
  yearsQueried: number[];
  crashesPerSquareMile: number;
  crashDensityBasis: CrashDensityBasis;
  /** Crashes the source matched, geocoded or not. */
  reportedTotal: number;
  /** Of those, how many carried usable coordinates and could be mapped. */
  mappedTotal: number;
  truncated: boolean;
  /**
   * Mappable crash points from the SAME fetch that produced the counts above.
   * They used to come from a second, independent read, so the map and the
   * scorecard could describe different data.
   */
  points: CrashPointFeature[];
  /** Adapters consulted when nothing covered the study area. */
  checkedSources: string[];
  /** Why the source could not answer, when it could not. */
  unavailableReason: string | null;
  /**
   * The run's `sourceSnapshots.crashes` entry and the safety line of its
   * narrative, built here rather than at the call site.
   *
   * Disclosure travels WITH the figures on purpose: a caller that renders crash
   * numbers cannot forget to say where they came from, or fail to say that they
   * do not exist. `buildCrashSourceSnapshot` / `describeCrashSafety` remain
   * exported so the wording is unit-testable on its own.
   */
  sourceSnapshot: Record<string, unknown>;
  narrativeLine: string;
}

/** A summary before its own disclosure is attached. */
type CrashSummaryCore = Omit<CrashSummary, "sourceSnapshot" | "narrativeLine">;

export type CrashPointSeverityBucket = "fatal" | "severe_injury" | "injury";

export type CrashPointFeature = GeoJSON.Feature<
  GeoJSON.Point,
  {
    kind: "crash_point";
    /** Registry adapter id, so a point always carries its provenance. */
    source: string;
    severityBucket: CrashPointSeverityBucket;
    severityLabel: string;
    collisionYear: number | null;
    fatalCount: number;
    injuryCount: number;
    pedestrianInvolved: boolean;
    bicyclistInvolved: boolean;
  }
>;

/**
 * How many recent calendar years the scorecard asks for.
 *
 * Deliberately a window rather than a vintage: national fatality files publish
 * roughly two years in arrears while state files run closer to real time, so a
 * hardcoded year list (the retired implementation pinned 2022/2021/2020) rots
 * into "no crashes found". Adapters clamp this to what they actually hold.
 */
const ANALYSIS_YEAR_WINDOW = 4;

/** Cap on points returned to a single corridor run; truncation is disclosed. */
const ANALYSIS_MAX_RECORDS = 5_000;

export function recentCrashYears(now: Date = new Date()): number[] {
  const mostRecentComplete = now.getUTCFullYear() - 1;
  return Array.from({ length: ANALYSIS_YEAR_WINDOW }, (_, index) => mostRecentComplete - index);
}

function bboxAreaSquareMiles(bbox: StudyAreaBbox): number {
  const latMid = (bbox.minLat + bbox.maxLat) / 2;
  const latDist = Math.abs(bbox.maxLat - bbox.minLat) * 69.0;
  const lonDist = Math.abs(bbox.maxLon - bbox.minLon) * 69.0 * Math.cos((latMid * Math.PI) / 180);
  return Math.max(0.01, latDist * lonDist);
}

function labelForSeverityBucket(severity: CrashPointSeverityBucket): string {
  if (severity === "fatal") return "Fatal";
  if (severity === "severe_injury") return "Severe injury";
  return "Injury";
}

/**
 * Property-damage-only crashes are dropped from the map layer: they are the
 * bulk of any record-level file and would bury the KSI points the layer exists
 * to show. They remain in `reportedTotal`.
 */
function toPointFeature(record: CrashRecord, sourceId: string): CrashPointFeature | null {
  if (record.severity === "pdo") return null;
  const severityBucket: CrashPointSeverityBucket = record.severity;

  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [record.longitude, record.latitude] },
    properties: {
      kind: "crash_point",
      source: sourceId,
      severityBucket,
      severityLabel: labelForSeverityBucket(severityBucket),
      collisionYear: record.collisionYear,
      fatalCount: record.killedCount,
      injuryCount: record.injuredCount,
      pedestrianInvolved: record.pedestrianInvolved,
      bicyclistInvolved: record.bicyclistInvolved,
    },
  };
}

function emptySummary(
  base: Pick<CrashSummary, "source" | "sourceLabel" | "checkedSources" | "unavailableReason">
): CrashSummaryCore {
  return {
    observed: false,
    attribution: null,
    severityCompleteness: null,
    totalFatalCrashes: 0,
    totalFatalities: 0,
    pedestrianFatalities: 0,
    bicyclistFatalities: 0,
    severeInjuryCrashes: null,
    totalInjuryCrashes: null,
    yearsQueried: [],
    crashesPerSquareMile: 0,
    crashDensityBasis: "none",
    reportedTotal: 0,
    mappedTotal: 0,
    truncated: false,
    points: [],
    ...base,
  };
}

export function summarizeCrashFetch(
  adapter: CrashSourceAdapter,
  fetched: CrashFetchResult,
  bbox: StudyAreaBbox,
  requestedYears: number[]
): CrashSummaryCore {
  let totalFatalCrashes = 0;
  let totalFatalities = 0;
  let pedestrianFatalities = 0;
  let bicyclistFatalities = 0;
  let severeInjuryCrashes = 0;
  let injuryCrashes = 0;

  const points: CrashPointFeature[] = [];

  for (const record of fetched.records) {
    if (record.severity === "fatal") {
      totalFatalCrashes += 1;
      totalFatalities += Math.max(1, record.killedCount);
      if (record.pedestrianInvolved) pedestrianFatalities += 1;
      if (record.bicyclistInvolved) bicyclistFatalities += 1;
    }

    if (record.severity === "severe_injury") severeInjuryCrashes += 1;
    if (record.severity === "severe_injury" || record.severity === "injury") injuryCrashes += 1;

    const point = toPointFeature(record, adapter.id);
    if (point) points.push(point);
  }

  const fatalOnly = adapter.severityCompleteness === "fatal_only";
  // A source that cannot separate KABCO A must report null, never 0: "0 serious
  // injuries" and "serious injuries are not distinguishable here" are opposite
  // findings, and the second one is the true one.
  const severeInjury = adapter.severityCompleteness === "kabco_full" ? severeInjuryCrashes : null;
  const totalInjuryCrashes = fatalOnly ? null : injuryCrashes;

  const area = bboxAreaSquareMiles(bbox);
  const yearsQueried = fetched.yearsCovered;
  const annualBasis = Math.max(1, yearsQueried.length || requestedYears.length);
  const densityCount = totalInjuryCrashes ?? totalFatalCrashes;

  return {
    observed: true,
    source: adapter.id,
    sourceLabel: adapter.label,
    attribution: adapter.attribution,
    severityCompleteness: adapter.severityCompleteness,
    totalFatalCrashes,
    totalFatalities,
    pedestrianFatalities,
    bicyclistFatalities,
    severeInjuryCrashes: severeInjury,
    totalInjuryCrashes,
    yearsQueried,
    crashesPerSquareMile: Math.round((densityCount / annualBasis / area) * 10) / 10,
    crashDensityBasis: fatalOnly ? "fatal_only" : "injury_and_fatal",
    reportedTotal: fetched.matchedTotal,
    mappedTotal: fetched.geocodedTotal,
    truncated: fetched.truncated,
    points,
    checkedSources: [adapter.id],
    unavailableReason: null,
  };
}

function withDisclosure(core: CrashSummaryCore): CrashSummary {
  return {
    ...core,
    // The moment the source was read, which is what provenance actually means
    // here — not the moment the surrounding analysis finished assembling.
    sourceSnapshot: buildCrashSourceSnapshot(core, new Date().toISOString()),
    narrativeLine: describeCrashSafety(core),
  };
}

export async function fetchCrashesForBbox(
  bbox: StudyAreaBbox,
  options: { now?: Date; signal?: AbortSignal } = {}
): Promise<CrashSummary> {
  // "read_only": the scorecard reports crash figures but never writes crash
  // rows, so it may use sources the `safety_crashes` CHECK domain has not been
  // widened for yet.
  const resolution = resolveCrashSource(bbox, "read_only");

  if (resolution.kind === "out_of_coverage") {
    return withDisclosure(
      emptySummary({
        source: "out-of-coverage",
        sourceLabel: "No covering crash source",
        checkedSources: resolution.checked.map((entry) => entry.id),
        unavailableReason: null,
      })
    );
  }

  const adapter = resolution.adapter;
  const years = recentCrashYears(options.now).filter((year) => year >= adapter.earliestYear);

  try {
    const fetched = await adapter.fetch({
      bbox,
      years,
      maxRecords: ANALYSIS_MAX_RECORDS,
      signal: options.signal,
    });
    return withDisclosure(summarizeCrashFetch(adapter, fetched, bbox, years));
  } catch (error) {
    // An outage is a state, not a number. Every count stays zero-by-schema and
    // `observed:false` is what callers read.
    return withDisclosure(
      emptySummary({
        source: "source-unavailable",
        sourceLabel: adapter.label,
        checkedSources: [adapter.id],
        unavailableReason: error instanceof Error ? error.message : "Unknown crash source failure",
      })
    );
  }
}

/**
 * The `sourceSnapshots.crashes` entry for a run's metrics.
 *
 * `source` is deliberately OMITTED when nothing was observed. That is not
 * evasion — it is how the existing disclosure seam is wired:
 * `resolveEstimatedDomains()` only trusts `dataQuality.crashDataAvailable` when
 * the snapshot carries no source string, and leaving a non-source token there
 * would make `buildSourceTransparency()` render the run's crash data as "Live".
 * The honest identifier still travels, in `state`.
 */
export function buildCrashSourceSnapshot(
  crashes: CrashSummaryCore,
  fetchedAt: string
): Record<string, unknown> {
  const shared = {
    state: crashes.source,
    label: crashes.sourceLabel,
    attribution: crashes.attribution,
    yearsQueried: crashes.yearsQueried,
    fetchedAt,
  };

  if (!crashes.observed) {
    // Defensive: a summary can reach here from a persisted run or a partially
    // shaped caller, and a snapshot builder must never be the thing that fails
    // an analysis.
    const checked = Array.isArray(crashes.checkedSources) ? crashes.checkedSources : [];
    return {
      ...shared,
      note:
        crashes.source === "out-of-coverage"
          ? `No crash source covers this study area. Checked: ${
              checked.join(", ") || "none registered"
            }. Crash metrics are not available for this run and were not estimated.`
          : `${crashes.sourceLabel} could not be reached${
              crashes.unavailableReason ? ` (${crashes.unavailableReason})` : ""
            }. Crash metrics are not available for this run and were not estimated.`,
      checkedSources: checked,
    };
  }

  const severityNote =
    crashes.severityCompleteness === "fatal_only"
      ? " Fatal crashes only — this source records no injury or property-damage crashes, so injury figures are unavailable rather than zero."
      : crashes.severityCompleteness === "fatal_injury_only"
        ? " Fatal and injury crashes are separable; suspected serious injury (KABCO A) is not, so no KSI total is reported."
        : "";

  const ungeocoded = Math.max(0, crashes.reportedTotal - crashes.mappedTotal);
  const mappingNote =
    ungeocoded > 0
      ? ` ${crashes.reportedTotal.toLocaleString()} crashes matched, ${crashes.mappedTotal.toLocaleString()} carried coordinates and are mappable.`
      : "";

  return {
    ...shared,
    source: crashes.source,
    severityCompleteness: crashes.severityCompleteness,
    crashDensityBasis: crashes.crashDensityBasis,
    reportedTotal: crashes.reportedTotal,
    mappedTotal: crashes.mappedTotal,
    truncated: crashes.truncated,
    note: `Observed crash records from ${crashes.sourceLabel}.${severityNote}${mappingNote}`,
  };
}

/** The safety line of the deterministic corridor narrative. */
export function describeCrashSafety(crashes: CrashSummaryCore): string {
  if (!crashes.observed) {
    const reason =
      crashes.source === "out-of-coverage"
        ? "no crash source covers this study area"
        : `${crashes.sourceLabel} could not be reached`;
    return `**Safety:** Crash data is not available for this study area (${reason}). No crash figures were estimated, and the safety score below is therefore not supported by observed crash data.`;
  }

  const yearsStr =
    crashes.yearsQueried.length > 0 ? crashes.yearsQueried.join(", ") : "no years with matching records";
  const densityLabel =
    crashes.crashDensityBasis === "fatal_only" ? "Fatal crash density" : "Reportable crash density";

  return (
    `**Safety (${yearsStr}, ${crashes.sourceLabel}):** ${crashes.totalFatalCrashes} fatal crashes, ` +
    `${crashes.totalFatalities} fatalities (${crashes.pedestrianFatalities} involving a pedestrian, ` +
    `${crashes.bicyclistFatalities} involving a bicyclist). ${densityLabel}: ` +
    `${crashes.crashesPerSquareMile}/sq mi/yr.`
  );
}
