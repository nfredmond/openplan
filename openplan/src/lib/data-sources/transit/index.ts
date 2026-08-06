/**
 * TRANSIT ACCESS FOR A CORRIDOR SCREEN — the one door, over the registry.
 *
 * `/api/analysis` calls `fetchTransitAccessForBbox` and does not know that GTFS
 * exists. This module walks the registry in order, takes the first adapter that
 * ANSWERS, and attaches the disclosure to the figures rather than leaving it to
 * the caller: the narrative line, the run's `sourceSnapshots.transit` entry, and
 * the caveats all travel WITH the summary, the same way `crashes.ts` does it.
 *
 * WHY DISCLOSURE IS BUILT HERE AND NOT AT THE CALL SITE. A caller that renders
 * transit numbers must not be able to forget to say where they came from — and
 * with two sources that produce different scales of the same metric, forgetting
 * is not a cosmetic lapse. A workspace that ingests its agency's feed can watch
 * this corridor's accessibility score fall by up to nine points; the only thing
 * standing between that and a support ticket (or a planner quietly publishing
 * two incompatible numbers) is that every surface says which measurement it is
 * looking at.
 *
 * AN ADAPTER THAT DECLINES IS NOT A FAILURE. `gtfs-feed` declines whenever the
 * workspace has ingested nothing, or nothing whose stops reach the study area,
 * and the registry moves on. An adapter that is UNAVAILABLE is a different
 * thing — its source should have answered and could not — and it is recorded so
 * a run can say "your feeds could not be read" rather than silently scoring off
 * OpenStreetMap as though nothing had happened.
 */

import type { StudyAreaBbox } from "@/lib/models/study-area";
import { TRANSIT_SOURCE_ADAPTERS } from "./registry";
import { NOT_MEASURED_METHOD } from "./method";
import { TRANSIT_UNAVAILABLE_REASON } from "./osm-overpass";
import type {
  TransitAccessCore,
  TransitAccessSummary,
  TransitFetchContext,
} from "./types";

export type { TransitAccessSummary, TransitContributingSource, TransitSourceAdapter } from "./types";
export type { TransitAccessMethod, TransitAccessMethodId, TransitSourceId } from "./method";
export {
  NOT_MEASURED_METHOD,
  NOT_RECORDED_METHOD,
  OSM_STOP_INVENTORY_METHOD,
  gtfsServiceLevelMethod,
  resolveTransitMethod,
  transitComparabilityRefusal,
  transitFrequencyHalfNote,
  transitMethodComparabilityKey,
  transitMethodLine,
} from "./method";
export { TRANSIT_SOURCE_ADAPTERS, getTransitSourceById } from "./registry";
export { TRANSIT_UNAVAILABLE_REASON } from "./osm-overpass";
export { bboxAreaSquareMiles } from "./bbox";

/** What the corridor route hands the registry, minus the study area itself. */
export type TransitAccessRequest = Omit<TransitFetchContext, "bbox">;

/** One adapter's refusal, kept so the summary can name what was tried. */
type AdapterAttempt = { id: string; label: string; state: "declined" | "unavailable"; reason: string };

function unobservedCore(reason: string): TransitAccessCore {
  return {
    observed: false,
    totalStops: null,
    busStops: null,
    railStations: null,
    ferryStops: null,
    stopsPerSqMile: null,
    accessTier: null,
    source: "unavailable",
    unavailableReason: reason,
    // Nothing answered, so nothing measured frequency. The transit term is
    // dropped entirely for an unobserved summary anyway (see
    // `computeAccessibility`), and false is the honest value rather than a
    // convenient one.
    measuresFrequency: false,
    frequentServiceShare: null,
    frequentServiceStops: null,
    frequentServiceHeadwayMinutes: null,
    truncated: false,
    method: NOT_MEASURED_METHOD,
    contributingSources: [],
  };
}

export async function fetchTransitAccessForBbox(
  bbox: StudyAreaBbox,
  request: TransitAccessRequest
): Promise<TransitAccessSummary> {
  const attempts: AdapterAttempt[] = [];

  for (const adapter of TRANSIT_SOURCE_ADAPTERS) {
    let outcome;
    try {
      outcome = await adapter.fetch({ ...request, bbox });
    } catch (error) {
      // An adapter that throws is UNAVAILABLE, never empty. Conflating the two
      // is the single most dangerous bug this lane can have, because "0 stops"
      // reads as a corridor with no transit.
      outcome = {
        kind: "unavailable" as const,
        reason: error instanceof Error ? error.message : "Unknown transit source failure",
      };
    }

    if (outcome.kind === "answered") {
      return withDisclosure(outcome.core, attempts);
    }

    attempts.push({
      id: adapter.id,
      label: adapter.label,
      state: outcome.kind,
      reason: outcome.reason,
    });
  }

  const unavailable = attempts.find((attempt) => attempt.state === "unavailable");
  return withDisclosure(unobservedCore(unavailable?.reason ?? TRANSIT_UNAVAILABLE_REASON), attempts);
}

/* -------------------------------------------------------------------------- */
/* Disclosure                                                                   */
/* -------------------------------------------------------------------------- */

function withDisclosure(core: TransitAccessCore, attempts: AdapterAttempt[]): TransitAccessSummary {
  const caveats = core.caveats ?? [];
  return {
    ...core,
    caveats,
    narrativeLine: describeTransitAccess(core),
    // The moment the source was read, which is what provenance means here — not
    // the moment the surrounding analysis finished assembling.
    sourceSnapshot: buildTransitSourceSnapshot(core, attempts, new Date().toISOString()),
  };
}

/** Percent, to one decimal, from a 0–1 share. */
function sharePercent(share: number): number {
  return Math.round(share * 1000) / 10;
}

/**
 * The transit line of the deterministic corridor narrative.
 *
 * IT LIVES HERE RATHER THAN IN THE ROUTE, and moving it was part of the change:
 * the route's version could not describe a GTFS answer at all — it printed
 * "including ${busStops} bus stops", which is `null` for a feed-derived summary
 * because GTFS records a mode on the route and not on the stop. A narrative
 * built beside the numbers cannot fall behind them.
 *
 * The unobserved branch keeps its instruction to the model verbatim. That
 * sentence is what stops the AI narrative asserting a stop count for a corridor
 * nothing was measured in.
 */
export function describeTransitAccess(core: TransitAccessCore): string {
  if (!core.observed) {
    return (
      `**Transit Access:** Not measured. ${core.unavailableReason ?? ""} Do not state or imply a transit ` +
      `stop count, density, or access tier for this corridor.`
    );
  }

  const parts: string[] = [
    `**Transit Access:** ${core.totalStops?.toLocaleString() ?? "0"} stops (${core.stopsPerSqMile}/sq mi). ` +
      `Access tier: ${core.accessTier}.`,
  ];

  if (core.source === "osm-overpass") {
    parts.push(
      `Counted from the OpenStreetMap stop inventory: ${core.busStops} bus stops, ${core.railStations} rail ` +
        `stations, ${core.ferryStops} ferry terminals. OpenStreetMap holds no schedule, so this says nothing ` +
        `about how often service calls at them.`
    );
  }

  if (core.source === "gtfs-feed") {
    const names = core.contributingSources.map((source) => source.label).join(", ");
    parts.push(
      `Derived from the GTFS ${core.contributingSources.length === 1 ? "feed" : "feeds"} this workspace has ` +
        `ingested (${names}). Feeds it has not ingested are absent from this count rather than absent from ` +
        `the corridor, and a mode split is not reported because GTFS records a mode on the route and not on ` +
        `the stop.`
    );

    if (core.frequentServiceShare !== null && core.frequentServiceHeadwayMinutes !== null) {
      parts.push(
        `${sharePercent(core.frequentServiceShare)}% of those ${core.totalStops?.toLocaleString() ?? "0"} ` +
          `stops (${core.frequentServiceStops}) meet a ${core.frequentServiceHeadwayMinutes}-minute peak ` +
          `headway on a representative service day. A stop with no derivable peak headway that day is counted ` +
          `as not meeting it, so this is a share of every stop above and not of some smaller subset.`
      );
    } else {
      parts.push(
        `A frequent-service share is not reported for this study area — no single ingested feed's stops span ` +
          `it, so a share taken over the part that is covered would describe that part rather than the area. ` +
          `The frequency half of the accessibility score's transit term is therefore scored as zero rather ` +
          `than credited back as stop density: measuring less must never raise the score.`
      );
    }

    const expired = core.contributingSources
      .filter((source) => source.serviceEndDate)
      .map((source) => `${source.label} through ${source.serviceEndDate}`);
    if (expired.length > 0) {
      parts.push(`Service windows: ${expired.join("; ")}.`);
    }
  }

  if (core.truncated) {
    parts.push(
      `⚠️ More stops fall inside this study area than one screening run reads, so the count above is a floor ` +
        `and the density understates the corridor. Draw a smaller study area for a complete count.`
    );
  }

  return parts.join(" ");
}

/**
 * The `sourceSnapshots.transit` entry for a run's metrics.
 *
 * `method` is the disclosure this whole change exists for and it is written
 * VERBATIM, so a run stored today can still say how it was measured after the
 * labels here have been rewritten twice. `resolveTransitMethod` reads it back
 * without reinterpreting it.
 *
 * `source` is kept exactly where it has always been and keeps its old
 * vocabulary, because `resolveEstimatedDomains` and `buildSourceTransparency`
 * both key off it and a run stored before this change must keep meaning what it
 * meant.
 */
export function buildTransitSourceSnapshot(
  core: TransitAccessCore,
  attempts: AdapterAttempt[],
  fetchedAt: string
): Record<string, unknown> {
  const declined = attempts.filter((attempt) => attempt.state === "declined");
  const unavailable = attempts.filter((attempt) => attempt.state === "unavailable");

  return {
    source: core.source,
    observed: core.observed,
    method: core.method,
    note: core.observed
      ? core.method.detail
      : (core.unavailableReason ??
        "No transit source answered; stop counts and density were not measured."),
    frequentServiceShare: core.frequentServiceShare,
    frequentServiceStops: core.frequentServiceStops,
    frequentServiceHeadwayMinutes: core.frequentServiceHeadwayMinutes,
    truncated: core.truncated,
    contributingSources: core.contributingSources,
    caveats: core.caveats ?? [],
    // What was tried and did not answer. A workspace whose feeds could not be
    // read must be able to see that its run fell back rather than discovering it
    // from a score that moved.
    skippedSources: declined.map((attempt) => ({ id: attempt.id, reason: attempt.reason })),
    unavailableSources: unavailable.map((attempt) => ({ id: attempt.id, reason: attempt.reason })),
    fetchedAt,
  };
}
