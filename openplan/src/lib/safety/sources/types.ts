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
import {
  CRASH_SEVERITIES,
  isCrashSeverity,
  type CrashAgeBand,
  type CrashCollisionType,
  type CrashDimension,
  type CrashDimensionCapability,
  type CrashLighting,
  type CrashPartyRole,
  type CrashPersonInjury,
  type CrashSeverity,
  type CrashWeather,
} from "@/lib/safety/vocabulary";

/**
 * The severity band and the neutral vocabulary it belongs to now live in
 * `src/lib/safety/vocabulary.ts`, which is the single declaration of every
 * dimension's values AND of the column names that store them. They are
 * re-exported here so the adapter contract still reads as one file, and so the
 * dozens of existing `from "./types"` imports keep working — but nothing may
 * spell a vocabulary value anywhere except that module and a source descriptor.
 */
export { CRASH_SEVERITIES, isCrashSeverity };
export type { CrashSeverity };

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
  /**
   * People killed / injured, or NULL when the source supplied no count.
   *
   * NULLABLE ON PURPOSE, and this is the correction the `unknown` severity band
   * exists to make possible. A missing count used to parse to 0, and zero killed
   * plus zero injured is the definition of property-damage-only — so a collision
   * whose outcome the source never recorded was stored, filtered and counted as
   * a crash where nobody was hurt. That is roughly 4.7% of one state's 2025
   * records and 9.5% in one rural county of it. A count that could not be read
   * is not zero, all the way to the column and the screen.
   */
  killedCount: number | null;
  injuredCount: number | null;
  pedestrianInvolved: boolean;
  bicyclistInvolved: boolean;
  /**
   * Motorcyclist involvement.
   *
   * A third vulnerable-road-user flag beside pedestrian and bicyclist, because
   * motorcyclists are a distinct countermeasure audience and were invisible at
   * every layer of this product. Sources that cannot express it declare
   * `party_role` support below `supplied`, which is what stops a `false` here
   * from reading as "no motorcyclist was involved".
   */
  motorcyclistInvolved: boolean;
  /**
   * Neutral dimensions, or NULL when the SOURCE does not record the dimension at
   * all. Distinguish carefully: `"unknown"` means the source records lighting
   * and had none for this crash; `null` means the source has no lighting field,
   * which is a fact about the source and is disclosed once per ingest via
   * `CrashSourceAdapter.dimensions`.
   */
  collisionType: CrashCollisionType | null;
  lighting: CrashLighting | null;
  weather: CrashWeather | null;
  /**
   * Values the source supplied that its descriptor does not declare, kept
   * verbatim under their source column name.
   *
   * A value we could not classify is preserved rather than dropped, so an
   * operator can audit what the mapping is missing and a later descriptor can
   * pick it up without a re-ingest being the only way to find out what was lost.
   * NOTHING outside `src/lib/safety/sources/**` may read a key out of this blob:
   * the moment a screen does, a source's private spelling has become part of the
   * product's vocabulary.
   */
  sourceAttributes: Record<string, string>;
  latitude: number;
  longitude: number;
  /**
   * 2-digit state FIPS ("06" = California), when the source carries it. Used to
   * dedup a national backstop against a regional primary: a FARS fatal in
   * California is already in CCRS, so the multi-source read drops backstop
   * records whose state the primary already covers. Undefined when the source
   * does not expose state.
   */
  stateFips?: string;
  /**
   * The adapter id that produced this record. Set so a MERGED result (a primary
   * plus a national backstop) can carry per-point provenance — otherwise every
   * merged crash point would inherit the primary source id and a FARS Nevada
   * fatal would render as CCRS. Undefined falls back to the summarizing adapter.
   */
  sourceId?: string;
};

/**
 * One person in one collision.
 *
 * ROWS, NOT A SUMMARY. A per-crash summary blob cannot answer "pedestrian
 * fatalities among people 65 or older", which is precisely the question a safety
 * action plan is built on; and a summary computed at ingest freezes the age
 * banding, so changing a band would mean re-ingesting every workspace.
 *
 * WHAT IS NOT HERE IS THE DESIGN. No name, no race or ethnicity, no sex, no
 * exact age, no licence, no vehicle description, no sobriety or fault
 * allegation, no seat position or airbag detail, no report number. Those fields
 * exist in the source and are never requested — refused in the SELECT, not
 * merely left off a screen. `src/test/refused-crash-person-fields.test.ts`
 * carries the argument and fails if one is ever added.
 */
export type CrashPartyRecord = {
  /** The crash this person was in — the source's own case id. */
  crashExternalId: string;
  /** Stable per-person id within the source, e.g. case id + party number. */
  externalPartyId: string;
  role: CrashPartyRole;
  ageBand: CrashAgeBand;
  injury: CrashPersonInjury;
  /** Unmapped source spellings, same contract as `CrashRecord.sourceAttributes`. */
  sourceAttributes: Record<string, string>;
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
  /**
   * How many values, per dimension, the source supplied but the descriptor does
   * not declare. Absent keys mean none fell through.
   *
   * Kept as a tally rather than a flag because the useful sentence names a
   * number: a facet that failed to classify 314 of 400,000 rows is usable and a
   * facet that failed on a third of them is not, and only the count separates
   * them.
   */
  unmappedByDimension?: Partial<Record<CrashDimension, number>>;
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
  /**
   * What this source can say about each neutral dimension.
   *
   * REQUIRED, not optional, and that is the mechanism that keeps a facet honest
   * across sources. It is written onto every ingest row, and the filter panel
   * renders a `not_supplied` dimension as a disabled control naming the reason
   * rather than as a control that returns nothing. Without it, "this source has
   * no lighting field" and "no crash here happened after dark" are the same
   * empty list on screen, and only one of them is a finding.
   *
   * A new jurisdiction supplies this in its descriptor. Nothing branches on an
   * adapter id to decide which facets to show.
   */
  dimensions: CrashDimensionCapability;
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
  /**
   * The state FIPS codes this source AUTHORITATIVELY covers, when it is a
   * regional source. Used by the multi-source read to dedup a national backstop:
   * backstop records whose state is in a regional primary's `coversStateFips` are
   * already represented by the primary and are dropped. Undefined means the
   * source is national (a backstop, e.g. FARS) and claims no exclusive state.
   */
  coversStateFips?: readonly string[];
  /** True when this adapter can serve the given study area. */
  covers: (bbox: StudyAreaBbox) => boolean;
  fetch: (params: CrashFetchParams) => Promise<CrashFetchResult>;
  /**
   * Person-level rows for crashes this adapter already returned.
   *
   * OPTIONAL, and the absence is itself the declaration: a source with no person
   * table simply does not define it, which must agree with its `party_role` and
   * `person_injury` capability above. Defining it here rather than letting the
   * ingest branch on an adapter id is what keeps the ingest jurisdiction-neutral
   * — the sequence asks "can this source do people?", never "is this source
   * California?".
   *
   * A throw is not fatal to an ingest: the crashes are real and worth keeping,
   * and the run records that person rows were not retrieved instead of recording
   * that there were none.
   */
  fetchParties?: (params: CrashPartyFetchParams) => Promise<CrashPartyRecord[]>;
};

/**
 * Which already-fetched crashes to pull person rows for.
 *
 * Keyed by the crashes rather than by a bbox because person tables generally
 * carry no coordinates — they can only be reached by case id, batched. Passing
 * the year alongside lets a per-year-partitioned source pick its table without
 * the ingest knowing that it is partitioned.
 */
export type CrashPartyFetchParams = {
  crashes: ReadonlyArray<{ externalId: string; collisionYear: number | null }>;
  signal?: AbortSignal;
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
