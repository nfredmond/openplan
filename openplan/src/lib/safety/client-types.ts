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
  out_of_coverage:
    "No registered crash source covers this study area, so no crashes could be retrieved. This is not evidence that no crashes occurred.",
  source_unavailable:
    "The crash source could not be reached, so no crashes were retrieved. This is not evidence that no crashes occurred.",
};
