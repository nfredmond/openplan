/**
 * Which census tracts belong on this workspace's map, and what to say when the
 * answer is "none".
 *
 * THE DEFECT THIS REPLACES. `/api/map-features/census-tracts` selected
 * `.limit(500)` from `census_tracts_map` with no bbox, county, state or
 * workspace filter. `census_tracts` is a SHARED, national table that every
 * workspace's home-geography ingest writes into, so once more than 500 rows
 * existed — Los Angeles County alone has ~2,500 — the equity choropleth drew an
 * arbitrary slice of whatever had been ingested, quite possibly none of the
 * viewer's own geography, with nothing on screen saying so.
 *
 * WHY THERE IS NO STATE-WIDE FALLBACK. Tract ingest is triggered only for a
 * home geography of kind `county`. A city, CDP or metro workspace therefore has
 * no tracts of its own loaded, and filtering by state alone would draw whichever
 * counties some OTHER agency happened to ingest, in the same state, underneath
 * this workspace's map. That is the exact failure this module exists to prevent,
 * so an unsupported geography scopes to NOTHING and says why.
 *
 * Every sentence here follows the house formula the crash and equity-designation
 * lanes already use: state what was not done, and state explicitly what it does
 * NOT establish about the place.
 *
 * PURE — no I/O, no clock. Facts in, scope and copy out.
 */

import {
  tigerwebCountyFipsFromHomeGeography,
  type WorkspaceHomeGeography,
} from "@/lib/workspaces/home-geography";

/** How many features one map-layer response will carry. */
export const MAP_FEATURE_LAYER_LIMIT = 500;

export type CensusTractScopeState =
  /** Scoped to the workspace's stated county. */
  | "home_geography"
  /** Authenticated, but no workspace membership resolved. */
  | "no_workspace"
  /** The workspace has stated no home geography. */
  | "geography_not_set"
  /** Stated, but not a county — tract coverage is county-grained. */
  | "geography_kind_unsupported";

export type CensusTractScope =
  | {
      scopeState: "home_geography";
      stateFips: string;
      countyFips: string;
      scopeLabel: string | null;
    }
  | {
      scopeState: Exclude<CensusTractScopeState, "home_geography">;
      scopeLabel: string | null;
      /** The kind that could not be scoped, when there was one. */
      unsupportedKind: string | null;
    };

export function resolveCensusTractScope(
  geography: WorkspaceHomeGeography | null,
  options: { hasWorkspace: boolean }
): CensusTractScope {
  if (!options.hasWorkspace) {
    return { scopeState: "no_workspace", scopeLabel: null, unsupportedKind: null };
  }

  if (!geography) {
    return { scopeState: "geography_not_set", scopeLabel: null, unsupportedKind: null };
  }

  const county = tigerwebCountyFipsFromHomeGeography(geography);
  if (!county) {
    return {
      scopeState: "geography_kind_unsupported",
      scopeLabel: geography.home_geography_label,
      unsupportedKind: geography.home_geography_kind,
    };
  }

  return {
    scopeState: "home_geography",
    stateFips: county.stateFips,
    countyFips: county.countyFips,
    scopeLabel: geography.home_geography_label,
  };
}

export type CensusTractCoverageInput = {
  scopeState: CensusTractScopeState;
  scopeLabel: string | null;
  unsupportedKind?: string | null;
  /** Rows matching the scope in the database. */
  matchedCount: number;
  /** Features actually carried by the response. */
  returnedCount: number;
  /** Rows fetched but not drawable. Counted, never hidden. */
  droppedCount: number;
  limit: number;
};

/**
 * Where a workspace owner actually sets the home geography.
 *
 * Named concretely because a remedy that points at a page which does not exist
 * is worse than no remedy: there is no `/settings` route — the panel lives on
 * the dashboard.
 */
const GEOGRAPHY_REMEDY = "Set it in the Workspace geography panel on the dashboard.";

/** The label, or a neutral stand-in — never empty quotes. */
function placeName(scopeLabel: string | null): string {
  return scopeLabel && scopeLabel.trim().length > 0 ? scopeLabel.trim() : "this workspace's home county";
}

/**
 * The sentences a viewer must see for the equity layer.
 *
 * Returns an ordered list so a caller can render several at once: a scoped
 * county can simultaneously be truncated AND have dropped geometry, and
 * appending one to the other would let a non-truncated layer hide its drops.
 */
export function describeCensusTractCoverage(input: CensusTractCoverageInput): string[] {
  const notes: string[] = [];

  if (input.scopeState === "no_workspace") {
    notes.push(
      "Equity tracts are not shown: no workspace is active, so there is no geography to scope them to."
    );
    return notes;
  }

  if (input.scopeState === "geography_not_set") {
    notes.push(
      "Equity tracts are not shown because this workspace has not set a home geography, so there is " +
        "nothing to scope them to. This is not a finding that your area has no census tracts. " +
        GEOGRAPHY_REMEDY
    );
    return notes;
  }

  if (input.scopeState === "geography_kind_unsupported") {
    const kind = input.unsupportedKind ? `a ${input.unsupportedKind}` : "not a county";
    notes.push(
      `Equity tracts are not shown: census tract coverage is loaded county by county, and this ` +
        `workspace's home geography is ${kind}. This is not a finding that ${placeName(input.scopeLabel)} ` +
        `has no census tracts — tract data for it has simply never been requested. Multi-county and ` +
        `city-level tract coverage is not built yet.`
    );
    return notes;
  }

  // Scoped to a county from here on.
  if (input.matchedCount === 0) {
    notes.push(
      `Equity tracts are scoped to ${placeName(input.scopeLabel)}, but none have been loaded for it yet. ` +
        `This is not a finding that the county has no census tracts. Tract data loads in the background ` +
        `after a home geography is set, and stays empty when the deployment has no Census API key.`
    );
    return notes;
  }

  const drawn = input.returnedCount;
  if (drawn + input.droppedCount < input.matchedCount) {
    notes.push(
      `Showing ${drawn.toLocaleString()} of ${input.matchedCount.toLocaleString()} census tracts in ` +
        `${placeName(input.scopeLabel)} — the first ${input.limit.toLocaleString()} by tract ID, not the ` +
        `tracts nearest you. The rest of the county is not drawn, which is not a finding that it has no tracts.`
    );
  } else {
    notes.push(
      `Equity tracts are scoped to ${placeName(input.scopeLabel)} — this workspace's home geography.`
    );
  }

  if (input.droppedCount > 0) {
    notes.push(
      `${input.droppedCount.toLocaleString()} tract${input.droppedCount === 1 ? "" : "s"} could not be ` +
        `drawn because the stored boundary was unusable, so ${input.droppedCount === 1 ? "it is" : "they are"} ` +
        `missing from the map rather than absent from the county.`
    );
  }

  return notes;
}
