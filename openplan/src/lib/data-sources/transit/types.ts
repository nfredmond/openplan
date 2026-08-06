/**
 * THE TRANSIT-SOURCE ADAPTER CONTRACT, and the summary every adapter answers in.
 *
 * The same shape `src/lib/safety/sources/types.ts` gives crash data, for the
 * same reason: coverage grows by REGISTERING AN ADAPTER, never by editing a call
 * site. `/api/analysis` asks the registry for a transit summary; it does not
 * know that GTFS exists.
 *
 * ============================================== THE POSTURE, WHICH IS INHERITED
 *
 * There is NO ESTIMATE TIER here and there never will be. The retired
 * implementation manufactured `area x 2.5` stops with a fixed 85/10/5
 * bus/rail/ferry split when Overpass did not answer, derived an access tier from
 * that constant, and fed the fabricated density into up to 20 points of the
 * accessibility score — which flowed into the corridor composite and out into
 * grant-ready reports. A planner in a rural county with no Overpass coverage got
 * a transit density indistinguishable from a measured one.
 *
 * So: `observed: false` means nothing was counted, every count is null rather
 * than zero, and callers key off `observed` and never off the numbers. Zero is
 * reserved for "we looked and found none", which is a real finding.
 *
 * ======================================= WHY AN ADAPTER MAY REFUSE TO ANSWER
 *
 * A crash adapter either covers a study area or does not. A transit adapter has
 * a third state that matters more here: it covers the area and has NOTHING
 * RELEVANT. A workspace whose only ingested feed serves a city four hundred
 * miles away must not have that feed's zero stops reported as a measurement of
 * this corridor — that is the "0 crashes, safe" failure wearing a transit
 * jersey. `TransitAdapterOutcome` therefore separates "answered" from
 * "declined", and only an answer becomes a summary.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { StudyAreaBbox } from "@/lib/models/study-area";
import type { TransitAccessMethod, TransitSourceId } from "./method";

/**
 * What a corridor run knows about transit access.
 *
 * FIELD-BY-FIELD COMPATIBILITY IS DELIBERATE. `stopsPerSqMile`, `accessTier`,
 * `totalStops` and the three mode counts are read by four surfaces that predate
 * this registry (the scorecard, the corridor report, the AI fact list, the
 * walk/bike classifier). Changing their names would have been a wider change
 * than this one, for no gain: they mean the same thing whichever adapter
 * produced them.
 */
export interface TransitAccessSummary {
  /**
   * True when a transit source answered. False means nothing was counted —
   * which is not the same as counting zero stops, and must not read as it.
   */
  observed: boolean;
  /** Null when unobserved. Zero is reserved for "we looked and found none". */
  totalStops: number | null;
  /**
   * The mode split, when the source can separate it.
   *
   * NULL FROM A GTFS FEED, AND THAT IS THE HONEST ANSWER RATHER THAN A GAP.
   * GTFS records a mode on the ROUTE, not on the stop, so splitting stops into
   * bus / rail / ferry buckets means either double-counting every interchange or
   * inventing a "primary mode" the feed never states. Null renders as "Not
   * measured" everywhere these are shown, which is what it is.
   */
  busStops: number | null;
  railStations: number | null;
  ferryStops: number | null;
  stopsPerSqMile: number | null;
  /** Null when unobserved: a tier derived from no measurement is not a finding. */
  accessTier: "high" | "medium" | "low" | null;
  source: TransitSourceId | "unavailable";
  /** Why nothing was counted, in planner terms. Null when observed. */
  unavailableReason: string | null;

  /**
   * TRUE WHEN THIS SOURCE MEASURES SERVICE FREQUENCY AT ALL — a property of the
   * SOURCE, not of this study area.
   *
   * It is what separates the two things `frequentServiceShare === null` used to
   * mean, and conflating them inverted the accessibility score. OpenStreetMap
   * records where a stop is and NOTHING about what calls there, so it has no
   * opinion on frequency and its runs are scored on the density-only scale they
   * have always been on. An ingested GTFS feed always has an opinion; when it
   * cannot state one for THIS area (partial coverage, a truncated read) the
   * frequency half of the transit term is scored as zero rather than handed back
   * as density — because handing it back made a partial-coverage run score 6.45
   * points ABOVE a full-coverage run over the identical stops.
   *
   * See `accessibilityTransitTerm` in `scoring.ts` for the invariant this exists
   * to satisfy: MORE INFORMATION MUST NEVER PRODUCE A HIGHER TRANSIT TERM.
   */
  measuresFrequency: boolean;
  /**
   * The share (0–1) of ALL the stops counted above that meet the frequent-service
   * headway on a representative service day, or null when the source cannot say.
   *
   * THE DENOMINATOR IS `totalStops`, AND THAT IS WHAT MAKES THE SENTENCE TRUE.
   * It used to be the stops for which a peak headway could be derived, while the
   * narrative, the report table and the results-board tile all called it a share
   * of the corridor's stops — so a corridor with weekend-only stops printed a
   * share of a denominator nothing on screen named. A stop the feed schedules but
   * whose representative service day yields no derivable interval does not meet a
   * 15-minute peak headway; counting it as not meeting it is a finding, not an
   * assumption, and it is what makes the share monotone in how much was measured.
   *
   * Null is NOT zero. A source that records where stops are and nothing about
   * how often service calls there has no opinion on frequency, and printing its
   * silence as "no stop is frequent" would state a finding it never made.
   */
  frequentServiceShare: number | null;
  /** The stops behind that share. Null whenever the share is null. */
  frequentServiceStops: number | null;
  /** The peak headway, in minutes, the share was taken at. Null with the share. */
  frequentServiceHeadwayMinutes: number | null;

  /**
   * True when a per-run row cap stopped the read before the source was
   * exhausted, so `totalStops` is a floor rather than a count.
   *
   * Disclosed rather than absorbed: this number divides into a density that
   * lands in a grant application, and a count that silently stopped counting is
   * a wrong number rather than a missing one.
   */
  truncated: boolean;

  /** How the figures above were produced. See `method.ts`. */
  method: TransitAccessMethod;
  /** Sources that contributed, for disclosure. */
  contributingSources: TransitContributingSource[];
  /**
   * Qualifications that must be shown wherever these figures are.
   *
   * Built by `selectGtfsCaveats` for a feed-derived summary and empty for every
   * other source, because those caveats are about how a GTFS headway is derived
   * and attaching them to an OSM stop tally would be noise — and noise is what
   * trains a reader to skip the caveats that matter.
   */
  caveats: string[];
  /** The line the deterministic corridor narrative prints for transit. */
  narrativeLine: string;
  /** The `sourceSnapshots.transit` entry, built with the figures it describes. */
  sourceSnapshot: Record<string, unknown>;
}

/** One source that contributed to a summary, named so a planner can audit it. */
export type TransitContributingSource = {
  /** Adapter-scoped identifier. For GTFS this is the feed's id. */
  id: string;
  /** What a planner calls it — an agency name, or the adapter's own label. */
  label: string;
  /**
   * The service window the contributed figures describe, when the source has
   * one. A GTFS feed whose schedule ended is still counted (see `gtfs-feed.ts`)
   * and this is how a reader learns that.
   */
  serviceEndDate?: string | null;
};

/** A summary before its own disclosure is attached. */
export type TransitAccessCore = Omit<
  TransitAccessSummary,
  "sourceSnapshot" | "narrativeLine" | "caveats"
> & { caveats?: string[] };

/** Everything an adapter is given. */
export type TransitFetchContext = {
  bbox: StudyAreaBbox;
  /**
   * The workspace the run belongs to.
   *
   * Load-bearing for the GTFS adapter and unused by OSM. `gtfs_feeds` rows with
   * `workspace_id IS NULL` are PUBLIC PRELOADED feeds shared by every tenant on
   * a deployment, so a read that merely follows RLS would show a workspace a
   * stranger's transit agency as its own. The adapter filters explicitly.
   */
  workspaceId: string;
  /**
   * A service-role client. The GTFS adapter re-imposes the workspace boundary
   * itself; see its header for why that is not a shortcut around RLS.
   */
  client: SupabaseClient;
  signal?: AbortSignal;
};

/**
 * What an adapter answers.
 *
 * `declined` is not a failure and must not be summarized as one: it means this
 * adapter has nothing to say about this study area, and the registry moves on
 * to the next one. `unavailable` means the adapter SHOULD have been able to
 * answer and its source could not be reached — the state that must never be
 * rendered as a count of zero.
 */
export type TransitAdapterOutcome =
  | { kind: "answered"; core: TransitAccessCore }
  | { kind: "declined"; reason: string }
  | { kind: "unavailable"; reason: string };

export type TransitSourceAdapter = {
  id: TransitSourceId;
  label: string;
  /** Required attribution, rendered wherever this source's figures appear. */
  attribution: string | null;
  fetch: (context: TransitFetchContext) => Promise<TransitAdapterOutcome>;
};

/**
 * Stop density to a tier, shared by every adapter.
 *
 * SHARED SO THE TIERS CANNOT DIVERGE. Two adapters that classified the same
 * density differently would make "medium transit access" mean two things in one
 * product, and the tier is what an AI narrative and a report both quote.
 */
export function classifyTransitAccessTier(stopsPerSqMile: number): "high" | "medium" | "low" {
  if (stopsPerSqMile >= 8) return "high";
  if (stopsPerSqMile >= 3) return "medium";
  return "low";
}
