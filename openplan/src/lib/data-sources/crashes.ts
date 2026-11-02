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

import {
  crashSourcesForStudyArea,
  knownStudyAreaStates,
  type CrashStudyAreaStates,
} from "@/lib/safety/sources/registry";
import { readCrashPublicationEvidence } from "@/lib/safety/publication-evidence";
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
  /**
   * Mappable crashes the source reported WITHOUT any casualty count, so they
   * could not be placed in a severity band at all.
   *
   * Not a rounding error: it is 4.7% of one state's 2025 records statewide and
   * 9.5% in one rural county of it. These crashes are in `reportedTotal` and in
   * no severity tally, which is the honest arrangement — but only if the number
   * is visible, because otherwise the severity counts silently fail to add up to
   * the total and a reader assumes the difference is property damage.
   */
  unclassifiedCrashes: number;
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
  /** Exact source-published cutoff, when the adapter supplied one. */
  publishedCutoff?: import("@/lib/safety/sources/types").CrashPublishedCutoff;
  resourceUpdates?: import("@/lib/safety/sources/types").CrashResourceUpdates;
  /**
   * The state FIPS codes that chose the source, from a place identity the
   * server confirmed. NULL means the run could not establish its state (a drawn
   * or uploaded area, a metro area, a place whose boundary did not match), so
   * only a national source was allowed to answer. Undefined on summaries built
   * before this field existed.
   */
  studyAreaStates?: string[] | null;
  /**
   * Richer sources for this study area that could not be reached this run,
   * when a later source in registry order did answer. The figures then come
   * from the source that answered, and the narrative says which one failed.
   */
  unavailableSources?: Array<{ id: string; label: string }>;
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

function publicationCutoffNote(crashes: Pick<CrashSummaryCore, "publishedCutoff" | "resourceUpdates">): string {
  const publication = readCrashPublicationEvidence(crashes.publishedCutoff?.publishedThrough, crashes.publishedCutoff?.provenance ?? crashes.resourceUpdates);
  return publication.resourceUpdateNote ? ` ${publication.resourceUpdateNote}` : publication.publishedThrough
    ? ` Source publication cutoff: ${publication.publishedThrough}; provenance is recorded with this run.`
    : " The source supplied no exact publication cutoff; requested and returned years are not substitutes.";
}

/**
 * Says why only a national source was read when the run could not confirm
 * the study area's state. Empty when the state was confirmed, or when the
 * summary predates the field.
 */
function unconfirmedStateNote(crashes: Pick<CrashSummaryCore, "studyAreaStates">): string {
  return crashes.studyAreaStates === null
    ? " The study area's state was not confirmed from a picked place, so only a national crash source was read."
    : "";
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
    /**
     * NULL when the source supplied no count. A fatality census, for instance,
     * records no injury count at all — reporting 0 there would say nobody was
     * hurt in a fatal crash.
     */
    fatalCount: number | null;
    injuryCount: number | null;
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
 *
 * UNCLASSIFIED crashes are dropped too, and for the opposite reason: this layer
 * paints a severity, and a collision whose casualty counts the source never
 * supplied has none to paint. Plotting it in any of the three colours would
 * assert an outcome nobody reported. They remain in `reportedTotal` and are
 * counted separately in `unclassifiedCrashes`, so the corridor scorecard can say
 * how much of the record it could not classify instead of quietly shrinking.
 */
function toPointFeature(record: CrashRecord, sourceId: string): CrashPointFeature | null {
  if (record.severity === "pdo" || record.severity === "unknown") return null;
  const severityBucket: CrashPointSeverityBucket = record.severity;

  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [record.longitude, record.latitude] },
    properties: {
      kind: "crash_point",
      // Prefer the record's OWN source when it carries one, so a point never
      // inherits a different source's id.
      source: record.sourceId ?? sourceId,
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
    unclassifiedCrashes: 0,
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
  let unclassifiedCrashes = 0;

  const points: CrashPointFeature[] = [];

  for (const record of fetched.records) {
    // Counted, never silently skipped. These are collisions the source reported
    // and did not classify; leaving them out of every tally would make the
    // scorecard's own numbers unaccountable against `reportedTotal`.
    if (record.severity === "unknown") unclassifiedCrashes += 1;

    if (record.severity === "fatal") {
      totalFatalCrashes += 1;
      // A fatal record has a positive, readable killed count by construction —
      // that is what made it fatal. The floor of 1 is belt-and-braces for a
      // source that flags fatality without a count.
      totalFatalities += Math.max(1, record.killedCount ?? 1);
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
  // The years the source answered for, including years with no crash in the
  // study area. Dividing by only the years that returned a crash raised the
  // annual rate whenever a year was empty: one crash in four years read as one
  // a year.
  const yearsQueried = fetched.yearsQueried ?? fetched.yearsCovered;
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
    unclassifiedCrashes,
    reportedTotal: fetched.matchedTotal,
    mappedTotal: fetched.geocodedTotal,
    truncated: fetched.truncated,
    points,
    checkedSources: [adapter.id],
    unavailableReason: null,
    publishedCutoff: fetched.publishedCutoff,
    resourceUpdates: fetched.resourceUpdates,
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

/**
 * The study area a corridor run reads crashes for.
 *
 * `stateFips` is REQUIRED, and null is a real answer: the caller must say
 * whether a confirmed place identity gave it the area's states. The bbox alone
 * never chooses a state source, because the California rectangle contains most
 * of Nevada.
 */
export type CorridorCrashStudyArea = {
  bbox: StudyAreaBbox;
  stateFips: CrashStudyAreaStates;
};

/**
 * Crash figures for a corridor run, from the source its STATE selects.
 *
 * The same rule as a Safety acquisition (`crashSourcesForStudyArea`): a known
 * state gets the richest source that reads every one of its states; an unknown
 * or multi-state area gets only a national source, labeled fatal-only. Every
 * candidate the registry returns serves the whole study area, so there is
 * nothing to merge: the first candidate that answers drives the summary, and
 * a richer candidate that failed first is named in `unavailableSources`.
 */
export async function fetchCrashesForStudyArea(
  area: CorridorCrashStudyArea,
  options: { now?: Date; signal?: AbortSignal } = {}
): Promise<CrashSummary> {
  const { bbox } = area;
  const studyAreaStates = knownStudyAreaStates(area.stateFips);
  // "read_only": the scorecard reports crash figures but never writes crash
  // rows, so it may use sources the `safety_crashes` CHECK domain has not been
  // widened for yet.
  const { candidates, checked } = crashSourcesForStudyArea({ bbox, stateFips: studyAreaStates }, "read_only");

  if (candidates.length === 0) {
    return withDisclosure({
      ...emptySummary({
        source: "out-of-coverage",
        sourceLabel: "No covering crash source",
        checkedSources: checked.map((adapter) => adapter.id),
        unavailableReason: null,
      }),
      studyAreaStates,
    });
  }

  // Richest first. A later candidate is read only when every earlier one failed.
  const failures: Array<{ adapter: CrashSourceAdapter; error: Error }> = [];
  for (const adapter of candidates) {
    const years = recentCrashYears(options.now).filter((year) => year >= adapter.earliestYear);
    try {
      const fetched = await adapter.fetch({
        bbox,
        years,
        maxRecords: ANALYSIS_MAX_RECORDS,
        signal: options.signal,
      });
      const core = summarizeCrashFetch(adapter, fetched, bbox, years);
      return withDisclosure({
        ...core,
        studyAreaStates,
        ...(failures.length > 0
          ? { unavailableSources: failures.map(({ adapter: failed }) => ({ id: failed.id, label: failed.label })) }
          : {}),
      });
    } catch (error) {
      failures.push({
        adapter,
        error: error instanceof Error ? error : new Error("Unknown crash source failure"),
      });
    }
  }

  // Every candidate was down. An outage is a state, not a number.
  return withDisclosure({
    ...emptySummary({
      source: "source-unavailable",
      sourceLabel: candidates[0].label,
      checkedSources: candidates.map((adapter) => adapter.id),
      unavailableReason: failures[0]?.error.message ?? "Unknown crash source failure",
    }),
    studyAreaStates,
  });
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
  const cutoffNote = publicationCutoffNote(crashes);
  const publication = readCrashPublicationEvidence(crashes.publishedCutoff?.publishedThrough, crashes.publishedCutoff?.provenance ?? crashes.resourceUpdates);
  const shared = {
    state: crashes.source,
    label: crashes.sourceLabel,
    attribution: crashes.attribution,
    yearsQueried: crashes.yearsQueried,
    fetchedAt,
    ...(publication.publishedThrough
      ? {
          publishedThrough: publication.publishedThrough,
          publishedThroughProvenance: publication.provenance,
        }
      : { publishedThroughNote: "The source supplied no exact publication cutoff." }),
    ...(publication.resourceUpdateNote ? { resourceUpdateNote: publication.resourceUpdateNote, sourceResourceUpdates: publication.provenance } : {}),
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
      ? ` ${crashes.reportedTotal.toLocaleString("en-US")} crashes matched, ${crashes.mappedTotal.toLocaleString("en-US")} carried coordinates and are mappable.`
      : "";

  // Say the number, or the severity counts quietly fail to add up to the total
  // and a reader fills the gap in with "property damage".
  const unclassifiedNote =
    !crashes.truncated && crashes.unclassifiedCrashes > 0
      ? ` ${crashes.unclassifiedCrashes.toLocaleString("en-US")} of the mapped crashes carry no casualty count from the source and are not classified by severity — they are counted in the total and in no severity band.`
      : "";

  const truncationNote = crashes.truncated
    ? ` The record extract reached OpenPlan's analysis cap. Severity totals and density derived from that partial extract are incomplete and are withheld from the narrative and safety score.`
    : "";

  const unavailable = crashes.unavailableSources ?? [];
  const unavailableNote =
    unavailable.length > 0
      ? ` ${unavailable.map((s) => s.label).join(" and ")} could not be reached this run, so these figures come from ${crashes.sourceLabel}.`
      : "";
  const stateNote = unconfirmedStateNote(crashes);

  return {
    ...shared,
    source: crashes.source,
    severityCompleteness: crashes.severityCompleteness,
    crashDensityBasis: crashes.crashDensityBasis,
    reportedTotal: crashes.reportedTotal,
    mappedTotal: crashes.mappedTotal,
    truncated: crashes.truncated,
    ...(crashes.studyAreaStates !== undefined ? { studyAreaStates: crashes.studyAreaStates } : {}),
    ...(unavailable.length > 0 ? { unavailableSources: unavailable } : {}),
    unclassifiedCrashes: crashes.unclassifiedCrashes,
    note: `Observed crash records from ${crashes.sourceLabel}.${cutoffNote}${severityNote}${mappingNote}${unclassifiedNote}${truncationNote}${unavailableNote}${stateNote}`,
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

  if (crashes.truncated) {
    return (
      `**Safety (${crashes.yearsQueried.length > 0 ? crashes.yearsQueried.join(", ") : "requested years"}, ${crashes.sourceLabel}):** ` +
      `${crashes.reportedTotal.toLocaleString("en-US")} crashes matched the study area, but the record extract reached OpenPlan's analysis cap. ` +
      "Severity totals, crash density, and the safety score are withheld because the extract is incomplete."
    );
  }

  const yearsStr =
    crashes.yearsQueried.length > 0 ? crashes.yearsQueried.join(", ") : "no years with matching records";
  const densityLabel =
    crashes.crashDensityBasis === "fatal_only" ? "Fatal crash density" : "Reportable crash density";

  // A richer source that failed means these figures come from a thinner one.
  // Say which, so a fatal-only count is not read as the state's full record.
  const unavailable = crashes.unavailableSources ?? [];
  const unavailableNote =
    unavailable.length > 0
      ? ` ${unavailable.map((s) => s.label).join(" and ")} could not be reached this run, so these figures come from ${crashes.sourceLabel}.`
      : "";
  const stateNote = unconfirmedStateNote(crashes);

  // The unclassified share belongs in the deterministic narrative, not only in
  // the snapshot: this line is what the AI narrative and the report read, and a
  // severity breakdown that does not account for every reported crash invites
  // the reader to assume the remainder was minor.
  const unclassifiedNote =
    crashes.unclassifiedCrashes > 0
      ? ` ${crashes.unclassifiedCrashes} mapped crashes carry no casualty count from the source and are not classified by severity.`
      : "";
  const cutoffNote = publicationCutoffNote(crashes);

  // The injury count belongs in this line for the same reason: the Planner
  // Agent reads it, and without the count it told a planner that injury
  // crashes were not recorded when the run held them (2026-10-11). A
  // fatal-only source never saw an injury crash, so it says nothing here.
  const injuryNote =
    crashes.totalInjuryCrashes === null
      ? ""
      : ` ${crashes.totalInjuryCrashes} non-fatal injury crashes` +
        (crashes.severeInjuryCrashes === null
          ? " (the source does not separate suspected serious injuries)"
          : ` (${crashes.severeInjuryCrashes} with a suspected serious injury)`) +
        ` of ${crashes.reportedTotal.toLocaleString("en-US")} crashes reported.`;

  return (
    `**Safety (${yearsStr}, ${crashes.sourceLabel}):** ${crashes.totalFatalCrashes} fatal crashes, ` +
    `${crashes.totalFatalities} fatalities (${crashes.pedestrianFatalities} involving a pedestrian, ` +
    `${crashes.bicyclistFatalities} involving a bicyclist).${injuryNote} ${densityLabel}: ` +
    `${crashes.crashesPerSquareMile}/sq mi/yr.${cutoffNote}${unclassifiedNote}${unavailableNote}${stateNote}`
  );
}
