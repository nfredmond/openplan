/**
 * HOW A CORRIDOR'S TRANSIT NUMBER WAS MEASURED, AS A THING THE RUN CARRIES.
 *
 * ============================================================== WHY THIS EXISTS
 *
 * A workspace that ingests its agency's real GTFS feed can watch the same
 * corridor's accessibility score FALL by up to nine points, with nothing about
 * the corridor having changed. That is the correct answer — a published schedule
 * is better evidence about service than a count of OpenStreetMap stop nodes, and
 * the new score is built from frequency as well as density — but it is also the
 * support question, and a planner who cannot see WHY will conclude the product
 * is broken, or (worse) will not notice at all and will present two
 * incompatible numbers in the same document.
 *
 * So the measurement travels with the run. Three surfaces read this module and
 * they must all say the same thing:
 *
 *   1. `sourceSnapshots.transit.method` on the stored run — the record.
 *   2. The corridor report's transit table — the artifact a planner hands over.
 *   3. The run comparison — which refuses to subtract two runs measured
 *      differently, because "Transit Stops: +412 (+38%)" reads as SERVICE GREW
 *      and means THE MEASUREMENT CHANGED.
 *
 * =========================================== STORED RUNS ARE NEVER REWRITTEN
 *
 * A run stored before this module existed keeps its old score and its old
 * method forever. `resolveTransitMethod` therefore READS what the run recorded
 * and derives nothing it cannot support: a run whose snapshot names
 * `osm-overpass` is reported as an OSM-measured run (which it was, and its score
 * carried the whole density term, which is what `frequencyTermApplied: false`
 * says); a run that recorded no transit provenance at all is reported as NOT
 * RECORDED rather than assumed. Backfilling a method onto an old run would be
 * inventing provenance for a number nobody can re-derive.
 *
 * ======================================================= PURE, AND DELIBERATELY
 *
 * No database, no network, no adapter imports. `src/lib/analysis/compare.ts` is
 * reached from a `"use client"` component, and the corridor report is a server
 * route; both import this file. Anything heavier here would drag the Supabase
 * client into a browser bundle.
 */

import {
  BASIC_SERVICE_HEADWAY_MINUTES,
  FREQUENT_SERVICE_HEADWAY_MINUTES,
} from "@/lib/gtfs/service-levels";

/**
 * The registered transit source ids.
 *
 * These are the ADAPTER ids, and they are what `sourceSnapshots.transit.source`
 * has always held — `osm-overpass` is the token every run stored before the
 * registry existed carries, which is why it keeps its spelling exactly.
 */
export const TRANSIT_SOURCE_IDS = ["gtfs-feed", "osm-overpass"] as const;
export type TransitSourceId = (typeof TRANSIT_SOURCE_IDS)[number];

/** What a run's transit figures were measured with. */
export type TransitAccessMethodId =
  /** Derived service levels from the workspace's own ingested GTFS feeds. */
  | "gtfs-service-levels"
  /** A count of OpenStreetMap transit stop nodes inside the study-area bbox. */
  | "osm-stop-inventory"
  /** No transit source answered. There are no transit figures on this run. */
  | "not-measured"
  /** The run predates transit provenance and recorded none. */
  | "not-recorded";

export type TransitAccessMethod = {
  id: TransitAccessMethodId;
  /** Short enough for a table cell or a badge. */
  label: string;
  /** One sentence a planner can act on. Printed under the transit figures. */
  detail: string;
  /**
   * True when the accessibility score's transit term included the
   * frequent-service half.
   *
   * PART OF THE METHOD, NOT A FOOTNOTE ON IT. A run whose transit term is
   * half density and half frequent-service share and a run whose transit term is
   * density alone produce accessibility scores on two different scales, and
   * subtracting them yields a number that describes the formula rather than the
   * corridor. See `transitMethodComparabilityKey`.
   */
  frequencyTermApplied: boolean;
};

/**
 * The method a GTFS-backed run records.
 *
 * `frequencyTermApplied` is supplied by the caller rather than fixed, because a
 * feed whose extent only partly reaches the study area cannot speak to how
 * frequent service is across the rest of it — see `gtfs-feed.ts` for why partial
 * coverage suppresses the term instead of scoring the uncovered part as zero.
 */
export function gtfsServiceLevelMethod(frequencyTermApplied: boolean): TransitAccessMethod {
  return {
    id: "gtfs-service-levels",
    label: "Ingested GTFS service levels",
    detail: frequencyTermApplied
      ? `Stop counts and frequency come from the GTFS feeds this workspace has ingested. The accessibility ` +
        `score's transit term is half stop density and half the share of ALL the stops counted meeting a ` +
        `${FREQUENT_SERVICE_HEADWAY_MINUTES}-minute peak headway; a stop with no derivable peak headway on ` +
        `a representative service day counts as not meeting it. Feeds this workspace has not ingested are ` +
        `not counted, so an operator whose feed is missing is absent from these figures rather than absent ` +
        `from the corridor.`
      : `Stop counts come from the GTFS feeds this workspace has ingested. No feed's stops reach across the ` +
        `whole study area, so no frequency share is reported for it — a share taken over part of an area ` +
        `would describe that part, not the area. The frequency half of the transit term is scored as ZERO ` +
        `rather than credited back as stop density, because an unmeasured half is not an earned one: ` +
        `handing it back made a partly-covered corridor outscore a fully-covered one. This run's ` +
        `accessibility score is therefore on a different scale from a run whose feed spans its area, and ` +
        `the two are not subtracted. Feeds this workspace has not ingested are not counted.`,
    frequencyTermApplied,
  };
}

/**
 * The method an OpenStreetMap-backed run records.
 *
 * `frequencyTermApplied` is FALSE and there is no argument for it ever being
 * true: OSM records where a stop is, and nothing at all about how often anything
 * calls there. The transit term is therefore the density term at full weight,
 * which is exactly what it was before the registry existed — so an OSM run
 * scores today what it scored before, and nothing in this change moves a number
 * for a workspace that has ingested no feed.
 */
export const OSM_STOP_INVENTORY_METHOD: TransitAccessMethod = {
  id: "osm-stop-inventory",
  label: "OpenStreetMap stop inventory",
  detail:
    "Stop counts are a tally of OpenStreetMap transit stop nodes inside the study area. OpenStreetMap " +
    "records where a stop is and nothing about how often service calls there, so the accessibility score's " +
    "transit term is stop density alone. A community-mapped inventory is uneven between places and is not " +
    "an agency's own published schedule.",
  frequencyTermApplied: false,
};

/** No source answered. Not the same as a corridor with no transit. */
export const NOT_MEASURED_METHOD: TransitAccessMethod = {
  id: "not-measured",
  label: "Not measured",
  detail:
    "No transit source answered for this study area, so no stop count, density, or frequency was measured " +
    "and the accessibility score carries no transit term at all. This is not a finding that the area has " +
    "no transit.",
  frequencyTermApplied: false,
};

/** A run stored before transit provenance was recorded. */
export const NOT_RECORDED_METHOD: TransitAccessMethod = {
  id: "not-recorded",
  label: "Not recorded",
  detail:
    "This run predates transit measurement provenance and did not record how its transit figures were " +
    "produced, so they cannot be compared with a run that did. Re-run the analysis to get a run that " +
    "states its own method.",
  frequencyTermApplied: false,
};

/** The second frequent-service tier, re-exported so a surface never types 30. */
export const TRANSIT_TIER_HEADWAYS = [
  FREQUENT_SERVICE_HEADWAY_MINUTES,
  BASIC_SERVICE_HEADWAY_MINUTES,
] as const;

type MethodLike = { id?: unknown; label?: unknown; detail?: unknown; frequencyTermApplied?: unknown };

type TransitSnapshotLike = { source?: unknown; method?: unknown } | null | undefined;

type MetricsLike = { sourceSnapshots?: { transit?: TransitSnapshotLike } | null } | null | undefined;

/**
 * Read the transit measurement method off a run's persisted metrics.
 *
 * THE ORDER IS THE POINT. A run that recorded a method is described by the
 * method it recorded, verbatim, including a label this build has never heard of
 * — a future source's runs must not be re-described by an older reader. Only
 * when there is no method at all does this fall back to the `source` token,
 * which is the one thing every run since the crash-registry era has carried.
 */
export function resolveTransitMethod(metrics: MetricsLike): TransitAccessMethod {
  const snapshot = metrics?.sourceSnapshots?.transit ?? null;
  const recorded = (snapshot && typeof snapshot === "object" ? snapshot.method : null) as MethodLike | null;

  if (recorded && typeof recorded === "object" && typeof recorded.id === "string" && recorded.id.length > 0) {
    return {
      id: recorded.id as TransitAccessMethodId,
      label: typeof recorded.label === "string" && recorded.label ? recorded.label : recorded.id,
      detail: typeof recorded.detail === "string" ? recorded.detail : "",
      frequencyTermApplied: recorded.frequencyTermApplied === true,
    };
  }

  const source = snapshot && typeof snapshot === "object" ? snapshot.source : null;

  // Every run stored before this module existed used the OSM inventory and the
  // full density term, so this derivation is a reading of what happened rather
  // than a guess about it.
  if (source === "osm-overpass") return OSM_STOP_INVENTORY_METHOD;
  if (source === "unavailable") return NOT_MEASURED_METHOD;

  return NOT_RECORDED_METHOD;
}

/**
 * THE KEY TWO RUNS MUST SHARE BEFORE THEIR TRANSIT-DERIVED FIGURES MAY BE
 * SUBTRACTED.
 *
 * It is the method id AND whether the frequency half was applied, because both
 * change what the numbers mean:
 *
 *   - a different id changes what a "stop" is. An OSM tally counts mapped
 *     nodes — platforms, stop positions, both sides of a street where a mapper
 *     drew both — while a GTFS feed counts the stops its own schedule calls at.
 *     The difference between the two is a mapping artefact, and rendering it as
 *     "+412 stops (+38%)" states that service grew.
 *   - the same id with the frequency half withheld puts the accessibility score
 *     on a different scale, so its delta describes the formula.
 */
export function transitMethodComparabilityKey(method: TransitAccessMethod): string {
  return `${method.id}:${method.frequencyTermApplied ? "with-frequency" : "density-only"}`;
}

/**
 * Why two runs cannot be subtracted, in one sentence a planner can act on.
 * Null when they can.
 */
export function transitComparabilityRefusal(
  current: TransitAccessMethod,
  baseline: TransitAccessMethod
): string | null {
  /**
   * A RUN THAT NEVER STATED ITS MEASUREMENT CANNOT BE SHOWN COMPARABLE TO
   * ANYTHING — INCLUDING ANOTHER SILENT RUN.
   *
   * Two `not-recorded` methods produce the same comparability key, so a plain key
   * comparison PERMITS the subtraction. That is the inverted case: matching keys
   * are evidence of a matching measurement only when both runs stated one, and
   * `not-recorded` is the absence of a statement rather than a statement of
   * absence. It bit hardest on model runs, whose result summary carried only four
   * numbers, so every model run resolved to `not-recorded` — which refused every
   * mixed model/analysis pairing and permitted exactly the pairing that could be
   * measured two different ways.
   *
   * `NOT_MEASURED_METHOD` is deliberately NOT treated this way: "no source
   * answered" IS a statement, the run carries no transit figures at all, and two
   * such runs have nothing to disagree about.
   */
  const unstated = [
    current.id === "not-recorded" ? "this run" : null,
    baseline.id === "not-recorded" ? "the baseline" : null,
  ].filter((entry): entry is string => entry !== null);

  if (unstated.length > 0) {
    return (
      `Measurement not recorded: ${unstated.join(" and ")} did not record how transit was measured, so there ` +
      `is no way to show these figures were produced the same way. Re-run the analysis to get a run that ` +
      `states its own method, and no delta is shown until then.`
    );
  }

  if (transitMethodComparabilityKey(current) === transitMethodComparabilityKey(baseline)) return null;

  return (
    `Measured differently: this run used ${current.label.toLowerCase()}, the baseline used ` +
    `${baseline.label.toLowerCase()}. A difference between them is a change in how transit was measured, ` +
    `not a change in the corridor, so no delta is shown.`
  );
}

/**
 * HOW THE FREQUENCY HALF OF THE TRANSIT TERM WAS FILLED, in one sentence.
 *
 * It lives here because THREE surfaces print the frequent-service figure — the
 * corridor narrative, the report table and the Explore results tile — and the
 * scoring consequence of a withheld share is the thing a planner asking "why did
 * my score fall" needs from whichever one they are looking at. A sentence built
 * at a call site is a sentence one of the three will be missing.
 *
 * The three cases are distinct on purpose, and collapsing the middle two is what
 * hid the inversion for as long as it was hidden: a source that cannot speak to
 * frequency AT ALL is not the same as a source that speaks to it and could not
 * state a share HERE, and only the first keeps the whole term as density.
 */
export function transitFrequencyHalfNote(method: TransitAccessMethod): string {
  if (method.frequencyTermApplied) {
    return (
      "Share of ALL the stops counted above whose median peak headway on a representative service day meets " +
      "this threshold — a stop with no derivable peak headway that day counts as not meeting it. Half the " +
      "accessibility score's transit term."
    );
  }

  if (method.id === "gtfs-service-levels") {
    return (
      "No single ingested feed's stops span this study area, so no frequency share could be measured for it. " +
      "The frequency half of the accessibility score's transit term is scored as zero rather than credited " +
      "back as stop density — measuring less must never raise the score — so this run's accessibility score " +
      "is up to ten points below what the same corridor would score from a feed that spans it."
    );
  }

  return (
    `${method.label} cannot say how often service calls at a stop, so the accessibility score's transit term ` +
    `is stop density alone.`
  );
}

/**
 * The line a corridor report prints beside its transit figures.
 *
 * One string, built here, so the report and any later artifact cannot describe
 * the same run's method in two different ways.
 */
export function transitMethodLine(method: TransitAccessMethod): string {
  return `${method.label} — ${method.detail}`;
}
