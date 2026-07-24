/**
 * Crash-source adapter contract (Wave 8.1).
 *
 * The Safety module never fetches crash data directly. It resolves a *source
 * adapter* for a study area and asks that adapter for observed crash records.
 * This mirrors the multi-state traffic-count adapters (WA/CO/OR) already in the
 * repo: coverage grows by adding a descriptor, not by editing call sites.
 *
 * POSTURE — the load-bearing rule of this module:
 *
 *   An adapter may ONLY return crashes that were actually reported and
 *   geolocated by the source agency. There is no estimate tier here. Where no
 *   adapter covers a study area, the resolver returns an explicit
 *   `out_of_coverage` result and the caller shows that state — it never falls
 *   back to a synthesized figure.
 *
 * As of Wave 8.2 this is the ONLY crash lane in the platform.
 * `src/lib/data-sources/crashes.ts` — which used to fabricate counts from bbox
 * area for the Explore scorecard — is now a summarizer over this registry, so
 * the Safety module and the corridor scorecard can no longer disagree about
 * what a place's crash history is.
 *
 * Failure protocol: an adapter that cannot reach its source THROWS
 * (`CrashSourceUnavailableError` is the canonical shape). Returning an empty
 * `CrashFetchResult` means "the source answered, and there were no matching
 * crashes" — a real finding. Conflating the two is the single most dangerous
 * bug this module can have, because "0 fatalities" reads as a safe corridor.
 */

import type { StudyAreaBbox } from "@/lib/models/study-area";

/**
 * KABCO-aligned severity buckets.
 *
 * `severe_injury` is KABCO "A" (suspected serious injury). Fatal + severe_injury
 * together are the "KSI" measure that SS4A and HSIP are built on, which is why
 * the bucket exists even for sources that cannot populate it directly — see
 * `CrashSeverityCompleteness`.
 */
export const CRASH_SEVERITIES = ["fatal", "severe_injury", "injury", "pdo"] as const;
export type CrashSeverity = (typeof CRASH_SEVERITIES)[number];

/**
 * How completely a source can express severity. Rendered to the operator so a
 * "0 serious injuries" reading is never mistaken for "none occurred" when the
 * truth is "this source cannot distinguish them".
 */
export type CrashSeverityCompleteness =
  /** Fatal / severe-injury / injury / PDO are all distinguishable. */
  | "kabco_full"
  /** Fatal and injury are distinguishable; serious injury is NOT separable. */
  | "fatal_injury_only"
  /** Only fatal crashes are present at all. */
  | "fatal_only";

/** What a resolved source can say about a study area. */
export type SafetyCoverageState =
  | "ccrs_ca_statewide"
  | "fars_fatal_only"
  | "switrs_legacy_local"
  | "out_of_coverage"
  | "source_unavailable";

/** One observed, geolocated crash. Every field traces to a source column. */
export type CrashRecord = {
  /** The source's own stable case identifier — the dedup key. */
  externalId: string;
  /** ISO-8601 date (no time) when known; null when the source only gives a year. */
  collisionDate: string | null;
  collisionYear: number | null;
  severity: CrashSeverity;
  killedCount: number;
  injuredCount: number;
  pedestrianInvolved: boolean;
  bicyclistInvolved: boolean;
  latitude: number;
  longitude: number;
};

/**
 * The result of a fetch, including the counts needed to be honest about what
 * was NOT returned.
 *
 * `matchedTotal` vs `geocodedTotal` is not bookkeeping pedantry: CCRS geocodes
 * roughly 78% of its records, so a map built from `records` silently omits about
 * a fifth of reported crashes. Surfacing both numbers is what lets the UI say
 * "1,180 crashes reported, 916 mappable" instead of quietly showing 916.
 */
export type CrashFetchResult = {
  records: CrashRecord[];
  /** Reported crashes matching the query, geocoded or not. */
  matchedTotal: number;
  /** Of those, how many carried usable coordinates. */
  geocodedTotal: number;
  /** Years actually represented in the returned records. */
  yearsCovered: number[];
  /** True when a caller-supplied cap stopped paging before the source was exhausted. */
  truncated: boolean;
};

export type CrashFetchParams = {
  bbox: StudyAreaBbox;
  /** Calendar years to request, most-recent-first is conventional but not required. */
  years: number[];
  /**
   * Optional county filter (CCRS "County Code", CA alphabetical numbering —
   * 29 = Nevada). When supplied it is the LOSSLESS way to count a county's
   * reported crashes, because an ungeocoded crash has no coordinates and can
   * therefore never satisfy a bbox predicate. Supplying it is what lets
   * `matchedTotal` exceed `geocodedTotal` and the UI disclose the difference.
   */
  countyCode?: number;
  /**
   * Hard cap on returned records, so an ingest job cannot be surprised by a
   * metropolitan county. When hit, `truncated` is true.
   */
  maxRecords?: number;
  signal?: AbortSignal;
};

export type CrashSourceAdapter = {
  /** Stable id persisted on every crash row; also the `safety_crashes` CHECK domain. */
  id: string;
  label: string;
  /** Required attribution string, rendered wherever this source's data appears. */
  attribution: string;
  license: string;
  coverageState: SafetyCoverageState;
  severityCompleteness: CrashSeverityCompleteness;
  /** Earliest year the source holds; used to clamp requested years honestly. */
  earliestYear: number;
  /**
   * May rows from this source be WRITTEN to `safety_crashes`?
   *
   * The table's `source_id` CHECK is a closed domain, so persistence coverage
   * advances by migration while read coverage advances by registering an
   * adapter. Marking an adapter non-persistable keeps it usable for read-only
   * analysis (the Explore scorecard) while the DB allowlist catches up, instead
   * of letting an ingest discover the mismatch as a constraint violation.
   */
  persistable: boolean;
  /** True when this adapter can serve the given study area. */
  covers: (bbox: StudyAreaBbox) => boolean;
  fetch: (params: CrashFetchParams) => Promise<CrashFetchResult>;
};

/**
 * Why the caller wants a source.
 *
 * `ingest` (the default) only resolves adapters whose rows may legally be
 * stored. `read_only` resolves the full registry — used by the corridor
 * scorecard, which reports figures without persisting crash points.
 */
export type CrashSourceUse = "ingest" | "read_only";

/** What the resolver returns when nothing covers the study area. */
export type CrashSourceResolution =
  | { kind: "resolved"; adapter: CrashSourceAdapter }
  | { kind: "out_of_coverage"; checked: Array<{ id: string; label: string }> };

/**
 * Thrown by an adapter when its source could not be reached or answered in a
 * shape it does not recognize.
 *
 * This exists so "unreachable" can never be silently summarized as "zero
 * crashes". Callers translate it into an explicit unavailable state.
 */
export class CrashSourceUnavailableError extends Error {
  readonly sourceId: string;

  constructor(sourceId: string, message: string) {
    super(message);
    this.name = "CrashSourceUnavailableError";
    this.sourceId = sourceId;
  }
}

export function isCrashSeverity(value: unknown): value is CrashSeverity {
  return typeof value === "string" && (CRASH_SEVERITIES as readonly string[]).includes(value);
}
