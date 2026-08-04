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
  killedCount: number;
  injuredCount: number;
  pedestrianInvolved: boolean;
  bicyclistInvolved: boolean;
};

export type SafetyCrashFeature = GeoJSON.Feature<GeoJSON.Point, SafetyCrashProperties>;

export type SafetyCrashCollection = GeoJSON.FeatureCollection<GeoJSON.Point, SafetyCrashProperties>;

/** The crash-query response, including the counts that keep the UI honest. */
export type SafetyCrashQueryResponse = SafetyCrashCollection & {
  /** How many features this response actually carries. */
  returnedCount: number;
  /** How many crashes matched the filters in the database. */
  matchedCount: number;
  /** True when returnedCount < matchedCount — the map is showing a subset. */
  truncated: boolean;
  limit: number;
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
  createdAt: string;
};

export const SEVERITY_LABELS: Record<CrashSeverity, string> = {
  fatal: "Fatal",
  severe_injury: "Serious injury",
  injury: "Injury",
  pdo: "Property damage only",
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
