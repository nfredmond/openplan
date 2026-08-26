/**
 * Shapes shared between the Safety API routes and the client components.
 * Kept separate from `sources/types.ts` so client bundles do not pull in the
 * adapter implementations.
 */

import type { CrashSeverity } from "./sources/types";

export type SafetyCrashProperties = {
  kind: "safety_crash";
  id: string;
  externalId: string;
  sourceId: string;
  collisionDate: string | null;
  collisionYear: number | null;
  severity: CrashSeverity;
  /**
   * NULLABLE, all the way to the screen. A source that supplied no casualty
   * count has not told us that nobody was hurt, and a `0` in this slot is that
   * claim being made on its behalf. Renderers must say "not reported" — see
   * `SEVERITY_LABELS.unknown` for the band that goes with it.
   */
  killedCount: number | null;
  injuredCount: number | null;
  pedestrianInvolved: boolean;
  bicyclistInvolved: boolean;
  /**
   * The third vulnerable-road-user flag. Motorcyclists were invisible at every
   * layer of this product while one state's 2025 file alone carries 12,513
   * collisions involving a motorcycle.
   */
  motorcyclistInvolved: boolean;
  /**
   * The neutral dimensions, or NULL when the SOURCE does not record the
   * dimension at all.
   *
   * READ THE DIFFERENCE CAREFULLY, because the two states must never render the
   * same. `"unknown"` means the source records lighting and supplied none for
   * this crash. `null` means the source has no lighting field — a fact about the
   * feed, disclosed once per acquisition in `dimensionCoverage`, and the reason
   * the filter panel disables a facet instead of returning an empty list.
   */
  collisionType: string | null;
  lighting: string | null;
  weather: string | null;
};

export type SafetyCrashFeature = GeoJSON.Feature<GeoJSON.Point, SafetyCrashProperties>;

export type SafetyCrashCollection = GeoJSON.FeatureCollection<GeoJSON.Point, SafetyCrashProperties>;

/** One ranked concentration of observed fatal/serious-injury crash records. */
export type SafetyKsiConcentration = {
  rank: number;
  longitude: number;
  latitude: number;
  crashCount: number;
  fatalCrashCount: number;
  seriousInjuryCrashCount: number;
  radiusMeters: number;
  roadIdentity?: import("./road-context").SafetyRoadIdentity;
};

/** A validated bounding box assembled from one or more user-chosen crash acquisitions. */
export type SafetyKsiBounds = {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
};

/** One Census-tract context row for mapped KSI crash burden. */
export type SafetyKsiEquityTract = {
  rank: number;
  geoid: string;
  tractName: string | null;
  ksiCrashCount: number;
  fatalCrashCount: number;
  seriousInjuryCrashCount: number;
  population: number | null;
  ksiPer100k: number | null;
  pctPoverty: number | null;
  pctNonwhite: number | null;
  pctZeroVehicle: number | null;
  areaMedianPctPoverty: number | null;
  areaMedianPctNonwhite: number | null;
  areaMedianPctZeroVehicle: number | null;
};

/** The crash-query response, including the counts that keep the UI honest. */
export type SafetyCrashQueryResponse = SafetyCrashCollection & {
  /** How many features this response actually carries. */
  returnedCount: number;
  /** How many crashes matched the filters in the database. */
  matchedCount: number;
  /**
   * Whether `matchedCount` is the database's exact count or a fallback to the
   * number of rows fetched. The fallback is CAPPED, so a page that states it as
   * a total claims the study area holds exactly as many crashes as the map
   * happened to draw. Absent on an older response, which is read as "not known
   * to be exact" rather than as "exact".
   */
  matchedCountIsExact?: boolean;
  /**
   * Crashes per severity band across the WHOLE study area under these filters,
   * counted in Postgres — or `null` when they could not be counted.
   *
   * This is what the KSI headline is built from. It exists because the features
   * above are capped: a real run drew 1,000 crashes against 11,870 matching the
   * study area, so adding the drawn dots up understated the headline by roughly
   * an order of magnitude — on a figure that goes into grant applications.
   *
   * `null` MEANS NOT COUNTED, NEVER NONE. It is all-or-nothing on purpose: a
   * partial map would render a band that failed to count as a band with no
   * crashes in it, and a zero in the fatal row reads as good news.
   */
  severityTotals?: Readonly<Record<string, number>> | null;
  /**
   * Matched rows the response could not render honestly — an unusable
   * coordinate pair or a severity outside the vocabulary.
   *
   * Reported rather than swallowed. Without it, `returnedCount` silently drops
   * below `matchedCount` and the UI reports truncation, sending a planner to
   * look for records that are in the table and undrawable rather than beyond a
   * cap.
   */
  undrawableCount: number;
  /** True when the map is showing a subset because of the cap. */
  truncated: boolean;
  limit: number;
  /** Exact database-side clusters over the whole requested area, or null when unavailable. */
  ksiConcentrations: SafetyKsiConcentration[] | null;
  /** Frozen named roads used for identity matching and local printable context. */
  roadContext?: import("./road-context").SafetyRoadContextFeature[] | null;
  roadContextCoverageLimit?: string;
  /** US Census tract context for mapped KSI records; empty where no adapter data exists. */
  ksiEquityTracts: SafetyKsiEquityTract[] | null;
  ksiEquityDemographicSource: { label: string; vintage: string };
};

/** The latest ingest for a workspace, as rendered by the coverage banner. */
export type SafetyIngestSummary = {
  id: string;
  sourceLabel: string | null;
  attribution: string | null;
  coverageState: string;
  severityCompleteness: string;
  status: string;
  /** Reported crashes — including any the source could not geolocate. */
  crashCount: number;
  /** Of those, how many carry coordinates and can therefore be mapped. */
  geocodedCount: number;
  truncated: boolean;
  yearsRequested: number[];
  fetchError: string | null;
  createdAt: string;
  /**
   * The sources that were consulted, when coverage decided the outcome.
   *
   * Optional because `safety_crash_ingests` does not store it — only a fresh
   * retrieval knows it. A coverage gap that can name what it checked is a
   * different statement from one that cannot, and the UI says whichever is
   * true rather than implying the fuller one.
   */
  checkedSourceLabels?: string[];
  /**
   * `safety_crash_ingests.dimension_coverage` — per-dimension source capability.
   *
   * Deliberately typed as `unknown` rather than as a record: it arrives from
   * PostgREST as untyped JSONB (this codebase has no generated Supabase types,
   * by decision), so the only honest thing a consumer can do is read it through
   * `facetAvailability`, which yields `"unknown"` for anything it cannot parse
   * instead of assuming the source supplied the dimension.
   */
  dimensionCoverage?: unknown;
  /** Whether person-level rows were retrieved for this acquisition. */
  partyCompleteness?: string;
  /** People stored, or null when they were not retrieved. Never 0-for-unknown. */
  partyCount?: number | null;
  /** `party_rows` or `crash_flags` — which basis the involvement flags rest on. */
  involvementBasis?: string | null;
  /** Exact source-published cutoff, not inferred from requested or returned years. */
  publishedThrough?: string | null;
  publishedThroughProvenance?: Record<string, unknown> | null;
};

/**
 * A LIVE READ — crashes retrieved from a registered source that this workspace
 * may not store, held for the current visit only.
 *
 * It is deliberately a separate type from `SafetyIngestSummary` rather than a
 * flag on it. An ingest summary describes a row in `safety_crash_ingests`, and
 * everything that reads one — the coverage banner, the acquisition history, the
 * project spine — is entitled to assume the crashes it counts are in
 * `safety_crashes`. A live read breaks that assumption, so it gets its own
 * shape and its own banner instead of quietly widening the meaning of an
 * existing one.
 */
export type SafetyLiveCrashRead = {
  sourceLabel: string;
  attribution: string | null;
  coverageState: string;
  severityCompleteness: string;
  /** Reported crashes matching the query, geocoded or not. */
  crashCount: number;
  /** Of those, how many carry coordinates and are in `collection`. */
  geocodedCount: number;
  truncated: boolean;
  yearsRequested: number[];
  /** Years the source actually returned records for. */
  yearsCovered: number[];
  /** The crash points themselves. They exist nowhere else. */
  collection: SafetyCrashCollection;
  retrievedAt: string;
  publishedThrough?: string | null;
  publishedThroughProvenance?: Record<string, unknown> | null;
  /**
   * The same per-dimension capability an acquisition records, for the source
   * this read came from. A live read stores nothing, but the SAME filter panel
   * renders both lanes — so if this were absent the panel would offer facets a
   * fatality census cannot answer and present the empty result as a finding.
   */
  dimensionCoverage?: unknown;
};

/** A workspace project offered on the ingest launcher's attach selector. */
export type SafetyProjectOption = {
  id: string;
  name: string;
  status: string;
};

/**
 * One acquisition-history row. The ingest — not the crash point — is the
 * acquisition unit, so the project link lives here.
 */
export type SafetyIngestHistoryEntry = {
  id: string;
  projectId: string | null;
  sourceLabel: string | null;
  coverageState: string;
  status: string;
  /** Reported crashes — including any the source could not geolocate. */
  crashCount: number;
  /** Of those, how many carry coordinates and can therefore be mapped. */
  geocodedCount: number;
  yearsRequested: number[];
  publishedThrough?: string | null;
  publishedThroughProvenance?: Record<string, unknown> | null;
  /**
   * The area this pull covered, as recorded when it ran.
   *
   * A crash count with no stated area is a number a planner cannot defend. The
   * history listed source, years, counts and status, and said nothing at all
   * about WHERE — so an acquisition attached to a project could not be told
   * apart from one covering a whole county. The database has always stored the
   * extent; it simply was not selected, was not on this type, and never reached
   * the screen.
   *
   * Null when the row records no extent, which is not the same as covering
   * nothing and must not be rendered as an area of zero.
   */
  scope: SafetyIngestScope | null;
  createdAt: string;
};

/**
 * Where an acquisition looked. Deliberately not a place NAME: the pull records
 * a bounding box and, for some sources, a county code, and no place label is
 * stored at request time. Naming the place properly means recording it when the
 * pull is made — the fuller fix, and a migration. Until then this says exactly
 * what is known rather than guessing a name from a code.
 */
export type SafetyIngestScope = {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
  /** The source's own county identifier, when the pull was scoped to one. */
  countyCode: number | null;
};

export const SEVERITY_LABELS: Record<CrashSeverity, string> = {
  fatal: "Fatal",
  severe_injury: "Serious injury",
  injury: "Injury",
  pdo: "Property damage only",
  /**
   * NOT "unknown severity" and emphatically not blank. These are collisions the
   * source reported while supplying no casualty count at all — 4.7% of one
   * state's 2025 records, 9.5% in one rural county of it. They used to be stored
   * as property-damage-only, because a missing count parsed to zero. The label
   * has to say that the classification is missing, not that the outcome was mild.
   */
  unknown: "Not classified — no casualty count reported",
};

/**
 * Human-readable coverage copy. Deliberately explicit about what each state
 * does NOT establish — an empty map must never read as "no crashes here".
 */
export const COVERAGE_STATE_COPY: Record<string, string> = {
  ccrs_ca_statewide:
    "California Crash Reporting System (CCRS) — statewide California, reported collisions from 2016 onward.",
  fars_fatal_only:
    "NHTSA FARS — fatal crashes only. Injury and property-damage collisions are not included.",
  switrs_legacy_local:
    "Legacy SWITRS extract — a discontinued system frozen at 2025-01-08. Historical use only.",
  /**
   * WORDED FOR WHAT THE STATE ACTUALLY MEANS, which is narrower than it used to
   * claim. This sentence read "No registered crash source covers this study
   * area" — a claim about the WHOLE registry — but both surfaces that render it
   * reach it after checking only a SUBSET: the Safety ingest resolves only
   * adapters `safety_crashes.source_id` will admit, and the shared map's crash
   * layer asks the same storable-only question of the workspace's home
   * geography. A registered national adapter covering the place was therefore
   * routinely present while this sentence denied it existed.
   *
   * Every call site names the sources it checked alongside this copy, so the
   * sentence carries only what it can support: nothing that was checked covered
   * the area, and that is not a finding about crashes.
   */
  out_of_coverage:
    "No crashes were retrieved, because none of the crash sources checked for this study area covers it. This is not evidence that no crashes occurred.",
  source_unavailable:
    "The crash source could not be reached, so no crashes were retrieved. This is not evidence that no crashes occurred.",
};
