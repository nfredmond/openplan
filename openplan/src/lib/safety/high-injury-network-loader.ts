import type { CrashSeverity } from "./sources/types";
import { isCrashSeverity } from "./vocabulary";
import {
  computeHighInjuryNetwork,
  highInjuryNetworkBasis,
  highInjuryNetworkSeverities,
  type HighInjuryNetwork,
  type HighInjuryNetworkCrash,
} from "./high-injury-network";
import type { SafetyRoadContextFeature } from "./road-context";

/** The PostgREST row cap. A page can never be larger than this. */
const PAGE_SIZE = 1000;
/** Above this many severe crashes the ranking is refused rather than partial. */
export const HIGH_INJURY_NETWORK_MAX_CRASHES = 20_000;

type PageResult = { data: unknown[] | null; error: unknown; count?: number | null };

/** The query chain the loader uses. Kept narrow so tests can type their fakes. */
export type HighInjuryNetworkCrashQuery = PromiseLike<PageResult> & {
  eq(column: string, value: unknown): HighInjuryNetworkCrashQuery;
  gte(column: string, value: unknown): HighInjuryNetworkCrashQuery;
  lte(column: string, value: unknown): HighInjuryNetworkCrashQuery;
  in(column: string, values: readonly unknown[]): HighInjuryNetworkCrashQuery;
  order(column: string, options: { ascending: boolean }): HighInjuryNetworkCrashQuery;
  range(from: number, to: number): HighInjuryNetworkCrashQuery;
};

export type HighInjuryNetworkSupabaseLike = {
  from(table: "safety_crashes"): {
    select(columns: string, options?: { count: "exact" }): HighInjuryNetworkCrashQuery;
  };
};

export const HIGH_INJURY_NETWORK_CRASH_PROJECTION = "id, longitude, latitude, severity";

export type HighInjuryNetworkScope = {
  workspaceId: string;
  ingestId: string;
  bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number };
  severities: readonly CrashSeverity[];
  /** Exact requested-year membership, when supplied; not observation coverage. */
  years?: readonly number[];
  yearFrom?: number;
  yearTo?: number;
};

export type HighInjuryNetworkCrashRead =
  | { status: "read"; crashes: HighInjuryNetworkCrash[]; count: number }
  | { status: "failed" }
  | { status: "too_many"; count: number };

function readRow(row: unknown): HighInjuryNetworkCrash | null {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const record = row as Record<string, unknown>;
  const longitude = Number(record.longitude);
  const latitude = Number(record.latitude);
  if (typeof record.id !== "string" || !isCrashSeverity(record.severity)) return null;
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  return { id: record.id, longitude, latitude, severity: record.severity };
}

/** Validate the requested set and intersect it with optional map bounds. */
function selectedYears(years: readonly number[], yearFrom?: number, yearTo?: number): number[] | null {
  const validYear = (year: number) => Number.isInteger(year) && year >= 1900 && year <= 2100;
  if (!Array.isArray(years) || years.length === 0 || !years.every(validYear)) return null;
  if (yearFrom !== undefined && !validYear(yearFrom)) return null;
  if (yearTo !== undefined && !validYear(yearTo)) return null;
  const selected = [...new Set(years)].filter((year) =>
    (yearFrom === undefined || year >= yearFrom) && (yearTo === undefined || year <= yearTo)
  ).sort((a, b) => a - b);
  return selected.length > 0 ? selected : null;
}

/**
 * Read every severe crash in scope, page by page under the row cap, and check
 * the pages add up to the database's exact count. A short read is a failure,
 * never a smaller network.
 */
export async function loadHighInjuryNetworkCrashes(
  supabase: HighInjuryNetworkSupabaseLike,
  scope: HighInjuryNetworkScope,
  maxCrashes: number = HIGH_INJURY_NETWORK_MAX_CRASHES,
): Promise<HighInjuryNetworkCrashRead> {
  // Omitted years preserve the low-level loader's existing range-only callers.
  // An explicit missing/invalid set must never become an unfiltered read.
  const years = scope.years === undefined ? undefined : selectedYears(scope.years, scope.yearFrom, scope.yearTo);
  if (years === null) return { status: "failed" };
  const page = (from: number) => {
    let query = supabase
      .from("safety_crashes")
      .select(HIGH_INJURY_NETWORK_CRASH_PROJECTION, { count: "exact" })
      .eq("workspace_id", scope.workspaceId)
      .eq("ingest_id", scope.ingestId)
      .gte("longitude", scope.bbox.minLon)
      .lte("longitude", scope.bbox.maxLon)
      .gte("latitude", scope.bbox.minLat)
      .lte("latitude", scope.bbox.maxLat)
      .in("severity", [...scope.severities]);
    if (years !== undefined) query = query.in("collision_year", years);
    if (scope.yearFrom !== undefined) query = query.gte("collision_year", scope.yearFrom);
    if (scope.yearTo !== undefined) query = query.lte("collision_year", scope.yearTo);
    return query.order("id", { ascending: true }).range(from, from + PAGE_SIZE - 1);
  };

  try {
    const first = await page(0);
    if (first.error || typeof first.count !== "number" || !Number.isInteger(first.count) || first.count < 0) {
      return { status: "failed" };
    }
    const total = first.count;
    if (total > maxCrashes) return { status: "too_many", count: total };

    const rows: unknown[] = [...(first.data ?? [])];
    // The rest of the pages at once, by offset. Ordered by id, so the pages
    // cannot overlap; a short or failed page fails the whole read below.
    // The step is the first page's own length, so a server with a lower row
    // cap than PAGE_SIZE is still read in full.
    if (rows.length === 0 && total > 0) return { status: "failed" };
    const step = rows.length;
    const offsets: number[] = [];
    for (let offset = rows.length; offset < total; offset += step) offsets.push(offset);
    const pages = await Promise.all(offsets.map((offset) => page(offset)));
    for (const next of pages) {
      if (next.error || !next.data || next.data.length === 0) return { status: "failed" };
      rows.push(...next.data);
    }
    if (rows.length !== total) return { status: "failed" };

    const crashes = rows.flatMap((row) => {
      const crash = readRow(row);
      return crash ? [crash] : [];
    });
    return { status: "read", crashes, count: total };
  } catch {
    return { status: "failed" };
  }
}

/**
 * Load and rank in one step for a route. Every failure becomes an explicit
 * unavailable state with its reason; none becomes an empty list.
 */
export async function buildHighInjuryNetworkForIngest(
  supabase: HighInjuryNetworkSupabaseLike,
  input: {
    workspaceId: string;
    ingestId: string;
    severityCompleteness: string | null | undefined;
    bbox: HighInjuryNetworkScope["bbox"];
    /** Requested years to filter exactly, not complete observation duration. */
    years: readonly number[];
    yearFrom?: number;
    yearTo?: number;
    roads: readonly SafetyRoadContextFeature[] | null;
  },
): Promise<HighInjuryNetwork> {
  const basis = highInjuryNetworkBasis(input.severityCompleteness);
  if (!basis) return { status: "unavailable", reason: "severity_coverage_unknown", basis: null };
  if (input.roads === null) return { status: "unavailable", reason: "road_read_failed", basis };
  const years = selectedYears(input.years, input.yearFrom, input.yearTo);
  if (years === null) return { status: "unavailable", reason: "year_scope_unavailable", basis };

  const read = await loadHighInjuryNetworkCrashes(supabase, {
    workspaceId: input.workspaceId,
    ingestId: input.ingestId,
    bbox: input.bbox,
    severities: highInjuryNetworkSeverities(basis),
    years,
    yearFrom: input.yearFrom,
    yearTo: input.yearTo,
  });
  if (read.status === "failed") return { status: "unavailable", reason: "crash_read_failed", basis };
  if (read.status === "too_many") return { status: "unavailable", reason: "too_many_crashes", basis };

  return computeHighInjuryNetwork({
    crashes: read.crashes,
    crashesConsidered: read.count,
    basis,
    roads: input.roads,
    years,
  });
}
